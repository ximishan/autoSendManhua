# autoSendManhua

本地 Electron 多平台图文分发工具。任务先发布到微博并取得帖子链接，再把该链接写入知乎、简书、百家号、今日头条、搜狐号和网易号的平台模板。

## 当前状态：原型，尚未完成验收

2026-09-06 复核发现暂停、重试防重复发布、队列节流、发布结果确认和模板预览存在实际缺陷。上一版“已完成”的表述不准确。原有 16 项测试通过不能证明真实平台可用。

新增定向审计 28 个场景中有 27 个违反要求，详见 `docs/COMPLETION_AUDIT.md` 和 `docs/PROJECT_STATUS.md`。下列为已有代码模块，不代表功能均已验收通过。

## 已有模块（含未完成项）

- Electron 桌面端：任务中心、新建发布、Excel 批量、账号、模板、日志和设置。
- SQLite 本地数据库：任务、图片、账号、平台 job、微博结果、模板、设置和日志。
- Playwright Persistent Profile 管理代码（账号标识碰撞和串号缺陷待修复）。
- 微博文字、多图、资源链接、响应解析、DOM 对比和 URL 存储原型（结果识别未验收）。
- 微博前置与下游任务编排（部分简单用例通过，假成功和重复提交缺陷待修复）。
- 暂停/继续、重试、恢复及队列入口（执行语义与节流未达要求）。
- Excel `.xlsx` 导入逐行校验、错误行报告、导入模板和结果导出。
- 平台 selector 独立维护，不需要修改核心工作流。

## 环境

- Windows 10/11
- Node.js 22+
- 系统 Chrome（优先）或 Playwright Chromium

安装：

```powershell
cd D:\project\autoSendManhua
npm install
```

如果 Electron 二进制下载不稳定，可以只对当前命令指定镜像：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
npm install
```

## 本地验证

```powershell
npm test
npm run smoke
npm run smoke:ui
```

- `npm test`：状态机、SQLite、模板、微博结果解析、Excel 及 Electron 启动测试。
- `npm run smoke`：不访问真实平台、不发布内容的微博→下游模拟闭环。
- `npm run smoke:ui`：启动 Electron，检查预加载 API、导航和任务表后自动退出；不覆盖发布、暂停和预览正确性。测试应设置独立的 `AUTO_SEND_MANHUA_ROOT`，避免启动恢复逻辑影响业务数据。

额外的完成度审计：`node scripts/audit-core.mjs` 和 `node scripts/audit-ui.mjs`，当前均会返回退出码 1（仍有不满足项）。

## 启动桌面端

```powershell
npm start
```

首次使用顺序：

1. 在“账号管理”添加微博及目标平台账号。
2. 点击“登录/打开”，在正常浏览器窗口完成登录。
3. 点击“测试状态”。
4. 在“平台模板”确认各平台正文。
5. 在“新建发布”填写任务并选择账号。

验证码、二维码或平台人工验证不会被绕过；对应任务会进入“需处理/已暂停”。

## CLI

登录指定平台和账号：

```powershell
npm run login -- weibo wb_01
npm run login -- zhihu zh_01
```

运行数据库中已有任务，或从 JSON 创建并运行：

```powershell
npm run run:task -- task_xxx
npm run run:task -- D:\tasks\one-task.json
```

导入 Excel：

```powershell
npm run import:excel -- D:\tasks\batch.xlsx
```

任务 JSON 示例：

```json
{
  "title": "标题",
  "content": "正文",
  "resourceUrl": "https://pan.example.com/xxx",
  "images": ["D:/images/1.jpg", "D:/images/2.jpg"],
  "selectedPlatforms": ["zhihu", "jianshu"],
  "accountIds": {
    "weibo": "wb_01",
    "zhihu": "zh_01",
    "jianshu": "js_01"
  }
}
```

## 数据目录

```text
data/app.db       SQLite 数据库
.profiles/        各平台/账号登录 Profile
logs/             脱敏 JSONL 调试日志
imports/          导入模板
exports/          发布结果
```

日志目前仅对 details 对象中的 Cookie、Token、Authorization 和密码键进行脱敏；message/stack 字符串不保证脱敏。Profile 保存在本机。

完整规格见 `docs/IMPLEMENTATION_PLAN.md`，当前证据与验收边界见 `docs/PROJECT_STATUS.md`。
