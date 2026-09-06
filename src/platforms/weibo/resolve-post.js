import { textFingerprint } from "../helpers.js";

const BASE62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const WEIBO_HOSTS = new Set(["weibo.com", "www.weibo.com"]);

function encodeBase62(number) {
  let value = BigInt(number);
  if (value === 0n) return "0";
  let output = "";
  while (value > 0n) {
    output = BASE62[Number(value % 62n)] + output;
    value /= 62n;
  }
  return output;
}

export function midToBid(mid) {
  const source = String(mid || "");
  if (!/^\d+$/.test(source)) return "";
  const chunks = [];
  for (let end = source.length; end > 0; end -= 7) {
    const start = Math.max(0, end - 7);
    const encoded = encodeBase62(source.slice(start, end));
    chunks.unshift(start === 0 ? encoded : encoded.padStart(4, "0"));
  }
  return chunks.join("");
}

function pick(object, keys) {
  for (const key of keys) {
    if (typeof object?.[key] === "number" && !Number.isSafeInteger(object[key])) continue;
    if (object?.[key] !== undefined && object?.[key] !== null && object?.[key] !== "") return String(object[key]);
  }
  return "";
}

function isNumericId(value) {
  return /^\d+$/.test(String(value || ""));
}

function normalizeShareUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") return "";
    if (WEIBO_HOSTS.has(url.hostname) || url.hostname === "t.cn") return url.toString();
  } catch {}
  return "";
}

export function extractWeiboIdentifiers(payload, expectedUserId = "") {
  const queue = [payload];
  const seen = new Set();
  let best = null;
  const expected = String(expectedUserId || "");

  while (queue.length) {
    const value = queue.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) if (item && typeof item === "object") queue.push(item);
      continue;
    }

    const id = pick(value, ["idstr", "weibo_id", "id"]);
    const mid = pick(value, ["mid"]);
    const bid = pick(value, ["bid", "mblogid"]);
    const userId = pick(value.user, ["idstr", "id", "uid"]) || pick(value, ["user_id", "uid"]);
    const numericPostId = isNumericId(mid) ? mid : (isNumericId(id) ? id : "");
    const resolvedBid = bid || midToBid(numericPostId);

    if (isNumericId(userId) && numericPostId && resolvedBid && (!expected || userId === expected)) {
      const candidate = {
        id: isNumericId(id) ? id : numericPostId,
        mid: isNumericId(mid) ? mid : numericPostId,
        bid: resolvedBid,
        userId,
        shareUrl: normalizeShareUrl(pick(value, ["share_url", "shareUrl", "url"]))
      };
      const score = [candidate.id, candidate.mid, candidate.bid, candidate.userId, candidate.shareUrl].filter(Boolean).length;
      if (!best || score > best.score) best = { ...candidate, score };
    }

    for (const key of ["data", "status", "mblog", "statuses", "items", "cards", "card_group"]) {
      const child = value[key];
      if (child && typeof child === "object") queue.push(child);
    }
  }

  if (!best) return null;
  delete best.score;
  return best;
}

export function buildWeiboUrls({ userId, bid, id, mid, shareUrl }) {
  const resolvedBid = bid || midToBid(mid || id);
  const canonicalUrl = isNumericId(userId) && resolvedBid
    ? `https://weibo.com/${userId}/${resolvedBid}`
    : isNumericId(id) ? `https://weibo.com/detail/${id}` : "";
  return { canonicalUrl, shareUrl: normalizeShareUrl(shareUrl) };
}

function postKeys(post) {
  const keys = [];
  if (post?.mid) keys.push(`mid:${post.mid}`);
  if (post?.id) keys.push(`id:${post.id}`);
  if (post?.userId && post?.bid) keys.push(`bid:${post.userId}:${post.bid}`);
  if (post?.url) keys.push(`url:${String(post.url).split("?")[0]}`);
  return keys;
}

function comparableText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/https?:\/\/[^\s]+/gi, "")
    .replace(/网页链接/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&#39;|&quot;/g, "")
    .replace(/\s+/g, "")
    .trim();
}

