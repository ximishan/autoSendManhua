# autoSendManhua 项目进度

更新时间：2026-09-06（微博 URL 解析修复）

## 当前结论：未完成，不满足完整版本验收

项目具有可启动的 Electron 界面、SQLite、模板和模拟工作流，但仍不能把模拟发布成功、窗口能启动或单元测试通过当作真实跨平台分发已完成。

完整功能清单见：[FEATURE_CHECKLIST.md](FEATURE_CHECKLIST.md)。
详细历史缺陷证据见：[COMPLETION_AUDIT.md](COMPLETION_AUDIT.md)。

## 本轮已处理：微博“发布成功 → 正确详情链接”

已在 `fix/weibo-url-resolution` 分支完成代码加固：

- [x] 发布响应只接受当前登录 UID 对应的微博实体，拒绝无用户归属的图片 ID 等伪候选。
- [x] 直接发布响应优先生成 `https://weibo.com/<uid>/<bid>` canonical URL。
- [x] 增加本人主页移动端 API 前后差分层：`m.weibo.cn/api/container/getIndex`。
- [x] API 层失败后再使用桌面主页 DOM 差分兜底。
- [x] 主页候选必须同时满足：新增、当前 UID、发布时间窗口、图片数量、正文指纹。
- [x] 多个候选同时匹配时返回不确定，不猜测其中一条。
- [x] 匹配正文改为使用真正发出去的 `rendered.content`，不再错误使用原始 `task.content`。
- [x] 对微博把外链显示为“网页链接”的情况做正文归一化。
- [x] 无法唯一确认 URL 时进入 `PublishUncertainError`，明确禁止自动重发。
- [x] 增加微博 resolver 回归测试：伪 ID、错误 UID、多候选、时间/图片不匹配、外链显示差异、canonical URL。

### 仍需真实验收

- [ ] 用真实微博账号发布一条纯文字微博，确认 resolution 为 `publish-response` 或 `profile-api-diff`，且 URL 指向刚发布内容。
- [ ] 用真实微博账号发布多图 + 百度/夸克/迅雷资源链接，确认图片数、正文和 URL 全部匹配。
- [ ] 人为模拟发布接口响应拿不到 ID，确认主页 API 差分能拿到正确 URL。
- [ ] 人为制造两个相同正文候选，确认系统进入“不确定/需人工核对”，而不是误选旧微博。

## 当前里程碑

| 里程碑 | 状态 | 缺口 |
|---|---|---|
| M0 骨架 | 部分完成 | Electron/SQLite 可运行；账号隔离仍需继续修复 |
| M1 微博闭环 | 代码已加固，待真实验收 | 本轮已补发布响应 + 主页 API + DOM 三层解析；仍缺真实账号实测 |
| M2 微博→知乎 | 未验收 | 模拟链路通过；没有真实发布证据 |
| M3 六个下游平台 | 原型 | 共用通用浏览器发布器和独立 selector；缺逐站实际验收 |
| M4 UI/SQLite | 部分完成 | 页面能启动；部分 UI 状态/详情/错误展示仍需修复 |
| M5 批量/队列 | 部分完成 | xlsx 已实现；调度、恢复等仍需继续修复 |

## 下一优先级

1. [ ] 本地真实验收微博 URL 解析闭环。
2. [ ] 修复提交后状态持久化与防重复发布的剩余边界。
3. [ ] 修复暂停 / 恢复 / 账号锁 / 队列。
4. [ ] 跑通真实“微博 → 知乎”。

## 验证命令

```powershell
npm test
node scripts/audit-core.mjs
node scripts/audit-ui.mjs
```

注意：真实微博发布验收必须在用户自己的已登录 Profile 上执行；测试通过不能替代线上真实发布验收。
