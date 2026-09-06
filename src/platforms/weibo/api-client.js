import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { AppError, LoginRequiredError } from "../../core/errors.js";
import { parseWeiboCookie, validateWeiboCookie } from "./shortcut-auth.js";

export const WEIBO_POST_URL = "https://weibo.com/ajax/statuses/update";
export const WEIBO_COMMENT_URL = "https://weibo.com/ajax/comments/create";
export const WEIBO_UPLOAD_URL = "https://picupload.weibo.com/interface/pic_upload.php";

const MIME_TYPES = new Map([
  [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".png", "image/png"],
  [".webp", "image/webp"], [".gif", "image/gif"], [".bmp", "image/bmp"]
]);

function mimeTypeFor(filePath) {
  return MIME_TYPES.get(path.extname(filePath).toLowerCase()) || "image/jpeg";
}

function payloadMessage(payload, fallback = "微博操作失败") {
  return String(payload?.msg || payload?.message || payload?.error || fallback);
}

function parseJsonPayload(text, label) {
  const raw = String(text || "").trim();
  try { return JSON.parse(raw); }
  catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(raw.slice(start, end + 1)); } catch {}
    }
    throw new AppError(`${label}返回了异常页面，可能需要重新登录或验证`, {
      code: "WEIBO_INVALID_RESPONSE",
      needsAction: true
    });
  }
}

function checkPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new AppError("微博返回格式异常", { code: "WEIBO_INVALID_RESPONSE", needsAction: true });
  }
  if ((payload.ok !== undefined && payload.ok !== 1) || payload.error_code) {
    const message = payloadMessage(payload);
    if (/登录|验证|安全|账号|权限/.test(message)) throw new LoginRequiredError("weibo");
    if (/频繁|限制|上限|稍后/.test(message)) {
      throw new AppError(message, { code: "RATE_LIMITED", needsAction: true });
    }
    throw new AppError(message, { code: "WEIBO_API_ERROR" });
  }
  return payload;
}

function rawBinaryPost(urlValue, headers, body, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlValue);
    const request = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method: "POST",
      headers: {
        ...headers,
        "Content-Length": Buffer.byteLength(body),
        "Accept-Encoding": "identity"
      }
    }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        resolve({
          status: Number(response.statusCode || 0),
          headers: response.headers,
          text: Buffer.concat(chunks).toString("utf8")
        });
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("微博图片上传超时")));
    request.on("error", reject);
    request.end(body);
  });
}

export function extractWeiboPostInfo(payload) {
  const candidates = [];
  if (payload?.data && typeof payload.data === "object") candidates.push(payload.data);
  if (payload && typeof payload === "object") candidates.push(payload);

  for (const item of candidates) {
    const id = String(item.idstr || item.id || item.mid || "");
    if (!id) continue;
    const user = item.user && typeof item.user === "object" ? item.user : {};
    return {
      id,
      mid: String(item.mid || item.idstr || item.id || ""),
      bid: String(item.bid || item.mblogid || ""),
      userId: String(user.idstr || user.id || item.user_id || item.uid || "")
    };
  }
  return { id: "", mid: "", bid: "", userId: "" };
}

export class WeiboApiClient {
  constructor(cookieText, { fetchImpl = globalThis.fetch, binaryPostImpl = rawBinaryPost } = {}) {
    this.cookie = validateWeiboCookie(cookieText);
    this.cookies = parseWeiboCookie(this.cookie);
    this.fetchImpl = fetchImpl;
    this.binaryPostImpl = binaryPostImpl;
    if (typeof this.fetchImpl !== "function") throw new Error("当前 Node 环境不支持 fetch");
    this.headers = {
      "Accept": "application/json, text/plain, */*",
      "Content-Type": "application/x-www-form-urlencoded",
      "Origin": "https://weibo.com",
      "Referer": "https://weibo.com/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/132 Safari/537.36",
      "X-Requested-With": "XMLHttpRequest",
      "X-XSRF-TOKEN": this.cookies["XSRF-TOKEN"],
      "Cookie": this.cookie
    };
  }

  async request(url, { data = null, body = null, headers = {}, timeoutMs = 45000 } = {}) {
    let response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: { ...this.headers, ...headers },
        body: body ?? new URLSearchParams(data || {}).toString(),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      throw new AppError(`微博请求失败：${error.message}`, {
        code: "WEIBO_NETWORK_ERROR",
        retryable: true,
        cause: error
      });
    }

