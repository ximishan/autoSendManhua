// Requirement audit: isolated SQLite; fake publishers simulate boundary responses only.
// No network or real publishing. Nonzero exit means requirements are violated.
import assert from 'node:assert/strict';
import { openDatabase } from './test-db.mjs';
import { Workflow } from '../src/core/workflow.js';
import { TaskQueue } from '../src/core/queue.js';
import { LoginRequiredError } from '../src/core/errors.js';
import { extractWeiboIdentifiers, buildWeiboUrls, matchNewPost } from '../src/platforms/weibo/resolve-post.js';
import { resolveProfileDir } from '../src/browser/profile-manager.js';

const observations = [];
const okWeibo = { success: true, canonicalUrl: 'https://weibo.com/123/Abcd' };
const draft = { title: '审计测试', content: '审计正文' };
async function check(id, requirement, action) {
  try { await action(); observations.push({ id, requirement, passed: true }); }
  catch (error) { observations.push({ id, requirement, passed: false, evidence: error.message }); }
}
async function scenario(action, publish = async () => okWeibo) {
  const db = openDatabase(':memory:');
  const calls = [];
  const workflow = new Workflow({ database: db,
    retryPolicy: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 },
    publisherFactory: (platform, options) => ({ publish: async (task, rendered) => {
      calls.push({ platform, id: task.id, account: options.account?.id });
      return publish(platform, task, rendered, db);
    } }) });
  try { await action({ db, workflow, calls }); } finally { db.close(); }
}
await check('A01', '下游 success:false 不得落库为 success', () => scenario(async ({db,workflow}) => {
  const task = db.tasks.create({...draft,selectedPlatforms:['zhihu']});
  const result = await workflow.runTask(task.id);
  assert.notEqual(result.jobs[1].status, 'success', JSON.stringify(result.jobs[1]));
}, async p => p==='weibo' ? okWeibo : {success:false,errorCode:'REJECTED',errorMessage:'平台拒绝'}));

await check('A02', '微博已提交但缺 URL 不得重新调用整个 publish', () => scenario(async ({db,workflow,calls}) => {
  const task=db.tasks.create(draft); await workflow.runTask(task.id);
  assert.equal(calls.length,1, `publish 调用 ${calls.length} 次`);
}, async () => ({success:true,id:'123'})));

await check('A03', '执行中暂停后不启动下游', () => scenario(async ({db,workflow,calls}) => {
  const task=db.tasks.create({...draft,selectedPlatforms:['zhihu']});
  const result=await workflow.runTask(task.id);
  assert.equal(calls.filter(x=>x.platform==='zhihu').length,0,`调用=${JSON.stringify(calls)} 最终状态=${result.status}`);
}, async (p,task,rendered,db) => { if(p==='weibo') db.tasks.setStatus(task.id,'paused'); return p==='weibo'?okWeibo:{success:true,postUrl:'https://zhuanlan.zhihu.com/p/1'}; }));

await check('A04', '已暂停任务点击执行不得绕过暂停', () => scenario(async ({db,workflow,calls}) => {
  const task=db.tasks.create(draft);db.tasks.setStatus(task.id,'paused');await workflow.runTask(task.id);
  assert.equal(calls.length,0,`暂停任务 publish 调用 ${calls.length} 次`);
}));

await check('A05', '同一任务并发进入工作流只能发布一次', () => scenario(async ({db,workflow,calls}) => {
  const task=db.tasks.create(draft);await Promise.all([workflow.runTask(task.id),workflow.runTask(task.id)]);
  assert.equal(calls.length,1,`同一任务 publish 调用 ${calls.length} 次`);
}, async () => { await new Promise(r=>setTimeout(r,15)); return okWeibo; }));

let active=0,peak=0;
await check('A06', '同账号不同任务禁止同时发布', () => scenario(async ({db,workflow}) => {
  const inputs={...draft,accountIds:{weibo:'wb'}};
  db.accounts.upsert({id:'wb',platform:'weibo',profilePath:'unused'});
  const a=db.tasks.create(inputs), b=db.tasks.create(inputs);
  await Promise.all([workflow.runTask(a.id),workflow.runTask(b.id)]);
  assert.equal(peak,1,`同账号峰值并发=${peak}`);
}, async () => {active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,15));active--;return okWeibo;}));

await check('A07', '非微博 URL 不能解锁下游', () => scenario(async ({db,workflow,calls}) => {
  const task=db.tasks.create({...draft,selectedPlatforms:['zhihu']});await workflow.runTask(task.id);
  assert.equal(calls.filter(x=>x.platform==='zhihu').length,0,'外站链接仍解锁知乎');
}, async p=>p==='weibo'?{success:true,canonicalUrl:'https://example.invalid/not-weibo'}:{success:true,postUrl:'https://zhuanlan.zhihu.com/p/1'}));

await check('A08', '达到尝试上限后再次执行不得抛内部 TypeError', () => scenario(async ({db,workflow}) => {
  const task=db.tasks.create(draft);db.tasks.updateJob(task.jobs[0].id,{status:'failed',attempt_count:2});
  await workflow.runTask(task.id);
}));

await check('A09', '两次需要登录后人工完成登录能够继续', () => scenario(async ({db,workflow}) => {
  const task=db.tasks.create(draft);
  await workflow.runTask(task.id);db.tasks.continueTask(task.id);
  await workflow.runTask(task.id);db.tasks.continueTask(task.id);
  const result=await workflow.runTask(task.id);assert.equal(result.status,'completed');
}, (()=>{let attempt=0;return async()=>{if(++attempt<=2)throw new LoginRequiredError('weibo');return okWeibo;};})()));

