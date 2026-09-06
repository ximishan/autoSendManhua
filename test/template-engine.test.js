import test from "node:test";
import assert from "node:assert/strict";
import { renderTemplate, validateTemplate } from "../src/core/template-engine.js";

test("微博模板可以使用资源链接", () => {
  const result = renderTemplate("weibo", "{content}\n{resourceUrl}", {
    content: "正文",
    resourceUrl: "https://pan.example/a"
  });
  assert.equal(result, "正文\nhttps://pan.example/a");
});

test("下游模板使用微博链接并禁止原始资源链接", () => {
  assert.equal(renderTemplate("zhihu", "{title}\n{content}\n{weiboUrl}", {
    title: "标题", content: "正文", weiboUrl: "https://weibo.com/1/a"
  }), "标题\n正文\nhttps://weibo.com/1/a");
  assert.throws(() => validateTemplate("zhihu", "{resourceUrl}"), /禁止/);
});

test("未知模板变量会被拒绝", () => {
  assert.throws(() => validateTemplate("weibo", "{content}\n{secret}"), /未知变量/);
});
