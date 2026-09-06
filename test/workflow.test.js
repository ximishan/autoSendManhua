import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../scripts/test-db.mjs";
import { Workflow } from "../src/core/workflow.js";
import { AppError, LoginRequiredError } from "../src/core/errors.js";

function createWorkflow(handlers) {
  const database = openDatabase(":memory:");
  const calls = [];
  const workflow = new Workflow({
    database,
    logger: { info() {}, error() {} },
    retryPolicy: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 2 },
    publisherFactory(platform) {
      return {
        async publish(task, rendered) {
          calls.push({ platform, rendered });
          return handlers[platform](task, rendered);
        }
      };
    }
  });
  return { database, workflow, calls };
}

test("微博失败时下游保持 blocked 且不被调用", async () => {
  const runtime = createWorkflow({
    weibo: async () => { throw new AppError("网络失败", { code: "NETWORK", retryable: true }); },
    zhihu: async () => { throw new Error("不应调用"); }
  });
  try {
    const task = runtime.database.tasks.create({ title: "标题", content: "正文", selectedPlatforms: ["zhihu"] });
    const result = await runtime.workflow.runTask(task.id);
    assert.equal(result.status, "weibo_failed");
    assert.equal(result.jobs.find((job) => job.platform === "zhihu").status, "blocked");
    assert.deepEqual(runtime.calls.map((call) => call.platform), ["weibo", "weibo"]);
  } finally { runtime.database.close(); }
});

test("登录失效进入需处理状态且不自动重试", async () => {
  const runtime = createWorkflow({ weibo: async () => { throw new LoginRequiredError("微博"); } });
  try {
    const task = runtime.database.tasks.create({ title: "标题", content: "正文" });
    const result = await runtime.workflow.runTask(task.id);
    assert.equal(result.status, "paused");
    assert.equal(result.jobs[0].status, "needs_action");
    assert.equal(runtime.calls.length, 1);
  } finally { runtime.database.close(); }
});

test("一个下游失败不影响其他平台且模板获得微博 URL", async () => {
  const runtime = createWorkflow({
    weibo: async () => ({ success: true, canonicalUrl: "https://weibo.com/1/demo", id: "1" }),
    zhihu: async () => { throw new Error("知乎故障"); },
    jianshu: async (task, rendered) => {
      assert.match(rendered.content, /https:\/\/weibo\.com\/1\/demo/);
      return { success: true, postUrl: "https://jianshu.com/p/abcdef" };
    }
  });
  try {
    const task = runtime.database.tasks.create({ title: "标题", content: "正文", selectedPlatforms: ["zhihu", "jianshu"] });
    const result = await runtime.workflow.runTask(task.id);
    assert.equal(result.status, "partial_failed");
    assert.equal(result.jobs.find((job) => job.platform === "zhihu").status, "failed");
    assert.equal(result.jobs.find((job) => job.platform === "jianshu").status, "success");
  } finally { runtime.database.close(); }
});

test("成功 job 在继续运行时不会重复发布", async () => {
  const runtime = createWorkflow({
    weibo: async () => ({ success: true, canonicalUrl: "https://weibo.com/1/demo" }),
    zhihu: async () => ({ success: true, postUrl: "https://zhuanlan.zhihu.com/p/1" })
  });
  try {
    const task = runtime.database.tasks.create({ title: "标题", content: "正文", selectedPlatforms: ["zhihu"] });
    await runtime.workflow.runTask(task.id);
    runtime.database.tasks.setStatus(task.id, "pending");
    await runtime.workflow.runTask(task.id);
    assert.deepEqual(runtime.calls.map((call) => call.platform), ["weibo", "zhihu"]);
  } finally { runtime.database.close(); }
});

test("微博发布器声称成功但未返回 URL 时仍阻断下游", async () => {
  const runtime = createWorkflow({
    weibo: async () => ({ success: true, id: "1" }),
    zhihu: async () => ({ success: true, postUrl: "https://zhuanlan.zhihu.com/p/1" })
  });
  try {
    const task = runtime.database.tasks.create({ title: "标题", content: "正文", selectedPlatforms: ["zhihu"] });
    const result = await runtime.workflow.runTask(task.id);
    assert.equal(result.status, "paused");
    assert.equal(result.jobs.find((job) => job.platform === "weibo").error_code, "PUBLISH_UNCERTAIN");
    assert.equal(runtime.calls.filter(call=>call.platform==='weibo').length,1);
    assert.equal(runtime.calls.filter((call) => call.platform === "zhihu").length, 0);
  } finally { runtime.database.close(); }
});
