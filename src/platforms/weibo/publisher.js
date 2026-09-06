import { PlatformPublisher } from "../base-publisher.js";
import { LoginRequiredError } from "../../core/errors.js";
import { extractResourceLinks } from "../../core/task.js";
import { validateWeiboCookie } from "./shortcut-auth.js";
import { WeiboApiClient, WEIBO_COMMENT_URL, WEIBO_POST_URL, WEIBO_UPLOAD_URL } from "./api-client.js";

export function buildWeiboResourceComment(resourceText) {
  const text = String(resourceText || "").trim();
  if (!text) return "";
  const links = extractResourceLinks(text);
  if (!links.length) return "";
  if (links.length === 1 && text === links[0]) return `链接：${text}`;
  return text;
}

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
    const imageUploads = [];

    this.logger?.info?.(`微博：准备发布，图片 ${task.images?.length || 0} 张`, {
      platform: "weibo",
      details: { imageCount: task.images?.length || 0 }
    });

    for (const filePath of task.images || []) {
      this.guard();
      this.logger?.info?.("微博：开始上传图片", {
        platform: "weibo",
        details: { filePath, endpoint: WEIBO_UPLOAD_URL }
      });
      const uploaded = await client.uploadImage(filePath);
      const pid = typeof uploaded === "string" ? uploaded : uploaded?.pid;
      if (!pid) throw new Error(`微博图片上传未返回 PID：${filePath}`);
      imageIds.push(String(pid));
      imageUploads.push({
        filePath,
        pid: String(pid),
        transport: typeof uploaded === "string" ? "legacy" : uploaded.transport || "unknown"
      });
      this.logger?.info?.("微博：图片上传成功", {
        platform: "weibo",
        details: imageUploads[imageUploads.length - 1]
      });
    }

    this.guard();
    this.checkpoint("submitting", {
      submitted: false,
      transport: "baidu-link-converter-api",
      endpoint: WEIBO_POST_URL,
      imageIds,
      imageUploads
    });

    this.logger?.info?.("微博：发送正文", {
      platform: "weibo",
      details: {
        endpoint: WEIBO_POST_URL,
        imageCount: imageIds.length,
        picId: imageIds.join(",")
      }
    });

    const publishedAt = new Date().toISOString();
    const { info, payload: postResponse } = await client.publishPost(rendered.content, imageIds);
    const canonicalUrl = `https://weibo.com/detail/${info.id}`;

    this.checkpoint("submitted", {
      submitted: true,
      transport: "baidu-link-converter-api",
      endpoint: WEIBO_POST_URL,
      postId: info.id,
      imageIds,
      imageUploads
    });

    let commentStatus = "skipped";
    let commentError = "";
    let commentResponse = null;
    const commentContent = buildWeiboResourceComment(task.resourceUrl);
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
        imageUploads,
        resourceLinks: extractResourceLinks(task.resourceUrl),
        commentStatus,
        commentError
      },
      raw: {
        postResponse,
        commentResponse,
        imageIds,
        imageUploads,
        resourceText: task.resourceUrl || "",
        resourceLinks: extractResourceLinks(task.resourceUrl),
        commentStatus,
        commentError
      }
    };
  }
}
