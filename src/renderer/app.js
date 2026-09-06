const api = window.autoSend;
const platforms = ["weibo", "zhihu", "jianshu", "baijiahao", "toutiao", "sohu", "netease"];
const names = {
  weibo: "微博", zhihu: "知乎", jianshu: "简书", baijiahao: "百家号",
  toutiao: "今日头条", sohu: "搜狐号", netease: "网易号"
};
const pageMeta = {
  tasks: ["任务中心", "核对每个平台的状态、地址和错误"],
  create: ["新建发布", "微博确认后再分发到其他平台"],
  batch: ["批量导入", "仅支持 .xlsx，错误行不会进入队列"],
  accounts: ["账号管理", "微博直接扫码登录，登录态自动保存"],
  templates: ["平台模板", "预览与实际发布使用相同模板"],
  logs: ["运行日志", "记录本地任务步骤和异常"],
  settings: ["设置", "保存后立即应用于后续任务"]
};

let state = { tasks: [], accounts: [], templates: [], logs: [], queue: {}, settings: {} };
let selectedImages = [];
let detailId = null;
let refreshing = false;

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>'"]/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
})[char]);
const labels = {
  pending: "等待", blocked: "等待微博", running: "进行中", success: "已发布", published: "已发布",
  failed: "失败", needs_action: "需核对/处理", interrupted: "中断待核对", submitted: "已提交待审核",
  awaiting_review: "等待审核", paused: "已暂停", cancelled: "已取消", completed: "全部已发布",
  weibo_failed: "微博失败", partial_failed: "部分失败", logged_in: "已登录", needs_login: "需要登录",
  unknown: "待检测", rejected: "审核拒绝"
};
const status = value => `<span class="status ${esc(value)}">${esc(labels[value] || value || "—")}</span>`;

function toast(message, error = false) {
  $("#toast").textContent = message;
  $("#toast").className = `toast${error ? " error" : ""}`;
  $("#toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { $("#toast").hidden = true; }, 5000);
}

async function safely(action) {
  try { return await action(); }
  catch (error) { toast(error.message, true); }
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    state = await api.snapshot();
    renderTasks();
    renderAccounts();
    renderTemplates();
    renderCreate();
    renderLogs();
    renderQueue();
  } finally {
    refreshing = false;
  }
}

function renderTasks() {
  $("#task-stats").innerHTML = [
    ["全部任务", state.tasks.length],
    ["等待/运行", state.tasks.filter(task => ["pending", "publishing_weibo", "distributing"].includes(task.status)).length],
    ["已完成", state.tasks.filter(task => task.status === "completed").length],
    ["需处理", state.tasks.filter(task => ["paused", "weibo_failed", "partial_failed", "awaiting_review"].includes(task.status)).length]
  ].map(([label, count]) => `<div class="stat"><span>${label}</span><b>${count}</b></div>`).join("");

  $("#task-list").innerHTML = state.tasks.map(task => {
    const cell = platform => {
      const job = task.jobs.find(item => item.platform === platform);
      return status(job?.status) + (job?.error_message ? `<span title="${esc(job.error_message)}"> ⓘ</span>` : "");
    };
    const url = task.weibo?.canonical_url;
    return `<tr>
      <td>${esc(task.title)}<br>${status(task.status)}</td>
      <td>${cell("weibo")}</td>
      <td>${url ? `<button class="link-btn" data-open="${esc(url)}">打开</button>` : "—"}</td>
      ${["zhihu", "jianshu", "baijiahao", "toutiao"].map(platform => `<td>${cell(platform)}</td>`).join("")}
      <td>${new Date(task.createdAt).toLocaleString()}</td>
      <td>
        <button class="link-btn" data-detail="${task.id}">查看详情</button>
        <button class="link-btn" data-run="${task.id}">执行</button>
        <button class="link-btn" data-pause="${task.id}">暂停</button>
        <button class="link-btn" data-continue="${task.id}">继续</button>
        <button class="link-btn" data-retry="${task.id}">重试失败项</button>
      </td>
    </tr>`;
  }).join("") || '<tr><td colspan="9">暂无任务</td></tr>';
}

