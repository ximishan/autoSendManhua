import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WeiboApiClient, WEIBO_COMMENT_URL, WEIBO_POST_URL, WEIBO_UPLOAD_URL } from "../src/platforms/weibo/api-client.js";
import { WeiboPublisher } from "../src/platforms/weibo/publisher.js";

const COOKIE = "SUB=session; XSRF-TOKEN=csrf-token; WBPSESS=value";

function fakeResponse(payload, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async text() { return JSON.stringify(payload); }
  };
}

test("微博接口发布正文后使用返回 ID 发送首评", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (String(url).startsWith(WEIBO_POST_URL)) return fakeResponse({ ok: 1, data: { id: "123456789", mid: "123456789" } });
    if (String(url).startsWith(WEIBO_COMMENT_URL)) return fakeResponse({ ok: 1, data: { id: "comment-1" } });
    throw new Error(`unexpected url ${url}`);
  };
  const client = new WeiboApiClient(COOKIE, { fetchImpl });
  const { info } = await client.publishPost("正文", []);
  await client.publishComment(info.id, "链接：https://pan.baidu.com/s/test");
  assert.equal(info.id, "123456789");
  assert.equal(calls.length, 2);
  assert.match(calls[0].options.body, /content=%E6%AD%A3%E6%96%87/);
  assert.match(calls[1].options.body, /id=123456789/);
});

test("微博图片上传复用 pic_upload 接口并返回 pid", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-weibo-api-"));
  const image = path.join(dir, "a.jpg");
  fs.writeFileSync(image, Buffer.from("jpeg"));
  try {
    let called = "";
    const client = new WeiboApiClient(COOKIE, {
      fetchImpl: async (url) => {
        called = String(url);
        return fakeResponse({ data: { pics: { pic_1: { pid: "image-pid" } } } });
      }
    });
    assert.equal(await client.uploadImage(image), "image-pid");
    assert.ok(called.startsWith(WEIBO_UPLOAD_URL));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("首评失败时正文结果仍然成功，不能触发正文重发", async () => {
  const phases = [];
  let postCalls = 0;
  const publisher = new WeiboPublisher({
    cookieText: COOKIE,
    checkpoint: (phase) => phases.push(phase),
    clientFactory: () => ({
      async uploadImage() { return "pid"; },
      async publishPost() {
        postCalls += 1;
        return { info: { id: "987654321", mid: "987654321", bid: "", userId: "" }, payload: { ok: 1, data: { id: "987654321" } } };
      },
      async publishComment() { throw new Error("该微博不存在"); }
    })
  });
  const result = await publisher.publish({ images: [], resourceUrl: "https://pan.baidu.com/s/test" }, { content: "正文" });
  assert.equal(result.success, true);
  assert.equal(result.id, "987654321");
  assert.equal(result.evidence.commentStatus, "failed");
  assert.equal(postCalls, 1);
  assert.deepEqual(phases, ["submitting", "submitted"]);
});
