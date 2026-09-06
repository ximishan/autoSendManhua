export const WEIBO_HOME = "https://weibo.com/";
export const WEIBO_LOGIN = "https://weibo.com/login";

const WEIBO_HOSTS = new Set(["weibo.com", "www.weibo.com", "m.weibo.cn"]);

export async function openWeiboHome(page) {
  await page.goto(WEIBO_HOME, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });
  await page.waitForTimeout(1500);
}

export function buildWeiboCookieText(cookies = []) {
  const values = new Map();
  for (const cookie of cookies) {
    const domain = String(cookie?.domain || "").replace(/^\./, "").toLowerCase();
    const name = String(cookie?.name || "").trim();
    const value = String(cookie?.value || "").trim();
    if (!name || !value) continue;
    if (domain === "weibo.com" || domain.endsWith(".weibo.com")) values.set(name, value);
  }
  if (!values.get("SUB")) return "";
  return [...values.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function readCookieState(page) {
  try {
    const cookies = await page.context().cookies([
      "https://weibo.com/",
      "https://www.weibo.com/",
      "https://m.weibo.cn/"
    ]);
    const cookieText = buildWeiboCookieText(cookies);
    const names = new Set(cookies.map(cookie => cookie.name));
    return {
      authenticated: Boolean(cookieText),
      hasXsrf: names.has("XSRF-TOKEN"),
      cookieText
    };
  } catch {
    return { authenticated: false, hasXsrf: false, cookieText: "" };
  }
}

async function readUidFromDesktop(page) {
  try {
    if (!WEIBO_HOSTS.has(new URL(page.url()).hostname)) return "";
    const payload = await page.evaluate(async () => {
      const response = await fetch("/ajax/config", {
        credentials: "same-origin",
        signal: AbortSignal.timeout(8000)
      });
      return response.ok ? await response.json() : null;
    });
    const candidates = [
      payload?.data?.uid,
      payload?.data?.user?.idstr,
      payload?.data?.user?.id,
      payload?.uid
    ];
    return String(candidates.find(value => /^\d+$/.test(String(value || ""))) || "");
  } catch {
    return "";
  }
}

async function readUidFromMobile(page) {
  try {
    const response = await page.context().request.get("https://m.weibo.cn/api/config", {
      headers: { accept: "application/json, text/plain, */*" },
      timeout: 10000
    });
    if (!response.ok()) return "";
    const payload = await response.json().catch(() => null);
    const candidates = [
      payload?.data?.uid,
      payload?.data?.user?.idstr,
      payload?.data?.user?.id,
      payload?.uid
    ];
    return String(candidates.find(value => /^\d+$/.test(String(value || ""))) || "");
  } catch {
    return "";
  }
}

async function readUidFromDom(page) {
  try {
    const hrefs = await page.locator("a[href]").evaluateAll(nodes => nodes.slice(0, 300).map(node => node.href || node.getAttribute("href") || ""));
    for (const href of hrefs) {
      const match = String(href).match(/weibo\.com\/(?:u\/)?(\d{5,})/);
      if (match) return match[1];
    }
  } catch {}
  return "";
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
  if (identity?.authenticated && identity?.hasXsrf) return { alreadyLoggedIn: true, identity };

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
    if (identity?.authenticated && identity?.hasXsrf && identity?.cookieText) return identity;

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
  return Boolean(identity?.authenticated);
}

export async function readWeiboIdentity(page) {
  const cookieState = await readCookieState(page);
  if (!cookieState.authenticated) return null;

  let uid = await readUidFromDesktop(page);
  if (!uid) uid = await readUidFromMobile(page);
  if (!uid) uid = await readUidFromDom(page);

  return {
    uid,
    authenticated: true,
    hasXsrf: cookieState.hasXsrf,
    cookieText: cookieState.cookieText
  };
}
