# JSON 日报主数据与 SQLite 采集证据重构设计

> 日期：2026-07-27
>
> 状态：已确认
>
> 本文覆盖并修正
> `2026-07-26-sqlite-modular-refactor-design.md` 中“SQLite 是所有日报数据
> 唯一事实来源”和“页面从 SQLite 投影日报”的设计。

## 1. 目标

修复当前版本中 Git 采集、SQLite、JSON 和页面之间的数据断裂，并建立清晰、
可恢复的数据所有权：

- SQLite 结构化保存脚本采集的仓库、Commit、GitLog 和 AI 会话证据；
- 日期 JSON 是用户查看日报、编辑日报、生成汇总和 XLSX 的主数据；
- 程序生成字段必须先成功写入 SQLite，再从 SQLite 覆盖 JSON 对应字段；
- 用户字段只能由用户操作修改，采集和 AI 流程不得自动覆盖；
- 仓库详情从 SQLite 查询采集事实，并按日期、项目展示；
- 页面不再混用 SQLite 日报投影和 JSON 日报，避免写入后显示旧数据。

## 2. 数据所有权

### 2.1 SQLite 所有的结构化数据

SQLite 保存可追溯、可按项目和日期查询的程序采集事实：

- `projects`：远程仓库身份；
- `project_clones`：本地仓库副本；
- `collection_runs`：采集批次、范围、状态和错误；
- `commits`：Commit SHA、主题、作者、时间、仓库和采集批次；
- `gitlog_entries`：按日期生成的 GitLog 文本及其项目关联；
- `gitlog_entry_commits`：GitLog 与 Commit 的关联；
- `ai_sessions`：Codex、Cursor、Qoder 会话；
- `ai_messages`：AI 会话消息；
- `daily_items` 中 `source = 'ai'` 的记录：程序生成的 AILog；
- `daily_ai_evidence`：AILog 与 AI 会话、消息的来源关联；
- 新增 JSON 投影状态：按日期和字段组记录是否已同步、失败原因和待重试
  状态。

SQLite 不再作为用户手动日报字段的运行时主存储。现有
`daily_items.source IN ('manual', 'migration')` 仅用于一次性兼容迁移，正常
保存流程不再写入这些记录。

### 2.2 JSON 中的用户字段

以下字段以日期 JSON 为唯一事实来源，并允许用户编辑：

- `completed`
- `plan`
- `blockers`
- `notes`

`completed` 明确属于用户。Git 采集、缓存恢复、AI 润色、SQLite 投影和启动
迁移都不得自动覆盖它。

用户记录的项目归属也保存在 JSON。兼容现有字符串数组的同时，可增加
`projectLinks`：

```json
{
  "projectLinks": [
    {
      "field": "completed",
      "content": "修复日报同步问题",
      "assignment": "project",
      "projectOriginUrl": "git@github.com:example/project.git"
    },
    {
      "field": "plan",
      "content": "整理文档",
      "assignment": "unassigned",
      "projectOriginUrl": null
    }
  ]
}
```

同一字段内仍不允许重复文本，因此 `field + content` 可以稳定定位关联。
编辑、删除或移动一条用户记录时，必须在同一次 JSON 保存中更新对应关联。

### 2.3 JSON 中的程序字段

以下字段由 SQLite 投影到日期 JSON：

- `gitlog`
- `gitCommit`
- `origin_url`
- `ailog`

这些字段在日报页和采集确认页中均为只读。用户不能直接新增、修改或删除，
只能通过以下操作更新：

- “重新采集”：重新运行脚本，更新 SQLite 后再投影 JSON；
- “同步 JSON”：不运行脚本，从 SQLite 重新投影选定日期；
- “重新 AI 润色”：更新 SQLite 中的 AILog 及证据关联后再投影 JSON。

未知 JSON 字段必须原样保留，投影器只能修改上述白名单字段。Git 操作只投影
`gitlog`、`gitCommit`、`origin_url`，AI 操作只投影 `ailog`；两类操作不能
借机清空另一类程序字段。

## 3. 读取规则

### 3.1 日报、汇总和导出

下列功能统一读取日期 JSON：

- 日报页面；
- 日期切换；
- 月度日报列表；
- 日报和月报 Markdown 预览；
- AI 月报上下文；
- 工时表和 XLSX 生成；
- 采集确认页中已有日报的用户字段。

页面初始化和 `dateLoaded` 不再调用 SQLite 日报投影。SQLite 暂时为空、迁移
未完成或投影失败时，页面仍应展示已有 JSON，不能显示一份空日报。

