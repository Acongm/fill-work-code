# JSON Primary Daily Data and SQLite Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a usable daily-log workflow by making date JSON authoritative for UI/edit/export while persisting generated Git and AI evidence in SQLite before projecting only owned JSON fields.

**Architecture:** `WorkLogManager` becomes the only daily JSON repository and serializes every write for a date. Collection commands store normalized facts in SQLite, then a field-scoped `GeneratedDailyProjector` atomically patches `gitlog`, `gitCommit`, `origin_url`, or `ailog`; daily pages and exports read JSON, while project pages keep querying SQLite facts.

**Tech Stack:** TypeScript, VS Code Extension API, React 19, sql.js, Mocha, ESLint, esbuild, Vite.

---

### Task 1: Make the JSON Repository Preserve Field Ownership

**Files:**
- Modify: `src/shared/types/dailyLog.ts`
- Modify: `src/daily/utils/workLogManager.ts`
- Create: `test/workLogManager.test.ts`

- [ ] **Step 1: Write failing repository tests**

Add tests that create a temporary storage root and prove:

```ts
test('generated patch preserves user and unknown JSON fields', async () => {
  const manager = new WorkLogManager(root);
  fs.writeFileSync(filePath, JSON.stringify({
    date: '2026-07-27',
    completed: ['manual'],
    plan: ['next'],
    blockers: [],
    notes: 'note',
    gitlog: ['old'],
    ailog: ['keep-ai'],
    gitCommit: [],
    origin_url: [],
    custom: { keep: true },
  }));

  await manager.patchGeneratedFields('2026-07-27', 'git', {
    gitlog: ['new'],
    gitCommit: ['abc change'],
    origin_url: ['https://example.com/a.git'],
  });

  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  assert.deepStrictEqual(raw.completed, ['manual']);
  assert.deepStrictEqual(raw.ailog, ['keep-ai']);
  assert.deepStrictEqual(raw.custom, { keep: true });
  assert.deepStrictEqual(raw.gitlog, ['new']);
});
```

Add a second test that starts a user save and a generated patch concurrently,
then asserts both changes survive.

- [ ] **Step 2: Verify RED**

Run: `npm run compile-tests`

Expected: compilation fails because `patchGeneratedFields()` does not exist.

- [ ] **Step 3: Extend the daily JSON contract**

Add readable project-link metadata without changing existing string fields:

```ts
export interface DailyProjectLink {
  field: 'completed' | 'plan' | 'blockers' | 'notes';
  content: string;
  assignment: 'project' | 'unassigned';
  projectOriginUrl: string | null;
}

export interface DailyLog {
  // existing fields
  projectLinks?: DailyProjectLink[];
}
```

- [ ] **Step 4: Add one per-date write queue and field-scoped patching**

Implement these APIs in `WorkLogManager`:

```ts
saveUserFields(date: string, log: DailyLog): Promise<void>
patchGeneratedFields(
  date: string,
  group: 'git',
  fields: Pick<DailyLog, 'gitlog' | 'gitCommit' | 'origin_url'>,
): Promise<void>
patchGeneratedFields(
  date: string,
  group: 'ai',
  fields: Pick<DailyLog, 'ailog'>,
): Promise<void>
```

All three operations must use the same `Map<string, Promise<void>>` queue,
read raw JSON inside the queued operation, preserve unknown fields, write a
unique temporary file, rename atomically, and then refresh the month summary.
Keep `saveDailyLog()` as a compatibility wrapper until callers are migrated.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm run compile-tests
npm test
```

Expected: repository tests pass and existing tests remain green.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types/dailyLog.ts src/daily/utils/workLogManager.ts test/workLogManager.test.ts
git commit -m "refactor make daily JSON writes field scoped"
```

### Task 2: Track JSON Projection State in SQLite

**Files:**
- Modify: `src/database/utils/schema.ts`
- Modify: `src/database/commands/migrateSchema.ts`
- Create: `src/database/commands/projectionRepository.ts`
- Modify: `test/database.test.ts`

- [ ] **Step 1: Write failing schema and repository tests**

