import { PlatformPublisher } from './base-publisher.js';
import { detectLoginBySignals, findVisible } from '../browser/login-state.js';
import { AppError, PublishUncertainError } from '../core/errors.js';
import { fillEditable, requireAttached, requireVisible } from './helpers.js';
import { validPostUrl } from '../core/result.js';

export class BrowserPlatformPublisher extends PlatformPublisher {
  constructor({config,...options}) {super({...options,platform:config.platform});this.config=config;}
  async getPage() {
    if(this.page)return this.page;
    this.page=(await this.browserManager.getSession(this.platform,this.account.id,{profileDir:this.account.profile_path})).page;
    return this.page;
  }
  async checkLogin() {
    const page=await this.getPage();
    await page.goto(this.config.composerUrl,{waitUntil:'domcontentloaded',timeout:60000});
    if(this.config.loginUrlPattern?.test(page.url()))return false;
    if(await findVisible(page,this.config.selectors.loggedOut || []))return false;
    // Author portraits alone are insufficient: require the authenticated editing surface.
    return Boolean(await findVisible(page,this.config.selectors.title)) && Boolean(await findVisible(page,this.config.selectors.editor));
  }
  async openComposer() {
    const page=await this.getPage();
    if(this.config.selectors.entry?.length) {
      const entry=await findVisible(page,this.config.selectors.entry);
      if(entry)await entry.click();
    }
    this.initialUrl=page.url();
  }
  async fillTitle(task) {
    const title=await requireVisible(await this.getPage(),this.config.selectors.title,this.platform+'标题');
    await fillEditable(title,task.title);
  }
  async fillContent(task,rendered) {
    this.rendered=rendered.content;
    this.editor=await requireVisible(await this.getPage(),this.config.selectors.editor,this.platform+'正文');
    await fillEditable(this.editor,rendered.content);
    const actual=await this.editor.inputValue().catch(()=>this.editor.innerText());
    if(actual.replace(/\s/g,'')!==rendered.content.replace(/\s/g,''))throw new AppError('正文写入不完整',{code:'CONTENT_FILL_FAILED',retryable:true});
  }
  async uploadImages(task) {
    if(!task.images?.length || this.config.syncImages===false)return;
    const page=await this.getPage();
    const input=await requireAttached(page,this.config.selectors.imageInput,this.platform+'图片上传');
    const before=await this.editor.locator('img').count();
    await input.setInputFiles(task.images);
    const deadline=Date.now()+60000;
    while(Date.now()<deadline) {
      this.guard();
      const ready=await this.editor.locator('img').evaluateAll(imgs=>imgs.filter(i=>i.complete&&i.naturalWidth>0&&!i.src.startsWith('blob:')).length);
      if(ready>=before+task.images.length)return;
      await page.waitForTimeout(500);
    }
    throw new AppError('图片上传尚未确认完成',{code:'IMAGE_UPLOAD_TIMEOUT',retryable:true});
  }
  async collectLinks(page) {
    return page.locator('a[href]').evaluateAll(nodes=>nodes.map(n=>n.href)).catch(()=>[]);
  }
  async submit() {
    const page=await this.getPage();
    this.beforeLinks=new Set(await this.collectLinks(page));
    this.beforeLinks.add(page.url());
    const beforeSignals=new Set();
    for(const s of this.config.selectors.success)if(await findVisible(page,[s]))beforeSignals.add(s);
    const button=await requireVisible(page,this.config.selectors.submit,this.platform+'发布按钮');
    if(await button.isDisabled())throw new AppError('发布按钮不可用',{code:'SUBMIT_DISABLED'});
    const submittedAt=new Date().toISOString();
    this.checkpoint('submitting',{submittedAt});
    await button.click();
    const deadline=Date.now()+20000;
    while(Date.now()<deadline) {
      const limited=await findVisible(page,["text=操作频繁","text=账号受限","text=发布失败","text=审核不通过"]);
      if(limited){const text=await limited.innerText();throw new AppError(text,{code:/频繁|受限/.test(text)?'ACCOUNT_RESTRICTED':'REJECTED',needsAction:true});}
      for(const selector of this.config.selectors.success) {
        if(!beforeSignals.has(selector) && await findVisible(page,[selector]))
          return {successSignal:true,submittedAt,evidence:{submitted:true,signal:selector}};
      }
      await page.waitForTimeout(300);
    }
    throw new PublishUncertainError(this.platform);
  }
  async resolvePublishedUrl(task, result) {
    if(!result?.successSignal)throw new PublishUncertainError(this.platform);
    const page=await this.getPage();
    const candidates=[...new Set([page.url(),...await this.collectLinks(page)])]
      .filter(url=>validPostUrl(this.platform,url)&&!this.beforeLinks?.has(url));
    if(candidates.length!==1) {
      if(this.config.submissionOnly && result.evidence?.submitted)
        return {success:true,platform:this.platform,resultStatus:'submitted',postUrl:'',publishedAt:result.submittedAt,evidence:result.evidence};
      throw new PublishUncertainError(this.platform,'没有取得唯一的新帖子地址，请核对结果');
    }
    return {success:true,platform:this.platform,postUrl:candidates[0],publishedAt:result.submittedAt,resultStatus:'published',evidence:result.evidence};
  }
}
