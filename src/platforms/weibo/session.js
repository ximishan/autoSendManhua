export const WEIBO_HOME = "https://weibo.com/";

export async function openWeiboHome(page) {
  await page.goto(WEIBO_HOME, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });
  await page.waitForTimeout(1500);
}

export async function detectWeiboLogin(page) {
  const currentUrl = page.url();
  if (/passport\.weibo\.com|login\.sina\.com\.cn/.test(currentUrl)) {
    return false;
  }

  const loginSignals = [
    "text=登录",
    "text=注册",
    "input[placeholder*='手机号']",
    "input[placeholder*='邮箱']"
  ];

  for (const selector of loginSignals) {
    if (await page.locator(selector).count().catch(() => 0)) {
      const visible = await page.locator(selector).first().isVisible().catch(() => false);
      if (visible) return false;
    }
  }

  const loggedInSignals = [
    "a[href*='/u/']",
    "a[href*='/profile']",
    "[class*='avatar']",
    "[class*='woo-avatar']"
  ];

  for (const selector of loggedInSignals) {
    if (await page.locator(selector).count().catch(() => 0)) return true;
  }

  return null;
}