XLSX 生成前不得再从 Markdown、TSV 或 SQLite 反向合并日报。生成器只消费
当前 JSON 内容。

### 3.2 仓库与项目详情

仓库列表和仓库详情从 SQLite 读取：

- 按项目展示所有本地副本；
- 按日期分组展示 Commit、GitLog 和 AI 证据；
- 支持按日期范围过滤；
- 用户手动记录通过扫描 JSON 的 `projectLinks` 合并到项目时间线；
- “未归属”用户记录不进入任何项目详情，只在未归属类目展示。

这样既保留仓库事实的结构化查询能力，也不要求把用户日报重新复制到 SQLite。

## 4. 写入与同步流程

### 4.1 Git 采集

```text
运行脚本
  → 解析并校验 staging 结果
  → SQLite 事务写入项目、仓库、Commit、GitLog、采集批次
  → 标记目标日期 Git 字段组投影待处理
  → 从 SQLite 查询目标日期的 Git 生成字段
  → 原子覆盖 JSON 的 Git 白名单字段
  → 标记投影成功
  → 页面重新读取 JSON
```

脚本结果必须全部通过校验后才能更新 SQLite。重新扫描采用“目标日期范围
替换”语义：成功扫描后清除目标范围内已失效的旧生成事实，避免旧 Commit
永久残留；扫描失败时保留上一次成功事实和 JSON。

### 4.2 缓存命中

确认页缓存不是结构化事实来源，不能直接写 JSON。

- SQLite 已有目标日期事实时，缓存只用于加速确认展示，应用时仍从 SQLite
  投影 JSON；
- SQLite 缺少事实但 `_commits.tsv` 存在时，先将 TSV 解析写入 SQLite；
- SQLite 和 TSV 都缺少事实时，缓存作废并强制重新扫描；
- 不允许从只有 Commit 文本、没有 SHA 和项目身份的确认缓存伪造 Commit。

### 4.3 AI 采集和润色

Codex、Cursor、Qoder 脚本先把会话和消息写入 SQLite。AILog 生成完成后：

1. 在同一业务操作中替换目标日期的 AI 生成记录；
2. 写入 `daily_ai_evidence` 来源关联；
3. 标记 JSON 的 AI 字段组投影待处理；
4. 仅覆盖 JSON 的 `ailog`；
5. 页面重新读取 JSON。

AI 流程不得改写 `completed`。

### 4.4 用户编辑

用户保存时只更新 JSON 用户字段和 `projectLinks`。保存过程必须保留当前
JSON 中的程序字段和未知字段，不再调用 `DailyItemRepository.replaceDate()`
或 `CompatibilityWriter.exportDaily()`。

“同步到今日完成”是明确的用户操作：

1. 用户从当日 `ailog` 或 `gitlog` 中选择内容；
2. 系统展示将追加的内容；
3. 确认后去重追加到 `completed`；
4. 能确定项目时同步写入 `projectLinks`，否则明确标记为 `unassigned`；
5. 只保存 JSON，不反向修改 SQLite 采集事实。

一旦复制到 `completed`，该文本即成为用户数据，后续重新采集不能修改它。

## 5. JSON 投影器

新增一个单一职责的字段投影器，禁止各功能自行双写：

```ts
interface GeneratedDailyFields {
  gitlog: string[];
  gitCommit: string[];
  origin_url: string[];
  ailog: string[];
}

type ProjectionGroup = 'git' | 'ai';

projectGeneratedFields(
  date,
  groups: ProjectionGroup[],
): Promise<ProjectionResult>
retryPendingProjections(): Promise<ProjectionResult[]>
```

投影器必须：

- 从 SQLite 查询生成字段；
- 读取现有 JSON，文件不存在时创建标准空日报；
- 只替换本次字段组对应的 `GeneratedDailyFields` 白名单；
- 保留用户字段、`projectLinks` 和未知字段；
- 写入唯一临时文件并原子替换目标 JSON；
- 成功后更新投影状态；
- 失败时保留原 JSON，记录错误并允许重试；
- 对同一日期的投影、用户保存和手动同步使用同一把写锁，防止并发
  read-modify-write 互相覆盖。

`CompatibilityWriter.exportDaily()` 的“从 SQLite 重建整份日报”能力必须删除
或停止调用。TSV 和仓库注册表兼容导出可以暂时保留，但不能反向成为日报
字段来源。

## 6. 页面交互

日报页面：

