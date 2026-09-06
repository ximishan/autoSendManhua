import { AppError } from "../core/errors.js";
import { findVisible } from "../browser/login-state.js";

export async function requireVisible(page, selectors, label, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const locator = await findVisible(page, selectors);
    if (locator) return locator;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw new AppError(`未找到${label}`, { code: "SELECTOR_NOT_FOUND", retryable: true });
}

export async function requireAttached(page, selectors, label, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.count().catch(() => 0)) return locator;
    }
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw new AppError(`未找到${label}`, { code: "SELECTOR_NOT_FOUND", retryable: true });
}

export async function fillEditable(locator, value) {
  const tagName = await locator.evaluate((node) => node.tagName.toLowerCase());
  const contentEditable = await locator.getAttribute("contenteditable");
  if (tagName === "input" || tagName === "textarea") {
    await locator.fill(value);
  } else if (contentEditable === "true") {
    await locator.click();
    await locator.evaluate((node) => {
      node.focus();
      node.textContent = "";
      node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
    });
    await locator.pressSequentially(value, { delay: 1 });
  } else {
    await locator.click();
    await locator.pressSequentially(value, { delay: 1 });
  }
}

export async function waitForAnyVisible(page, selectors, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const found = await findVisible(page, selectors);
    if (found) return found;
    await page.waitForTimeout(250);
  }
  return null;
}

export function textFingerprint(value, length = 36) {
  return String(value || "").replace(/\s+/g, "").slice(0, length);
}
