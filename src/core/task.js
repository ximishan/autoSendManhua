import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ValidationError } from "./errors.js";

export const SUPPORTED_PLATFORMS = [
  "weibo", "zhihu", "jianshu", "baijiahao", "toutiao", "sohu", "netease"
];

export const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

export function createTask(input) {
  if(!input || typeof input!=='object' || (input.images!==undefined&&!Array.isArray(input.images)) || (input.selectedPlatforms!==undefined&&!Array.isArray(input.selectedPlatforms)))throw new ValidationError('任务格式错误');
  const selectedPlatforms = [...new Set(["weibo", ...(input.selectedPlatforms || [])])];
  return {
    id: input.id || `task_${crypto.randomUUID()}`,
    title: String(input.title || "").trim(),
    content: String(input.content || "").trim(),
    resourceUrl: String(input.resourceUrl || "").trim(),
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
    try {
      const parsed = new URL(task.resourceUrl);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error("protocol");
    } catch {
      errors.push("资源链接必须是有效的 HTTP/HTTPS URL");
    }
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
