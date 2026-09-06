import { textFingerprint } from "../helpers.js";

const BASE62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

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
    if(typeof object?.[key]==='number'&&!Number.isSafeInteger(object[key]))continue;
    if (object?.[key] !== undefined && object?.[key] !== null && object?.[key] !== "") return String(object[key]);
  }
  return "";
}

export function extractWeiboIdentifiers(payload) {
  const queue = [payload];
  const seen = new Set();
  let best = null;
  while (queue.length) {
    const value = queue.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    const id = pick(value, ["idstr", "id", "weibo_id"]);
    const mid = pick(value, ["mid"]);
    const bid = pick(value, ["bid", "mblogid"]);
    const userId = pick(value.user, ["idstr", "id", "uid"]) || pick(value, ["user_id", "uid"]);
    const shareUrl = pick(value, ["share_url", "shareUrl", "url"]);
    const isPost=Boolean(userId && (bid || mid) && (id || mid));
    const candidate = { id, mid, bid: bid || midToBid(mid), userId, shareUrl: /^https?:\/\//.test(shareUrl) ? shareUrl : "" };
    const score = [candidate.id, candidate.mid, candidate.bid, candidate.userId].filter(Boolean).length;
    if (isPost && (!best || score > best.score)) best = { ...candidate, score };
    for (const child of Array.isArray(value) ? value : ['data','status','mblog'].map(key=>value[key])) {
      if (child && typeof child === "object") queue.push(child);
    }
  }
  if (!best) return null;
  delete best.score;
  return best;
}

export function buildWeiboUrls({ userId, bid, id, mid, shareUrl }) {
  const resolvedBid = bid || midToBid(mid);
  const canonicalUrl = userId && resolvedBid
    ? `https://weibo.com/${userId}/${resolvedBid}`
    : id ? `https://weibo.com/detail/${id}` : "";
  return { canonicalUrl, shareUrl: shareUrl || "" };
}

export async function captureRecentPosts(page, selectors) {
  const cardSelector = selectors.postCards.join(",");
  return page.locator(cardSelector).evaluateAll((cards) => cards.slice(0, 8).map((card) => {
    const link = [...card.querySelectorAll("a[href]")].map((node) => node.href)
      .find((href) => /weibo\.com\/(?:\d+\/\w+|detail\/\d+)/.test(href)) || "";
    const match = link.match(/weibo\.com\/(?:detail\/)?(?:\d+\/)?([A-Za-z0-9]+)/);
    return {
      id: card.getAttribute("mid") || card.getAttribute("data-mid") || match?.[1] || "",
      url: link,
      text: (card.querySelector('[data-testid="post-content"], [class*="detail_wbtext"], [class*="wbtext"], p')?.innerText || '').trim(),
      userId: new URL(link || 'https://weibo.com/').pathname.split('/')[1],
      publishedAt: card.querySelector('time[datetime]')?.getAttribute('datetime') || card.getAttribute('data-published-at') || '',
      imageCount: card.querySelectorAll('[data-testid="post-image"], [class*="picture"] img').length
    };
  })).catch(() => []);
}

export function matchNewPost(beforePosts, afterPosts, task, publishedAt = Date.now()) {
  const beforeIds = new Set(beforePosts.map((post) => post.id || post.url).filter(Boolean));
  const fingerprint = textFingerprint(task.content);
  const candidates = afterPosts.filter((post) => !beforeIds.has(post.id || post.url));
  const uid=String(task.userId || task.weiboUserId || '');
  if(!uid || !Number.isFinite(publishedAt))return null;
  const matched=candidates.filter(post=>{
    const time=Date.parse(post.publishedAt);
    return String(post.userId)===uid && Number.isFinite(time) && time>=publishedAt-60000 && time<=Date.now()+60000
      && post.imageCount===(task.images?.length||0) && fingerprint && textFingerprint(post.text,fingerprint.length)===fingerprint;
  });
  return matched.length===1?matched[0]:null;
}

export function resultFromPost(post) {
  if (!post?.url) return null;
  const path = new URL(post.url).pathname.split("/").filter(Boolean);
  const isDetail = path[0] === "detail";
  return {
    id: isDetail ? path[1] || post.id : post.id || "",
    userId: isDetail ? "" : path[0] || "",
    bid: isDetail ? "" : path[1] || "",
    canonicalUrl: post.url.split("?")[0],
    shareUrl: "",
    publishedAt: new Date().toISOString(),
    resolution: "timeline-diff"
  };
}