Test migration from schema version 1 to 2, then assert this contract:

```ts
await repository.markPending('2026-07-27', 'git', 3);
assert.deepStrictEqual(repository.get('2026-07-27', 'git'), {
  date: '2026-07-27',
  group: 'git',
  sourceRevision: 3,
  projectedRevision: 0,
  status: 'pending',
  lastError: null,
});
await repository.markFailed('2026-07-27', 'git', 'disk full');
assert.strictEqual(repository.listPending()[0].status, 'failed');
```

- [ ] **Step 2: Verify RED**

Run: `npm run compile-tests`

Expected: missing `ProjectionRepository`.

- [ ] **Step 3: Add schema version 2**

Add:

```sql
CREATE TABLE json_projection_state (
  date TEXT NOT NULL,
  field_group TEXT NOT NULL CHECK (field_group IN ('git', 'ai')),
  source_revision INTEGER NOT NULL DEFAULT 0,
  projected_revision INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('pending', 'projected', 'failed')),
  last_error TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (date, field_group)
);
```

Update `SCHEMA_VERSION` to `2`, execute `SCHEMA_VERSION_2` when current version
is below 2, and preserve the version-1 migration path.

- [ ] **Step 4: Implement the projection repository**

Expose:

```ts
type ProjectionGroup = 'git' | 'ai';
markPending(date, group, revision): Promise<void>
markProjected(date, group, revision): Promise<void>
markFailed(date, group, message): Promise<void>
get(date, group): ProjectionState | undefined
listPending(): ProjectionState[]
```

Both `pending` and `failed` rows are retryable.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm test`

Expected: all database tests pass.

```bash
git add src/database test/database.test.ts
git commit -m "feat track generated JSON projections"
```

### Task 3: Project SQLite Facts into JSON by Field Group

**Files:**
- Create: `src/daily/types/generatedDailyFields.ts`
- Create: `src/daily/commands/generatedDailyProjector.ts`
- Create: `test/generatedDailyProjector.test.ts`

- [ ] **Step 1: Write failing projector tests**

Build real SQLite projects, clones, commits, gitlog rows and AI daily items.
Assert:

```ts
await projector.project('2026-07-27', ['git']);
assert.deepStrictEqual(manager.getDailyLog(date)?.gitlog, ['project: change']);
assert.deepStrictEqual(manager.getDailyLog(date)?.ailog, ['old ai']);

await projector.project('2026-07-27', ['ai']);
assert.deepStrictEqual(manager.getDailyLog(date)?.ailog, ['new ai']);
assert.deepStrictEqual(manager.getDailyLog(date)?.gitlog, ['project: change']);
```

Add a failure test using a JSON repository stub that throws; assert the
projection row becomes `failed` rather than `projected`.

- [ ] **Step 2: Verify RED**

Run: `npm run compile-tests`

Expected: missing `GeneratedDailyProjector`.

- [ ] **Step 3: Implement SQLite queries and projection orchestration**

`GeneratedDailyProjector` receives `Database`, `WorkLogManager` and optional log
callback. It queries:

- `gitlog_entries.content` by date;
- `commits.subject` by commit date, formatting the existing JSON-compatible
  commit line;
- distinct `projects.origin_url` referenced by date commits or GitLog;
- `daily_items.content` where `date = ?`, `kind = 'ailog'`, `source = 'ai'`.

For each requested group it calls the matching `WorkLogManager` patch, updates
projection state, and logs row counts.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm test`

Expected: projector tests pass.

```bash
git add src/daily test/generatedDailyProjector.test.ts
git commit -m "feat project SQLite evidence to daily JSON"
```

### Task 4: Restore Daily and Monthly JSON Reads

**Files:**
- Modify: `src/daily/commands/dailyMessages.ts`
- Delete: `src/daily/commands/saveDailyItems.ts`
- Delete: `src/daily/commands/loadDailyItems.ts`
- Modify: `src/database/commands/legacyMigrator.ts`
- Modify: `src/app/commands/buildWebviewConfig.ts`
- Modify: `test/dailyCollection.test.ts`
- Modify: `test/legacyMigration.test.ts`

