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

test("微博图片上传使用原始二进制请求并返回 pid", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-weibo-api-"));
  const image = path.join(dir, "a.jpg");
  fs.writeFileSync(image, Buffer.from("jpeg"));
  try {
    let call = null;
    const client = new WeiboApiClient(COOKIE, {
      binaryPostImpl: async (url, headers, body) => {
        call = { url, headers, body };
        return {
          status: 200,
          headers: {},
          text: JSON.stringify({ data: { pics: { pic_1: { pid: "image-pid" } } } })
        };
      }
    });
    const result = await client.uploadImage(image);
    assert.equal(result.pid, "image-pid");
    assert.equal(result.transport, "raw-binary");
    assert.ok(call.url.startsWith(WEIBO_UPLOAD_URL));
    assert.equal(call.headers["Content-Type"], "image/jpeg");
    assert.deepEqual(call.body, Buffer.from("jpeg"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("原始二进制图片请求失败时使用 fetch 兜底", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-weibo-api-fallback-"));
  const image = path.join(dir, "a.png");
  fs.writeFileSync(image, Buffer.from("png"));
  try {
    const client = new WeiboApiClient(COOKIE, {
      binaryPostImpl: async () => { throw new Error("raw failed"); },
      fetchImpl: async () => fakeResponse({ data: { pics: { pic_1: { pid: "fallback-pid" } } } })
    });
    const result = await client.uploadImage(image);
    assert.equal(result.pid, "fallback-pid");
    assert.equal(result.transport, "fetch-fallback");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("publisher 会把图片 pid 作为 pic_id 传给正文接口", async () => {
  let receivedPicIds = null;
  const publisher = new WeiboPublisher({
    cookieText: COOKIE,
    clientFactory: () => ({
      async uploadImage() { return { pid: "pid-1", transport: "raw-binary" }; },
      async publishPost(_content, picIds) {
        receivedPicIds = picIds;
        return { info: { id: "123", mid: "123", bid: "", userId: "" }, payload: { ok: 1, data: { id: "123" } } };
      },
      async publishComment() { return { ok: 1 }; }
    })
  });
  const result = await publisher.publish({ images: ["a.jpg"], resourceUrl: "" }, { content: "正文" });
  assert.deepEqual(receivedPicIds, ["pid-1"]);
  assert.deepEqual(result.evidence.imageIds, ["pid-1"]);
});

test("首评失败时正文结果仍然成功，不能触发正文重发", async () => {
  const phases = [];
  let postCalls = 0;
  const publisher = new WeiboPublisher({
    cookieText: COOKIE,
    checkpoint: (phase) => phases.push(phase),
    clientFactory: () => ({
      async uploadImage() { return { pid: "pid", transport: "raw-binary" }; },
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
