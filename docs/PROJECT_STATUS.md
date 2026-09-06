# autoSendManhua 项目进度

更新时间：2026-09-06（微博一键扫码登录 + URL 解析修复）

## 当前结论：未完成，不满足完整版本验收

项目具有可启动的 Electron 界面、SQLite、模板和模拟工作流，但仍不能把模拟发布成功、窗口能启动或单元测试通过当作真实跨平台分发已完成。

完整功能清单见：[FEATURE_CHECKLIST.md](FEATURE_CHECKLIST.md)。
详细历史缺陷证据见：[COMPLETION_AUDIT.md](COMPLETION_AUDIT.md)。

## 本轮调整：微博恢复一键扫码登录

客户侧重新改回最简单的流程：

```text
启动软件
  ↓
账号管理
  ↓
扫码登录微博
  ↓
程序打开独立的真实 Chrome Profile
  ↓
手机微博 APP 扫码确认
  ↓
程序直接检查浏览器中的微博登录 Cookie
  ↓
自动保存 SUB + XSRF-TOKEN 等凭据
  ↓
账号自动显示“已登录”
```

这次保留 `baidu-link-converter` 中已经验证过的核心登录依据：微博自动发布凭据以 `SUB + XSRF-TOKEN` 为准；但不再要求客户导入 `.lnk`、理解 Chrome Profile 或手工复制 Cookie。

已完成：

- [x] 账号管理页恢复“扫码登录微博”主按钮。
- [x] 新账号 ID、Profile 路径均由程序自动创建。
- [x] 每个微博账号使用独立真实 Chrome Persistent Profile。
- [x] 扫码成功不再依赖 `/ajax/config` 必须返回固定结构。
- [x] 登录状态优先根据当前 Profile 中的微博 `SUB` Cookie 判断。
- [x] 自动等待 `XSRF-TOKEN` 就绪后保存发布所需完整微博 Cookie。
- [x] 自动尝试从桌面接口、移动端 `/api/config`、页面链接三层读取 UID；UID 读取失败不再导致“明明登录却显示未登录”。
- [x] 扫码完成后自动将登录凭据写入本机 `data/weibo_credentials.json`。
- [x] 客户不再需要“保存登录信息”、粘贴 Cookie、Copy as cURL 或 Cookie-Editor JSON。
- [x] 客户不需要再额外点击“测试状态”才能完成登录。
- [x] 登录成功后浏览器 Profile 与自动发布凭据会同时保留。
- [x] 新增微博 Cookie 状态 helper 回归测试。

### 客户端预期操作

```text
启动软件
→ 账号管理
→ 扫码登录微博
→ 手机微博 APP → 我的 → 扫一扫
→ 手机确认
→ 软件自动显示“已登录”
```

## 已处理：微博“发布成功 → 正确详情链接”

- [x] 发布响应只接受明确微博实体，拒绝图片 ID 等伪候选。
- [x] 直接发布响应优先生成 canonical URL。
- [x] 增加本人主页移动端 API 前后差分层。
- [x] API 层失败后再使用桌面主页 DOM 差分兜底。
- [x] 主页候选同时校验：新增、UID、发布时间、图片数量、正文指纹。
- [x] 多个候选同时匹配时返回不确定，不猜测其中一条。
- [x] 匹配正文使用真正发出去的 `rendered.content`。
- [x] 无法唯一确认 URL 时进入 `PublishUncertainError`，禁止自动重发。

### 仍需真实验收

- [ ] Windows 本机点击“扫码登录微博”，确认扫码成功后无需任何额外操作自动显示“已登录”。
- [ ] 关闭并重启 autoSendManhua，确认登录状态仍可复用。
- [ ] 用真实微博账号发布一条纯文字微博，确认 URL 指向刚发布内容。
- [ ] 用真实微博账号发布多图 + 百度/夸克/迅雷资源链接，确认图片、正文和 URL 全部匹配。

## 当前里程碑

| 里程碑 | 状态 | 缺口 |
|---|---|---|
| M0 骨架 | 部分完成 | Electron/SQLite 可运行；微博扫码 UX 已恢复为客户友好流程 |
| M1 微博闭环 | 代码已加固，待真实验收 | 扫码登录、Cookie 自动保存、发布响应、主页 API、DOM 三层解析均已接入 |
| M2 微博→知乎 | 未验收 | 模拟链路通过；没有真实发布证据 |
| M3 六个下游平台 | 原型 | 共用通用浏览器发布器和独立 selector；缺逐站实际验收 |
| M4 UI/SQLite | 部分完成 | 页面能启动；微博账号 UI 已简化，其他 UI 仍有待优化项 |
| M5 Excel/队列 | 部分完成 | xlsx 已实现；调度、恢复等仍需继续修复 |

## 下一优先级

1. [ ] 本地真实验收“一键扫码登录微博”。
2. [ ] 本地真实验收微博发布与 URL 解析闭环。
3. [ ] 修复提交后状态持久化与防重复发布剩余边界。
4. [ ] 修复暂停 / 恢复 / 账号锁 / 队列。
5. [ ] 跑通真实“微博 → 知乎”。

## 验证命令

```powershell
npm test
node scripts/audit-core.mjs
node scripts/audit-ui.mjs
```

当前执行环境无法直接联网 `git clone` 仓库，所以真实本地运行验证仍需在用户 Windows 环境执行；真实微博登录和发布也必须使用用户自己的已授权账号。