- [ ] **Step 1: Replace old SQLite-first tests with failing JSON-source tests**

Assert that:

- `handleLoadDate()` returns existing JSON even when every SQLite fact table is
  empty;
- `handleSave()` changes user fields but preserves generated and unknown fields;
- `handleLoadMonthLogs()` returns all date JSON files even when SQLite is empty.

- [ ] **Step 2: Verify RED**

Run: `npm test`

Expected: current handlers return empty SQLite projections.

- [ ] **Step 3: Change daily handlers to JSON**

Replace `loadDailyProjection()` with:

```ts
loadDailyLog(deps, date): DailyLog
```

using `WorkLogManager.getDailyLog() ?? emptyDailyLog(date)`.
`handleSave()` calls `saveUserFields()`. `handleLoadMonthLogs()` calls
`getMonthlyLogs()`. `updateWebview()` reads the same JSON loader.

Repository options continue to come from SQLite. Stop posting SQLite
`daily_items` as the page model.

- [ ] **Step 4: Add one-time manual-item recovery**

During legacy migration, merge `daily_items.source IN ('manual', 'migration')`
into JSON only when the corresponding user field is absent. Existing JSON wins,
the operation is recorded in `legacy_imports`, and repeated activation is a
no-op. Never use this recovery path for normal saves.

- [ ] **Step 5: Remove full daily compatibility export**

Delete callers of `CompatibilityWriter.exportDaily()` and remove its obsolete
test. Keep `exportCommits()` and `exportRegistry()`.

- [ ] **Step 6: Verify GREEN and commit**

Run:

```bash
npm run typecheck
npm test
```

Expected: daily handlers consistently read JSON.

```bash
git add -A
git commit -m "fix restore JSON as daily view source"
```

### Task 5: Make Git Apply SQLite-First and Cache-Safe

**Files:**
- Modify: `src/collection/utils/gitEvidenceService.ts`
- Modify: `src/collection/commands/collectMessages.ts`
- Modify: `src/collection/commands/applyCollection.ts`
- Modify: `test/dailyCollection.test.ts`

- [ ] **Step 1: Write failing fresh-scan and cache tests**

Cover two cases:

1. applying a fresh Git preview projects SQLite facts into JSON without changing
   `completed`;
2. a preview-cache hit with empty SQLite first imports `_commits.tsv`, then
   projects JSON; if TSV is absent it reports that a rescan is required and does
   not write JSON.

- [ ] **Step 2: Verify RED**

Run: `npm test`

Expected: current `applyFillPreview()` writes preview JSON directly and changes
`completed`.

- [ ] **Step 3: Expose structured-evidence recovery**

Add:

```ts
ensureStructuredEvidence(
  request: CollectRequest,
  database: Database,
  onLog?: (line: string) => void,
): Promise<{ hydrated: boolean; missingMonths: string[] }>
```

It imports existing monthly `_commits.tsv` through `evidenceTsvToFacts()` and
`applyCollection()`. It must never synthesize SHAs from `FillPreview`.

- [ ] **Step 4: Replace Git preview application**

`applyFillPreview(..., 'git')` must:

