import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { BrowserManager } from "../browser/browser-manager.js";
import { resolveProfileDir } from "../browser/profile-manager.js";
import { openDatabase } from "../db/index.js";
import { createPublisher, platformConfigs } from "../platforms/index.js";

const platform = process.argv[2];
const accountId = process.argv[3] || "default";
if (!platform || (platform !== "weibo" && !platformConfigs[platform])) {
  console.error("用法：npm run login -- <weibo|zhihu|jianshu|baijiahao|toutiao|sohu|netease> [accountId]");
  process.exit(2);
}

const database = openDatabase();
const browserManager = new BrowserManager();
const rl = readline.createInterface({ input, output });

try {
  const account = database.accounts.upsert({
    id: accountId,
    platform,
    nickname: accountId,
    profilePath: resolveProfileDir(platform, accountId),
    status: "unknown"
  });
  const publisher = createPublisher(platform, { account, browserManager });
  const loggedIn = await publisher.checkLogin();
  if (loggedIn) {
    database.accounts.setStatus(accountId, "logged_in");
    console.log(`${platform}/${accountId} 已登录。`);
  } else {
    console.log(`请在打开的浏览器中完成 ${platform}/${accountId} 登录。`);
    await rl.question("登录完成后按回车检测...");
    const after = await publisher.checkLogin();
    database.accounts.setStatus(accountId, after ? "logged_in" : "needs_login");
    console.log(after ? "登录成功，Profile 已保存。" : "仍未检测到登录状态。");
    if (!after) process.exitCode = 2;
  }
} finally {
  rl.close();
  await browserManager.closeAll();
  database.close();
}
