# 仓库 Commit 生成单日工作日志设计

## 背景

“个人中心 → 我的仓库 → 仓库详情”的工作日志目前同时展示
`gitlog_entries` 与 `commits`。两类数据来自同一批 Git 采集事实，页面上会产生
重复信息。项目详情还缺少从已采集 Commit 生成项目单日工作日志的直接入口。

## 目标

- 工作日志按日期分组，只展示可展开的 Commit，不再单独展示 GitLog。
- 支持复选一个或多个日期，并为每个日期分别生成单日工作日志。
- 生成结果写入对应日期 JSON，立即在项目详情回显。
- SQLite 继续只保存自动采集事实，不保存用户最终编辑视图。
- 同一日期、同一项目、同一内容重复生成时不重复追加。

## 方案比较

### 方案 A：直接拼接 Commit 标题

实现简单且完全离线，但生成内容更接近 Commit 清单，不够像工作日志。

### 方案 B：每次调用 AI 生成

表达质量较高，但依赖 AI 配置和网络；项目详情的基础操作可能因外部服务失败而
不可用。

### 方案 C：复用结构化 GitLog，Commit 标题回退（采用）

页面仅展示 Commit；生成时在宿主端读取选中日期对应的 SQLite
`gitlog_entries`，将它作为已采集的结构化摘要。若某日没有 GitLog，则使用去重
后的 Commit 标题。该方案不增加外部依赖，并能复用现有采集产物。

## 页面交互

项目详情的“工作日志”区域按日期倒序展示：

1. 日期标题前增加复选框。
2. 日期标题显示 Commit 数量，并可展开或收起。
3. 展开后显示短 SHA、Commit 标题、提交时间；不显示独立 GitLog 行。
4. 区域顶部提供“生成单日工作日志”按钮，并显示已选日期数量。
5. 点击按钮后，为每个选中日期分别生成内容；成功后清空选择并刷新项目详情。
6. 没有选中日期时按钮禁用。
7. 没有 Commit 的日期不参与选择；AI 日志或手动日志仍可在该日期下显示。

## 数据流

```text
项目详情日期复选
  → Webview 发送 projectId/originUrl + dates
  → 宿主校验项目和日期
  → SQLite 查询每个日期的 gitlog_entries / commits
  → 每个日期生成一组 completed 文本
  → WorkLogManager.saveUserFields 更新对应 JSON
  → 同步维护 projectLinks(projectOriginUrl)
  → 重新加载仓库详情并回显
```

写入规则：

- 目标字段为 JSON `completed`。
- 每条新增内容同时增加 `projectLinks`：
  - `field: "completed"`
  - `assignment: "project"`
  - `projectOriginUrl: 当前项目 originUrl`
- 保留 JSON 中已有用户字段、生成字段和未知字段。
- 使用内容标准化后的精确匹配去重。
- 单个日期失败不阻止其他日期写入；完成后返回成功日期和失败原因。

## 模块边界

- `web/src/projects/pages/ProjectDetailPage.tsx`
  负责页面编排、日期选择、加载和提交状态。
- `web/src/projects/views/ProjectCommitDay.tsx`
  负责单个日期的折叠 Commit 展示，不发送宿主命令。
- `src/projects/commands/generateProjectDailyLogs.ts`
  负责校验请求、按日期读取事实、生成内容并协调 JSON 写入。
- `src/projects/utils/buildProjectDailyEntries.ts`
  纯函数：将 GitLog/Commit 转换为去重后的工作日志文本。
- `src/projects/commands/projectMessages.ts`
  保留仓库详情加载职责，不承担生成逻辑。

## 消息契约

Webview 请求：

```ts
{
  command: 'generateProjectDailyLogs';
  originUrl: string;
  dates: string[];
}
```

宿主响应：

```ts
{
  command: 'projectDailyLogsGenerated';
  originUrl: string;
  generatedDates: string[];
  failures: Array<{ date: string; message: string }>;
}
```

响应后页面重新请求 `getRepoDetail`，确保显示内容来自已落盘 JSON。

## 错误处理

- 项目不存在、日期格式错误或日期没有 Commit 时，将对应日期加入失败结果。
- JSON 写入错误保留具体日期和错误消息，并输出到扩展日志。
- 页面保留失败日期的选择，方便用户重试；成功日期取消选择。
- 不修改 SQLite 采集事实，不触发 Git 重新采集。

## 测试

- 纯函数测试：优先 GitLog、Commit 回退、去重、空输入。
- 命令测试：多日期分别写入 JSON、项目关联正确、已有内容不重复。
- 页面辅助逻辑测试：只允许选择包含 Commit 的日期，成功后仅清除成功日期。
- 回归测试：仓库历史加载仍包含 SQLite Commit、AI 项和 JSON 手动项目记录。
- 完整执行 TypeScript、ESLint、Webview build、单元测试和 VS Code Extension
  Host 测试。

## 发布

验证通过后：

1. 提交全部改动。
2. 升级补丁版本。
3. 创建版本 tag。
4. 原子推送 `main` 与 tag。
5. 跟踪发布流水线到 Marketplace 发布完成。