- ignore `day.completed`;
- ensure cached evidence is structured;
- mark selected dates pending;
- invoke `GeneratedDailyProjector.project(date, ['git'])`;
- post `fillApplied` only after JSON projection succeeds;
- post actionable failure with “重新扫描” when structured evidence is missing.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm test`

Expected: both fresh and cache paths are SQLite-first.

```bash
git add src/collection test/dailyCollection.test.ts
git commit -m "fix make Git apply SQLite first"
```

### Task 6: Persist AILog Before JSON Projection

**Files:**
- Modify: `src/collection/commands/collectAiConversations.ts`
- Create: `src/collection/commands/saveGeneratedAilog.ts`
- Modify: `src/collection/commands/collectMessages.ts`
- Modify: `src/database/commands/aiConversationRepository.ts`
- Modify: `test/dailyCollection.test.ts`

- [ ] **Step 1: Write a failing AI apply test**

Apply an AI preview and assert:

- `daily_items` contains `kind = 'ailog'`, `source = 'ai'`;
- JSON `ailog` matches those rows;
- JSON `completed` and Git fields are unchanged;
- reapplying replaces AI rows for that date rather than duplicating them.

Add a conversation-materialization test: one Codex session and its messages
produce one date-scoped AILog row whose ID starts with `ai:conversation:`, and
`daily_ai_evidence` links the row to the source session/message.

- [ ] **Step 2: Verify RED**

Run: `npm test`

Expected: current AI apply only writes JSON.

- [ ] **Step 3: Implement generated AILog replacement**

For Git-based AI polish, within one SQLite transaction:

- delete only `daily_items` rows whose ID starts with `ai:polish:<date>:`;
- insert stable `ai:polish:` IDs derived from date, index and content;
- preserve manual/migration rows;
- mark the AI projection group pending.

Then project `['ai']`. Do not update `completed`.

- [ ] **Step 4: Materialize collected conversations**

After Codex/Cursor/Qoder sessions and messages are stored, group sessions by the
local date of their messages (falling back to session start/update time).
Create one readable `ai:conversation:` AILog item per session/date using the
provider, title and first user-message summary. Link it through
`daily_ai_evidence`, mark affected AI dates pending, and project only `ailog`.
Recollection replaces rows for the same session/date without touching
`ai:polish:` rows.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm test`

Expected: AI rows and JSON agree.

```bash
git add src/collection test/dailyCollection.test.ts
git commit -m "fix persist generated AILog before JSON"
```

### Task 7: Remove Reverse Daily Merges from Summary and XLSX

**Files:**
- Modify: `src/summary/commands/summaryMessages.ts`
- Modify: `src/collection/utils/gitEvidenceService.ts`
- Create: `test/summaryJsonSource.test.ts`

- [ ] **Step 1: Write a failing XLSX-source characterization test**

Create JSON with `gitlog: ['json value']` and Markdown/TSV with a different
value. Invoke the pre-generation preparation and assert JSON remains byte-for-
byte unchanged.

- [ ] **Step 2: Verify RED**

Run: `npm test`

Expected: `mergeGitlogIntoDailyLogs()` rewrites JSON from Markdown.

- [ ] **Step 3: Remove reverse merges**

