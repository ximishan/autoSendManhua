import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../db/index.js";
import { BrowserManager } from "../browser/browser-manager.js";
import { resolveProfileDir } from "../browser/profile-manager.js";
import { AppLogger } from "../core/logger.js";
import { Workflow } from "../core/workflow.js";
import { TaskQueue } from "../core/queue.js";
import { createPublisher, platformConfigs } from "../platforms/index.js";
import { exportResults, importExcel, writeImportTemplate } from "../importers/excel.js";
import { getDataPaths } from "../config/paths.js";
import { renderTemplate } from '../core/template-engine.js';
import { validPostUrl } from '../core/result.js';
import { openWeiboQrLogin, waitForWeiboLogin } from '../platforms/weibo/session.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
let mainWindow;
let database;
let browserManager;
let logger;
let workflow;
let queue;
const activeRuns = new Map();
app.setPath('userData',path.join(getDataPaths().data,'electron'));
const ownsInstance=app.requestSingleInstanceLock();
if(!ownsInstance)app.quit();
app.on('second-instance',()=>{ mainWindow?.restore();mainWindow?.focus(); });

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: "#f5f6fa",
    title: "autoSendManhua 多平台分发",
    webPreferences: {
      preload: path.join(currentDir, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.loadFile(path.join(currentDir, "..", "renderer", "index.html"));
  mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  mainWindow.webContents.on('will-navigate',event=>event.preventDefault());
}

function ensureHttpUrl(value) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol)) throw new Error("只允许打开 HTTP/HTTPS 地址");
  return url.href;
}

async function loginWeiboByQr(accountId = null) {
  const id = accountId || `weibo_${Date.now().toString(36)}`;
  let account = database.accounts.get(id);
  if (account && account.platform !== 'weibo') throw new Error('该账号 ID 不属于微博');
  if (database.raw.prepare("SELECT 1 FROM publish_jobs WHERE account_id=? AND status='running'").get(id)) {
    throw new Error('账号正在执行任务，请等待结束');
  }

  if (!account) {
    account = database.accounts.upsert({
      id,
      platform: 'weibo',
      nickname: '微博账号',
      profilePath: resolveProfileDir('weibo', id),
      status: 'unknown'
    });
  }

  const session = await browserManager.getSession('weibo', id, { profileDir: account.profile_path });
  mainWindow?.webContents.send('account:login-progress', { accountId: id, platform: 'weibo', status: 'opening_qr' });

  try {
    const opened = await openWeiboQrLogin(session.page);
    let identity = opened.identity;
    if (!identity) {
      mainWindow?.webContents.send('account:login-progress', { accountId: id, platform: 'weibo', status: 'waiting_scan' });
      identity = await waitForWeiboLogin(session.page, { timeoutMs: 300000 });
    }

    if (!identity?.uid) {
      database.accounts.setStatus(id, 'needs_login');
      throw new Error('扫码登录超时或登录窗口已关闭，请重新点击“扫码登录微博”');
    }

    account = database.accounts.upsert({
      id,
      platform: 'weibo',
      nickname: account.nickname && account.nickname !== '微博账号' ? account.nickname : `微博 ${identity.uid}`,
      profilePath: account.profile_path,
      status: 'logged_in',
      lastLoginAt: new Date().toISOString(),
      lastCheckedAt: new Date().toISOString(),
      enabled: Boolean(account.enabled)
    });
    const updated = database.accounts.setStatus(id, 'logged_in');
    mainWindow?.webContents.send('account:login-progress', { accountId: id, platform: 'weibo', status: 'logged_in', uid: identity.uid });
    await browserManager.close('weibo', id).catch(() => {});
    return { ...updated, uid: identity.uid };
  } catch (error) {
    mainWindow?.webContents.send('account:login-progress', { accountId: id, platform: 'weibo', status: 'failed', message: error.message });
    throw error;
  }
}

