import { PlatformPublisher } from "../base-publisher.js";
import { LoginRequiredError } from "../../core/errors.js";
import { validateWeiboCookie } from "./shortcut-auth.js";
import { WeiboApiClient, WEIBO_COMMENT_URL, WEIBO_POST_URL, WEIBO_UPLOAD_URL } from "./api-client.js";

export class WeiboPublisher extends PlatformPublisher {
  constructor(options = {}) {
    super({ ...options, platform: "weibo" });
    this.cookieText = options.cookieText || "";
    this.clientFactory = options.clientFactory || ((cookieText) => new WeiboApiClient(cookieText));
  }

  async checkLogin() {
    try {
      validateWeiboCookie(this.cookieText);
      return true;
    } catch {
      return false;
    }
  }

  async publish(task, rendered) {
    this.guard();
    if (!await this.checkLogin()) throw new LoginRequiredError("weibo");

    const client = this.clientFactory(this.cookieText);
    const imageIds = [];

    for (const filePath of task.images || []) {
      this.guard();
      this.logger?.info?.("微博：上传图片", {
        platform: "weibo",
        details: { filePath, endpoint: WEIBO_UPLOAD_URL }
      });
      imageIds.push(await client.uploadImage(filePath));
    }

    this.guard();
    // 与 baidu-link-converter 一致：真正调用正文接口前立即进入 submitting。
    // 从这一刻起，任何异常都不能自动重发正文。
    this.checkpoint("submitting", {
      submitted: false,
      transport: "baidu-link-converter-api",
      endpoint: WEIBO_POST_URL,
      imageIds
    });

    const publishedAt = new Date().toISOString();
    const { info, payload: postResponse } = await client.publishPost(rendered.content, imageIds);
    const canonicalUrl = `https://weibo.com/detail/${info.id}`;

    this.checkpoint("submitted", {
      submitted: true,
      transport: "baidu-link-converter-api",
      endpoint: WEIBO_POST_URL,
      postId: info.id,
      imageIds
    });

    // baidu-link-converter 的已验证流程：资源链接放首评。
    // 首评失败不能让正文再次发送，因此这里只记录失败，不抛出导致正文重试。
    let commentStatus = "skipped";
    let commentError = "";
    let commentResponse = null;
    const commentContent = task.resourceUrl ? `链接：${task.resourceUrl}` : "";
    if (commentContent) {
      try {
        commentResponse = await client.publishComment(info.id, commentContent);
        commentStatus = "published";
      } catch (error) {
        commentStatus = "failed";
        commentError = error.message || String(error);
        this.logger?.warn?.("微博：正文已发布，但首评失败；禁止重复发送正文", {
          platform: "weibo",
          details: { postId: info.id, error: commentError, endpoint: WEIBO_COMMENT_URL }
        });
      }
    }

    return {
      success: true,
      platform: "weibo",
      id: info.id,
      mid: info.mid,
      bid: info.bid,
      userId: info.userId,
      canonicalUrl,
      shareUrl: canonicalUrl,
      publishedAt,
      resolution: "baidu-link-converter-api",
      evidence: {
        submitted: true,
        transport: "baidu-link-converter-api",
        postEndpoint: WEIBO_POST_URL,
        uploadEndpoint: WEIBO_UPLOAD_URL,
        commentEndpoint: WEIBO_COMMENT_URL,
        imageIds,
        commentStatus,
        commentError
      },
      raw: {
        postResponse,
        commentResponse,
        imageIds,
        commentStatus,
        commentError
      }
    };
  }
}
