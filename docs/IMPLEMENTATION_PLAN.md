# autoSendManhua 完整实现方案

更新时间：2026-09-06

> 本文档定义项目从“微博前置发布”到“多平台分发、桌面 UI、批量任务、状态恢复”的完整实现方案。后续开发优先按本文档执行；实际页面结构变化时只修改平台适配器，不改变核心工作流。

## 1. 最终目标

输入一条内容任务：

- 标题
- 正文
- 1~N 张图片
- 资源链接（百度网盘 / 夸克 / 迅雷等）
- 要发布的平台

执行链路：

```text
创建任务
  ↓
校验标题 / 正文 / 图片 / 资源链接
  ↓
微博发布（前置依赖）
  ↓
确认发布成功
  ↓
获取刚发布微博的 canonicalUrl / shareUrl
  ↓
保存微博结果
  ↓
根据各平台模板生成二次分发正文
  ↓
知乎 / 简书 / 百家号 / 今日头条 / 搜狐号 / 网易号 ...
  ↓
逐平台记录成功 / 失败 / 发布 URL / 错误原因
```

核心原则：后续平台默认只拿“微博帖子链接”作为外部链接，不直接使用原始网盘链接。

---

## 2. 技术栈

### 桌面端

- Electron：桌面 UI、窗口管理、本地文件选择
- Node.js：任务编排、平台适配、日志、数据库

### 浏览器自动化

- Playwright
- 每个平台 / 每个账号独立 Persistent Context
- 默认使用系统 Chrome / Chromium
- 支持后续接入 CDP 已登录浏览器

### 本地数据

- SQLite：任务、账号、发布结果、日志索引、模板、平台配置
- 本地文件目录：图片缓存、导入文件、日志、Profile

### 批量导入

- xlsx：Excel 导入/导出

---

## 3. 推荐目录结构

```text
autoSendManhua/
├─ package.json
├─ README.md
├─ docs/
│  ├─ PROJECT_STATUS.md
│  └─ IMPLEMENTATION_PLAN.md
├─ data/
│  └─ app.db
├─ logs/
├─ imports/
├─ .profiles/
│  ├─ weibo/<accountId>/
│  ├─ zhihu/<accountId>/
│  ├─ jianshu/<accountId>/
│  ├─ baijiahao/<accountId>/
│  └─ toutiao/<accountId>/
└─ src/
   ├─ main/
   │  ├─ electron-main.js
   │  └─ ipc.js
   ├─ renderer/
   │  ├─ pages/
   │  └─ components/
   ├─ core/
   │  ├─ workflow.js
   │  ├─ task-runner.js
   │  ├─ queue.js
   │  ├─ template-engine.js
   │  ├─ retry-policy.js
   │  └─ errors.js
   ├─ db/
   │  ├─ index.js
   │  ├─ migrations.js
   │  └─ repositories/
   ├─ browser/
   │  ├─ profile-manager.js
   │  ├─ browser-manager.js
   │  └─ login-state.js
   ├─ platforms/
   │  ├─ base-publisher.js
   │  ├─ weibo/
   │  │  ├─ session.js
   │  │  ├─ selectors.js
   │  │  ├─ publisher.js
   │  │  ├─ resolve-post.js
   │  │  └─ login-check.js
   │  ├─ zhihu/
   │  ├─ jianshu/
   │  ├─ baijiahao/
   │  ├─ toutiao/
   │  ├─ sohu/
   │  └─ netease/
   ├─ importers/
   │  └─ excel.js
   └─ cli/
      ├─ login-weibo.js
      └─ smoke-publish.js
```

---

## 4. 统一任务模型

每条内容只创建一个主任务，平台发布状态挂在主任务下面。

```json
{
  "id": "task_001",
  "title": "标题",
  "content": "正文",
  "images": ["D:/images/1.jpg", "D:/images/2.jpg"],
  "resourceUrl": "https://pan.example.com/xxx",
  "selectedPlatforms": ["weibo", "zhihu", "jianshu", "baijiahao"],
  "status": "pending",
  "weibo": {
    "accountId": "wb_01",
    "status": "pending",
    "id": "",
    "mid": "",
    "bid": "",
    "canonicalUrl": "",
    "shareUrl": "",
    "publishedAt": "",
    "error": ""
  },
  "platforms": {
    "zhihu": { "status": "pending", "url": "", "error": "" },
    "jianshu": { "status": "pending", "url": "", "error": "" },
    "baijiahao": { "status": "pending", "url": "", "error": "" }
  }
}
```

