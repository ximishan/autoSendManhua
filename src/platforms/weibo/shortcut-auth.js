import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getDataPaths } from "../../config/paths.js";

const REQUIRED_COOKIE_NAMES = ["SUB", "XSRF-TOKEN"];
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const launcherScript = path.resolve(moduleDir, "../../../scripts/open-weibo-shortcut.ps1");

function credentialsFile() {
  return path.join(getDataPaths().data, "weibo_credentials.json");
}

function ensureDataDir() {
  fs.mkdirSync(getDataPaths().data, { recursive: true });
}

function normalizeCookieKey(values, wanted) {
  const found = Object.keys(values).find(key => key.toLowerCase() === wanted.toLowerCase());
  if (!found) return "";
  if (found !== wanted) {
    values[wanted] = values[found];
    delete values[found];
  }
  return values[wanted];
}

export function parseWeiboCookie(cookieText) {
  let raw = String(cookieText || "").trim();
  if (!raw) return {};

  if (raw.startsWith("[")) {
    try {
      const exported = JSON.parse(raw);
      if (Array.isArray(exported)) {
        const values = {};
        for (const item of exported) {
          if (!item || typeof item !== "object") continue;
          const domain = String(item.domain || "").replace(/^\./, "").toLowerCase();
          const name = String(item.name || "").trim();
          const value = String(item.value || "").trim();
          if ((domain === "weibo.com" || domain.endsWith(".weibo.com")) && name && value) values[name] = value;
        }
        normalizeCookieKey(values, "SUB");
        normalizeCookieKey(values, "XSRF-TOKEN");
        return values;
      }
    } catch {}
  }

  const curlSource = raw.replace(/\^/g, "");
  const xsrfHeader = curlSource.match(/(?:-H|--header)\s+(['"])x-xsrf-token:\s*([\s\S]*?)\1/i);
  const cookieHeader = curlSource.match(/(?:-H|--header)\s+(['"])cookie:\s*([\s\S]*?)\1/i);
  const cookieArg = curlSource.match(/(?:-b|--cookie)\s+(['"])([\s\S]*?)\1/i);
  if (cookieHeader || cookieArg) raw = (cookieHeader || cookieArg)[2].trim();

  const values = {};
  for (const part of raw.replace(/\r/g, "").replace(/\n/g, "").split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key && value) values[key] = value;
  }
  if (xsrfHeader && !normalizeCookieKey(values, "XSRF-TOKEN")) values["XSRF-TOKEN"] = xsrfHeader[2].trim();
  normalizeCookieKey(values, "SUB");
  normalizeCookieKey(values, "XSRF-TOKEN");
  return values;
}

export function validateWeiboCookie(cookieText) {
  const values = parseWeiboCookie(cookieText);
  const missing = REQUIRED_COOKIE_NAMES.filter(name => !normalizeCookieKey(values, name));
  if (missing.length) throw new Error(`Cookie 缺少：${missing.join(", ")}`);
  return Object.entries(values).map(([key, value]) => `${key}=${value}`).join("; ");
}

export function toPlaywrightCookies(cookieText) {
  const values = parseWeiboCookie(validateWeiboCookie(cookieText));
  return Object.entries(values).map(([name, value]) => ({
    name,
    value,
    domain: ".weibo.com",
    path: "/",
    secure: true,
    sameSite: "Lax"
  }));
}

export function loadWeiboCredentials() {
  try {
    const data = JSON.parse(fs.readFileSync(credentialsFile(), "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function writeCredentials(data) {
  ensureDataDir();
  const file = credentialsFile();
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(temp, file);
}

export function getWeiboCredential(accountId) {
  return String(loadWeiboCredentials()[accountId] || "");
}

export function hasWeiboCredential(accountId) {
  try {
    return Boolean(validateWeiboCookie(getWeiboCredential(accountId)));
  } catch {
    return false;
  }
}

export function saveWeiboCredential(accountId, cookieText) {
  const normalized = validateWeiboCookie(cookieText);
  const credentials = loadWeiboCredentials();
  credentials[accountId] = normalized;
  writeCredentials(credentials);
  return normalized;
}

export function removeWeiboCredential(accountId) {
  const credentials = loadWeiboCredentials();
  if (!(accountId in credentials)) return false;
  delete credentials[accountId];
  writeCredentials(credentials);
  return true;
}

function shortcutId(shortcutPath) {
  const normalized = path.resolve(shortcutPath).toLowerCase();
  const hash = crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  return `weibo_${hash}`;
}

export function listWeiboShortcutAccounts(shortcutsDir) {
  const directory = path.resolve(String(shortcutsDir || ""));
  if (!directory || !fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return [];
  const credentials = loadWeiboCredentials();
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(".lnk"))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
    .map(entry => {
      const shortcutPath = path.join(directory, entry.name);
      const id = shortcutId(shortcutPath);
      return {
        id,
        name: path.basename(entry.name, path.extname(entry.name)),
        shortcutName: entry.name,
        shortcutPath,
        configured: Boolean(credentials[id])
      };
    });
}

export function findWeiboShortcutAccount(shortcutsDir, accountId) {
  return listWeiboShortcutAccounts(shortcutsDir).find(account => account.id === accountId) || null;
}

export function openWeiboShortcut(shortcutPath) {
  return new Promise((resolve, reject) => {
    if (process.platform !== "win32") {
      reject(new Error("微博快捷方式登录目前只支持 Windows"));
      return;
    }
    if (!fs.existsSync(launcherScript)) {
      reject(new Error("微博账号启动脚本不存在"));
      return;
    }
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", launcherScript,
      "-ShortcutPath", shortcutPath
    ], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolve(true);
      else reject(new Error((stderr || stdout || `启动微博浏览器失败（${code}）`).trim()));
    });
  });
}
