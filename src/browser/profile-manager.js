import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const PROFILE_ROOT = path.join(ROOT, ".profiles");

export async function openPersistentBrowser(platform, options = {}) {
  const profileDir = options.profileDir || path.join(PROFILE_ROOT, platform);
  await fs.mkdir(profileDir, { recursive: true });

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: Boolean(options.headless),
    viewport: options.viewport || { width: 1365, height: 900 },
    locale: "zh-CN",
    args: ["--disable-blink-features=AutomationControlled"]
  });

  const page = context.pages()[0] || await context.newPage();
  return {
    context,
    page,
    profileDir,
    close: () => context.close()
  };
}