主任务状态：

```text
pending
→ publishing_weibo
→ resolving_weibo_url
→ distributing
→ completed
```

异常状态：

```text
weibo_failed
partial_failed
paused
cancelled
```

后续平台绝不能在 `weibo.canonicalUrl/shareUrl` 为空时启动。

---

## 5. 微博发布完整实现

### 5.1 登录态

每个微博账号使用独立目录：

```text
.profiles/weibo/<accountId>/
```

登录流程：

1. 打开微博首页。
2. 检测是否已登录。
3. 未登录时保留浏览器窗口，让用户正常登录。
4. 登录成功后保存 Persistent Profile。
5. 后续任务复用该 Profile。

不能把 Cookie 明文写入业务日志。

### 5.2 发布输入

微博最终正文由模板生成，例如：

```text
{content}

{resourceUrl}
```

支持：

- 纯文字
- 文字 + 单图
- 文字 + 多图
- 正文中原始资源链接

### 5.3 发布步骤

1. 打开微博发布页/首页发布区域。
2. 确认登录态。
3. 找到正文编辑器。
4. 写入完整正文。
5. 上传图片并等待预览数量达到预期。
6. 校验发布按钮可用。
7. 开始监听发布相关网络响应。
8. 点击发布。
9. 等待成功信号。
10. 解析新微博信息。

### 5.4 发布成功判断

按优先级组合判断，不只依赖一个 DOM 文案：

1. 发布接口返回成功。
2. 响应中得到微博 `id/mid/bid`。
3. 页面出现成功提示。
4. 主页最新微博发生变化。
5. 新微博正文摘要与本次任务匹配。

只有至少一种强成功信号成立，才将微博状态记为 success。

---

## 6. 获取“刚发布微博链接”的三层方案

这是整个项目最重要的步骤之一。

### A. 首选：发布接口响应

点击发布前注册 `page.on('response')` / `waitForResponse`。

从成功响应中尽量提取：

```text
id
mid
bid
userId
```

如果拿到 `bid + userId`，生成 canonical URL：

```text
https://weibo.com/<userId>/<bid>
```

同时保留移动端/状态页 URL 作为备用。

### B. 兜底：发布前后主页最新微博对比

发布前读取账号最近若干条微博 ID。

发布成功后轮询最新微博：

```text
beforeIds = [A, B, C]
afterIds  = [N, A, B]
```

`N` 为候选新微博。

再根据：

- 发布时间
- 正文前若干字符
- 图片数量
- 当前登录账号

确认是否为本任务。

### C. 第二兜底：DOM / 个人主页匹配

API 未返回可用结果时：

1. 打开个人主页。
2. 读取最前面的微博卡片。
3. 找详情页链接。
4. 按正文摘要 + 时间窗口确认。

### 6.1 shareUrl 与 canonicalUrl

数据库同时保存：

- `canonicalUrl`：稳定的微博帖子详情链接
- `shareUrl`：如果微博分享 UI 能直接得到分享地址，则同时保存

后续平台的链接来源可配置：

```text
preferShareUrl = true
shareUrl 不存在 → 自动使用 canonicalUrl
```

不要因为拿不到短地址就把整条任务判为失败；只要稳定的微博帖子 URL 已取得，就可以继续分发。

---

## 7. 平台发布器统一协议

所有平台必须实现同一套接口：

```js
class PlatformPublisher {
  async checkLogin(account) {}
  async openComposer(task) {}
  async fillTitle(task, rendered) {}
  async fillContent(task, rendered) {}
  async uploadImages(task) {}
  async submit(task) {}
  async resolvePublishedUrl(task) {}
}
```

统一返回：

```json
{
  "success": true,
  "platform": "zhihu",
  "postUrl": "https://...",
  "publishedAt": "...",
  "errorCode": "",
  "errorMessage": ""
}
```

平台页面结构变化时，只更新该平台目录，不修改 `workflow.js`。

---

## 8. 二次分发模板

微博发布成功后，模板引擎得到：

```text
{title}
{content}
{weiboUrl}
```

每个平台单独保存模板，不共享硬编码正文。

示例：

```text
{content}

更多内容：{weiboUrl}
```

模板变量：

```text
{title}
{content}
{resourceUrl}   # 默认只允许微博模板使用
{weiboUrl}
{date}
```

默认策略：

- 微博模板可使用 `resourceUrl`
- 知乎/简书/百家号/头条等二次分发模板使用 `weiboUrl`

