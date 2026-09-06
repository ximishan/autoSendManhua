// A real local Chromium session exercises the production publishers.
// Every HTTP request is intercepted; these are synthetic pages, NOT live website acceptance.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Workflow } from '../src/core/workflow.js';
import { WeiboPublisher } from '../src/platforms/weibo/publisher.js';
import { BrowserPlatformPublisher } from '../src/platforms/browser-platform-publisher.js';
import { config as zhihuConfig } from '../src/platforms/zhihu/selectors.js';
import { openDatabase } from './test-db.mjs';

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'asm-browser-fixture-'));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlWQAAAAASUVORK5CYII=','base64');
const image=path.join(temp,'cover.png');fs.writeFileSync(image,png);
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext();
const counts={weibo:0,zhihu:0,unexpected:[]};
const captured={};
await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/fixture.png')return route.fulfill({contentType:'image/png',body:png});
  if(url.hostname==='weibo.com'&&url.pathname==='/ajax/config')return route.fulfill({json:{ok:1,data:{login:true,uid:'123'}}});
  if(url.hostname==='weibo.com'&&url.pathname==='/ajax/statuses/update') {
    counts.weibo++;captured.weibo=route.request().postDataJSON();
    return route.fulfill({json:{ok:1,data:{idstr:'123456789',mid:'123456789',mblogid:'Abcd',user:{idstr:'123'}}}});
  }
  if(url.hostname==='zhuanlan.zhihu.com'&&url.pathname==='/fixture-submit') {
    counts.zhihu++;captured.zhihu=route.request().postDataJSON();return route.fulfill({json:{ok:true}});
  }
  if(['weibo.com','zhuanlan.zhihu.com'].includes(url.hostname)) {
    const isWeibo=url.hostname==='weibo.com';
    return route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html><body>
      <form data-testid="composer"><input placeholder="标题"><textarea placeholder="分享新鲜事"></textarea>
      <div contenteditable="true" role="textbox"></div><input type="file" multiple accept="image/*"><div class="preview"></div>
      <button type="button">发布</button></form><div id="out"></div>
      <script>
      const wb=${isWeibo};
      document.querySelector('input[type=file]').onchange=e=>{
        for(const file of e.target.files){const img=new Image();img.src='/fixture.png';
          (wb?document.querySelector('.preview'):document.querySelector('[contenteditable]')).append(img);}
      };
      document.querySelector('button').onclick=async()=>{
        const text=wb?document.querySelector('textarea').value:document.querySelector('[contenteditable]').innerText;
        const images=(wb?document.querySelector('.preview'):document.querySelector('[contenteditable]')).querySelectorAll('img').length;
        await fetch(wb?'/ajax/statuses/update':'/fixture-submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,images})});
        document.querySelector('#out').innerHTML=wb?'发布成功':'文章发布成功 <a href="https://zhuanlan.zhihu.com/p/456">查看文章</a>';
      };
      </script></body></html>`});
  }
  counts.unexpected.push(url.hostname);return route.abort();
});
const sessions=new Map();
const manager={getSession:async(platform)=>{
  if(!sessions.has(platform))sessions.set(platform,{page:await context.newPage()});
  return sessions.get(platform);
}};
const db=openDatabase();
try {
  const workflow=new Workflow({database:db,publisherFactory:(platform,options)=>platform==='weibo'
    ?new WeiboPublisher({...options,browserManager:manager,responseTimeoutMs:5000})
    :new BrowserPlatformPublisher({...options,browserManager:manager,config:zhihuConfig})});
  for(const images of [[],[image,image]]) {
    // Fresh pages ensure the fixture has no previous success banner or article link.
    for(const session of sessions.values())await session.page.close();sessions.clear();
    const task=db.tasks.create({title:'本地浏览器验收',content:'这是原创测试正文',resourceUrl:'https://pan.example.com/test',images,selectedPlatforms:['zhihu']});
    const result=await workflow.runTask(task.id);
    assert.equal(result.status,'completed',JSON.stringify(result.jobs));
    assert.equal(captured.weibo.images,images.length);
    assert.equal(captured.zhihu.images,images.length);
    assert.match(captured.weibo.text,/pan.example.com/);
    assert.match(captured.zhihu.text,/https:\/\/weibo.com\/123\/Abcd/);
    assert.doesNotMatch(captured.zhihu.text,/pan.example.com/);
    await workflow.runTask(task.id);
  }
  assert.equal(counts.weibo,2);assert.equal(counts.zhihu,2);assert.deepEqual(counts.unexpected,[]);
  console.log(JSON.stringify({passed:true,mode:'synthetic-pages-real-browser',externalPublishing:false,cases:['text','two-images','weibo-url-injection','completed-task-not-republished'],counts},null,2));
} finally {db.close();await browser.close();}
