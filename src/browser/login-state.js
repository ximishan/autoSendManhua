export async function findVisible(page, selectors, { timeout = 0 } = {}) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (timeout > 0) await locator.waitFor({ state: "visible", timeout }).catch(() => {});
    if (await locator.isVisible().catch(() => false)) return locator;
  }
  return null;
}

export async function detectLoginBySignals(page, { loggedIn = [], loggedOut = [] }) {
  if (await findVisible(page, loggedOut)) return false;
  if (await findVisible(page, loggedIn)) return true;
  return null;
}