function renderAccounts() {
  $("#account-list").innerHTML = state.accounts.map(account => {
    if (account.platform === "weibo") {
      return `<article class="account-card">
        <h3>${esc(account.nickname || account.id)}</h3>
        <p>微博 · ${esc(account.id)}</p>
        ${status(account.status)}
        <p>${account.status === "logged_in" ? "扫码登录状态已保存，后续发布会直接复用" : "点击扫码登录，手机确认后程序会自动保存登录状态"}</p>
        <div class="account-actions">
          <button class="primary small" data-account-weibo-login="${esc(account.id)}">${account.status === "logged_in" ? "重新扫码" : "扫码登录"}</button>
          <button class="secondary small" data-account-open="${esc(account.id)}">打开微博</button>
          <button class="secondary small" data-account-check="${esc(account.id)}">检测状态</button>
          <button class="secondary small" data-account-delete="${esc(account.id)}">删除</button>
        </div>
      </article>`;
    }
    return `<article class="account-card">
      <h3>${esc(account.nickname || account.id)}</h3>
      <p>${names[account.platform]} · ${esc(account.id)}</p>
      ${status(account.status)}
      <p>该平台继续使用独立浏览器 Profile</p>
      <div class="account-actions">
        <button class="secondary small" data-account-open="${esc(account.id)}">登录/打开</button>
        <button class="secondary small" data-account-check="${esc(account.id)}">测试状态</button>
        <button class="secondary small" data-account-delete="${esc(account.id)}">删除</button>
      </div>
    </article>`;
  }).join("") || '<p>还没有账号。点击上方“扫码登录微博”即可添加第一个微博账号。</p>';
}

function renderTemplates() {
  if ($("#template-list").children.length) return;
  $("#template-list").innerHTML = state.templates.map(template => `<article class="template-card">
    <h3>${names[template.platform]}</h3>
    <textarea data-template="${template.platform}">${esc(template.content_template)}</textarea>
    <button class="primary small" data-save-template="${template.platform}">保存模板</button>
  </article>`).join("");
}

function renderCreate() {
  const form = new FormData($("#task-form"));
  const options = platform => '<option value="">请选择账号</option>' + state.accounts
    .filter(account => account.platform === platform && account.enabled)
    .map(account => `<option value="${esc(account.id)}">${esc(account.nickname || account.id)}</option>`).join("");

  $("#weibo-account").innerHTML = options("weibo");
  $("#weibo-account").value = form.get("weiboAccount") || "";
  $("#platform-checks").innerHTML = platforms.slice(1).map(platform => `<label><span><input type="checkbox" name="platform" value="${platform}">${names[platform]}</span><select name="${platform}Account">${options(platform)}</select></label>`).join("");
  for (const platform of platforms.slice(1)) {
    $(`[name="platform"][value="${platform}"]`).checked = form.getAll("platform").includes(platform);
    $(`[name="${platform}Account"]`).value = form.get(`${platform}Account`) || "";
  }
}

function renderLogs() {
  $("#log-list").innerHTML = state.logs.slice(0, 300).map(log => `<div class="log-row"><span>${new Date(log.created_at).toLocaleString()}</span><span>${esc(log.level)}</span><span>${esc(log.platform || "system")}</span><span>${esc(log.message)}</span></div>`).join("") || "暂无日志";
}

function renderQueue() {
  const running = state.queue.running && !state.queue.paused;
  $("#queue-dot").classList.toggle("on", running);
  $("#queue-state").textContent = running ? "队列运行中" : "队列未运行";
  $("#queue-task").textContent = state.queue.activeTask ? `执行中：${state.queue.activeTask}` : "没有正在执行的任务";
  $("#queue-toggle").textContent = running ? "暂停队列" : "启动队列";
}

function gotoPage(name) {
  document.querySelectorAll(".nav-item").forEach(node => node.classList.toggle("active", node.dataset.page === name));
  document.querySelectorAll(".page").forEach(node => node.classList.toggle("active", node.id === `page-${name}`));
  $("#page-title").textContent = pageMeta[name][0];
  $("#page-desc").textContent = pageMeta[name][1];
  if (name === "settings" && state.settings) {
    $("#setting-attempts").value = state.settings.maxAttempts;
    $("#setting-delay").value = state.settings.intervalMs;
    $("#setting-share").checked = state.settings.preferShareUrl;
    $("#setting-retention").value = state.settings.retentionDays;
  }
}

function input() {
  const form = new FormData($("#task-form"));
  const selectedPlatforms = form.getAll("platform");
  return {
    title: form.get("title"),
    content: form.get("content"),
    resourceUrl: form.get("resourceUrl"),
    images: selectedImages,
    selectedPlatforms,
    accountIds: Object.fromEntries(["weibo", ...selectedPlatforms].map(platform => [
      platform,
      form.get(platform === "weibo" ? "weiboAccount" : `${platform}Account`)
    ]))
  };
}

