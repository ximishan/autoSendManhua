import { AppError, normalizeError } from './errors.js';
import { validateTask } from './task.js';
import { renderTemplate } from './template-engine.js';
import { DEFAULT_RETRY_POLICY, retryDelay, shouldRetry, wait } from './retry-policy.js';
import { validPostUrl } from './result.js';

export class Workflow {
  constructor({database,publisherFactory,logger,retryPolicy=DEFAULT_RETRY_POLICY,preferShareUrl=true}) {
    Object.assign(this,{database,publisherFactory,logger,retryPolicy,preferShareUrl});
    this.active=new Map(); this.accountLocks=new Map(); this.queuePaused=false;
  }
  runTask(id) {
    if(this.active.has(id)) return this.active.get(id);
    const run=this.execute(id).finally(()=>this.active.delete(id));
    this.active.set(id,run);return run;
  }
  stopped(id) { return this.queuePaused || ['paused','cancelled'].includes(this.database.tasks.get(id)?.status); }
  log(level,message,context) { try {this.logger?.[level](message,context);}catch{} }
  async lock(accountId,action) {
    const previous=this.accountLocks.get(accountId)||Promise.resolve();
    let release;const gate=new Promise(r=>release=r);
    const chain=previous.catch(()=>{}).then(()=>gate);this.accountLocks.set(accountId,chain);
    await previous.catch(()=>{});
    try{return await action();}finally{release();if(this.accountLocks.get(accountId)===chain)this.accountLocks.delete(accountId);}
  }
  summarize(id) {
    const task=this.database.tasks.get(id);
    if(this.stopped(id))return task;
    const wb=task.jobs.find(j=>j.platform==='weibo');
    const status=task.jobs.some(j=>['needs_action','interrupted'].includes(j.status))?'paused'
      : wb?.status==='failed'?'weibo_failed'
      : task.jobs.some(j=>j.status==='failed')?'partial_failed'
      : task.jobs.some(j=>j.status==='submitted')?'awaiting_review'
      : task.jobs.every(j=>['success','cancelled'].includes(j.status))?'completed':'paused';
    return this.database.tasks.setStatus(id,status);
  }
  async execute(id) {
    let task=this.database.tasks.get(id);
    if(!task)throw new AppError('任务不存在');
    if(this.stopped(id)||task.status==='completed')return task;
    const wb=task.jobs.find(j=>j.platform==='weibo');
    if(!wb)throw new AppError('缺少微博任务');
    try {
      // Repair the legacy non-atomic success/result persistence gap without publishing again.
      if(wb.status==='success' && !task.weibo && validPostUrl('weibo',wb.post_url))
        this.database.tasks.finishJob(wb,{success:true,canonicalUrl:wb.post_url});
      if(wb.status==='pending') {
        this.database.tasks.setStatus(id,'publishing_weibo');
        await this.runJob(task,wb);
      }
      if(this.stopped(id))return this.database.tasks.get(id);
      task=this.database.tasks.get(id);
      const url=task.weibo?.canonical_url;
      if(!validPostUrl('weibo',url))return this.summarize(id);
      this.database.tasks.unlockDownstream(id);
      this.database.tasks.setStatus(id,'distributing');
      // A share URL must be a validated detail URL as well; canonical is always a safe fallback.
      const chosen=this.preferShareUrl && validPostUrl('weibo',task.weibo?.share_url)?task.weibo.share_url:url;
      for(const job of this.database.tasks.get(id).jobs.filter(j=>j.platform!=='weibo'&&j.status==='pending')) {
        if(this.stopped(id))break;
        await this.runJob(this.database.tasks.get(id),job,chosen);
      }
      return this.summarize(id);
    } catch(error) {
      this.log('error',error.message,{taskId:id});
      this.database.tasks.setStatus(id,'paused');
      return this.database.tasks.get(id);
    }
  }
  async runJob(task, initialJob, weiboUrl='') {
    return this.lock(initialJob.account_id || initialJob.platform,async()=>{
      const repo=this.database.tasks;
      let job=repo.getJob(initialJob.id);
      if(this.stopped(task.id)||job.status!=='pending')return;
      let lastError;
      const policy={...DEFAULT_RETRY_POLICY,...this.retryPolicy};
      for(let attempt=0;attempt<policy.maxAttempts;attempt++) {
        if(this.stopped(task.id))return;
        job=repo.getJob(job.id);
        try {
          const account=this.database.accounts.get(job.account_id);
          if(!account || !account.enabled || account.platform!==job.platform)throw new AppError('账号不存在、已停用或不属于该平台',{code:'ACCOUNT_INVALID',needsAction:true});
          if(['rate_limited','restricted'].includes(account.status))throw new AppError('账号已被平台限制，请处理后重新检测',{code:'ACCOUNT_RESTRICTED',needsAction:true});
          validateTask(task);
          const template=this.database.templates.get(job.platform);
          if(!template?.enabled) {
            if(job.platform==='weibo')throw new AppError('微博模板必须启用',{code:'TEMPLATE_DISABLED'});
            repo.updateJob(job.id,{status:'cancelled'});return;
          }
          const rendered={title:task.title,content:renderTemplate(job.platform,template.content_template,{...task,weiboUrl})};
          const claim=this.database.raw.prepare("UPDATE publish_jobs SET status='running',phase='prepare',attempt_count=attempt_count+1,retry_count=?,started_at=?,error_code='',error_message='' WHERE id=? AND status IN ('pending','failed') AND phase IN ('prepare','unknown')").run(attempt+1,new Date().toISOString(),job.id);
          if(!Number(claim.changes))return;
          const guard=()=>{if(this.stopped(task.id))throw new AppError('任务已暂停',{code:'PAUSED'});};
          const checkpoint=(phase,evidence={})=>{
            if(phase==='submitting')guard();
            repo.updateJob(job.id,{phase,evidence:JSON.stringify(evidence)});
          };
          const publisher=this.publisherFactory(job.platform,{account,logger:this.logger,guard,checkpoint});
          this.log('info',job.platform+'：开始处理',{taskId:task.id,jobId:job.id,platform:job.platform});
          const result=await publisher.publish(task,rendered);
          // Publishers must checkpoint before clicking. Also protect legacy/custom publishers returning success.
          if(result?.success===true && repo.getJob(job.id).phase==='prepare')checkpoint('submitted',result.evidence || {});
          this.database.tasks.finishJob(job,result);
          this.log('info',job.platform+(result.resultStatus==='submitted'?'：已提交待审核':'：已确认发布'),{taskId:task.id,jobId:job.id,platform:job.platform});
          return;
        } catch(error) {
          if(error.name==='TimeoutError')error.retryable=true;
          lastError=normalizeError(error);
          const phase=repo.getJob(job.id).phase;
          const ambiguous=phase!=='prepare';
          const status=error.code==='PAUSED'?'paused':ambiguous||lastError.needsAction?'needs_action':'failed';
          repo.updateJob(job.id,{status,error_code:ambiguous?'PUBLISH_UNCERTAIN':lastError.code,
            error_message:ambiguous?'已进入提交阶段，需要核对结果；禁止自动重发。'+lastError.message:lastError.message,
            finished_at:new Date().toISOString()});
          this.log('error',lastError.message,{taskId:task.id,jobId:job.id,platform:job.platform});
          if(['RATE_LIMITED','ACCOUNT_RESTRICTED'].includes(lastError.code))this.database.accounts.setStatus(job.account_id,'rate_limited');
          if(ambiguous || !shouldRetry(error,attempt+1,policy))return;
          await wait(retryDelay(attempt+1,policy));
        }
      }
    });
  }
}
