import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { openPersistentBrowser } from "../browser/profile-manager.js";
import { detectWeiboLogin, openWeiboHome } from "../platforms/weibo/session.js";

async function main() {
  const session = await openPersistentBrowser("weibo");
  const rl = readline.createInterface({ input, output });

  try {
    await openWeiboHome(session.page);
    const before = await detectWeiboLogin(session.page);

    if (before === true) {
      console.log("微博已登录，当前登录态可继续使用。");
      await rl.question("按回车关闭浏览器...");
      return;
    }

    console.log("微博登录窗口已打开，请在浏览器中完成登录。登录状态会保存在 .profiles/weibo。 ");
    await rl.question("登录完成后按回车检测状态...");

    await openWeiboHome(session.page);
    const after = await detectWeiboLogin(session.page);

    if (after === true) {
      console.log("微博登录成功，登录态已保存。下次无需重复登录。 ");
    } else if (after === false) {
      console.log("仍检测到未登录状态，请重新运行 npm run login:weibo。 ");
      process.exitCode = 2;
    } else {
      console.log("页面结构无法明确判断登录状态，但 Profile 已保存。后续发布模块会再做接口级验证。 ");
    }
  } finally {
    rl.close();
    await session.close();
  }
}

main().catch((error) => {
  console.error("微博登录初始化失败：", error);
  process.exitCode = 1;
});
