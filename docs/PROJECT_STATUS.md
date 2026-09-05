# autoSendManhua 项目进度

更新时间：2026-09-06

## 一、项目目标

制作一个桌面端多平台图文分发工具。

业务主链：

```text
内容任务
  ├─ 标题
  ├─ 正文
  ├─ 图片
  └─ 资源链接
       ↓
微博发布
       ↓
获取微博分享/详情链接
       ↓
各平台根据自己的模板二次发布
       ↓
知乎 / 简书 / 百家号 / 今日头条 / ...
```

## 二、当前技术方案

- Node.js
- Playwright：浏览器自动化、登录态持久化、页面发布
- Electron：后续桌面 UI
- SQLite：后续任务、账号、平台状态持久化

完整开发方案见 `docs/IMPLEMENTATION_PLAN.md`。

## 三、模块规划

```text
src/
├─ core/
│  ├─ task.js                  # 统一任务模型
│  ├─ publisher.js             # 平台发布器基类/协议
│  └─ workflow.js              # 微博前置 + 多平台分发编排
├─ browser/
│  └─ profile-manager.js       # 平台登录态/Profile 管理
├─ platforms/
│  ├─ weibo/
│  │  ├─ session.js            # 微博会话与登录检测
│  │  ├─ publisher.js          # 微博发布
│  │  └─ resolve-post.js       # 获取刚发布微博链接
│  ├─ zhihu/
│  ├─ jianshu/
│  ├─ baijiahao/
│  └─ toutiao/
└─ cli/
   └─ login-weibo.js           # 微博登录初始化
```

## 四、任务状态

### P0：微博最小闭环

- [x] 浏览器/Profile 管理
- [x] 登录微博入口
- [x] 基础登录状态检测
- [ ] 发布纯文字微博
- [ ] 发布文字 + 图片
- [ ] 正文加入资源链接
- [ ] 监听发布接口响应
- [ ] 获取微博 ID / mid / bid
- [ ] 生成微博详情链接
- [ ] API 获取失败时使用主页最新微博兜底
- [ ] 将发布结果保存到本地

### P1：平台分发

- [ ] 知乎
- [ ] 简书
- [ ] 百家号
- [ ] 今日头条
- [ ] 搜狐号
- [ ] 网易号

### P2：桌面客户端

- [ ] Electron 主界面
- [ ] 内容输入
- [ ] 图片选择
- [ ] 账号管理
- [ ] 平台勾选
- [ ] 发布队列
- [ ] 状态表格
- [ ] 日志窗口

### P3：批量能力

- [ ] Excel 导入
- [ ] 每条任务独立状态
- [ ] 发布节流
- [ ] 失败重试
- [ ] 暂停/继续
- [ ] 导出结果

## 五、关键数据

每个任务至少记录：

```json
{
  "id": "task-id",
  "title": "标题",
  "content": "正文",
  "images": [],
  "resourceUrl": "https://...",
  "weibo": {
    "status": "pending",
    "id": "",
    "mid": "",
    "bid": "",
    "url": ""
  },
  "platforms": {
    "zhihu": { "status": "pending", "url": "" },
    "jianshu": { "status": "pending", "url": "" },
    "baijiahao": { "status": "pending", "url": "" },
    "toutiao": { "status": "pending", "url": "" }
  }
}
```

## 六、当前已完成

- [x] 创建 `ximishan/autoSendManhua` 新仓库开发基线
- [x] 明确微博必须作为前置发布平台
- [x] 明确后续平台只使用微博分享/详情链接，不直接依赖原始网盘链接
- [x] 建立 README 和项目进度文档
- [x] 新增完整实现方案 `docs/IMPLEMENTATION_PLAN.md`
- [x] 完整方案已覆盖微博链接三层获取、统一平台适配器、SQLite、多账号、队列恢复、错误分类、Electron UI、Excel 批量、日志、Selector 配置、测试与阶段验收标准
- [x] 新增 `.profiles/<platform>` 独立登录态目录
- [x] 新增微博登录 CLI：`npm run login:weibo`
- [x] 新增微博页面基础登录状态检测

## 七、明确不做

- 不修改 `ximishan/autoPushWeibo`
- 不把旧微博导出项目直接改造成多平台发布器
