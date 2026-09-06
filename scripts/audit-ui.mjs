// Local Electron / DOM audit. All database mutations are confined to a unique temp root.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { BrowserPlatformPublisher } from '../src/platforms/browser-platform-publisher.js';
import { config as jianshu } from '../src/platforms/jianshu/selectors.js';
import { detectWeiboLogin } from '../src/platforms/weibo/session.js';
import { captureRecentPosts, matchNewPost } from '../src/platforms/weibo/resolve-post.js';
import { selectors } from '../src/platforms/weibo/selectors.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'asm-audit-ui-'));
const app=await electron.launch({args:[root],cwd:root,env:{...process.env,AUTO_SEND_MANHUA_ROOT:temp},timeout:30000});
const observations=[];
async function check(id,requirement,action){
  try{await action();observations.push({id,requirement,passed:true});}
  catch(e){observations.push({id,requirement,passed:false,evidence:e.message});}
}
try {
  const page=await app.firstWindow();
  await page.route(/^https?:\/\//,route=>route.abort());
  await page.locator('[data-template="weibo"]').waitFor({state:'attached'});
  await check('U01','七个导航页面实际可切换',async()=>{
    for(const name of ['tasks','create','batch','accounts','templates','logs','settings']){
      await page.locator(`[data-page="${name}"]`).click();
      assert.equal(await page.locator(`#page-${name}`).isVisible(),true,name);
    }
  });
  await page.evaluate(async()=>{
    await window.autoSend.saveAccount({id:'audit_wb',platform:'weibo',nickname:'审计账号'});
    await window.autoSend.saveTemplate('weibo','CUSTOM_TEMPLATE {title} {content} {resourceUrl}');
    await window.autoSend.saveTemplate('zhihu','CUSTOM_ZHIHU {title} {weiboUrl}');
  });
  await page.locator('#refresh').click();
  await page.locator('#weibo-account option[value="audit_wb"]').waitFor({state:'attached'});
  await page.locator('[data-page="create"]').click();
  await page.locator('[name="title"]').fill('审计标题');
  await page.locator('[name="content"]').fill('审计正文');
  await page.locator('[name="platform"][value="zhihu"]').check();
  await page.locator('#weibo-account').selectOption('audit_wb');
  await page.locator('#preview-task').click();
  await page.waitForFunction(()=>document.querySelector('#content-preview').innerText.includes('审计正文'));
  await check('U02','预览使用用户保存的真实平台模板',async()=>{
    const text=await page.locator('#content-preview').innerText();
    assert.ok(text.includes('CUSTOM_TEMPLATE')&&text.includes('CUSTOM_ZHIHU'),`预览实际内容：${text}`);
  });
  // Await the actual refresh handler; do not wait for the buggy cleared state.
  await page.evaluate(() => refresh());
  await check('U03','刷新不得丢失已选择的平台和账号',async()=>{
    const account=await page.locator('#weibo-account').inputValue();
    const selected=await page.locator('[name="platform"][value="zhihu"]').isChecked();
    assert.ok(account==='audit_wb'&&selected,`刷新后 account=${JSON.stringify(account)}, zhihu=${selected}`);
  });
  await check('U04','账号管理跨平台同名 ID 不得覆盖原账号',async()=>{
    // Explicitly rejecting an already-used ID is also valid behavior.
    await page.evaluate(()=>window.autoSend.saveAccount({id:'audit_wb',platform:'zhihu',nickname:'不同平台'})).catch(()=>{});
    const snapshot=await page.evaluate(()=>window.autoSend.snapshot());
    assert.equal(snapshot.accounts.filter(x=>x.id==='audit_wb').some(x=>x.platform==='weibo'),true,'微博账号被知乎账号覆盖');
  });
  // Locally supplied DOM only: this does not claim live platform selector validation.
  await page.setContent('<div class="avatar">公开游客页的作者头像</div>');
  await check('U05','其他用户头像不能作为微博已登录证据',async()=>{
    assert.notEqual(await detectWeiboLogin(page),true,'仅存在普通 avatar 元素即判定已登录');
  });
  await page.setContent('<a href="https://www.jianshu.com/p/abcdef">旧文章</a>');
  await check('U06','发布后页面旧文章链接不得作为本次发布成功证据',async()=>{
    const publisher=new BrowserPlatformPublisher({config:jianshu});publisher.page=page;
    let result;
    try{result=await publisher.resolvePublishedUrl({}, {successSignal:false,changedUrl:'',submittedAt:new Date().toISOString()});}catch{return;}
    assert.notEqual(result.success,true,`实际返回 ${JSON.stringify(result)}`);
  });
  await page.setContent('<article data-published-at="'+new Date().toISOString()+'"><span>作者名字 今天 10:00</span><p>审计正文</p><a href="https://weibo.com/123/Abcd">详情</a></article>');
  await check('U07','微博卡片正文前有昵称/时间时仍能匹配正文',async()=>{
    const posts=await captureRecentPosts(page,selectors);
    assert.ok(matchNewPost([],posts,{content:'审计正文',userId:'123'}),`采集=${JSON.stringify(posts)}`);
  });
} finally { await app.close(); }
console.log(JSON.stringify({kind:'local-electron-audit',network:false,productionDatabase:false,tempRoot:temp,total:observations.length,violations:observations.filter(x=>!x.passed).length,observations},null,2));
process.exitCode=observations.some(x=>!x.passed)?1:0;
