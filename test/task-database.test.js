import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../scripts/test-db.mjs";
import { createTask, validateTask } from "../src/core/task.js";

test("任务校验检查标题、URL 和图片", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-task-"));
  const image = path.join(dir, "cover.png");
  fs.writeFileSync(image, "fixture");
  assert.doesNotThrow(() => validateTask(createTask({
    title: "标题", content: "正文", resourceUrl: "https://example.com/a", images: [image], selectedPlatforms: ["zhihu"]
  })));
  assert.throws(() => validateTask(createTask({ title: "", content: "正文" })), /标题不能为空/);
  assert.throws(() => validateTask(createTask({ title: "标题", content: "正文", resourceUrl: "file:\/\/bad" })), /HTTP/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("数据库创建微博前置 jobs 并可恢复中断状态", () => {
  const database = openDatabase(":memory:");
  try {
    const task = database.tasks.create({ title: "标题", content: "正文", selectedPlatforms: ["zhihu", "jianshu"] });
    assert.deepEqual(task.jobs.map(({ platform, status }) => ({ platform, status })), [
      { platform: "weibo", status: "pending" },
      { platform: "zhihu", status: "blocked" },
      { platform: "jianshu", status: "blocked" }
    ]);
    database.tasks.updateJob(task.jobs[0].id, { status: "running", phase: "prepare" });
    database.tasks.setStatus(task.id, "publishing_weibo");
    assert.deepEqual(database.tasks.recoverInterrupted(), { jobs: 1, tasks: 1 });
    assert.equal(database.tasks.get(task.id).status, "paused");
    assert.equal(database.tasks.get(task.id).jobs[0].status, "interrupted");
    database.tasks.continueTask(task.id);
    assert.equal(database.tasks.get(task.id).jobs[0].status, "pending");
  } finally { database.close(); }
});

test("手动重试会重置失败 job 的尝试次数", () => {
  const database = openDatabase(":memory:");
  try {
    const task = database.tasks.create({ title: "标题", content: "正文", selectedPlatforms: ["zhihu"] });
    const weibo = task.jobs.find((job) => job.platform === "weibo");
    database.tasks.updateJob(weibo.id, { status: "failed", attempt_count: 2 });
    const retried = database.tasks.retryFailed(task.id);
    assert.equal(retried.jobs.find((job) => job.platform === "weibo").status, "pending");
    assert.equal(retried.jobs.find((job) => job.platform === "weibo").retry_count, 0);
  } finally { database.close(); }
});

test("微博发布成功后完整记录账号、ID、链接、解析方式和提交证据", () => {
  const database = openDatabase(":memory:");
  try {
    const task = database.tasks.create({ title: "微博结果记录", content: "正文" });
    const job = task.jobs.find((item) => item.platform === "weibo");
    const publishedAt = "2026-09-06T07:20:00.000Z";
    database.tasks.finishJob(job, {
      success: true,
      id: "5200000000000001",
      mid: "5200000000000001",
      bid: "Qabc12345",
      userId: "1234567890",
      canonicalUrl: "https://weibo.com/1234567890/Qabc12345",
      shareUrl: "",
      publishedAt,
      resolution: "publish-response",
      evidence: { submitted: true, resolvedBy: "publish-response" }
    });

    const saved = database.tasks.get(task.id).weibo;
    assert.equal(saved.account_id, "test_weibo");
    assert.equal(saved.user_id, "1234567890");
    assert.equal(saved.weibo_id, "5200000000000001");
    assert.equal(saved.mid, "5200000000000001");
    assert.equal(saved.bid, "Qabc12345");
    assert.equal(saved.canonical_url, "https://weibo.com/1234567890/Qabc12345");
    assert.equal(saved.published_at, publishedAt);
    assert.equal(saved.resolution, "publish-response");
    assert.deepEqual(saved.evidence, { submitted: true, resolvedBy: "publish-response" });
  } finally { database.close(); }
});