function renderWeiboResult(task) {
  const result = task.weibo;
  if (!result) return "";
  const rows = [
    ["发布账号", result.account_id],
    ["微博 UID", result.user_id],
    ["微博 ID", result.weibo_id],
    ["mid", result.mid],
    ["bid", result.bid],
    ["发布时间", result.published_at],
    ["识别方式", result.resolution]
  ].filter(([, value]) => value);
  const evidence = result.evidence && Object.keys(result.evidence).length ? JSON.stringify(result.evidence) : "";
  return `<article class="job-detail weibo-result-detail">
    <h3>微博发布结果记录</h3>
    ${rows.map(([label, value]) => `<p><b>${esc(label)}：</b>${esc(value)}</p>`).join("")}
    ${result.canonical_url ? `<p><b>详情链接：</b><button class="link-btn" data-open="${esc(result.canonical_url)}">${esc(result.canonical_url)}</button></p>` : ""}
    ${result.share_url ? `<p><b>分享链接：</b><button class="link-btn" data-open="${esc(result.share_url)}">${esc(result.share_url)}</button></p>` : ""}
    ${evidence ? `<p><b>提交证据：</b>${esc(evidence)}</p>` : ""}
  </article>`;
}

async function detail(id) {
  detailId = id;
  const task = await api.getTask(id);
  if (!task) return;
  $("#detail-content").innerHTML = `<h2>${esc(task.title)}</h2><p>${status(task.status)}</p>${renderWeiboResult(task)}` + task.jobs.map(job => {
    const uncertain = ["needs_action", "submitted", "interrupted"].includes(job.status) && job.phase !== "prepare";
    return `<article class="job-detail"><h3>${names[job.platform]} ${status(job.status)}</h3><p>阶段：${esc(job.phase)} · 累计尝试 ${job.attempt_count} 次</p><p>${esc(job.error_message || "无错误")}</p>${job.post_url ? `<button class="link-btn" data-open="${esc(job.post_url)}">${esc(job.post_url)}</button>` : ""}${uncertain ? `<label>已核实的帖子详情地址<input id="result-${job.id}" type="url" placeholder="https://..."></label><label><input type="checkbox" id="confirm-${job.id}">我已打开帖子，确认内容和发布账号与本任务一致</label><button class="primary small" data-reconcile="${job.id}">保存人工核对结果</button><button class="secondary small" data-not-published="${job.id}">确认未发布，重新准备</button>` : ""}</article>`;
  }).join("") + `<button class="secondary" data-cancel="${task.id}">取消未提交部分</button>`;
  if (!$("#task-detail").open) $("#task-detail").showModal();
}

async function loginWeibo(accountId = null) {
  const quick = $("#quick-weibo-login");
  if (!accountId && quick) {
    quick.disabled = true;
    quick.textContent = "等待扫码…";
  }
  $("#weibo-login-tip").textContent = "正在打开微博二维码，请使用手机微博 APP → 我的 → 扫一扫。手机确认后程序会自动识别并保存，不需要再点检测。";
  try {
    const account = await api.quickLoginWeibo(accountId);
    await refresh();
    $("#weibo-login-tip").textContent = "微博登录成功，登录态和发布所需凭据已自动保存。下次直接使用即可。";
    toast("微博扫码登录成功");
    return account;
  } finally {
    if (!accountId && quick) {
      quick.disabled = false;
      quick.textContent = "扫码登录微博";
    }
  }
}

async function saveTask(run) {
  if (!$("#task-form").reportValidity()) return;
  const task = await api.createTask(input());
  await refresh();
  gotoPage("tasks");
  toast("任务已创建");
  if (run) {
    await api.runTask(task.id);
    await refresh();
  }
}

document.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button) return;
  safely(async () => {
    if (button.dataset.page) gotoPage(button.dataset.page);
    if (button.dataset.goto) gotoPage(button.dataset.goto);
    if (button.dataset.open) await api.openUrl(button.dataset.open);
    if (button.dataset.detail) await detail(button.dataset.detail);
    if (button.dataset.run) { toast("开始执行"); await api.runTask(button.dataset.run); await refresh(); }
    if (button.dataset.pause) { await api.pauseTask(button.dataset.pause); await refresh(); toast("已请求暂停，当前已提交结果仍会保存"); }
    if (button.dataset.continue) { await api.continueTask(button.dataset.continue); await api.runTask(button.dataset.continue); await refresh(); toast("已执行可恢复步骤；需核对的提交不会重发"); }
    if (button.dataset.retry) { await api.retryTask(button.dataset.retry); await api.runTask(button.dataset.retry); await refresh(); }
    if (button.dataset.cancel) { await api.cancelTask(button.dataset.cancel); await detail(detailId); await refresh(); }
    if (button.dataset.reconcile) {
      const id = Number(button.dataset.reconcile);
      await api.reconcileJob(id, $(`#result-${id}`).value, $(`#confirm-${id}`).checked);
      await detail(detailId); await refresh();
    }
    if (button.dataset.notPublished && confirm("请先在平台核对。只有确认本任务未发布，才能重新提交。确定尚未发布吗？")) {
      await api.markNotPublished(Number(button.dataset.notPublished), true);
      await detail(detailId); await refresh();
    }
    if (button.dataset.accountWeiboLogin) await loginWeibo(button.dataset.accountWeiboLogin);
    if (button.dataset.accountOpen) { await api.openAccount(button.dataset.accountOpen); toast("账号窗口已打开"); }
    if (button.dataset.accountCheck) { await api.checkAccount(button.dataset.accountCheck); await refresh(); }
    if (button.dataset.accountDelete && confirm("删除账号记录？")) {
      const remove = confirm("同时删除该账号的登录目录？取消则保留。");
      await api.deleteAccount(button.dataset.accountDelete, remove);
      await refresh();
    }
    if (button.dataset.saveTemplate) {
      await api.saveTemplate(button.dataset.saveTemplate, $(`[data-template="${button.dataset.saveTemplate}"]`).value);
      await refresh();
      toast("模板已保存");
    }
  });
});

