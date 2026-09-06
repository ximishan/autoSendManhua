import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";
import fs from 'node:fs';
import os from 'node:os';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sandboxRoot=fs.mkdtempSync(path.join(os.tmpdir(),'asm-ui-smoke-'));
const electronApp = await electron.launch({ args: [projectRoot], cwd: projectRoot,env:{...process.env,AUTO_SEND_MANHUA_ROOT:sandboxRoot} });
try {
  const window = await electronApp.firstWindow({ timeout: 20000 });
  await window.locator("#page-title").waitFor({ state: "visible" });
  const result = {
    title: await window.title(),
    heading: await window.locator("#page-title").textContent(),
    navigationItems: await window.locator(".nav-item").count(),
    preloadApi: await window.evaluate(() => Boolean(window.autoSend)),
    taskTableVisible: await window.locator("#task-list").isVisible()
  };
  const passed = result.heading === "任务中心" && result.navigationItems === 7 && result.preloadApi && result.taskTableVisible;
  console.log(JSON.stringify({ passed, ...result }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  await electronApp.close();
}
