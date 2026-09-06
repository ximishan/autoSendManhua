import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ValidationError } from "./errors.js";

export const SUPPORTED_PLATFORMS = [
  "weibo", "zhihu", "jianshu", "baijiahao", "toutiao", "sohu", "netease"
];

export const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

const RESOURCE_URL_PATTERN = /https?:\/\/[^\s<>"'，；]+/gi;

function trimUrlPunctuation(value) {
  return String(value || "").replace(/[。！？、；，,.;!?）)】\]}]+$/g, "");
}

export function extractResourceLinks(value) {
  const text = String(value || "").trim();
  if (!text) return [];
  const links = [];
  for (const match of text.matchAll(RESOURCE_URL_PATTERN)) {
    const raw = trimUrlPunctuation(match[0]);
    try {
      const url = new URL(raw);
      if (!/^https?:$/.test(url.protocol)) continue;
      links.push(url.href);
    } catch {}
  }
  return [...new Set(links)];
}

export function createTask(input) {
  if(!input || typeof input!=='object' || (input.images!==undefined&&!Array.isArray(input.images)) || (input.selectedPlatforms!==undefined&&!Array.isArray(input.selectedPlatforms)))throw new ValidationError('任务格式错误');
  const selectedPlatforms = [...new Set(["weibo", ...(input.selectedPlatforms || [])])];
  const resourceUrl = String(input.resourceUrl || "").trim();
  return {
    id: input.id || `task_${crypto.randomUUID()}`,
    title: String(input.title || "").trim(),
    content: String(input.content || "").trim(),
    resourceUrl,
    resourceLinks: extractResourceLinks(resourceUrl),
    images: (input.images || []).map((value) => path.resolve(String(value))),
    selectedPlatforms,
    accountIds: { ...(input.accountIds || {}) },
    status: "pending"
  };
}

export function validateTask(task, { checkFiles = true } = {}) {
  const errors = [];
  if (!task.title) errors.push("标题不能为空");
  if (!task.content) errors.push("正文不能为空");
  if (task.resourceUrl) {
    const links = extractResourceLinks(task.resourceUrl);
    if (!links.length) errors.push("资源信息至少需要包含一个有效的 HTTP/HTTPS 链接");
  }
  for (const platform of task.selectedPlatforms || []) {
    if (!SUPPORTED_PLATFORMS.includes(platform)) errors.push(`不支持的平台：${platform}`);
  }
  for (const image of task.images || []) {
    if (!IMAGE_EXTENSIONS.has(path.extname(image).toLowerCase())) errors.push(`不支持的图片格式：${image}`);
    if (checkFiles && (!fs.existsSync(image)||!fs.statSync(image).isFile())) errors.push(`图片不存在或不是文件：${image}`);
  }
  if (errors.length) throw new ValidationError(errors.join("；"));
  return task;
}