用户可在 UI 中编辑不同平台模板。

---

## 9. 首批平台实现顺序

### P1-1 知乎

实现：

- 登录态检测
- 文章/内容编辑入口
- 标题
- 正文
- 图片（可配置是否同步）
- 微博链接
- 提交
- 获取发布后 URL

### P1-2 简书

实现同一套统一协议。

### P1-3 百家号

实现：

- 标题
- 正文
- 图片
- 微博链接
- 提交
- 审核/提交成功状态记录

百家号可能出现“已提交但未最终公开”的状态，因此发布结果需要区分：

```text
submitted
published
rejected
```

### P1-4 今日头条

同样区分提交成功与最终公开 URL。

### P1-5 后续

- 搜狐号
- 网易号
- 其他用户后续指定的平台

---

## 10. 多账号模型

账号表：

```text
accounts
- id
- platform
- nickname
- profile_path
- status
- last_login_at
- last_checked_at
- enabled
```

原则：

- 一个账号一个 Profile
- 同平台多个账号互不共享登录态
- 每个任务明确指定微博账号和各分发平台账号
- UI 可显示“已登录 / 失效 / 需要验证”

遇到二维码、验证码或平台要求人工验证时，将任务置为 `needs_action`，保留浏览器窗口供用户正常完成验证，然后继续任务。

---

## 11. SQLite 数据表

至少包含：

### tasks

```text
id
title
content
resource_url
status
created_at
updated_at
```

### task_images

```text
id
task_id
file_path
sort_order
```

### accounts

```text
id
platform
nickname
profile_path
status
```

### publish_jobs

```text
id
task_id
platform
account_id
status
attempt_count
post_id
post_url
started_at
finished_at
error_code
error_message
```

### weibo_results

```text
task_id
weibo_id
mid
bid
canonical_url
share_url
published_at
```

### templates

```text
id
platform
name
content_template
enabled
```

### app_settings

保存队列、浏览器、默认账号等配置。

---

## 12. 任务队列与恢复

每个平台发布都是一个独立 job。

执行规则：

```text
微博 job 成功
  ↓
创建 / 解锁后续平台 jobs
```

微博失败：

```text
后续 jobs 保持 blocked
```

单个平台失败：

```text
其他平台继续
失败平台可单独重试
```

程序关闭后重新启动：

- `success` 不重复执行
- `pending` 可继续
- 异常退出时的 `running` 改为 `interrupted`
- 用户选择“继续任务”后从未完成步骤恢复

---

## 13. 重试与错误分类

不要对所有异常无限重试。

### 可自动重试

- 页面短暂加载失败
- 网络超时
- 编辑器暂时未出现
- 上传图片超时
- 发布结果解析超时

### 需要人工处理

- 登录失效
- 验证码
- 二维码登录
- 账号限制提示
- 平台明确拒绝提交

### 不自动重试

- 输入文件不存在
- 图片格式不支持
- 必填标题为空
- 微博 URL 无法取得且微博发布结果无法确认

建议默认单 job 自动重试 1~2 次，并记录每次失败原因。

---

## 14. 速率与队列控制

实现为普通任务节流/资源控制，不写死：

- 同账号同一时间只执行一个发布任务
- 不同平台可配置并发数
- 每个平台支持固定等待区间配置
- 用户可暂停 / 继续队列
- 遇到平台明确限流时停止该账号后续任务并提示

所有默认值通过设置页修改，不散落在平台脚本里。

---

## 15. Electron UI

### 左侧导航

```text
任务中心
新建发布
批量导入
账号管理
平台模板
运行日志
设置
```

### 新建发布

字段：

- 标题
- 正文
- 资源链接
- 图片拖拽/选择
- 微博账号
- 分发平台复选框
- 各平台账号
- 预览各平台最终正文
- 开始发布

### 任务中心

表格列：

```text
任务
微博
微博链接
知乎
简书
百家号
头条
创建时间
操作
```

状态使用：

```text
等待
进行中
成功
失败
需处理
已暂停
```

操作：

- 查看
- 重试失败项
- 打开微博
- 打开平台帖子
- 暂停
- 继续

### 账号管理

每个账号：

- 平台
- 昵称
- 登录状态
- 登录/重新登录
- 测试状态
- 打开账号浏览器
- 删除 Profile（需明确确认）

---

## 16. Excel 批量格式

建议第一版：

| title | content | resource_url | images | platforms | weibo_account |
|---|---|---|---|---|---|
| 示例标题 | 示例正文 | https://... | D:/a/1.jpg;D:/a/2.jpg | zhihu;jianshu;baijiahao | wb_01 |

