import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from 'node:crypto';
import { chromium } from "playwright";
import { getDataPaths } from "../config/paths.js";

function safeSegment(value, label) {
  const original=String(value || 'default');
  const segment = /^[a-zA-Z0-9_-]+$/.test(original) ? original : `account_${createHash('sha256').update(original).digest('hex')}`;
  if (!segment || segment === "." || segment === "..") throw new Error(`${label} 无效`);
  return segment;
}

export function resolveProfileDir(platform, accountId = "default", root = getDataPaths().profiles) {
  return path.join(root, safeSegment(platform, "平台"), safeSegment(accountId, "账号 ID"));
}

export async function openPersistentBrowser(platform, options = {}) {
  const accountId = options.accountId || "default";
  const profileDir = options.profileDir || resolveProfileDir(platform, accountId, options.profileRoot);
  await fs.mkdir(profileDir, { recursive: true });

  const launchOptions = {
    headless: Boolean(options.headless),
    viewport: options.viewport || { width: 1365, height: 900 },
    locale: "zh-CN",
    args: ["--disable-blink-features=AutomationControlled"],
    ...(options.channel === false ? {} : { channel: options.channel || "chrome" })
  };
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, launchOptions);
  } catch (error) {
    if (options.channel === false || !/channel|executable|chrome/i.test(error.message)) throw error;
    delete launchOptions.channel;
    context = await chromium.launchPersistentContext(profileDir, launchOptions);
  }

  const page = context.pages()[0] || await context.newPage();
  return {
    context,
    page,
    platform,
    accountId,
    profileDir,
    close: () => context.close()
  };
}
