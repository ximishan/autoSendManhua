# autoSendManhua

本地 Electron 多平台图文分发工具。任务先发布到微博并取得帖子链接，再把该微博链接写入知乎、简书、百家号、今日头条、搜狐号和网易号的平台模板。

## 当前状态

微博扫码登录已经在 Windows 本机真实验证通过。微博发布实现已切换为复用 `ximishan/baidu-link-converter` 中用户已经验证过的接口流程，正在进行真实发布验收。其他平台仍属于原型 / 待真实验收状态。

完整进度见：

- `docs/PROJECT_STATUS.md`
- `docs/FEATURE_CHECKLIST.md`
- `docs/IMPLEMENTATION_PLAN.md`

## 微博实现基线（重要）

微博账号登录和微博发布都以 `ximishan/baidu-link-converter` 的已验证实现为基线，不再自行发明另一套主流程。

### 登录

```text
扫码登录微博
→ 独立真实 Chrome Persistent Profile
→ 手机确认
→ 自动读取微博 Cookie
→ 校验 SUB + XSRF-TOKEN
→ 本机保存发布凭据
```

客户不需要命令行、不需要复制 Cookie、不需要再手动检测登录状态。

### 发布

```text
选择图片（可选）
→ picupload.weibo.com/interface/pic_upload.php 上传图片
→ weibo.com/ajax/statuses/update 发布正文
→ 直接读取接口返回的微博 ID
→ resourceUrl 存在时，用 weibo.com/ajax/comments/create 发布首评
→ 记录微博 ID / mid / bid / UID / URL / 发布时间 / 接口响应 / 首评状态
```

核心接口：

```text
图片：https://picupload.weibo.com/interface/pic_upload.php
正文：https://weibo.com/ajax/statuses/update
首评：https://weibo.com/ajax/comments/create
```

关键安全规则与 `baidu-link-converter` 保持一致：

> 正文一旦已经取得微博 ID，即视为正文已发布。后续首评、记录或其他步骤失败，都不能再次发送正文。

微博默认正文模板为 `{content}`。资源链接 `resourceUrl` 不再默认重复写进正文，而是按已验证流程发到首评。

旧的 Playwright 微博 DOM 发布 / URL 猜测代码可以作为诊断参考，但不再作为微博主发布链路。

## 已有模块

- Electron 桌面端：任务中心、新建发布、Excel 批量、账号、模板、日志和设置。
- SQLite：任务、图片、账号、平台 job、微博结果、模板、设置和日志。
- 微博一键扫码登录与本机 Cookie 持久化。
- 微博接口发布：文字、多图、首评、微博 ID 与结果记录。
- 微博结果完整记录：账号 ID、UID、微博 ID、mid、bid、canonical URL、share URL、发布时间、resolution、evidence、raw response。
- 微博前置与下游任务编排。
- 知乎 / 简书 / 百家号 / 今日头条 / 搜狐 / 网易平台适配原型。
- Excel `.xlsx` 导入、校验、模板和结果导出。

## 环境

- Windows 10/11
- Node.js 22+
- Chrome

安装：

```powershell
cd D:\project\autoSendManhua
npm install
```

启动：

```powershell
npm start
```

测试：

```powershell
npm test
node scripts/audit-core.mjs
node scripts/audit-ui.mjs
```

## 当前真实验收顺序

1. 微博扫码登录（已通过）。
2. 纯文字微博接口发布 + 微博 ID / URL 记录。
3. 多图微博接口发布。
4. resourceUrl 自动发布首评，首评失败时确认正文绝不重发。
5. 程序重启后登录态复用。
6. 跑通真实“微博 → 知乎”。

## 数据目录

```text
data/app.db                 SQLite 数据库
.profiles/                  各平台 / 账号登录 Profile
data/weibo_credentials.json 微博发布凭据（仅本机）
logs/                       调试日志
imports/                    导入模板
exports/                    发布结果
```

微博 Cookie / Token 不提交到 GitHub。
