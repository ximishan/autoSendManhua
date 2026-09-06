const api=window.autoSend;
const platforms=['weibo','zhihu','jianshu','baijiahao','toutiao','sohu','netease'];
const names={weibo:'微博',zhihu:'知乎',jianshu:'简书',baijiahao:'百家号',toutiao:'今日头条',sohu:'搜狐号',netease:'网易号'};
const pageMeta={tasks:['任务中心','核对每个平台的状态、地址和错误'],create:['新建发布','微博确认后再分发到其他平台'],batch:['批量导入','仅支持 .xlsx，错误行不会进入队列'],accounts:['账号管理','微博可直接扫码登录；每个账号使用独立登录目录'],templates:['平台模板','预览与实际发布使用相同模板'],logs:['运行日志','记录本地任务步骤和异常'],settings:['设置','保存后立即应用于后续任务']};
let state={tasks:[],accounts:[],templates:[],logs:[],queue:{}},selectedImages=[],detailId=null,refreshing=false;
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const labels={pending:'等待',blocked:'等待微博',running:'进行中',success:'已发布',published:'已发布',failed:'失败',needs_action:'需核对/处理',interrupted:'中断待核对',submitted:'已提交待审核',awaiting_review:'等待审核',paused:'已暂停',cancelled:'已取消',completed:'全部已发布',weibo_failed:'微博失败',partial_failed:'部分失败',logged_in:'已登录',needs_login:'需要登录',unknown:'待检测',rejected:'审核拒绝'};
const status=s=>'<span class="status '+esc(s)+'">'+esc(labels[s]||s||'—')+'</span>';
function toast(message,error=false){$('#toast').textContent=message;$('#toast').className='toast'+(error?' error':'');$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,5000);}
async function safely(action){try{return await action();}catch(e){toast(e.message,true);}}
async function refresh(){
  if(refreshing)return;refreshing=true;
  try{state=await api.snapshot();renderTasks();renderAccounts();renderTemplates();renderCreate();renderLogs();renderQueue();}finally{refreshing=false;}
}
function renderTasks(){
  $('#task-stats').innerHTML=[['全部任务',state.tasks.length],['等待/运行',state.tasks.filter(t=>['pending','publishing_weibo','distributing'].includes(t.status)).length],['已完成',state.tasks.filter(t=>t.status==='completed').length],['需处理',state.tasks.filter(t=>['paused','weibo_failed','partial_failed','awaiting_review'].includes(t.status)).length]].map(([label,count])=>'<div class="stat"><span>'+label+'</span><b>'+count+'</b></div>').join('');
  $('#task-list').innerHTML=state.tasks.map(t=>{
    const cell=p=>{const j=t.jobs.find(j=>j.platform===p);return status(j?.status)+(j?.error_message?'<span title="'+esc(j.error_message)+'"> ⓘ</span>':'');};
    const url=t.weibo?.canonical_url;
    return '<tr><td>'+esc(t.title)+'<br>'+status(t.status)+'</td><td>'+cell('weibo')+'</td><td>'+(url?'<button class="link-btn" data-open="'+esc(url)+'">打开</button>':'—')+'</td>'+['zhihu','jianshu','baijiahao','toutiao'].map(p=>'<td>'+cell(p)+'</td>').join('')+'<td>'+new Date(t.createdAt).toLocaleString()+'</td><td><button class="link-btn" data-detail="'+t.id+'">查看详情</button><button class="link-btn" data-run="'+t.id+'">执行</button><button class="link-btn" data-pause="'+t.id+'">暂停</button><button class="link-btn" data-continue="'+t.id+'">继续</button><button class="link-btn" data-retry="'+t.id+'">重试失败项</button></td></tr>';
  }).join('')||'<tr><td colspan="9">暂无任务</td></tr>';
}
function renderAccounts(){
  $('#account-list').innerHTML=state.accounts.map(a=>{
    const primaryAction=a.platform==='weibo'&&a.status!=='logged_in'
      ?'<button class="primary small" data-account-weibo-login="'+esc(a.id)+'">扫码登录</button>'
      :'<button class="secondary small" data-account-open="'+esc(a.id)+'">打开</button>';
    return '<article class="account-card"><h3>'+esc(a.nickname||a.id)+'</h3><p>'+names[a.platform]+' · '+esc(a.id)+'</p>'+status(a.status)+'<p>'+(a.platform==='weibo'?'登录态会自动保存，下次直接使用':'平台发布尚需使用本人账号实测')+'</p><div class="account-actions">'+primaryAction+'<button class="secondary small" data-account-check="'+esc(a.id)+'">测试状态</button><button class="secondary small" data-account-delete="'+esc(a.id)+'">删除</button></div></article>';
  }).join('')||'<p>还没有账号。微博直接点击上方“扫码登录微博”即可。</p>';
}
function renderTemplates(){
  if($('#template-list').children.length)return;
  $('#template-list').innerHTML=state.templates.map(t=>'<article class="template-card"><h3>'+names[t.platform]+'</h3><textarea data-template="'+t.platform+'">'+esc(t.content_template)+'</textarea><button class="primary small" data-save-template="'+t.platform+'">保存模板</button></article>').join('');
}
function renderCreate(){
  const form=new FormData($('#task-form'));
  const options=p=>'<option value="">请选择账号</option>'+state.accounts.filter(a=>a.platform===p&&a.enabled).map(a=>'<option value="'+esc(a.id)+'">'+esc(a.nickname||a.id)+'</option>').join('');
  $('#weibo-account').innerHTML=options('weibo');$('#weibo-account').value=form.get('weiboAccount')||'';
  $('#platform-checks').innerHTML=platforms.slice(1).map(p=>'<label><span><input type="checkbox" name="platform" value="'+p+'">'+names[p]+'</span><select name="'+p+'Account">'+options(p)+'</select></label>').join('');
  for(const p of platforms.slice(1)){
    $('[name="platform"][value="'+p+'"]').checked=form.getAll('platform').includes(p);
    $('[name="'+p+'Account"]').value=form.get(p+'Account')||'';
  }
}
function renderLogs(){ $('#log-list').innerHTML=state.logs.slice(0,300).map(l=>'<div class="log-row"><span>'+new Date(l.created_at).toLocaleString()+'</span><span>'+esc(l.level)+'</span><span>'+esc(l.platform||'system')+'</span><span>'+esc(l.message)+'</span></div>').join('')||'暂无日志'; }
function renderQueue(){const running=state.queue.running&&!state.queue.paused;$('#queue-dot').classList.toggle('on',running);$('#queue-state').textContent=running?'队列运行中':'队列未运行';$('#queue-task').textContent=state.queue.activeTask?'执行中：'+state.queue.activeTask:'没有正在执行的任务';$('#queue-toggle').textContent=running?'暂停队列':'启动队列';}
function gotoPage(name){document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.page===name));document.querySelectorAll('.page').forEach(n=>n.classList.toggle('active',n.id==='page-'+name));$('#page-title').textContent=pageMeta[name][0];$('#page-desc').textContent=pageMeta[name][1];if(name==='settings'&&state.settings){$('#setting-attempts').value=state.settings.maxAttempts;$('#setting-delay').value=state.settings.intervalMs;$('#setting-share').checked=state.settings.preferShareUrl;$('#setting-retention').value=state.settings.retentionDays;}}
function input(){const f=new FormData($('#task-form'));const selectedPlatforms=f.getAll('platform');return {title:f.get('title'),content:f.get('content'),resourceUrl:f.get('resourceUrl'),images:selectedImages,selectedPlatforms,accountIds:Object.fromEntries(['weibo',...selectedPlatforms].map(p=>[p,f.get(p==='weibo'?'weiboAccount':p+'Account')]))};}
async function detail(id){
  detailId=id;const t=await api.getTask(id);if(!t)return;
  $('#detail-content').innerHTML='<h2>'+esc(t.title)+'</h2><p>'+status(t.status)+'</p>'+t.jobs.map(j=>{
    const uncertain=['needs_action','submitted','interrupted'].includes(j.status)&&j.phase!=='prepare';
    return '<article class="job-detail"><h3>'+names[j.platform]+' '+status(j.status)+'</h3><p>阶段：'+esc(j.phase)+' · 累计尝试 '+j.attempt_count+' 次</p><p>'+esc(j.error_message||'无错误')+'</p>'+(j.post_url?'<button class="link-btn" data-open="'+esc(j.post_url)+'">'+esc(j.post_url)+'</button>':'')+(uncertain?'<label>已核实的帖子详情地址<input id="result-'+j.id+'" type="url" placeholder="https://..."></label><label><input type="checkbox" id="confirm-'+j.id+'">我已打开帖子，确认内容和发布账号与本任务一致</label><button class="primary small" data-reconcile="'+j.id+'">保存人工核对结果</button><button class="secondary small" data-not-published="'+j.id+'">确认未发布，重新准备</button>':'')+'</article>';
  }).join('')+'<button class="secondary" data-cancel="'+t.id+'">取消未提交部分</button>';
  if(!$('#task-detail').open)$('#task-detail').showModal();
}
async function loginWeibo(accountId=null){
  const quick=$('#quick-weibo-login');
  if(!accountId&&quick){quick.disabled=true;quick.textContent='等待扫码…';}
  $('#weibo-login-tip').textContent='正在打开微博二维码，请使用手机微博 APP → 我的 → 扫一扫。扫码后无需回到命令行，程序会自动识别。';
  try{
    const account=await api.quickLoginWeibo(accountId);
    await refresh();
    $('#weibo-login-tip').textContent='微博登录成功，登录态已保存。以后发布会自动使用该账号。';
    toast('微博扫码登录成功');
    return account;
  }finally{
    if(!accountId&&quick){quick.disabled=false;quick.textContent='扫码登录微博';}
  }
}
document.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;
  safely(async()=>{
    if(b.dataset.page)gotoPage(b.dataset.page);
    if(b.dataset.goto)gotoPage(b.dataset.goto);
    if(b.dataset.open)await api.openUrl(b.dataset.open);
    if(b.dataset.detail)await detail(b.dataset.detail);
    if(b.dataset.run){toast('开始执行');await api.runTask(b.dataset.run);await refresh();}
    if(b.dataset.pause){await api.pauseTask(b.dataset.pause);await refresh();toast('已请求暂停，当前已提交结果仍会保存');}
    if(b.dataset.continue){await api.continueTask(b.dataset.continue);await api.runTask(b.dataset.continue);await refresh();toast('已执行可恢复步骤；需核对的提交不会重发');}
    if(b.dataset.retry){await api.retryTask(b.dataset.retry);await api.runTask(b.dataset.retry);await refresh();}
    if(b.dataset.cancel){await api.cancelTask(b.dataset.cancel);await detail(detailId);await refresh();}
    if(b.dataset.reconcile){const id=Number(b.dataset.reconcile);await api.reconcileJob(id,$('#result-'+id).value,$('#confirm-'+id).checked);await detail(detailId);await refresh();}
    if(b.dataset.notPublished&&confirm('请先在平台核对。只有确认本任务未发布，才能重新提交。确定尚未发布吗？')){await api.markNotPublished(Number(b.dataset.notPublished),true);await detail(detailId);await refresh();}
    if(b.dataset.accountWeiboLogin)await loginWeibo(b.dataset.accountWeiboLogin);
    if(b.dataset.accountOpen){await api.openAccount(b.dataset.accountOpen);toast('账号窗口已打开');}
    if(b.dataset.accountCheck){await api.checkAccount(b.dataset.accountCheck);await refresh();}
    if(b.dataset.accountDelete&&confirm('删除账号记录？')){const remove=confirm('同时删除该账号的登录目录？取消则保留目录。');await api.deleteAccount(b.dataset.accountDelete,remove);await refresh();}
    if(b.dataset.saveTemplate){await api.saveTemplate(b.dataset.saveTemplate,$('[data-template="'+b.dataset.saveTemplate+'"]').value);await refresh();toast('模板已保存');}
  });
});
$('#refresh').onclick=()=>safely(refresh);$('#refresh-logs').onclick=()=>safely(refresh);
$('#quick-weibo-login').onclick=()=>safely(()=>loginWeibo());
$('#pick-images').onclick=()=>safely(async()=>{selectedImages=await api.selectImages();$('#image-count').textContent='已选择 '+selectedImages.length+' 张';$('#image-list').innerHTML=selectedImages.map(p=>'<span class="chip">'+esc(p.split(/[\\/]/).pop())+'</span>').join('');});
$('#preview-task').onclick=()=>safely(async()=>{const preview=await api.previewTask(input());$('#content-preview').innerHTML=preview.map(p=>'<div class="preview-block"><b>'+names[p.platform]+'</b>'+esc(p.content)+'</div>').join('');});
async function saveTask(run){if(!$('#task-form').reportValidity())return;const t=await api.createTask(input());await refresh();gotoPage('tasks');toast('任务已创建');if(run){await api.runTask(t.id);await refresh();}}
$('#task-form').onsubmit=e=>{e.preventDefault();safely(()=>saveTask(true));};
$('#save-draft').onclick=()=>safely(()=>saveTask(false));
$('#queue-toggle').onclick=()=>safely(async()=>{if(state.queue.running&&!state.queue.paused)await api.queuePause();else if(state.queue.running)await api.queueResume();else await api.queueStart();await refresh();});
$('#export-results').onclick=()=>safely(async()=>{const r=await api.exportExcel();if(r)toast('已导出 '+r.count+' 条');});
$('#excel-template').onclick=()=>safely(async()=>{if(await api.saveExcelTemplate())toast('模板已保存');});
$('#excel-import').onclick=()=>safely(async()=>{const r=await api.importExcel();if(r){$('#import-result').innerHTML='<p>创建 '+r.created.length+' 条，错误 '+r.invalid.length+' 条</p>'+r.invalid.map(x=>'<p>第 '+x.rowNumber+' 行：'+esc(x.error)+'</p>').join('');await refresh();}});
$('#add-account').onclick=()=>$('#account-form-wrap').hidden=!$('#account-form-wrap').hidden;
$('#account-form select').innerHTML=platforms.map(p=>'<option value="'+p+'">'+names[p]+'</option>').join('');
$('#account-form').onsubmit=e=>{e.preventDefault();safely(async()=>{const f=new FormData(e.target);const a=await api.saveAccount(Object.fromEntries(f));await refresh();if(a.platform==='weibo')await loginWeibo(a.id);else await api.openAccount(a.id);});};
$('#save-settings').onclick=()=>safely(async()=>{await api.setSetting('retry.maxAttempts',Number($('#setting-attempts').value));await api.setSetting('queue.intervalMs',Number($('#setting-delay').value));await api.setSetting('weibo.preferShareUrl',$('#setting-share').checked);await api.setSetting('logs.retentionDays',Number($('#setting-retention').value));await refresh();toast('设置已生效');});
$('#close-detail').onclick=()=>$('#task-detail').close();
api.onLog(()=>safely(refresh));
api.onAccountLoginProgress(entry=>{
  if(entry.platform!=='weibo')return;
  const text={opening_qr:'正在打开微博二维码…',waiting_scan:'二维码已打开，请用手机微博扫一扫并确认登录。',logged_in:'扫码成功，微博登录态已保存。',failed:entry.message||'微博登录失败，请重新扫码。'}[entry.status];
  if(text)$('#weibo-login-tip').textContent=text;
});
refresh().catch(e=>toast(e.message,true));
setInterval(()=>{if(document.visibilityState==='visible')safely(refresh);},2000);
