# autoSendManhua 完成度审计

审计日期：2026-09-06。对象：D:/project/autoSendManhua 当前工作区（包含上一轮未提交实现）。

## 结论

**项目未完成，存在实质性假成功、无效控制和缺失功能。**
此前“只差登录和发布授权即可最终验收”的结论不成立：即使提供账号，当前内部缺陷仍可能造成重复发帖、误取旧链接和队列漏任务。

本次完成度排查不修改产品运行代码，只新增可运行审计脚本并纠正 README/PROJECT_STATUS。以下问题仍待修复。

## 方法与证据边界

- 完整对照 IMPLEMENTATION_PLAN.md 第 1–22 节，检查工作流、数据库、平台适配器、浏览器、IPC、UI、Excel、日志、配置和测试代码。
- 原有 `npm test` 在独立 AUTO_SEND_MANHUA_ROOT 下重新运行：16/16 通过；模拟 smoke 通过。
- `node scripts/audit-core.mjs`：内存 SQLite、真实工作流代码、受控发布器结果，21 个定向场景违反要求。
- `node scripts/audit-ui.mjs`：真实 Electron/preload/renderer，临时数据库，外网请求拦截；7 个场景中 1 个通过、6 个违反要求。
- 共 28 个定向场景，27 个失败。它们按已发现的薄弱点设计，不能解释为产品随机运行失败率或 27 个独立根因。
- 生产数据库只读查询：tasks/accounts/publish_jobs/weibo_results/app_logs 均为 0；本项目 .profiles 不存在。没有本地真实登录或发帖验收记录。
- 未访问真实平台执行发布。适配器的本地 DOM 反例证明算法不可靠，不代表已经逐站验证线上 DOM。
- 临时审计目录前缀为 `asm-audit-ui-`、`asm-baseline-`；其中仅有测试数据，不含用户凭据。

## 关键缺陷（按修复优先级）

### 1. P1：提交后异常重试会重复发布

位置：`src/platforms/weibo/publisher.js:136`；`src/core/workflow.js:90`；`src/db/repositories/tasks.js:130`。

微博已出现成功信号但解析不到 URL 时，抛出的错误带 retryable=true。工作流下一次重新调用完整 publish，包括再次填写和点击发布，而非仅解析结果。A02 复现一次逻辑任务调用 publish 两次。A10 证明 running→interrupted→continue 也会直接重新发布，数据库没有提交阶段字段区分提交前后崩溃。

另外，job 成功、微博结果写入及下游解锁不是一个事务。A11 模拟在 job 已存 URL、weibo_results 尚未写入时崩溃，继续任务得到 weibo_failed，已有 URL 没有被用于修复状态。

要求：记录提交意图/已提交证据，结果阶段单独恢复；未知提交状态不得自动重发；微博结果与依赖解锁保持原子一致。

### 2. P1：失败结果、旧文章链接和非微博地址可被视为成功

位置：`src/core/workflow.js:90`；`src/platforms/browser-platform-publisher.js:74`。

runJob 没有验证 result.success。A01 下游返回 `{success:false,errorCode:'REJECTED'}` 后，数据库仍为 success，error 字段为空，result_status 为 published。A07 非微博 HTTPS 地址仍能解锁下游。

通用下游适配器从页面第一个匹配链接或当前 URL 推断结果，未验证本次任务归属。U06 本地页面只有一条旧简书文章链接，在 successSignal=false 时仍返回 success:true/published。现有代码中六个平台均复用这一适配器。

要求：严格验证 success、提交证据、URL 域名及帖子归属；不存在强证据时保存明确的未知状态，不清空错误或造成功状态。

### 3. P1：暂停和同账号互斥未实现到执行流程

位置：`src/main/electron-main.js:62`、`:70`；`src/core/workflow.js:14`；`src/core/queue.js:29`。

暂停 IPC 仅改 tasks.status。A03 在微博执行期间设置 paused，知乎仍被调用，最后覆盖成 completed。A04 已暂停任务仍可直接执行。

activeRuns 仅保护“同一个 task:run IPC”入口，队列直接调用工作流，且没有账号锁。A05 同一任务并发进入工作流发布两次；A06 两个任务使用同一账号时峰值并发为 2。浏览器管理器也只缓存已完成创建的 session，没有保护初始化中的 Promise。

要求：所有入口使用统一任务/账号锁；暂停在明确步骤边界阻止新提交，保留已提交结果。

### 4. P1：微博结果识别可误判，也可漏掉正确结果