- 用户字段保留当前编辑能力；
- 程序字段使用只读列表；
- 只读区域显示“数据来源：SQLite，最后同步时间”；
- 提供“重新采集”和“同步 JSON”；
- AILog/GitLog 提供“同步到今日完成”，但必须由用户确认；
- JSON 投影失败时显示明确错误和“重试同步”，不能显示保存成功。

采集确认页面：

- 可以选择是否应用某一天；
- Commit、GitLog、仓库和 AILog 不再直接编辑；
- 若要改变 Git 结果，返回修改采集条件或重新扫描；
- 确认应用只触发 SQLite 到 JSON 的投影。

仓库详情：

- 数据源标识为 SQLite；
- 支持日期和项目维度；
- Commit 可追溯到仓库副本和采集批次；
- 手动日报记录通过 JSON 项目关联合并展示。

## 7. 迁移与兼容

升级时执行以下顺序：

1. 已存在的日期 JSON 保持原位，不做全量覆盖；
2. 将 SQLite 中尚未进入 JSON 的手动记录一次性合并到缺失的用户字段；
3. 已有 JSON 用户字段优先，迁移不得覆盖；
4. 旧 `ailog` 可作为 `source = 'migration'` 的 AI 记录导入 SQLite，首次投影
   保持文本不变；
5. 优先从 `_commits.tsv` 恢复结构化 Git 事实；
6. 只有 JSON、没有 TSV 的历史 Git 字段继续展示，但在重新采集前不伪造
   Commit SHA；
7. 只有具备成功采集覆盖记录的日期和字段组才允许 SQLite 覆盖程序字段；
   一次成功扫描即使结果为空，也可以清空该日期旧的 Git 字段；Git 扫描
   不能清空旧 AILog；
8. 迁移完成后，页面立即从 JSON 读取。

迁移必须幂等。任何迁移失败都不得清空或截断现有 JSON。

## 8. 模块边界

保持 Host 与 Webview 对称的业务模块结构：

```text
src/{module}/{pages|commands|views|utils|layout|hooks|types}/
web/src/{module}/{pages|commands|views|utils|layout|hooks|types}/
```

建议职责：

- `src/database/commands`：SQLite 仓库和事务；
- `src/collection/commands`：采集用例，不直接写日报 JSON；
- `src/daily/commands`：JSON 日报读写、生成字段投影、用户同步；
- `src/daily/utils`：原子 JSON 文件仓库；
- `src/projects/commands`：按项目和日期查询结构化事实；
- `src/summary/commands`：只消费 JSON 日报；
- `web/src/daily`：可编辑用户字段和只读生成字段；
- `web/src/collection`：只读确认及范围选择；
- `shared/types`：JSON 日报和 Host/Webview 消息契约。

禁止依赖：

- 页面直接执行 SQL；
- 数据库仓库写 JSON；
- XLSX、Markdown 或缓存反向覆盖日报；
- 多个命令各自实现一套 SQLite/JSON 双写。

## 9. 失败语义与可观测性

- SQLite 事务失败：不触碰 JSON，采集显示失败；
- SQLite 成功、JSON 投影失败：采集事实保留，对应字段组标记待重试，页面
  继续显示原 JSON 并提示同步失败；
- JSON 用户保存失败：SQLite 不受影响，页面保留未保存状态；
- 扩展启动和打开日报时重试待处理投影；
- Output Channel 记录采集批次、SQLite 行数、投影日期、写入字段和错误；
- Webview 同步显示关键进度，避免“无日志输出”。

## 10. 验收标准

1. 已有 JSON 有内容而 SQLite 为空时，日报仍正常显示 JSON。
2. Git 新扫描先写入 SQLite，再覆盖 JSON 的三个 Git 字段。
3. 缓存命中且 SQLite 为空时不会直接写 JSON。
4. AI 采集先保存会话、消息和 AILog 关联，再覆盖 JSON `ailog`。
5. 任意采集和投影都不会修改 `completed`、`plan`、`blockers`、`notes`。
6. 页面不能直接编辑 `gitlog`、`gitCommit`、`origin_url`、`ailog`。
7. “同步到今日完成”仅在用户确认后去重追加。
8. 日报、月度汇总、预览和 XLSX 对同一天展示一致的 JSON 数据。
9. 仓库详情能按项目和日期查询 Commit、GitLog 和 AI 证据。
10. JSON 投影失败可重试，原 JSON 不损坏。
11. 重新扫描能移除目标范围内已失效的旧生成事实。
12. 旧 JSON、TSV 和空 SQLite 的升级场景均有自动化回归测试。
