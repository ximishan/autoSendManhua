import test from "node:test";
import assert from "node:assert/strict";
import { createTask, extractResourceLinks, validateTask } from "../src/core/task.js";
import { buildWeiboResourceComment } from "../src/platforms/weibo/publisher.js";

const MULTI = "K：https://pan.quark.cn/s/0e80aca30415 D: https://pan.baidu.com/s/1mjkRp6Ybi7NBomoRwjBgnQ?pwd=1111";

test("资源信息可以识别同一行的多个网盘链接", () => {
  assert.deepEqual(extractResourceLinks(MULTI), [
    "https://pan.quark.cn/s/0e80aca30415",
    "https://pan.baidu.com/s/1mjkRp6Ybi7NBomoRwjBgnQ?pwd=1111"
  ]);
  assert.doesNotThrow(() => validateTask(createTask({
    title: "测试",
    content: "正文",
    resourceUrl: MULTI
  }), { checkFiles: false }));
});

test("资源信息支持换行、中文说明和尾部标点", () => {
  const value = "夸克：https://pan.quark.cn/s/abc123\n百度：https://pan.baidu.com/s/xyz789?pwd=2222。";
  assert.deepEqual(extractResourceLinks(value), [
    "https://pan.quark.cn/s/abc123",
    "https://pan.baidu.com/s/xyz789?pwd=2222"
  ]);
});

test("多链接首评保留用户原始标签和排版", () => {
  assert.equal(buildWeiboResourceComment(MULTI), MULTI);
});

test("单个纯链接仍使用 baidu-link-converter 的链接前缀", () => {
  const value = "https://pan.baidu.com/s/test?pwd=1111";
  assert.equal(buildWeiboResourceComment(value), `链接：${value}`);
});

test("资源信息非空但没有有效链接时拒绝创建任务", () => {
  assert.throws(() => validateTask(createTask({
    title: "测试",
    content: "正文",
    resourceUrl: "百度网盘：没有链接"
  }), { checkFiles: false }), /至少需要包含一个有效/);
});