function setupIpc() {
  ipcMain.handle("app:snapshot", () => ({
    tasks: database.tasks.list(),
    accounts: database.accounts.list(),
    templates: database.templates.list(),
    logs: database.logs.list({ limit: 300 }),
    queue: { running: queue.running, paused: queue.paused, activeTask: queue.activeTask || [...workflow.active.keys()][0] || null },
    settings: {
      maxAttempts: database.settings.get("retry.maxAttempts", 2),
      intervalMs: database.settings.get("queue.intervalMs", 1500),
      retentionDays:database.settings.get('logs.retentionDays',30),
      preferShareUrl: database.settings.get("weibo.preferShareUrl", true)
    }
  }));
  ipcMain.handle("task:create", (_, input) => database.tasks.create(input));
  ipcMain.handle('task:get',(_,id)=>database.tasks.get(id));
  ipcMain.handle('task:cancel',(_,id)=>database.tasks.cancelTask(id));
  ipcMain.handle('task:preview',(_,input)=>['weibo',...(input.selectedPlatforms||[])].map(platform=>({platform,
    content:renderTemplate(platform,database.templates.get(platform)?.content_template||'',{...input,weiboUrl:'<微博发布后填入已确认的详情地址>'})})));
  ipcMain.handle('task:reconcile',(_,jobId,postUrl,confirmed)=>{
    if(confirmed!==true)throw new Error('请先核实帖子内容及发布账号');
    const job=database.tasks.getJob(jobId);
    if(!job || !['needs_action','submitted','interrupted'].includes(job.status))throw new Error('该任务无需核对');
    if(!validPostUrl(job.platform,postUrl))throw new Error('请输入该平台有效的帖子详情地址');
    database.tasks.finishJob(job,{success:true,canonicalUrl:job.platform==='weibo'?postUrl:undefined,postUrl,
      evidence:{manualConfirmed:true,confirmedAt:new Date().toISOString()}});
    database.tasks.setStatus(job.task_id,'pending');
    return workflow.summarize(job.task_id);
  });
  ipcMain.handle('task:not-published',(_,jobId,confirmed)=>{
    if(confirmed!==true)throw new Error('必须核实平台上没有发布该内容');
    const job=database.tasks.getJob(jobId);
    if(!job||!['needs_action','interrupted','submitted'].includes(job.status))throw new Error('任务状态不允许');
    database.tasks.updateJob(jobId,{status:'pending',phase:'prepare',retry_count:0,error_code:'',error_message:'',evidence:JSON.stringify({manualNotPublished:true})});
    return database.tasks.setStatus(job.task_id,'pending');
  });
  ipcMain.handle("task:run", async (_, taskId) => {
    if (activeRuns.has(taskId)) return activeRuns.get(taskId);
    const promise = workflow.runTask(taskId).finally(() => activeRuns.delete(taskId));
    activeRuns.set(taskId, promise);
    return promise;
  });
  ipcMain.handle("task:retry", (_, taskId) => database.tasks.retryFailed(taskId));
  ipcMain.handle("task:continue", (_, taskId) => database.tasks.continueTask(taskId));
  ipcMain.handle("task:pause", (_, taskId) => database.tasks.setStatus(taskId, "paused"));

  ipcMain.handle("account:save", (_, account) => database.accounts.upsert({
    ...account,
    profilePath: database.accounts.get(account.id)?.profile_path || resolveProfileDir(account.platform, account.id)
  }));
  ipcMain.handle('account:weibo-qr-login', (_, accountId) => loginWeiboByQr(accountId || null));
  ipcMain.handle("account:check", async (_, accountId) => {
    const account = database.accounts.get(accountId);
    if (!account) throw new Error("账号不存在");
    if(database.raw.prepare("SELECT 1 FROM publish_jobs WHERE account_id=? AND status='running'").get(accountId))throw new Error('账号正在执行任务，请等待结束');
    const publisher = createPublisher(account.platform, { account, browserManager, logger });
    const loggedIn = await publisher.checkLogin();
    return database.accounts.setStatus(accountId, loggedIn ? "logged_in" : "needs_login");
  });
  ipcMain.handle("account:open", async (_, accountId) => {
    const account = database.accounts.get(accountId);
    if (!account) throw new Error("账号不存在");
    if(database.raw.prepare("SELECT 1 FROM publish_jobs WHERE account_id=? AND status='running'").get(accountId))throw new Error('账号正在执行任务，请等待结束');
    if (account.platform === 'weibo' && account.status !== 'logged_in') return loginWeiboByQr(accountId);
    const publisher = createPublisher(account.platform, { account, browserManager, logger });
    await publisher.checkLogin();
    return { opened: true };
  });
  ipcMain.handle("account:delete", async (_, accountId, deleteProfile) => {
    const account = database.accounts.get(accountId);
    if (!account) return false;
    if(database.raw.prepare("SELECT 1 FROM publish_jobs WHERE account_id=? AND status NOT IN ('success','cancelled')").get(accountId))throw new Error('账号仍有关联未完成任务，请先处理任务');
    await browserManager.close(account.platform, account.id);
    if (deleteProfile) {
      const profileRoot = path.resolve(getDataPaths().profiles);
      const target = path.resolve(account.profile_path);
      if (!target.startsWith(`${profileRoot}${path.sep}`)) throw new Error("Profile 路径超出项目目录，拒绝删除");
      fs.rmSync(target, { recursive: true, force: true });
    }
    database.accounts.remove(accountId);
    return true;
  });

  ipcMain.handle("template:save", (_, platform, contentTemplate) => database.templates.save(platform, contentTemplate));
  ipcMain.handle("settings:get", (_, key, fallback) => database.settings.get(key, fallback));
  ipcMain.handle("settings:set", (_, key, value) => {
    if(key==='retry.maxAttempts' && (!Number.isInteger(value)||value<1||value>3))throw new Error('尝试次数必须为1–3');
    if(key==='queue.intervalMs' && (!Number.isInteger(value)||value<0||value>3600000))throw new Error('间隔应为0–3600000毫秒');
    if(key==='weibo.preferShareUrl' && typeof value!=='boolean')throw new Error('链接偏好格式错误');
    if(key==='logs.retentionDays' && (!Number.isInteger(value)||value<1||value>365))throw new Error('日志天数应为1–365');
    if(!['retry.maxAttempts','queue.intervalMs','weibo.preferShareUrl','logs.retentionDays'].includes(key))throw new Error('未知设置');
    database.settings.set(key,value);
    if(key==='retry.maxAttempts')workflow.retryPolicy.maxAttempts=value;
    if(key==='queue.intervalMs')queue.intervalMs=value;
    if(key==='weibo.preferShareUrl')workflow.preferShareUrl=value;
    if(key==='logs.retentionDays')logger.prune(value);
    return value;
  });

  ipcMain.handle("queue:start", () => { queue.start(); return { running: queue.running, paused: queue.paused }; });
  ipcMain.handle("queue:pause", () => { queue.pause(); return { running: queue.running, paused: queue.paused }; });
  ipcMain.handle("queue:resume", () => { queue.resume(); return { running: queue.running, paused: queue.paused }; });

  ipcMain.handle("dialog:images", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "图片", extensions: ["jpg", "jpeg", "png", "webp", "gif"] }]
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle("excel:import", async () => {
    const picked = await dialog.showOpenDialog(mainWindow, { properties: ["openFile"], filters: [{ name: "Excel", extensions: ["xlsx"] }] });
    if (picked.canceled) return null;
    return importExcel(database, picked.filePaths[0]);
  });
  ipcMain.handle("excel:export", async () => {
    const selected = await dialog.showSaveDialog(mainWindow, { defaultPath: path.join(getDataPaths().exports, "发布结果.xlsx"), filters: [{ name: "Excel", extensions: ["xlsx"] }] });
    if (selected.canceled) return null;
    fs.mkdirSync(path.dirname(selected.filePath), { recursive: true });
    return exportResults(database, selected.filePath);
  });
  ipcMain.handle("excel:template", async () => {
    const selected = await dialog.showSaveDialog(mainWindow, { defaultPath: path.join(getDataPaths().imports, "任务导入模板.xlsx"), filters: [{ name: "Excel", extensions: ["xlsx"] }] });
    if (selected.canceled) return null;
    fs.mkdirSync(path.dirname(selected.filePath), { recursive: true });
    return writeImportTemplate(selected.filePath);
  });
  ipcMain.handle("shell:open", (_, url) => shell.openExternal(ensureHttpUrl(url)));
}

