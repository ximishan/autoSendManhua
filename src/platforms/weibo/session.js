export const WEIBO_HOME = "https://weibo.com/";
export const WEIBO_LOGIN = "https://weibo.com/login";

export async function openWeiboHome(page) {
  await page.goto(WEIBO_HOME, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });
  await page.waitForTimeout(1500);
}

export async function openWeiboQrLogin(page) {
  await page.goto(WEIBO_HOME, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  }).catch(async () => {
    await page.goto(WEIBO_LOGIN, { waitUntil: "domcontentloaded", timeout: 60000 });
  });
  await page.waitForTimeout(1200);

  const identity = await readWeiboIdentity(page);
  if (identity) return { alreadyLoggedIn: true, identity };

  const loginTriggers = [
    "button:has-text('登录')",
    "a:has-text('登录')",
    "[role='button']:has-text('登录')"
  ];
  for (const selector of loginTriggers) {
    const locator = page.locator(selector).first();
    if (await locator.count().catch(() => 0) && await locator.isVisible().catch(() => false)) {
      await locator.click().catch(() => {});
      await page.waitForTimeout(500);
      break;
    }
  }

  const qrTriggers = [
    "text=扫码登录",
    "text=二维码登录",
    "text=扫描二维码登录",
    "[role='tab']:has-text('扫码')",
    "button:has-text('扫码')",
    "a:has-text('扫码')",
    "[role='button']:has-text('扫码')"
  ];
  for (const selector of qrTriggers) {
    const locator = page.locator(selector).first();
    if (await locator.count().catch(() => 0) && await locator.isVisible().catch(() => false)) {
      await locator.click().catch(() => {});
      await page.waitForTimeout(500);
      break;
    }
  }

  return { alreadyLoggedIn: false, identity: null };
}

export async function waitForWeiboLogin(page, { timeoutMs = 300000 } = {}) {
  const started = Date.now();
  let lastQrRefresh = 0;
  while (Date.now() - started < timeoutMs) {
    if (page.isClosed()) return null;
    const identity = await readWeiboIdentity(page);
    if (identity) return identity;

    if (Date.now() - lastQrRefresh > 90000) {
      lastQrRefresh = Date.now();
      for (const selector of ["text=刷新二维码", "text=重新获取", "button:has-text('刷新')", "[role='button']:has-text('刷新')"]) {
        const locator = page.locator(selector).first();
        if (await locator.count().catch(() => 0) && await locator.isVisible().catch(() => false)) {
          await locator.click().catch(() => {});
          break;
        }
      }
    }

    await page.waitForTimeout(1200);
  }
  return null;
}

export async function detectWeiboLogin(page) {
  const identity = await readWeiboIdentity(page);
  return Boolean(identity);
}

export async function readWeiboIdentity(page) {
  try {
    if (!['weibo.com', 'www.weibo.com'].includes(new URL(page.url()).hostname)) return null;
    const payload = await page.evaluate(async () => {
      const response = await fetch('/ajax/config', { credentials: 'same-origin', signal: AbortSignal.timeout(15000) });
      return response.ok ? await response.json() : null;
    });
    if (!payload) return null;
    const data = payload.data;
    if (payload.ok === 1 && (data?.login === true || data?.login === 1) && /^\d+$/.test(String(data.uid))) {
      return { uid: String(data.uid) };
    }
  } catch {}
  return null;
}
