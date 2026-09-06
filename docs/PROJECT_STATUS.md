# autoSendManhua 项目进度

更新时间：2026-09-06（微博快捷方式登录 + URL 解析修复）

## 当前结论：未完成，不满足完整版本验收

项目具有可启动的 Electron 界面、SQLite、模板和模拟工作流，但仍不能把模拟发布成功、窗口能启动或单元测试通过当作真实跨平台分发已完成。

完整功能清单见：[FEATURE_CHECKLIST.md](FEATURE_CHECKLIST.md)。
详细历史缺陷证据见：[COMPLETION_AUDIT.md](COMPLETION_AUDIT.md)。

## 本轮调整：微博登录直接复用 baidu-link-converter

已放弃上一版“扫码后依赖新版微博页面接口自动识别 UID”的登录判定，改为直接复用 `ximishan/baidu-link-converter` 已使用的微博账号方式：

```text
微博 Chrome 快捷方式目录
  ↓
每个 .lnk = 一个独立 Chrome / 微博账号
  ↓
用该快捷方式打开微博并完成登录
  ↓
保存该账号微博 Cookie
  ↓
只校验 SUB + XSRF-TOKEN
  ↓
本机保存登录凭据，发布时复用
```

已完成：

- [x] 账号管理页新增“导入微博账号目录”。
- [x] 扫描目录内 `.lnk` 快捷方式并自动创建微博账号记录。
- [x] 每个快捷方式生成稳定内部账号 ID，显示名使用快捷方式文件名。
- [x] 点击“打开微博”时，读取 `.lnk` 内 Chrome TargetPath / Arguments 并以同一个 Profile 打开 `weibo.com`。
- [x] 登录信息支持：完整 Cookie、Copy as cURL、Cookie-Editor JSON。
- [x] 与 baidu-link-converter 一致，保存前要求 Cookie 至少包含 `SUB` 与 `XSRF-TOKEN`。
- [x] Cookie 只保存到本机 `data/weibo_credentials.json`，前端不回显已保存值。
- [x] 微博“测试状态”不再依赖 `/ajax/config` 页面结构，改为检查本机是否存在有效的 `SUB + XSRF-TOKEN`。
- [x] 微博发布器启动 Playwright 会话时自动注入该账号保存的全部微博 Cookie。
- [x] 新增 `scripts/open-weibo-shortcut.ps1`，逻辑直接参考 baidu-link-converter 的 `open_weibo_shortcut.ps1`。
- [x] 新增微博 Cookie 解析单元测试。

### 客户端预期操作

```text
启动软件
  ↓
账号管理
  ↓
导入微博账号目录
  ↓
程序识别多个 .lnk 账号
  ↓
点击某个账号“打开微博”
  ↓
在该 Chrome 窗口登录微博
  ↓
点击“保存登录信息”并粘贴 Cookie
  ↓
账号显示“已登录”
```

不再要求客户运行 `npm run login -- weibo wb01`，也不再要求程序通过新版微博页面 DOM/API 猜测扫码是否完成。

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

- [ ] Windows 本机导入现有微博 Chrome 快捷方式目录，确认账号识别正确。
- [ ] 对一个已登录账号保存 Cookie，确认状态立即变为“已登录”。
- [ ] 关闭并重启 autoSendManhua，确认登录配置仍保留。
- [ ] 用真实微博账号发布一条纯文字微博，确认 URL 指向刚发布内容。
- [ ] 用真实微博账号发布多图 + 百度/夸克/迅雷资源链接，确认图片、正文和 URL 全部匹配。

## 当前里程碑

| 里程碑 | 状态 | 缺口 |
|---|---|---|
| M0 骨架 | 部分完成 | Electron/SQLite 可运行；微博账号方式已切换为已验证的快捷方式 + Cookie 方案 |
| M1 微博闭环 | 代码已加固，待真实验收 | 登录方式、发布响应、主页 API、DOM 三层解析均已接入；仍缺真实账号实测 |
| M2 微博→知乎 | 未验收 | 模拟链路通过；没有真实发布证据 |
| M3 六个下游平台 | 原型 | 共用通用浏览器发布器和独立 selector；缺逐站实际验收 |
| M4 UI/SQLite | 部分完成 | 页面能启动；微博账号 UI 已调整，其他 UI 仍有待优化项 |
| M5 Excel/队列 | 部分完成 | xlsx 已实现；调度、恢复等仍需继续修复 |

## 下一优先级

1. [ ] 本地真实验收“快捷方式账号 + Cookie”微博登录。
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

真实微博账号登录与发布验收必须在用户自己的 Windows 环境及已授权账号上执行；测试通过不能替代线上真实发布验收。