    if ([401, 403].includes(response.status)) throw new LoginRequiredError("weibo");
    if ([418, 429].includes(response.status)) {
      throw new AppError(`微博访问受限（HTTP ${response.status}）`, {
        code: "RATE_LIMITED",
        needsAction: true
      });
    }
    if (!response.ok) {
      throw new AppError(`微博请求失败（HTTP ${response.status}）`, {
        code: "WEIBO_HTTP_ERROR",
        retryable: response.status >= 500
      });
    }

    return checkPayload(parseJsonPayload(await response.text(), "微博"));
  }

  async uploadImageWithRawBinary(filePath) {
    const mime = mimeTypeFor(filePath);
    const url = new URL(WEIBO_UPLOAD_URL);
    url.searchParams.set("app", "miniblog");
    url.searchParams.set("data", "1");
    url.searchParams.set("mime", mime);
    const body = fs.readFileSync(filePath);
    let response;
    try {
      response = await this.binaryPostImpl(url.href, {
        ...this.headers,
        "Content-Type": mime
      }, body, 90000);
    } catch (error) {
      throw new AppError(`微博图片上传请求失败：${error.message}`, {
        code: "IMAGE_UPLOAD_NETWORK_ERROR",
        retryable: true,
        cause: error
      });
    }
    if ([401, 403].includes(response.status)) throw new LoginRequiredError("weibo");
    if ([418, 429].includes(response.status)) {
      throw new AppError(`图片上传被限制（HTTP ${response.status}）`, { code: "RATE_LIMITED", needsAction: true });
    }
    if (response.status < 200 || response.status >= 300) {
      throw new AppError(`微博图片上传失败（HTTP ${response.status}）`, {
        code: "IMAGE_UPLOAD_HTTP_ERROR",
        retryable: response.status >= 500
      });
    }
    return checkPayload(parseJsonPayload(response.text, "微博图片上传"));
  }

  async uploadImageWithFetch(filePath) {
    const mime = mimeTypeFor(filePath);
    const url = new URL(WEIBO_UPLOAD_URL);
    url.searchParams.set("app", "miniblog");
    url.searchParams.set("data", "1");
    url.searchParams.set("mime", mime);
    return this.request(url.href, {
      body: fs.readFileSync(filePath),
      headers: { "Content-Type": mime },
      timeoutMs: 90000
    });
  }

  async uploadImage(filePath) {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new AppError(`微博图片不存在：${filePath}`, { code: "IMAGE_NOT_FOUND" });
    }

    let payload;
    let transport = "raw-binary";
    try {
      payload = await this.uploadImageWithRawBinary(filePath);
    } catch (rawError) {
      if (rawError instanceof LoginRequiredError || rawError.code === "RATE_LIMITED") throw rawError;
      transport = "fetch-fallback";
      try {
        payload = await this.uploadImageWithFetch(filePath);
      } catch (fetchError) {
        throw new AppError(`微博图片上传失败；原始二进制：${rawError.message}；fetch 兜底：${fetchError.message}`, {
          code: "IMAGE_UPLOAD_FAILED",
          needsAction: Boolean(fetchError.needsAction || rawError.needsAction),
          retryable: Boolean(fetchError.retryable || rawError.retryable),
          cause: fetchError
        });
      }
    }

    const pid = payload?.data?.pics?.pic_1?.pid;
    if (!pid) throw new AppError(payloadMessage(payload, "图片上传没有返回图片 ID"), { code: "IMAGE_UPLOAD_FAILED" });
    return { pid: String(pid), transport, payload };
  }

  async uploadImages(filePaths = []) {
    if (filePaths.length > 9) throw new AppError("微博最多上传 9 张图片", { code: "TOO_MANY_IMAGES" });
    const results = [];
    for (const filePath of filePaths) results.push(await this.uploadImage(filePath));
    return results;
  }

  async publishPost(content, picIds = []) {
    const text = String(content || "").trim();
    if (!text) throw new AppError("微博正文不能为空", { code: "CONTENT_EMPTY" });
    const payload = await this.request(WEIBO_POST_URL, {
      data: {
        content: text,
        pic_id: picIds.join(","),
        visible: "0",
        media: "{}",
        vote: "{}",
        approval_state: "0"
      }
    });
    const info = extractWeiboPostInfo(payload);
    if (!info.id) {
      throw new AppError("微博已响应，但没有返回微博 ID", {
        code: "WEIBO_POST_ID_MISSING",
        needsAction: true
      });
    }
    return { info, payload };
  }

  async publishComment(postId, content) {
    const text = String(content || "").trim();
    if (!text) throw new AppError("微博首评内容不能为空", { code: "COMMENT_EMPTY" });
    return this.request(WEIBO_COMMENT_URL, {
      data: {
        id: String(postId),
        comment: text,
        pic_id: "",
        is_repost: "0",
        comment_ori: "0",
        is_comment: "0"
      }
    });
  }
}