$("#refresh").onclick = () => safely(refresh);
$("#refresh-logs").onclick = () => safely(refresh);
$("#quick-weibo-login").onclick = () => safely(() => loginWeibo());

$("#pick-images").onclick = () => safely(async () => {
  selectedImages = await api.selectImages();
  $("#image-count").textContent = `已选择 ${selectedImages.length} 张`;
  $("#image-list").innerHTML = selectedImages.map(file => `<span class="chip">${esc(file.split(/[\\/]/).pop())}</span>`).join("");
});

$("#preview-task").onclick = () => safely(async () => {
  const preview = await api.previewTask(input());
  $("#content-preview").innerHTML = preview.map(item => `<div class="preview-block"><b>${names[item.platform]}</b>${esc(item.content)}</div>`).join("");
});

$("#task-form").onsubmit = event => { event.preventDefault(); safely(() => saveTask(true)); };
$("#save-draft").onclick = () => safely(() => saveTask(false));
$("#queue-toggle").onclick = () => safely(async () => {
  if (state.queue.running && !state.queue.paused) await api.queuePause();
  else if (state.queue.running) await api.queueResume();
  else await api.queueStart();
  await refresh();
});
$("#export-results").onclick = () => safely(async () => { const result = await api.exportExcel(); if (result) toast(`已导出 ${result.count} 条`); });
$("#excel-template").onclick = () => safely(async () => { if (await api.saveExcelTemplate()) toast("模板已保存"); });
$("#excel-import").onclick = () => safely(async () => {
  const result = await api.importExcel();
  if (!result) return;
  $("#import-result").innerHTML = `<p>创建 ${result.created.length} 条，错误 ${result.invalid.length} 条</p>` + result.invalid.map(item => `<p>第 ${item.rowNumber} 行：${esc(item.error)}</p>`).join("");
  await refresh();
});

$("#add-account").onclick = () => { $("#account-form-wrap").hidden = !$("#account-form-wrap").hidden; };
$("#account-form select").innerHTML = platforms.slice(1).map(platform => `<option value="${platform}">${names[platform]}</option>`).join("");
$("#account-form").onsubmit = event => {
  event.preventDefault();
  safely(async () => {
    const form = new FormData(event.target);
    const account = await api.saveAccount(Object.fromEntries(form));
    await refresh();
    await api.openAccount(account.id);
  });
};

$("#save-settings").onclick = () => safely(async () => {
  await api.setSetting("retry.maxAttempts", Number($("#setting-attempts").value));
  await api.setSetting("queue.intervalMs", Number($("#setting-delay").value));
  await api.setSetting("weibo.preferShareUrl", $("#setting-share").checked);
  await api.setSetting("logs.retentionDays", Number($("#setting-retention").value));
  await refresh();
  toast("设置已生效");
});
$("#close-detail").onclick = () => $("#task-detail").close();

api.onLog(() => safely(refresh));
api.onAccountLoginProgress(entry => {
  if (entry.platform !== "weibo") return;
  const messages = {
    opening_qr: "正在打开微博登录页面…",
    waiting_scan: "二维码已打开，请使用手机微博 APP 扫码并确认登录…",
    logged_in: "扫码成功，正在自动保存登录状态…",
    failed: entry.message || "微博扫码登录失败"
  };
  $("#weibo-login-tip").textContent = messages[entry.status] || $("#weibo-login-tip").textContent;
});

refresh().catch(error => toast(error.message, true));
setInterval(() => { if (document.visibilityState === "visible") safely(refresh); }, 2000);