导入时先校验：

- 必填列
- 图片文件存在
- URL 格式
- 平台名称合法
- 指定账号存在

错误行不进入发布队列，UI 单独列出原因。

---

## 17. 日志

日志分两层：

### 用户日志

```text
[00:10:21] 任务 #15 开始
[00:10:23] 微博：打开发布页面
[00:10:31] 微博：图片上传完成 4/4
[00:10:35] 微博：发布成功
[00:10:36] 微博：已取得链接 https://...
[00:10:40] 知乎：开始发布
```

### 调试日志

记录：

- 平台
- taskId/jobId
- 当前步骤
- selector 命中情况
- HTTP 状态（不记录敏感 Cookie/Token）
- 错误堆栈

可配置保存最近 N 天日志。

---

## 18. Selector 配置

不要把所有 selector 写死在主流程。

每个平台独立：

```js
export const selectors = {
  composer: [...],
  title: [...],
  editor: [...],
  imageInput: [...],
  submit: [...]
};
```

每个关键元素允许多个候选 selector，并优先使用稳定属性。

页面更新后只调整平台 selector / adapter。

---

## 19. 测试方案

### 单元测试

- 模板变量替换
- 任务状态机
- URL 解析
- 微博结果解析
- Excel 校验

### 本地 Smoke Test

1. 登录微博。
2. 发布一条纯文字测试微博。
3. 获取微博 URL。
4. 发布一条文字 + 图片微博。
5. 获取微博 URL。
6. 再接入一个下游平台。
7. 验证“微博失败时下游不启动”。
8. 验证“某下游失败时其他平台继续”。

### 平台回归

每个平台至少保留：

- 登录检测
- 打开编辑器
- 填写正文
- 上传图片
- 提交前检查
- 获取结果

这些步骤可单独运行诊断。

---

## 20. 开发顺序

### M0：项目骨架

- [x] 仓库初始化
- [x] Playwright
- [x] Profile 管理基础
- [x] 微博登录 CLI

### M1：微博最小闭环

- [ ] 纯文字发布
- [ ] 多图片发布
- [ ] 资源链接写入
- [ ] 发布成功检测
- [ ] 网络响应解析 id/mid/bid
- [ ] 主页对比兜底
- [ ] canonicalUrl/shareUrl
- [ ] 本地结果保存

**验收标准：输入一条任务，可以自动发布微博并返回可打开的微博帖子链接。**

### M2：第一条完整跨平台链路

- [ ] 模板引擎
- [ ] 知乎适配器
- [ ] 微博成功后自动发布知乎
- [ ] 双平台状态落库

**验收标准：一次任务完成“微博 → 获取链接 → 知乎”。**

### M3：增加平台

- [ ] 简书
- [ ] 百家号
- [ ] 今日头条
- [ ] 搜狐号
- [ ] 网易号

### M4：Electron UI + SQLite

- [ ] 新建任务
- [ ] 任务中心
- [ ] 账号管理
- [ ] 模板管理
- [ ] 日志

### M5：批量

- [ ] Excel 导入
- [ ] 队列
- [ ] 暂停/继续
- [ ] 失败重试
- [ ] 恢复中断任务
- [ ] 导出发布结果

---

## 21. 第一版明确不做

为了避免第一版过度复杂，先不做：

- 云端服务器部署
- 把账号 Cookie 上传服务器
- 手机 App
- 无限制并发
- 遇到验证码时尝试绕过平台验证
- 依赖 `autoPushWeibo` 运行

`autoPushWeibo` 只作为已有微博相关实现的参考来源，不修改、不强依赖。

---

## 22. 最终验收标准

完整版本至少满足：

1. 多账号登录态可持久化。
2. 输入标题、正文、图片、资源链接后可发布微博。
3. 能稳定识别刚发布的微博，并取得帖子 URL。
4. 微博失败时不会错误触发下游平台。
5. 微博成功后可将微博 URL 自动写入各平台模板。
6. 知乎、简书、百家号、头条等平台彼此独立发布。
7. 一个下游平台失败不影响其他平台。
8. 每个平台有明确状态、URL 和错误原因。
9. 程序重启后可恢复未完成任务，不重复发布成功任务。
10. 支持单条任务和 Excel 批量任务。
11. Electron UI 可以完成账号、任务、模板、日志的日常操作。
12. 平台页面发生变化时，可以只维护对应 adapter/selector。