位置：`src/platforms/weibo/resolve-post.js:48`、`:83`；`src/platforms/weibo/publisher.js:34`、`:87`。

- A15 只有图片 id 的 JSON 被提取为微博 ID，继而拼出详情 URL。发布响应成功判断采用“没有几个失败值即成功”，并非确认成功码和微博实体。
- A16 两条新增同文候选直接选择第一条，没有唯一性判断。
- A17 账号、时间、图片不匹配的候选仍被接受，publishedAt 参数实际未参与匹配。
- U07 实际 DOM 卡片正文前带昵称和时间，整体 innerText 指纹从开头截取，反而匹配不到正确正文。
- 当前个人主页入口取首个 `a[href*='/u/']`，没有证明是登录用户本人；未实现计划中的主页 API 对比层，只实现了 DOM 采集。

要求：识别已登录 UID；只解析明确的发布成功响应中的帖子实体；提取卡片独立正文/时间/作者/图片，唯一匹配才返回 URL。

### 5. P1：账号模型可能串号

位置：`src/db/repositories/accounts.js:7`；`src/browser/profile-manager.js:6`；`src/core/task.js:28`。

- A13 普通任务可引用不存在账号；运行时可能回落到 default Profile。任务创建未验证账号是否属于目标平台、是否启用。
- A14 中文账号 ID “爸爸”和“妈妈”均变为 `__`，Profile 路径发生碰撞。
- U04 保存同 ID 的另一个平台账号会覆盖原平台记录。通用登录 CLI 默认 accountId='default'，在不同平台使用默认 ID 也有同样覆盖路径。
- U05 普通公开内容作者头像被判定为微博已登录；这不是用户本人登录证据。

要求：唯一账号标识和平台约束、无碰撞 Profile 路径、账号归属验证、可靠登录证据。

### 6. P2：队列节流设置和批量积压处理不正确

位置：`src/core/queue.js:32`、`:37`。

A18 设置 intervalMs=5000，完成任务后实际调用 schedule(0)，该设置仅影响空闲轮询。A19 最新 101 条任务都完成时，一条更旧的 pending 永远不会被选中，因为先限制最近 100 条再筛选 pending。

tick 没有 catch 记录工作流抛出的异常；手动执行又绕开队列控制。未发现每平台并发数、每平台等待区间、账号限流暂停实现。

### 7. P2：重试与继续存在崩溃和取消失效

位置：`src/core/workflow.js:79`、`:112`；`src/db/repositories/tasks.js:134`。

A08 attempt_count=2 后再次执行，循环不进入、lastError 为 undefined，抛出内部 TypeError。A09 连续两次需登录后完成登录再“继续”触发同样问题，因为 continue 不处理 needs_action 的尝试计数。A12 被取消的平台仍会被重新执行。

A20 通过损坏模板模拟异常，renderTemplate 在 try 外抛出，后续平台全部停止。正常模板保存有变量校验，因此这是数据库异常/兼容升级场景，优先级低于日常路径问题。

### 8. P2：界面功能与文案不一致

位置：`src/renderer/app.js:46`、`:97`、`:116`。

- U02 保存 CUSTOM_TEMPLATE/CUSTOM_ZHIHU 后，预览仍是硬编码正文，没有调用实际模板。
- U03 刷新后账号变为空、分发平台复选框全部复位；模板未保存编辑也会被刷新覆盖。
- A21 审核型平台 result_status=submitted 时，job=success、主任务=completed；任务表只看 status，显示“成功”，看不到待审核与拒绝结果。不能称为已公开发布。
- 任务表没有展示 error_message，没有“查看任务”详情入口；搜狐/网易没有对应状态列，用户无法从任务中心查看完整的所有平台结果。
- 日志事件只刷新日志，不刷新任务状态。手动运行的 activeTask 不在 queue.activeTask 中，侧栏可能一直说没有任务。

要求：使用同一模板引擎预览，保留用户选择，准确显示发布/提交/拒绝状态、错误及所有平台结果。

## 12 项最终验收标准逐项结论