await check('A10', '不明提交阶段的 interrupted 不得直接重发', () => scenario(async ({db,workflow,calls}) => {
  const task=db.tasks.create(draft);db.tasks.updateJob(task.jobs[0].id,{status:'running',attempt_count:1,phase:'submitting'});
  db.tasks.setStatus(task.id,'publishing_weibo'); // crash after remote acceptance, before local save
  db.tasks.recoverInterrupted();db.tasks.continueTask(task.id);await workflow.runTask(task.id);
  assert.equal(calls.length,0,'恢复后直接调用 publish，无法区分提交前/提交后中断');
}));

await check('A11', '已有成功 job URL 时恢复不得卡死于 weibo_results 缺失', () => scenario(async ({db,workflow}) => {
  const task=db.tasks.create({...draft,selectedPlatforms:['zhihu']});
  db.tasks.updateJob(task.jobs[0].id,{status:'success',post_url:okWeibo.canonicalUrl});
  db.tasks.setStatus(task.id,'resolving_weibo_url');db.tasks.recoverInterrupted();db.tasks.continueTask(task.id);
  const result=await workflow.runTask(task.id);assert.notEqual(result.status,'weibo_failed',`已保存 job URL，但状态=${result.status}`);
}));

await check('A12', '失败重试不得重置已取消的平台', () => scenario(async ({db,workflow}) => {
  const task=db.tasks.create({...draft,selectedPlatforms:['zhihu','jianshu']});
  db.tasks.updateJob(task.jobs[1].id,{status:'cancelled'});db.tasks.retryFailed(task.id);
  const result=await workflow.runTask(task.id);assert.equal(result.jobs[1].status,'cancelled');
}));

await check('A13', '不存在的账号必须在创建任务时拒绝', () => scenario(async ({db}) => {
  assert.throws(()=>db.tasks.create({...draft,accountIds:{weibo:'does-not-exist'}}), '不存在账号仍创建成功');
}));

await check('A14', '账号 ID 清理不能导致不同账号共享 Profile', async () => {
  assert.notEqual(resolveProfileDir('weibo','爸爸'),resolveProfileDir('weibo','妈妈'));
});

await check('A15', '响应只有图片 ID 不能视为微博 ID', async () => {
  const result=extractWeiboIdentifiers({data:{image:{id:'987654'}}});
  assert.equal(result,null,`错误生成=${JSON.stringify(result && buildWeiboUrls(result))}`);
});

await check('A16', '两个新增同文微博候选不能任选第一个', async () => {
  const posts=[{id:'a',url:'https://weibo.com/1/a',text:draft.content},{id:'b',url:'https://weibo.com/2/b',text:draft.content}];
  assert.equal(matchNewPost([],posts,draft),null,'歧义结果被选择');
});

await check('A17', '正文相同但账号/时间/图片不符的微博不能接受', async () => {
  assert.equal(matchNewPost([],[{id:'old',url:'https://weibo.com/999/old',text:draft.content,imageCount:0}],{...draft,images:['1','2'],accountIds:{weibo:'123'}},Date.now()-86400000),null);
});

await check('A18', '队列任务之间遵守 intervalMs', () => scenario(async ({db,workflow}) => {
  db.tasks.create(draft);const queue=new TaskQueue({database:db,workflow,intervalMs:5000});
  const scheduled=[];queue.schedule=delay=>scheduled.push(delay);queue.running=true;queue.paused=false;
  await queue.tick();assert.ok(scheduled.at(-1)>=5000,`下次调度 delay=${scheduled.at(-1)}`);
}));

await check('A19', '旧 pending 不能被最新100条完成任务遮挡', () => scenario(async ({db}) => {
  const pending=db.tasks.create(draft);db.raw.prepare('UPDATE tasks SET created_at=? WHERE id=?').run('2000-01-01',pending.id);
  for(let i=0;i<101;i++){const t=db.tasks.create(draft);db.tasks.setStatus(t.id,'completed');}
  let called=false;const queue=new TaskQueue({database:db,workflow:{runTask:async()=>{called=true;}}});
  queue.running=true;queue.paused=false;queue.schedule=()=>{};await queue.tick();
  assert.equal(called,true,'旧 pending 永远未被 tick 取出');
}));

await check('A20', '下游模板错误必须隔离且让其他平台继续', () => scenario(async ({db,workflow,calls}) => {
  const task=db.tasks.create({...draft,selectedPlatforms:['zhihu','jianshu']});
  db.raw.prepare('UPDATE templates SET content_template=? WHERE platform=?').run('{unknown}','zhihu');
  try{await workflow.runTask(task.id);}catch{}
  assert.equal(calls.filter(x=>x.platform==='jianshu').length,1,'模板异常跳出整个工作流');
}));

await check('A21', '已提交待审不能显示为已完成公开发布', () => scenario(async ({db,workflow}) => {
  const task=db.tasks.create({...draft,selectedPlatforms:['baijiahao']});const result=await workflow.runTask(task.id);
  assert.notEqual(result.status,'completed',`主任务=${result.status}, job=${result.jobs[1].status}, result=${result.jobs[1].result_status}`);
},async p=>p==='weibo'?okWeibo:{success:true,postUrl:'',resultStatus:'submitted',evidence:{submitted:true}}));

console.log(JSON.stringify({kind:'requirement-audit',network:false,productionDatabase:false,total:observations.length,violations:observations.filter(x=>!x.passed).length,observations},null,2));
process.exitCode=observations.some(x=>!x.passed)?1:0;