app.whenReady().then(() => {
  if(!ownsInstance)return;
  database = openDatabase();
  browserManager = new BrowserManager();
  logger = new AppLogger({
    database,
    onEntry: (entry) => mainWindow?.webContents.send("log:entry", entry)
  });
  logger.prune(database.settings.get('logs.retentionDays',30));
  workflow = new Workflow({
    database,
    logger,
    retryPolicy: {
      maxAttempts: database.settings.get("retry.maxAttempts", 2),
      baseDelayMs: database.settings.get("retry.baseDelayMs", 1200),
      maxDelayMs: database.settings.get("retry.maxDelayMs", 8000)
    },
    preferShareUrl: database.settings.get("weibo.preferShareUrl", true),
    publisherFactory: (platform, options) => createPublisher(platform, { ...options, browserManager })
  });
  queue = new TaskQueue({ database, workflow, intervalMs: database.settings.get("queue.intervalMs", 1500) });
  queue.recover();
  setupIpc();
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
let closing=false;
app.on("before-quit", (event) => {
  if(closing)return;
  event.preventDefault();closing=true;
  queue?.stop();
  if(workflow)workflow.queuePaused=true;
  Promise.resolve(browserManager?.closeAll()).then(()=>Promise.allSettled([...workflow?.active.values()||[]])).finally(()=>{database?.close();app.quit();});
});