| 计划第22节 | 当前证据 | 结论 |
|---|---|---|
| 1 多账号登录态持久化 | Persistent Context 已实现；A14/U04/U05 暴露隔离和检测缺陷，无真实 Profile | 未验收 |
| 2 输入内容后发布微博 | 存在操作代码；图片预览为宽泛全页选择器，没有真实文字/多图发布记录 | 未验收 |
| 3 稳定识别刚发布微博 URL | A15/A16/A17/U07 均失败 | 不满足 |
| 4 微博失败不触发下游 | 普通抛错场景通过；失败返回值/伪地址存在缺口（A01/A07） | 部分满足 |
| 5 微博 URL 注入模板 | 单元/模拟链路通过，UI 预览不一致 | 引擎满足、界面不满足 |
| 6 平台独立发布 | 六套 selector 共用一个发布器，无逐站验收，旧链接误判（U06） | 未验收 |
| 7 一个下游失败不影响其他平台 | 发布器抛错场景通过；模板异常跳出工作流（A20） | 部分满足 |
| 8 平台有状态、URL、错误 | 字段存在；假成功清空错误、待审标成功、界面缺详情 | 不满足 |
| 9 重启恢复且成功任务不重发 | 正常 success 跳过通过；提交后中断和写入间隙失败（A02/A10/A11） | 不满足 |
| 10 单条及 Excel 批量 | xlsx 正常行校验通过；账号校验、队列漏任务等缺陷 | 部分满足 |
| 11 Electron 日常操作 | U01 七页切换通过；暂停、预览、账号、详情问题 | 不满足 |
| 12 平台变化只维护 adapter/selector | 文件分层存在，核心无平台 DOM selector | 结构满足，逐站运行未验收 |

## 其他明确未完成/验证不足的计划项

| 计划章节 | 缺口或限制 |
|---|---|
| 4 状态机 | setStatus/updateJob 任意赋值，没有转换约束；取消无对应完整 UI 流程 |
| 5 图片与成功检测 | 微博全页 preview/picture img 可能混入旧图片；下游 setInputFiles 后仅固定 sleep，无上传完成校验 |
| 6 三层取链接 | 无主页 API 查询对比；没有分享 UI 提取流程；目前只读取响应 share 字段 |
| 9 审核型平台 | 无 submitted→published/rejected 回查逻辑，submissionOnly 两个分支完全相同 |
| 10 登录与账号 | needs_action 恢复错误；last_login_at 在状态测试成功时不更新；login:weibo 旧 CLI 不创建账号记录 |
| 13 错误分类 | Playwright 原生 timeout 未统一映射 retryable；验证码/限流/账号限制未独立识别 |
| 14 调度 | 并发、每平台间隔、限流暂停缺失，现有 intervalMs 不能控制任务间隔 |
| 15 UI | 图片选择可用但无拖拽；无任务详情；设置可持久化但 CLI runtime 不读取 UI 保存的策略 |
| 16 Excel | 仅 xlsx 读取，文件对话框仍允许 xls；缺列检测在逐行校验内，只有错误表头但无数据的表不会报缺列；未指定下游账号可回落默认 Profile |
| 17 日志 | 只有开始/成功/失败粗粒度日志；缺 selector 命中、步骤、HTTP 记录和 N 天保留设置；只对 details 的敏感键脱敏，不对 message/stack 字符串做脱敏 |
| 19 测试/诊断 | MockPublisher 永远返回预设地址；UI smoke 只检查首屏。没有命令逐阶段运行各平台回归；没有计划要求的真实微博纯文字、多图及下游 smoke |
| 21 第一版不做 | 没有发现依赖 autoPushWeibo、云端上传账号或绕过验证码实现 |

## 怎样解释“原有测试全绿”

原有测试验证了一些真实的局部功能，但未覆盖本次反例。其中“微博缺少 URL 仍阻断下游”测试只检查下游未被调用，没有断言微博 publish 次数，因此重复发布两次仍然通过。恢复测试只检查数据库把 running 改为 interrupted，没有模拟提交后崩溃。Electron smoke 只检查标题、导航数量、preload 是否存在和表格可见。

这不是测试工具失效，而是测试范围不足。安全依赖审计也不能证明业务功能正确；本次没有把此前的 npm audit 结果作为功能验收证据。

## 后续完成门槛

1. 优先修复 P1 的结果确认、防重发、账号锁与登录隔离，确保未确认结果不会显示成功。
2. 修复暂停/继续/节流和队列查询，补真实模板预览与状态详情。
3. 补齐各平台上传完成校验、提交确认与审核回查；逐站核对实际页面。
4. 审计脚本中的正确行为断言逐项通过，既有测试继续通过，再进行计划第 19 节真实发布验收。

在这些证据形成前，PROJECT_STATUS 必须保持“未完成”，不能将“文件已创建”或“待用户登录”写成完成验收。
