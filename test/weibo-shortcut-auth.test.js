import test from "node:test";
import assert from "node:assert/strict";
import { parseWeiboCookie, toPlaywrightCookies, validateWeiboCookie } from "../src/platforms/weibo/shortcut-auth.js";

test("微博完整 Cookie 可识别 SUB 与 XSRF-TOKEN", () => {
  const normalized = validateWeiboCookie("SUB=sub-value; XSRF-TOKEN=xsrf-value; WBPSESS=session-value");
  assert.match(normalized, /SUB=sub-value/);
  assert.match(normalized, /XSRF-TOKEN=xsrf-value/);
  assert.match(normalized, /WBPSESS=session-value/);
});

test("支持 Copy as cURL 中的 Cookie 与 x-xsrf-token", () => {
  const parsed = parseWeiboCookie("curl 'https://weibo.com/' -H 'cookie: SUB=sub-value; WBPSESS=abc' -H 'x-xsrf-token: xsrf-value'");
  assert.equal(parsed.SUB, "sub-value");
  assert.equal(parsed["XSRF-TOKEN"], "xsrf-value");
});

test("支持 Cookie-Editor JSON", () => {
  const text = JSON.stringify([
    { domain: ".weibo.com", name: "SUB", value: "sub-value" },
    { domain: "weibo.com", name: "XSRF-TOKEN", value: "xsrf-value" },
    { domain: ".example.com", name: "IGNORE", value: "x" }
  ]);
  const parsed = parseWeiboCookie(text);
  assert.equal(parsed.SUB, "sub-value");
  assert.equal(parsed["XSRF-TOKEN"], "xsrf-value");
  assert.equal(parsed.IGNORE, undefined);
});

test("缺少关键 Cookie 时拒绝保存", () => {
  assert.throws(() => validateWeiboCookie("SUB=sub-value"), /XSRF-TOKEN/);
});

test("保存的 Cookie 可转换为 Playwright Cookie", () => {
  const cookies = toPlaywrightCookies("SUB=sub-value; XSRF-TOKEN=xsrf-value");
  assert.equal(cookies.length, 2);
  assert.ok(cookies.every(cookie => cookie.domain === ".weibo.com" && cookie.path === "/"));
});
