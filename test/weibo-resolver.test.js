import test from "node:test";
import assert from "node:assert/strict";
import { buildWeiboUrls, extractWeiboIdentifiers, matchNewPost, midToBid } from "../src/platforms/weibo/resolve-post.js";

test("递归解析微博发布响应并生成 canonical URL", () => {
  const parsed = extractWeiboIdentifiers({ ok: 1, data: { idstr: "123456", mid: "123456", mblogid: "AbCd", user: { idstr: "9988" } } });
  assert.deepEqual({ id: parsed.id, mid: parsed.mid, bid: parsed.bid, userId: parsed.userId }, {
    id: "123456", mid: "123456", bid: "AbCd", userId: "9988"
  });
  assert.equal(buildWeiboUrls(parsed).canonicalUrl, "https://weibo.com/9988/AbCd");
});

test("mid 可以稳定转换为 base62 bid", () => {
  assert.equal(midToBid("0"), "0");
  assert.equal(midToBid("61"), "Z");
  assert.equal(midToBid("62"), "10");
  assert.equal(midToBid("not-a-mid"), "");
});

test("主页对比只选择新增且正文匹配的微博", () => {
  const before = [{ id: "old", text: "旧微博", url: "https://weibo.com/1/old" }];
  const after = [
    { id: "new", text: "这是本次发布正文 其他", url: "https://weibo.com/1/new", imageCount: 2, userId:'1', publishedAt:new Date().toISOString() },
    ...before
  ];
  assert.equal(matchNewPost(before, after, { content: "这是本次发布正文", images: ["a", "b"], userId:'1' }).id, "new");
});