Delete `parseDailyGitlogMarkdown()` and `mergeGitlogIntoDailyLogs()` from the
timesheet path. Stop using `enrichLogsFromCommits()` for UI/report reads. Keep
TSV only as evidence compatibility and cache recovery input.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm test`

Expected: JSON remains unchanged and the generator still receives the storage
root.

```bash
git add src/summary src/collection test/summaryJsonSource.test.ts
git commit -m "fix generate summaries and XLSX from JSON only"
```

### Task 8: Make Generated Fields Read-Only in the Webview

**Files:**
- Create: `web/src/daily/views/GeneratedFieldList.tsx`
- Create: `web/src/daily/views/UserFieldList.tsx`
- Create: `web/src/daily/pages/DailyPage.tsx`
- Modify: `web/src/app/pages/App.tsx`
- Modify: `web/src/collection/pages/FillReviewPage.tsx`
- Modify: `web/src/app/layout/index.css`

- [ ] **Step 1: Add testable pure synchronization logic**

Create and test:

```ts
export function appendUniqueCompleted(
  completed: string[],
  selected: string[],
): string[] {
  return [...completed, ...selected.filter(
    (item) => item.trim() && !completed.includes(item.trim()),
  ).map((item) => item.trim())];
}
```

Run `npm run compile-tests`; expect failure until the new module exists.

- [ ] **Step 2: Extract the daily vertical slice**

Move daily-only rendering into `web/src/daily/pages/DailyPage.tsx`. Put user
arrays in `UserFieldList` and generated arrays in `GeneratedFieldList`.
`App.tsx` remains orchestration and passes data/callback props.

- [ ] **Step 3: Remove generated-field editors**

`gitlog`, `gitCommit`, `origin_url`, and `ailog` render as read-only lists.
Remove their draft inputs, edit buttons and delete buttons from both the daily
page and confirmation page. Confirmation retains only per-day inclusion.

- [ ] **Step 4: Add explicit manual synchronization**

`GeneratedFieldList` offers “同步到今日完成”. It asks for confirmation, calls
`appendUniqueCompleted()`, marks the JSON user state dirty, and never sends
generated field changes to the Host.

`UserFieldList` shows a project selector for every `completed`, `plan`,
`blockers`, and non-empty `notes` entry. Options come from the SQLite project
list, while “未归属” is explicit. Each edit updates `projectLinks` in the same
React state change so the next JSON save cannot leave stale metadata.

Add a “同步 JSON” action that posts:

```ts
{ command: 'syncGeneratedJson', date: log.date, groups: ['git', 'ai'] }
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm run typecheck
npm run lint
npm run compile
npm test
```

Expected: all checks pass and the bundle builds.

```bash
git add web/src
git commit -m "refactor split daily page and lock generated fields"
```

### Task 9: Wire Manual Projection Retry and Project-Linked JSON

**Files:**
- Modify: `src/app/views/ChatViewProvider.ts`
- Modify: `src/daily/commands/dailyMessages.ts`
- Modify: `src/projects/commands/getProjectHistory.ts`
- Modify: `src/database/commands/projectRepository.ts`
- Modify: `src/app/types/hostDependencies.ts`
- Modify: `test/dailyCollection.test.ts`

- [ ] **Step 1: Write failing retry and project-history tests**

Assert `syncGeneratedJson` retries failed/pending field groups and reloads JSON.
Create a JSON `projectLinks` entry and assert project history merges it with
SQLite Commit/GitLog days without inserting a manual `daily_items` row.

- [ ] **Step 2: Verify RED**

Run: `npm test`

Expected: no retry command and project history only queries `daily_items`.

- [ ] **Step 3: Add the retry command**

Dispatch `syncGeneratedJson` to a daily command that projects requested groups,
posts success/failure, and reloads the active date. On extension startup, retry
pending projections after database migration without blocking JSON display.

- [ ] **Step 4: Merge JSON project links into project history**

Keep SQLite facts authoritative. In the project command layer, scan monthly
JSON, match `projectOriginUrl`, map linked manual entries into history DTOs, and
merge by date. Remove manual `daily_items` from normal project-history output.

- [ ] **Step 5: Verify and commit**

Run: `npm test`

Expected: retry and merged project timeline tests pass.

```bash
git add src test/dailyCollection.test.ts
git commit -m "feat retry projections and merge JSON project records"
```

### Task 10: Full Verification and Documentation

**Files:**
- Modify: `docs/current-page-functionality.md`
- Modify: `docs/superpowers/plans/2026-07-27-json-primary-sqlite-evidence.md`

- [ ] **Step 1: Update current behavior documentation**

Document:

- JSON-backed daily/monthly/XLSX reads;
- read-only generated fields;
- SQLite-backed project/date evidence;
- “同步 JSON” and “同步到今日完成”;
- field-scoped failure recovery.

- [ ] **Step 2: Run the complete automated suite**

Run:

```bash
npm run typecheck
npm run lint
npm run compile
npm test
```

Expected: all commands exit zero.

- [ ] **Step 3: Package and install locally**

Run:

```bash
npm run package:force
code --install-extension "$(ls -t dist-package/*.vsix | head -1)" --force
```

Expected: VSIX packages and installs successfully.

- [ ] **Step 4: Perform focused runtime verification**

Using a temporary storage copy:

- open an existing JSON date while SQLite is empty;
- run Git collection and verify SQLite rows appear before JSON changes;
- verify `completed` remains unchanged;
- reload the Webview and verify the same JSON values remain visible;
- generate XLSX and verify source JSON is unchanged;
- force one projection failure and verify “同步 JSON” recovers it.

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "docs describe JSON primary evidence flow"
```
