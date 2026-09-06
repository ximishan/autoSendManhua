import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWeiboUrls,
  extractWeiboIdentifiers,
  matchNewPost,
  midToBid,
  resultFromPost
} from "../src/platforms/weibo/resolve-post.js";

test("递归解析微博发布响应并生成 canonical URL", () => {
  const parsed = extractWeiboIdentifiers({
    ok: 1,
    data: { idstr: "123456", mid: "123456", mblogid: "AbCd", user: { idstr: "9988" } }
  }, "9988");
  assert.deepEqual({ id: parsed.id, mid: parsed.mid, bid: parsed.bid, userId: parsed.userId }, {
    id: "123456", mid: "123456", bid: "AbCd", userId: "9988"
  });
  assert.equal(buildWeiboUrls(parsed).canonicalUrl, "https://weibo.com/9988/AbCd");
});

test("发布响应不能把无用户归属的图片 id 误判成微博", () => {
  const parsed = extractWeiboIdentifiers({
    ok: 1,
    data: { pics: [{ id: "987654321", pid: "abc" }] }
  }, "9988");
  assert.equal(parsed, null);
});

test("发布响应必须属于当前登录微博 UID", () => {
  const parsed = extractWeiboIdentifiers({
    ok: 1,
    data: { idstr: "123456", mid: "123456", mblogid: "AbCd", user: { idstr: "7777" } }
  }, "9988");
  assert.equal(parsed, null);
});

test("mid 可以稳定转换为 base62 bid", () => {
  assert.equal(midToBid("0"), "0");
  assert.equal(midToBid("61"), "Z");
  assert.equal(midToBid("62"), "10");
  assert.equal(midToBid("not-a-mid"), "");
});

test("主页对比只选择新增且正文、UID、时间、图片匹配的微博", () => {
  const now = Date.now();
  const before = [{ id: "100", mid: "100", text: "旧微博", url: "https://weibo.com/1/old" }];
  const after = [
    {
      id: "101",
      mid: "101",
      bid: "new",
      text: "这是本次发布正文 其他",
      url: "https://weibo.com/1/new",
      imageCount: 2,
      userId: "1",
      publishedAt: new Date(now).toISOString()
    },
    ...before
  ];
  const matched = matchNewPost(before, after, {
    content: "这是本次发布正文",
    images: ["a", "b"],
    userId: "1"
  }, now);
  assert.equal(matched.id, "101");
});

test("正文中的原始外链与微博显示的网页链接差异不会破坏匹配", () => {
  const now = Date.now();
  const matched = matchNewPost([], [{
    id: "201",
    mid: "201",
    bid: "abc",
    text: "漫画资料整理：网页链接",
    url: "https://weibo.com/1/abc",
    imageCount: 0,
    userId: "1",
    publishedAt: new Date(now).toISOString()
  }], {
    content: "漫画资料整理：https://pan.baidu.com/s/123",
    images: [],
    userId: "1"
  }, now);
  assert.equal(matched.id, "201");
});

test("存在两个同样满足条件的新增候选时拒绝猜测", () => {
  const now = Date.now();
  const common = {
    text: "同一段正文",
    imageCount: 0,
    userId: "1",
    publishedAt: new Date(now).toISOString()
  };
  const matched = matchNewPost([], [
    { ...common, id: "301", mid: "301", bid: "a", url: "https://weibo.com/1/a" },
    { ...common, id: "302", mid: "302", bid: "b", url: "https://weibo.com/1/b" }
  ], { content: "同一段正文", images: [], userId: "1" }, now);
  assert.equal(matched, null);
});

test("账号、发布时间或图片数量不匹配的候选全部拒绝", () => {
  const now = Date.now();
  const candidates = [
    { id: "401", mid: "401", bid: "a", url: "https://weibo.com/2/a", text: "目标正文", imageCount: 1, userId: "2", publishedAt: new Date(now).toISOString() },
    { id: "402", mid: "402", bid: "b", url: "https://weibo.com/1/b", text: "目标正文", imageCount: 1, userId: "1", publishedAt: new Date(now - 10 * 60 * 1000).toISOString() },
    { id: "403", mid: "403", bid: "c", url: "https://weibo.com/1/c", text: "目标正文", imageCount: 2, userId: "1", publishedAt: new Date(now).toISOString() }
  ];
  assert.equal(matchNewPost([], candidates, { content: "目标正文", images: ["a"], userId: "1" }, now), null);
});

test("resultFromPost 使用 UID + bid 生成固定 canonical URL", () => {
  const result = resultFromPost({
    id: "501",
    mid: "501",
    bid: "AbCd",
    userId: "9988",
    url: "https://weibo.com/9988/AbCd?refer_flag=1001030103_",
    publishedAt: "2026-09-06T05:00:00.000Z",
    source: "profile-api"
  });
  assert.equal(result.canonicalUrl, "https://weibo.com/9988/AbCd");
  assert.equal(result.resolution, "profile-api");
});