export async function captureRecentPostsViaApi(page, uid, limit = 8) {
  const userId = String(uid || "");
  if (!isNumericId(userId)) return [];
  const context = page.context?.();
  if (!context?.newPage) return [];

  const probe = await context.newPage();
  try {
    await probe.goto(`https://m.weibo.cn/u/${userId}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    const posts = await probe.evaluate(async ({ uid, limit }) => {
      const response = await fetch(`/api/container/getIndex?type=uid&value=${uid}&containerid=107603${uid}&page=1`, {
        credentials: "include",
        headers: { accept: "application/json, text/plain, */*", "x-requested-with": "XMLHttpRequest" }
      });
      if (!response.ok) return [];
      const payload = await response.json();
      const rows = [];
      const walk = (cards) => {
        for (const card of Array.isArray(cards) ? cards : []) {
          if (card?.mblog) rows.push(card.mblog);
          if (Array.isArray(card?.card_group)) walk(card.card_group);
        }
      };
      walk(payload?.data?.cards);
      const toText = (html) => {
        const node = document.createElement("div");
        node.innerHTML = String(html || "");
        return (node.innerText || node.textContent || "").trim();
      };
      return rows.slice(0, limit).map((mblog) => ({
        id: String(mblog.idstr || mblog.id || ""),
        mid: String(mblog.mid || mblog.idstr || mblog.id || ""),
        bid: String(mblog.bid || mblog.mblogid || ""),
        userId: String(mblog.user?.idstr || mblog.user?.id || ""),
        text: toText(mblog.longText?.longTextContent || mblog.text || ""),
        publishedAt: String(mblog.created_at || ""),
        imageCount: Number(mblog.pic_num ?? mblog.pics?.length ?? 0)
      }));
    }, { uid: userId, limit });

    return posts.map((post) => {
      const urls = buildWeiboUrls(post);
      const timestamp = Date.parse(post.publishedAt);
      return {
        ...post,
        url: urls.canonicalUrl,
        publishedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : post.publishedAt,
        source: "profile-api"
      };
    }).filter((post) => post.url && post.userId === userId);
  } catch {
    return [];
  } finally {
    await probe.close().catch(() => {});
  }
}

export async function captureRecentPosts(page, selectors) {
  const cardSelector = selectors.postCards.join(",");
  return page.locator(cardSelector).evaluateAll((cards) => cards.slice(0, 8).map((card) => {
    const link = [...card.querySelectorAll("a[href]")].map((node) => node.href)
      .find((href) => /weibo\.com\/(?:\d+\/[A-Za-z0-9]+|detail\/\d+)/.test(href)) || "";
    const desktop = link.match(/weibo\.com\/(\d+)\/([A-Za-z0-9]+)/);
    const detail = link.match(/weibo\.com\/detail\/(\d+)/);
    const attrMid = card.getAttribute("mid") || card.getAttribute("data-mid") || "";
    const timeNode = card.querySelector('time[datetime], a[title][href*="/"]');
    return {
      id: detail?.[1] || (/^\d+$/.test(attrMid) ? attrMid : ""),
      mid: /^\d+$/.test(attrMid) ? attrMid : "",
      bid: desktop?.[2] || "",
      url: link.split("?")[0],
      text: (card.querySelector('[data-testid="post-content"], [class*="detail_wbtext"], [class*="wbtext"], [class*="text"]')?.innerText || "").trim(),
      userId: desktop?.[1] || "",
      publishedAt: timeNode?.getAttribute("datetime") || timeNode?.getAttribute("title") || card.getAttribute("data-published-at") || "",
      imageCount: card.querySelectorAll('[data-testid="post-image"], [class*="picture"] img').length,
      source: "profile-dom"
    };
  })).catch(() => []);
}

export function matchNewPost(beforePosts, afterPosts, task, publishedAt = Date.now()) {
  const beforeKeys = new Set(beforePosts.flatMap(postKeys));
  const uid = String(task.userId || task.weiboUserId || "");
  const clickedAt = Number(publishedAt);
  if (!isNumericId(uid) || !Number.isFinite(clickedAt)) return null;

  const expectedText = comparableText(task.content);
  const expectedImages = task.images?.length || 0;
  const candidates = afterPosts.filter((post) => {
    const keys = postKeys(post);
    if (!keys.length || keys.some(key => beforeKeys.has(key))) return false;
    if (String(post.userId || "") !== uid) return false;
    if (Number(post.imageCount ?? -1) !== expectedImages) return false;
    const time = Date.parse(post.publishedAt);
    if (!Number.isFinite(time) || time < clickedAt - 90000 || time > Date.now() + 120000) return false;

    const actualText = comparableText(post.text);
    if (!expectedText) return Boolean(actualText);
    const signatureLength = Math.min(48, expectedText.length);
    const signature = expectedText.slice(0, Math.max(1, signatureLength));
    return actualText.startsWith(signature) || actualText.includes(signature);
  });

  return candidates.length === 1 ? candidates[0] : null;
}

export function resultFromPost(post) {
  if (!post) return null;
  const urls = buildWeiboUrls(post);
  const canonicalUrl = urls.canonicalUrl || String(post.url || "").split("?")[0];
  if (!canonicalUrl) return null;
  return {
    id: post.id || "",
    mid: post.mid || "",
    userId: post.userId || "",
    bid: post.bid || "",
    canonicalUrl,
    shareUrl: urls.shareUrl || "",
    publishedAt: post.publishedAt || new Date().toISOString(),
    resolution: post.source || "timeline-diff"
  };
}
