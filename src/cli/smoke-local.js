import { openDatabase } from "../../scripts/test-db.mjs";
import { Workflow } from "../core/workflow.js";

class MockPublisher {
  constructor(platform) { this.platform = platform; }
  async publish(task, rendered) {
    if (this.platform !== "weibo" && !rendered.content.includes("https://weibo.com/100/demoBid")) {
      throw new Error("下游正文缺少微博链接");
    }
    return this.platform === "weibo"
      ? { success: true, id: "999", bid: "demoBid", userId: "100", canonicalUrl: "https://weibo.com/100/demoBid", publishedAt: new Date().toISOString() }
      : { success: true, postUrl: (this.platform==='zhihu'?'https://zhuanlan.zhihu.com/p/123':'https://www.jianshu.com/p/abcdef'), publishedAt: new Date().toISOString() };
  }
}

const database = openDatabase(":memory:");
const messages = [];
const logger = { info: (message) => messages.push(message), error: (message) => messages.push(message) };
try {
  const workflow = new Workflow({ database, logger, publisherFactory: (platform) => new MockPublisher(platform) });
  const task = database.tasks.create({
    title: "本地 Smoke Test",
    content: "验证微博前置和下游模板注入",
    resourceUrl: "https://pan.example.com/test",
    selectedPlatforms: ["zhihu", "jianshu"]
  });
  const result = await workflow.runTask(task.id);
  const passed = result.status === "completed"
    && result.weibo.canonical_url === "https://weibo.com/100/demoBid"
    && result.jobs.every((job) => job.status === "success");
  console.log(JSON.stringify({ passed, status: result.status, jobs: result.jobs.map(({ platform, status, post_url }) => ({ platform, status, post_url })), messages }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  database.close();
}
