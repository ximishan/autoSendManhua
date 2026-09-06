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
