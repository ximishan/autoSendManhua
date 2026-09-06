# autoSendManhua 项目进度

更新时间：2026-09-06（微博登录已实机通过；微博发布切换为 baidu-link-converter 已验证实现）

## 当前结论

微博扫码登录已经在 Windows 本机真实验证通过。微博发布主链路也已改为直接复用 `ximishan/baidu-link-converter` 中用户已经验证过的接口方式，不再以 Playwright 操作微博发布页作为主流程。

完整功能清单见：[FEATURE_CHECKLIST.md](FEATURE_CHECKLIST.md)。
详细历史缺陷证据见：[COMPLETION_AUDIT.md](COMPLETION_AUDIT.md)。

## 已真实通过：微博一键扫码登录

```text
启动软件
→ 账号管理
→ 扫码登录微博
→ 手机微博 APP 扫码确认
→ 程序自动保存登录状态和发布凭据
→ 软件自动显示“已登录”
```

- [x] Windows 本机真实扫码成功。
- [x] 不需要命令行。
- [x] 不需要手动复制 Cookie。
- [x] 不需要额外点击“检测状态”才能完成登录。
- [x] 发布凭据继续使用已验证标准：`SUB + XSRF-TOKEN`。

仍需：

- [ ] 关闭并重启 autoSendManhua，确认登录状态仍可直接复用。

## 当前微博发布主链路：复用 baidu-link-converter

已确认原项目真正使用：

```text
图片上传
https://picupload.weibo.com/interface/pic_upload.php

正文发布
https://weibo.com/ajax/statuses/update

首评发布
https://weibo.com/ajax/comments/create
```

`autoSendManhua` 已改成同一套核心流程：

```text
任务正文
↓
可选：逐张上传图片取得 pid
↓
调用 statuses/update 发布正文
↓
直接读取接口返回的微博 ID
↓
立即把任务 checkpoint 记为 submitted
↓
如有 resourceUrl，则发送“链接：{resourceUrl}”首评
↓
保存完整微博结果
```

### 已完成

- [x] 新增 `src/platforms/weibo/api-client.js`，按原项目接口参数实现 Node 版本。
- [x] 图片上传参数、正文发布参数、首评参数与 `baidu-link-converter` 对齐。
- [x] 使用已扫码保存的完整微博 Cookie 和 `X-XSRF-TOKEN`。
- [x] 401 / 403 识别为登录失效。
- [x] 418 / 429 识别为平台限制 / 限流。
- [x] 正文发布直接读取 `id / idstr / mid`，不再需要靠主页猜刚发布微博。
- [x] 正文一旦取得微博 ID，立即标记已提交。
- [x] 首评失败只记录 `commentStatus / commentError`，绝不重新发送正文。
- [x] canonical URL 直接使用 `https://weibo.com/detail/{微博ID}`。
- [x] 默认微博正文模板改为 `{content}`。
- [x] `resourceUrl` 改为按原项目已验证流程发布到首评。
- [x] migration v4 自动把旧默认微博模板 `{content}\n\n{resourceUrl}` 迁成 `{content}`，避免正文和首评重复链接。
- [x] 新增微博 API 单元测试：正文→首评、图片上传、首评失败不重发正文。

旧的 `resolve-post.js` / Playwright 微博发布相关代码不再作为主发布链路；可暂时保留用于诊断和历史测试。

## 微博发布结果记录

发布成功后 `weibo_results` 记录：

```text
任务 ID
发布账号 ID
微博 UID（接口返回时）
微博 ID
mid
bid
canonical URL
share URL
发布时间
resolution = baidu-link-converter-api
提交证据
图片 pid
正文接口响应
首评接口响应 / 首评失败原因
```

“任务中心 → 查看详情”可以直接查看这些信息。

## 现在要做的真实验收

### 测试 A：纯文字微博

- [ ] 新建发布任务。
- [ ] 只选微博，不选择下游平台。
- [ ] 填写唯一测试正文。
- [ ] 不填资源链接。
- [ ] 点击“创建并开始发布”。
- [ ] 确认微博真实发布成功。
- [ ] 任务中心显示微博“已发布”。
- [ ] canonical URL 打开就是刚发布微博。
- [ ] 查看详情确认 `weibo_id / mid / resolution / postResponse` 已记录。

### 测试 B：多图 + 资源链接

- [ ] 选择 2–3 张图片。
- [ ] 填写百度 / 夸克 / 迅雷测试链接。
- [ ] 确认图片出现在微博正文。
- [ ] 确认正文不重复出现 resourceUrl。
- [ ] 确认资源链接出现在该微博首评。
- [ ] 确认 `commentStatus = published`。
- [ ] 确认记录 URL 指向本次微博。

## 当前里程碑

| 里程碑 | 状态 | 缺口 |
|---|---|---|
| M0 骨架 | 部分完成 | Electron / SQLite 可运行；其他平台体验仍需完善 |
| M1 微博闭环 | 进行中 | 登录已实机通过；发布已切已验证 API；等待真实发布验收 |
| M2 微博→知乎 | 未验收 | 模拟链路通过；没有真实发布证据 |
| M3 六个下游平台 | 原型 | 缺逐站实际验收 |
| M4 UI/SQLite | 部分完成 | 微博结果详情已补充，其他 UI 仍需优化 |
| M5 Excel/队列 | 部分完成 | 调度、恢复等仍需继续修复 |

## 下一优先级

1. [ ] 真实发布纯文字微博并核对接口返回和结果记录。
2. [ ] 真实发布多图 + 网盘链接，并验证首评。
3. [ ] 验证程序重启后微博登录状态仍可复用。
4. [ ] 把首评失败后的延迟重试持久化到任务队列，但正文始终禁止重发。
5. [ ] 修复暂停 / 恢复 / 账号锁 / 队列。
6. [ ] 跑通真实“微博 → 知乎”。

## 本地验证命令

```powershell
npm test
node scripts/audit-core.mjs
node scripts/audit-ui.mjs
```

真实微博发布必须在用户自己的已授权账号上进行测试。
