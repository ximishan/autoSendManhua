import test from "node:test";
import assert from "node:assert/strict";
import { buildWeiboCookieText } from "../src/platforms/weibo/session.js";

test("buildWeiboCookieText keeps Weibo login cookies", () => {
  const text = buildWeiboCookieText([
    { name: "SUB", value: "sub-value", domain: ".weibo.com" },
    { name: "XSRF-TOKEN", value: "xsrf-value", domain: "weibo.com" },
    { name: "OTHER", value: "ok", domain: ".weibo.com" },
    { name: "SID", value: "ignore", domain: ".example.com" }
  ]);
  assert.match(text, /SUB=sub-value/);
  assert.match(text, /XSRF-TOKEN=xsrf-value/);
  assert.match(text, /OTHER=ok/);
  assert.doesNotMatch(text, /SID=ignore/);
});

test("buildWeiboCookieText rejects cookie sets without SUB", () => {
  const text = buildWeiboCookieText([
    { name: "XSRF-TOKEN", value: "xsrf-value", domain: ".weibo.com" }
  ]);
  assert.equal(text, "");
});
