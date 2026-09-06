import { PlatformPublisher } from "../base-publisher.js";
import { AppError, PublishUncertainError } from "../../core/errors.js";
import { fillEditable, requireAttached, requireVisible, waitForAnyVisible } from "../helpers.js";
import { readWeiboIdentity, openWeiboHome } from "./session.js";
import { publishApiPattern, selectors } from "./selectors.js";
import {
  buildWeiboUrls, captureRecentPosts, extractWeiboIdentifiers, matchNewPost, resultFromPost
} from "./resolve-post.js";

export class WeiboPublisher extends PlatformPublisher {
  constructor(options = {}) {
    super({ ...options, platform: "weibo" });
    this.selectors = options.selectors || selectors;
    this.responseTimeoutMs = options.responseTimeoutMs || 20000;
  }

  async getPage() {
    if (this.page) return this.page;
    const session = await this.browserManager.getSession("weibo", this.account?.id || "default", {
      profileDir: this.account?.profile_path || undefined
    });
    this.page = session.page;
    return this.page;
  }

  async checkLogin() {
    const page = await this.getPage();
    await openWeiboHome(page);
    const identity=await readWeiboIdentity(page);
    this.userId=identity?.uid;
    return Boolean(this.userId);
  }

  async openComposer(task) {
    const page = await this.getPage();
    this.profileUrl = this.userId ? 'https://weibo.com/u/'+this.userId : '';
    if (this.profileUrl) {
      await page.goto(this.profileUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      this.beforePosts = await captureRecentPosts(page, this.selectors);
      await openWeiboHome(page);
    } else {
      this.beforePosts = await captureRecentPosts(page, this.selectors);
    }
    this.composer = await requireVisible(page, this.selectors.composer, "微博正文编辑器", 20000);
    const forms=this.composer.locator('xpath=ancestor::form[1]');
    this.composerScope=await forms.count()?forms:this.composer.locator('xpath=..');
    return this.composer;
  }

  async fillContent(task, rendered) {
    if (!this.composer) await this.openComposer(task);
    await fillEditable(this.composer, rendered.content);
    const value = await this.composer.inputValue().catch(() => this.composer.innerText().catch(() => ""));
    if (!value.trim()) throw new AppError("微博正文写入失败", { code: "CONTENT_FILL_FAILED", retryable: true });
  }

  async uploadImages(task) {
    if (!task.images?.length) return;
    const page = await this.getPage();
    const input = await requireAttached(this.composerScope, this.selectors.imageInput, "微博图片上传控件", 15000);
    await input.setInputFiles(task.images);
    const started = Date.now();
    while (Date.now() - started < 60000) {
      let count = 0;
      this.guard();
      for (const selector of this.selectors.imagePreview) count = Math.max(count, await this.composerScope.locator(selector).evaluateAll(imgs=>imgs.filter(i=>i.complete&&i.naturalWidth>0).length).catch(() => 0));
      if (count >= task.images.length) return;
      await page.waitForTimeout(500);
    }
    throw new AppError(`微博图片上传超时，预期 ${task.images.length} 张`, { code: "IMAGE_UPLOAD_TIMEOUT", retryable: true });
  }

  async submit() {
    const page=await this.getPage();
    const submit=await requireVisible(this.composerScope || page,this.selectors.submit,'微博发布按钮',15000);
    if(await submit.isDisabled().catch(()=>false))throw new AppError('微博发布按钮不可用',{code:'SUBMIT_DISABLED'});
    const responses=[],pending=[];
    const handler=response=>{
      const url=new URL(response.url());
      if(url.hostname!=='weibo.com'||!publishApiPattern.test(url.pathname)||response.request().method()!=='POST')return;
      pending.push((async()=>{
        if(response.status()<200||response.status()>=300)return;
        const payload=await response.json().catch(()=>null);
        if(payload?.ok===1)responses.push(extractWeiboIdentifiers(payload));
      })());
    };
    page.on('response',handler);
    const clickedAt=Date.now();
    try {
      this.checkpoint('submitting',{clickedAt,userId:this.userId});
      await submit.click();
      const deadline=Date.now()+this.responseTimeoutMs;
      while(Date.now()<deadline) {
        await Promise.all(pending);
        const apiResult=responses.find(r=>r?.userId===this.userId);
        if(apiResult)return {strongSignal:true,apiResult,clickedAt,evidence:{submitted:true,id:apiResult.id,userId:this.userId}};
        await page.waitForTimeout(200);
      }
      return {strongSignal:false,clickedAt,evidence:{submitted:false,userId:this.userId}};
    } finally {page.off('response',handler);await Promise.allSettled(pending);}
  }

  async resolvePublishedUrl(task, submitResult) {
    if (submitResult.apiResult && submitResult.apiResult.userId===this.userId) {
      const urls = buildWeiboUrls(submitResult.apiResult);
      if (urls.canonicalUrl) {
        return {
          success: true,
          platform: "weibo",
          id: submitResult.apiResult.id,
          mid: submitResult.apiResult.mid,
          bid: submitResult.apiResult.bid,
          userId: submitResult.apiResult.userId,
          ...urls,
          publishedAt: new Date().toISOString(),
          resolution: "publish-response"
        };
      }
    }

    const page = await this.getPage();
    if (this.profileUrl) await page.goto(this.profileUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => openWeiboHome(page));
    else await openWeiboHome(page);
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const posts = await captureRecentPosts(page, this.selectors);
      const matched = matchNewPost(this.beforePosts || [], posts, {...task,userId:this.userId}, submitResult.clickedAt);
      const result = resultFromPost(matched);
      if (result) return { success: true, platform: "weibo", ...result };
      await page.waitForTimeout(1500);
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    }

    if (!submitResult.strongSignal) throw new PublishUncertainError("微博");
    throw new PublishUncertainError('微博','已显示成功，但帖子 URL 尚未确认，请核对结果');
  }

}
