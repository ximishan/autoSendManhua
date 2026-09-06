import { PlatformPublisher } from "../base-publisher.js";
import { AppError, PublishUncertainError } from "../../core/errors.js";
import { fillEditable, requireAttached, requireVisible } from "../helpers.js";
import { readWeiboIdentity, openWeiboHome } from "./session.js";
import { publishApiPattern, selectors } from "./selectors.js";
import { toPlaywrightCookies, validateWeiboCookie } from "./shortcut-auth.js";
import {
  buildWeiboUrls,
  captureRecentPosts,
  captureRecentPostsViaApi,
  extractWeiboIdentifiers,
  matchNewPost,
  resultFromPost
} from "./resolve-post.js";

export class WeiboPublisher extends PlatformPublisher {
  constructor(options = {}) {
    super({ ...options, platform: "weibo" });
    this.selectors = options.selectors || selectors;
    this.responseTimeoutMs = options.responseTimeoutMs || 20000;
    this.cookieText = options.cookieText || "";
    this.cookiesApplied = false;
  }

  async getPage() {
    if (this.page) return this.page;
    const session = await this.browserManager.getSession("weibo", this.account?.id || "default", {
      profileDir: this.account?.profile_path || undefined
    });
    if (this.cookieText && !this.cookiesApplied) {
      await session.context.addCookies(toPlaywrightCookies(this.cookieText));
      this.cookiesApplied = true;
    }
    this.page = session.page;
    return this.page;
  }

  async checkLogin() {
    const page = await this.getPage();
    await openWeiboHome(page);
    const identity = await readWeiboIdentity(page);
    this.userId = identity?.uid || "";
    if (this.userId) return true;

    // 与 baidu-link-converter 一致：微博账号以本机已保存的 SUB + XSRF-TOKEN
    // 作为登录配置依据，不再要求新版微博页面必须返回固定的 /ajax/config 结构。
    if (this.cookieText) {
      try {
        validateWeiboCookie(this.cookieText);
        return true;
      } catch {}
    }
    return false;
  }

  async snapshotBeforePublish(page) {
    const apiPosts = await captureRecentPostsViaApi(page, this.userId);
    if (apiPosts.length) return apiPosts;

    this.profileUrl = this.userId ? `https://weibo.com/u/${this.userId}` : "";
    if (this.profileUrl) {
      await page.goto(this.profileUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      return captureRecentPosts(page, this.selectors);
    }
    return [];
  }

  async openComposer(task) {
    const page = await this.getPage();
    this.profileUrl = this.userId ? `https://weibo.com/u/${this.userId}` : "";
    this.beforePosts = await this.snapshotBeforePublish(page);
    await openWeiboHome(page);
    this.composer = await requireVisible(page, this.selectors.composer, "微博正文编辑器", 20000);
    const forms = this.composer.locator("xpath=ancestor::form[1]");
    this.composerScope = await forms.count() ? forms : this.composer.locator("xpath=..");
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
      for (const selector of this.selectors.imagePreview) {
        count = Math.max(count, await this.composerScope.locator(selector)
          .evaluateAll(imgs => imgs.filter(i => i.complete && i.naturalWidth > 0).length)
          .catch(() => 0));
      }
      if (count >= task.images.length) return;
      await page.waitForTimeout(500);
    }
    throw new AppError(`微博图片上传超时，预期 ${task.images.length} 张`, { code: "IMAGE_UPLOAD_TIMEOUT", retryable: true });
  }

  async submit() {
    const page = await this.getPage();
    const submit = await requireVisible(this.composerScope || page, this.selectors.submit, "微博发布按钮", 15000);
    if (await submit.isDisabled().catch(() => false)) {
      throw new AppError("微博发布按钮不可用", { code: "SUBMIT_DISABLED" });
    }

    const responses = [];
    const pending = [];
    const handler = response => {
      let url;
      try { url = new URL(response.url()); } catch { return; }
      if (!WEIBO_API_HOSTS.has(url.hostname) || !publishApiPattern.test(url.pathname) || response.request().method() !== "POST") return;
      pending.push((async () => {
        if (response.status() < 200 || response.status() >= 300) return;
        const payload = await response.json().catch(() => null);
        if (payload?.ok !== 1) return;
        const parsed = extractWeiboIdentifiers(payload, this.userId);
        if (parsed) responses.push(parsed);
      })());
    };

    page.on("response", handler);
    const clickedAt = Date.now();
    try {
      this.checkpoint("submitting", { clickedAt, userId: this.userId });
      await submit.click();
      const deadline = Date.now() + this.responseTimeoutMs;
      while (Date.now() < deadline) {
        await Promise.all(pending);
        const apiResult = this.userId
          ? responses.find(result => result?.userId === this.userId)
          : responses[0];
        if (apiResult) {
          if (!this.userId) this.userId = apiResult.userId;
          return {
            strongSignal: true,
            apiResult,
            clickedAt,
            evidence: { submitted: true, id: apiResult.id, mid: apiResult.mid, bid: apiResult.bid, userId: apiResult.userId }
          };
        }
        await page.waitForTimeout(200);
      }
      return { strongSignal: false, clickedAt, evidence: { submitted: true, userId: this.userId } };
    } finally {
      page.off("response", handler);
      await Promise.allSettled(pending);
    }
  }

  async resolvePublishedUrl(task, submitResult, rendered) {
    if (submitResult.apiResult && (!this.userId || submitResult.apiResult.userId === this.userId)) {
      if (!this.userId) this.userId = submitResult.apiResult.userId;
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
          resolution: "publish-response",
          evidence: { submitted: true, resolvedBy: "publish-response" }
        };
      }
    }

    const page = await this.getPage();
    const matchTask = {
      ...task,
      content: rendered?.content || task.content,
      userId: this.userId
    };
    const deadline = Date.now() + 35000;

    while (Date.now() < deadline) {
      const apiPosts = await captureRecentPostsViaApi(page, this.userId);
      if (apiPosts.length) {
        const matched = matchNewPost(this.beforePosts || [], apiPosts, matchTask, submitResult.clickedAt);
        const result = resultFromPost(matched);
        if (result) {
          return {
            success: true,
            platform: "weibo",
            ...result,
            resolution: "profile-api-diff",
            evidence: { submitted: true, resolvedBy: "profile-api-diff" }
          };
        }
      }

      if (this.profileUrl) {
        await page.goto(this.profileUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
        const domPosts = await captureRecentPosts(page, this.selectors);
        const matched = matchNewPost(this.beforePosts || [], domPosts, matchTask, submitResult.clickedAt);
        const result = resultFromPost(matched);
        if (result) {
          return {
            success: true,
            platform: "weibo",
            ...result,
            resolution: "profile-dom-diff",
            evidence: { submitted: true, resolvedBy: "profile-dom-diff" }
          };
        }
      }

      await page.waitForTimeout(1500);
    }

    if (!submitResult.strongSignal) {
      throw new PublishUncertainError("微博", "已点击发布，但未从发布响应或本人主页唯一确认刚发布微博；禁止自动重发");
    }
    throw new PublishUncertainError("微博", "发布接口已显示成功，但微博详情 URL 尚未唯一确认；禁止自动重发");
  }
}

const WEIBO_API_HOSTS = new Set(["weibo.com", "www.weibo.com"]);
