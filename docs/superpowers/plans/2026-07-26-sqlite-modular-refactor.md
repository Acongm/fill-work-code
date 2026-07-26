# SQLite Modular Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SQLite the source of truth for project-linked work evidence and reorganize the Host and Webview into matching module-first structures while removing superseded flows.

**Architecture:** Add a SQLite WASM adapter and feature repositories under `src/database`, then migrate feature commands into `src/{module}` and React pages/hooks into `web/src/{module}`. Keep SQLite reads authoritative, dual-write legacy compatibility files for one transition release, and route Host/Webview communication through typed message unions.

**Tech Stack:** TypeScript, VS Code Extension API, React 19, sql.js SQLite WASM, Mocha, ESLint, esbuild, Vite.

---

### Task 1: Repair Fresh-Checkout Tests and Add SQLite Dependency

**Files:**
- Create: `.vscode-test.mjs`
- Modify: `package.json`
- Modify: `yarn.lock`

- [ ] **Step 1: Add the tracked test configuration**

```js
import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/**/*.test.js',
});
```

- [ ] **Step 2: Add SQLite WASM dependencies**

Run:

```bash
source /Users/acongm/.nvm/nvm.sh
nvm use 20
corepack yarn add sql.js
corepack yarn add -D @types/sql.js
```

Expected: `package.json` and `yarn.lock` include `sql.js` and `@types/sql.js`.

- [ ] **Step 3: Install and run the baseline**

Run:

```bash
source /Users/acongm/.nvm/nvm.sh
nvm use 20
corepack yarn install
npm test
```

Expected: two tests pass in a fresh worktree.

- [ ] **Step 4: Commit**

```bash
git add .vscode-test.mjs package.json yarn.lock
git commit -m "test track extension test configuration"
```

### Task 2: Remove Superseded Features

**Files:**
- Delete: `src/panels/handlers/importHandler.ts`
- Delete: `src/commands/commands.ts`
- Modify: `src/panels/ChatViewProvider.ts`
- Modify: `src/panels/handlers/types.ts`
- Modify: `src/panels/handlers/timesheetHandler.ts`
- Modify: `src/extension.ts`
- Modify: `src/utils/webviewMessages.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/pages/profile/ProfileOverlay.tsx`
- Modify: `docs/current-page-functionality.md`
- Test: `test/extension.test.ts`

- [ ] **Step 1: Add a protocol regression test**

Add imports and this test:

```ts
import {
  isRemovedWebviewCommand,
  type RemovedWebviewCommand,
} from '../src/shared/types/webviewMessages';

test('removed Webview commands stay unavailable', () => {
  const removed: RemovedWebviewCommand[] = [
    'selectXlsxImport',
    'confirmImport',
    'listMonthFiles',
    'sendEmail',
  ];
  for (const command of removed) {
    assert.strictEqual(isRemovedWebviewCommand(command), true);
  }
});
```

- [ ] **Step 2: Verify the test fails**

Run:

```bash
npm run compile-tests
```

Expected: compilation fails because `src/shared/types/webviewMessages` does not exist.

- [ ] **Step 3: Create the removed-command contract**

Create `src/shared/types/webviewMessages.ts`:

```ts
export type RemovedWebviewCommand =
  | 'selectXlsxImport'
  | 'confirmImport'
  | 'listMonthFiles'
  | 'sendEmail';

const REMOVED = new Set<string>([
  'selectXlsxImport',
  'confirmImport',
  'listMonthFiles',
  'sendEmail',
]);

export function isRemovedWebviewCommand(value: string): value is RemovedWebviewCommand {
  return REMOVED.has(value);
}
```

- [ ] **Step 4: Remove dead Host flows**

Delete imports and dispatch cases for XLSX import, single-month files, and
single-timesheet email. Keep `sendEmailWithAttachments` and refactor its handler
name to `sendMaterialsEmail`. Delete `src/panels/handlers/importHandler.ts`.

Delete the legacy standalone commands module and its registration from
`src/extension.ts`.

- [ ] **Step 5: Remove dead Webview state and UI**

Remove `importPreview`, `importSelection`, `selectXlsxImport`,
`confirmImport`, `showSettings`, `refreshConfig`, and their message cases from
`web/src/App.tsx`.

Keep materials selected-attachment email and SMTP settings.

- [ ] **Step 6: Verify**

Run:

```bash
npm run typecheck
npm run lint
npm run compile
npm test
```

Expected: all commands exit zero and the removed-command test passes.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor remove superseded flows"
```

### Task 3: Unify Runtime Storage and Settings Access

**Files:**
- Create: `src/settings/types/settings.ts`
- Create: `src/settings/utils/pathUtils.ts`
- Create: `src/settings/commands/settingsStore.ts`
- Modify: `src/features/settings/pluginSettings.ts`
- Modify: `src/panels/handlers/settingsHandler.ts`
- Modify: `src/panels/handlers/panelUtils.ts`
- Modify: `src/panels/webviewConfigBuilder.ts`
- Modify: `src/services/gitEvidenceService.ts`
- Modify: `src/services/timesheetRunner.ts`
- Modify: `src/panels/handlers/dailyLogHandler.ts`
- Modify: `src/panels/handlers/repoHandler.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/pages/profile/ProfileOverlay.tsx`
- Test: `test/extension.test.ts`

- [ ] **Step 1: Add path and settings tests**

```ts
import { resolveRuntimePaths } from '../src/settings/utils/pathUtils';

test('all runtime paths share the configured storage root', () => {
  const paths = resolveRuntimePaths('/tmp/work-logs');
  assert.strictEqual(paths.database, '/tmp/work-logs/work-log.sqlite');
  assert.strictEqual(paths.runtime, '/tmp/work-logs/.runtime');
  assert.strictEqual(paths.month(2026, 7), '/tmp/work-logs/2026-07');
});
```

- [ ] **Step 2: Verify the test fails**

Run: `npm run compile-tests`

Expected: missing `src/settings/utils/pathUtils`.

- [ ] **Step 3: Implement the unified path resolver**

```ts
import * as path from 'path';
import { expandHome } from './expandHome';

export interface RuntimePaths {
  root: string;
  database: string;
  runtime: string;
  month(year: number, month: number): string;
}

export function resolveRuntimePaths(storagePath: string): RuntimePaths {
  const root = expandHome(storagePath);
  return {
    root,
    database: path.join(root, 'work-log.sqlite'),
    runtime: path.join(root, '.runtime'),
    month: (year, month) =>
      path.join(root, `${year}-${String(month).padStart(2, '0')}`),
  };
}
```

Move `expandHome` into `src/settings/utils/expandHome.ts` and re-export it from
the module.

- [ ] **Step 4: Remove `outputDir`**

Remove `outputDir` from Host/Webview settings types, defaults, forms, and
services. Pass `RuntimePaths.root` or `RuntimePaths.month()` to collection,
timesheet, project, materials, and migration operations.

- [ ] **Step 5: Centralize settings stores**

Move settings load/save/normalization into
`src/settings/commands/settingsStore.ts`. The panel command becomes an adapter
that calls this store and posts the result.

- [ ] **Step 6: Verify**

Run:

```bash
npm run typecheck
npm run lint
npm test
```

Expected: zero failures and no runtime `outputDir` references.

Run:

```bash
rg -n 'outputDir' src web/src
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor unify runtime storage"
```

### Task 4: Add SQLite Database, Schema, and Repositories

**Files:**
- Create: `src/database/types/database.ts`
- Create: `src/database/utils/sqlJsDatabase.ts`
- Create: `src/database/commands/migrateSchema.ts`
- Create: `src/database/utils/schema.ts`
- Create: `src/database/commands/projectRepository.ts`
- Create: `src/database/commands/dailyItemRepository.ts`
- Create: `src/database/commands/collectionRepository.ts`
- Create: `src/database/commands/aiConversationRepository.ts`
- Create: `test/database.test.ts`
- Modify: `tsconfig.test.json`

- [ ] **Step 1: Write schema and repository tests**

Create `test/database.test.ts` with tests that:

```ts
test('enforces explicit project or unassigned daily item assignment', async () => {
  const db = await createTestDatabase();
  const repo = new DailyItemRepository(db);
  await assert.rejects(() =>
    repo.insert({
      id: 'bad',
      date: '2026-07-26',
      kind: 'todo',
      content: 'invalid',
      assignment: 'project',
      projectId: null,
      source: 'manual',
      sortOrder: 0,
    }),
  );
});

test('returns project history without unrelated same-day items', async () => {
  const fixture = await createProjectHistoryFixture();
  const history = await fixture.projects.getHistory('project-a');
  assert.deepStrictEqual(history.days[0].items.map((item) => item.content), [
    'project A item',
  ]);
});
```

- [ ] **Step 2: Verify tests fail**

Run: `npm run compile-tests`

Expected: missing database modules.

- [ ] **Step 3: Implement database interface**

```ts
export interface Database {
  execute(sql: string, params?: SqlValue[]): void;
  all<T>(sql: string, params?: SqlValue[]): T[];
  get<T>(sql: string, params?: SqlValue[]): T | undefined;
  transaction<T>(fn: () => T): T;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export type SqlValue = string | number | Uint8Array | null;
```

- [ ] **Step 4: Implement SQL.js persistence**

Initialize sql.js, enable foreign keys, load an existing database image, and
persist after successful outer transactions using:

```ts
const tempPath = `${databasePath}.tmp`;
await fs.promises.writeFile(tempPath, Buffer.from(sqlite.export()));
await fs.promises.rename(tempPath, databasePath);
```

Serialize transactions through one promise queue and never flush a failed
transaction.

- [ ] **Step 5: Implement schema migrations**

Create schema version 1 with every table and constraint from the approved design
spec. Apply migrations inside one transaction and record them in
`schema_migrations`.

- [ ] **Step 6: Implement repositories**

Repositories accept `Database` in their constructors and own SQL for:

- projects/clones/project history;
- daily items;
- collection runs/commits/GitLog;
- AI sessions/messages/evidence.

- [ ] **Step 7: Verify**

Run:

```bash
npm run compile-tests
npx vscode-test --fail-zero --grep 'Database|project history|assignment'
```

Expected: all database tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/database test/database.test.ts tsconfig.test.json
git commit -m "feat add SQLite source database"
```

### Task 5: Add Automatic Legacy Migration and Compatibility Dual-Write

**Files:**
- Create: `src/database/commands/legacyMigrator.ts`
- Create: `src/database/commands/compatibilityWriter.ts`
- Create: `src/database/utils/legacyReaders.ts`
- Create: `test/legacyMigration.test.ts`
- Create: `test/fixtures/legacy/2026-07/2026-07-25.json`
- Create: `test/fixtures/legacy/2026-07/_commits.tsv`
- Create: `test/fixtures/legacy/.repos/registry.json`

- [ ] **Step 1: Add migration tests**

```ts
test('legacy migration is idempotent and preserves ambiguous items as unassigned', async () => {
  const fixture = await migrateLegacyFixtureTwice();
  assert.strictEqual(fixture.dailyItems.length, 2);
  assert.ok(fixture.dailyItems.every((item) => item.assignment === 'unassigned'));
  assert.strictEqual(fixture.legacyFilesChanged, false);
});

test('compatibility writer exports one daily JSON from SQLite items', async () => {
  const output = await exportCompatibilityFixture();
  assert.deepStrictEqual(output.completed, ['completed item']);
  assert.deepStrictEqual(output.plan, ['todo item']);
});
```

- [ ] **Step 2: Verify tests fail**

Run: `npm run compile-tests`

Expected: missing migration modules.

- [ ] **Step 3: Implement file readers**

Reuse existing TSV and registry parsers through adapters. Fingerprint sources
with path, size, mtime, and SHA-256. Do not mutate source files.

- [ ] **Step 4: Implement ordered migration**

Import projects/clones, commits, GitLog entries, then daily items. Wrap each
source in a transaction and record successful fingerprints in `legacy_imports`.

- [ ] **Step 5: Implement dual-write**

After SQLite commits, export affected daily JSON and `_commits.tsv`. Map:

```ts
const fieldByKind = {
  completed: 'completed',
  ailog: 'ailog',
  todo: 'plan',
  blocker: 'blockers',
  note: 'notes',
} as const;
```

Compatibility failures return warnings without rolling back SQLite.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm run typecheck
npm test
```

Expected: all migration and compatibility tests pass.

```bash
git add src/database test
git commit -m "feat migrate and dual write legacy data"
```

### Task 6: Move Daily and Collection Workflows to SQLite

**Files:**
- Create: `src/daily/types/dailyItem.ts`
- Create: `src/daily/commands/loadDailyItems.ts`
- Create: `src/daily/commands/saveDailyItems.ts`
- Create: `src/collection/commands/collectGit.ts`
- Create: `src/collection/commands/applyCollection.ts`
- Create: `src/collection/commands/polishDailyItems.ts`
- Move: `src/services/gitEvidenceService.ts` to `src/collection/utils/gitEvidenceService.ts`
- Move: `src/services/fillCacheService.ts` to `src/collection/utils/fillCacheService.ts`
- Move: `src/services/aiPolishService.ts` to `src/collection/utils/aiPolishService.ts`
- Move: `src/panels/handlers/collectHandler.ts` to module command files
- Modify: `src/lib/workLogManager.ts`
- Modify: `src/panels/ChatViewProvider.ts`
- Test: `test/dailyCollection.test.ts`

- [ ] **Step 1: Add daily and collection tests**

```ts
test('manual daily item requires project choice or explicit unassigned', async () => {
  const command = createSaveDailyItemsCommand();
  await assert.rejects(() =>
    command.execute({
      date: '2026-07-26',
      items: [{ kind: 'todo', content: 'task' }],
    }),
  );
});

test('collected commits retain project links through confirmation', async () => {
  const result = await runCollectionFixture();
  assert.strictEqual(result.commits[0].projectId, 'project-a');
  assert.strictEqual(result.gitlogEntries[0].projectId, 'project-a');
});
```

- [ ] **Step 2: Verify tests fail**

Run: `npm run compile-tests`

Expected: missing feature commands.

- [ ] **Step 3: Implement daily commands**

Use `DailyItemRepository` for reads and transactional replacement/upsert.
Invoke the compatibility writer only after commit.

- [ ] **Step 4: Implement collection commands**

Keep collection preview behavior but represent commits and GitLog with project
IDs. On apply, persist through `CollectionRepository` and export compatibility
files.

- [ ] **Step 5: Make WorkLogManager a compatibility adapter**

SQLite-backed commands become the runtime path. `WorkLogManager` remains only
for transition serialization and is not injected into new feature commands.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm run typecheck
npm run lint
npm test
```

Expected: all tests pass.

```bash
git add -A
git commit -m "refactor persist daily collection data in SQLite"
```

### Task 7: Add Project Assignment and Project-Centric History

**Files:**
- Create: `src/projects/types/project.ts`
- Create: `src/projects/commands/listProjects.ts`
- Create: `src/projects/commands/getProjectHistory.ts`
- Create: `src/projects/commands/updateProject.ts`
- Create: `src/projects/commands/openProject.ts`
- Move: `src/utils/repoRegistry.ts` to `src/projects/utils/legacyRepoRegistry.ts`
- Move: `src/panels/handlers/repoHandler.ts` to `src/projects/commands/projectMessages.ts`
- Create: `web/src/daily/types/dailyItem.ts`
- Create: `web/src/daily/hooks/useDailyItems.ts`
- Create: `web/src/daily/views/ProjectAssignmentSelect.tsx`
- Create: `web/src/projects/pages/ProjectListPage.tsx`
- Create: `web/src/projects/pages/ProjectDetailPage.tsx`
- Create: `web/src/projects/hooks/useProjects.ts`
- Test: `test/projectHistory.test.ts`

- [ ] **Step 1: Add project history tests**

```ts
test('project history combines collected facts and explicitly assigned daily items', async () => {
  const history = await buildProjectHistoryFixture();
  assert.deepStrictEqual(history.days[0], {
    date: '2026-07-26',
    commits: [{ sha: 'abc1234', subject: 'change' }],
    gitlog: ['project gitlog'],
    completed: ['manual project item'],
    ailog: ['AI project item'],
    todos: ['next task'],
    blockers: [],
    notes: [],
    aiSessions: [],
  });
});
```

- [ ] **Step 2: Implement Host project commands**

Query explicit relations from repositories. Clone filtering applies only to Git
facts. Remove `gitlogLines` from the old `RepoActivity` transport.

- [ ] **Step 3: Implement daily project selection**

Represent each editable row as `DailyItem`. Require
`assignment='project' + projectId` or `assignment='unassigned'`. Render a visible
“未归属” label for migrated items.

- [ ] **Step 4: Implement project pages**

Project detail groups a unified project history by date and renders collected
facts, daily items, and AI evidence sections.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm run typecheck
npm run lint
npm test
npm run compile
```

Expected: all checks pass.

```bash
git add -A
git commit -m "feat link daily work to projects"
```

### Task 8: Add Codex, Cursor, and Qoder Conversation Collectors

**Files:**
- Create: `src/collection/types/aiConversation.ts`
- Create: `src/collection/commands/collectAiConversations.ts`
- Create: `src/collection/utils/codexConversationCollector.ts`
- Create: `src/collection/utils/cursorConversationCollector.ts`
- Create: `src/collection/utils/qoderConversationCollector.ts`
- Create: `src/collection/utils/conversationProjectMatcher.ts`
- Create: `scripts/collect-ai-conversations.mjs`
- Create: `test/aiCollectors.test.ts`
- Create: `test/fixtures/ai/codex-session.jsonl`
- Create: `test/fixtures/ai/cursor-schema.sql`
- Create: `test/fixtures/ai/qoder-state.json`
- Modify: `src/panels/ChatViewProvider.ts`
- Modify: `web/src/daily/pages/DailyPage.tsx`

- [ ] **Step 1: Add collector fixture tests**

```ts
test('collectors normalize complete sessions and messages', async () => {
  const collected = await collectProviderFixtures();
  assert.deepStrictEqual(collected.map((item) => item.provider), [
    'codex',
    'cursor',
    'qoder',
  ]);
  assert.ok(collected.every((item) => item.messages.length > 0));
});

test('collector diagnostics never include message content', async () => {
  const result = await collectMalformedFixture('PRIVATE MESSAGE');
  assert.ok(!result.diagnostics.join('\n').includes('PRIVATE MESSAGE'));
});
```

- [ ] **Step 2: Implement shared collector contract**

```ts
export interface AiConversationCollector {
  readonly provider: 'codex' | 'cursor' | 'qoder';
  discover(): Promise<ConversationSource[]>;
  collect(source: ConversationSource): Promise<CollectedConversation>;
}
```

- [ ] **Step 3: Implement Codex adapter**

Discover session and archived JSONL, parse supported event shapes, preserve full
user/assistant message content, and extract cwd/session metadata.

- [ ] **Step 4: Implement Cursor adapter**

Discover global/workspace `state.vscdb` and `conversation-search.db`, inspect
available tables, query supported schemas read-only, and skip unknown schemas
with a provider diagnostic.

- [ ] **Step 5: Implement Qoder adapter**

Discover `~/.qoder` and Application Support sources, detect VS Code-style
databases or JSON/JSONL state, and normalize supported schemas.

- [ ] **Step 6: Implement orchestration and project matching**

Match normalized cwd to known clone roots. Store unmatched sessions with null
project. Upsert sessions/messages transactionally and report per-provider counts.

- [ ] **Step 7: Add command/script entry**

The VS Code command and Node script invoke the same orchestration command. The
script accepts `--storage-path` and optional `--provider`.

- [ ] **Step 8: Verify and commit**

Run:

```bash
npm run typecheck
npm run lint
npm test
node scripts/collect-ai-conversations.mjs --help
```

Expected: all checks pass; help exits zero without reading conversation files.

```bash
git add -A
git commit -m "feat collect AI conversation evidence"
```

### Task 9: Add Typed Module Messaging

**Files:**
- Create: `src/app/types/webviewProtocol.ts`
- Create: `src/app/commands/messageDispatcher.ts`
- Create: `web/src/app/types/webviewProtocol.ts`
- Create: `web/src/app/hooks/useHostMessage.ts`
- Create: `web/src/shared/utils/hostClient.ts`
- Modify: `src/panels/ChatViewProvider.ts`
- Modify: `web/src/App.tsx`
- Test: `test/messageDispatcher.test.ts`

- [ ] **Step 1: Add dispatcher tests**

```ts
test('typed dispatcher rejects unknown commands', async () => {
  const dispatcher = createTestDispatcher();
  await assert.rejects(() => dispatcher.dispatch({ command: 'unknown' }));
});

test('typed dispatcher validates required date fields', async () => {
  const dispatcher = createTestDispatcher();
  await assert.rejects(() => dispatcher.dispatch({ command: 'daily/load' }));
});
```

- [ ] **Step 2: Create discriminated protocol unions**

Define feature request/response unions and compose them into
`HostRequest`/`HostResponse`. Re-export the same source into the Webview through
the existing Vite alias.

- [ ] **Step 3: Implement dispatcher and client**

Register module handlers in `src/app/commands/messageDispatcher.ts`. Implement a
typed `post()` client and one central response subscription for hooks.

- [ ] **Step 4: Reduce ChatViewProvider**

Keep Webview construction, dependency composition, typed dispatch, Output
Channel, and lifecycle only.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm run typecheck
npm run lint
npm test
```

Expected: all checks pass.

```bash
git add -A
git commit -m "refactor type Webview messaging"
```

### Task 10: Complete Host Module-First Structure

**Files:**
- Move: `src/panels/handlers/settingsHandler.ts` to `src/settings/commands/settingsMessages.ts`
- Move: `src/panels/handlers/previewHandler.ts` to `src/preview/commands/previewMessages.ts`
- Move: `src/panels/handlers/dailyLogHandler.ts` to `src/daily/commands/dailyMessages.ts`
- Move: `src/panels/handlers/repoHandler.ts` to `src/projects/commands/projectMessages.ts`
- Split: `src/panels/handlers/timesheetHandler.ts` into `src/summary/commands/generateTimesheet.ts`, `src/summary/commands/generateAiSummary.ts`, and `src/materials/commands/materialMessages.ts`
- Move: `src/panels/handlers/types.ts` to `src/app/types/hostDependencies.ts`
- Split: `src/panels/handlers/panelUtils.ts` into `src/settings/utils/pathUtils.ts` and `src/projects/utils/repositoryOptions.ts`
- Move: `src/panels/webviewConfigBuilder.ts` to `src/app/commands/buildWebviewConfig.ts`
- Move: `src/services/timesheetRunner.ts` to `src/summary/utils/timesheetRunner.ts`
- Move: `src/lib/aiReportGenerator.ts` to `src/summary/utils/aiReportGenerator.ts`
- Move: `src/services/openAiCompatibleClient.ts` to `src/collection/utils/openAiCompatibleClient.ts`
- Move: `src/utils/types/*` to the owning module `types` directories
- Move: cross-module pure utilities to `src/shared/utils`
- Create: module `index.ts` public exports
- Modify: all imports

- [ ] **Step 1: Record the expected top-level structure**

Add a test that lists TypeScript source top-level directories and rejects legacy
business directories:

```ts
test('Host uses module-first source structure', () => {
  const forbidden = ['panels/handlers', 'services', 'features/settings'];
  for (const relative of forbidden) {
    assert.strictEqual(fs.existsSync(path.join(repoRoot, 'src', relative)), false);
  }
});
```

- [ ] **Step 2: Move one feature at a time**

Use `git mv`, update imports, and run `npm run typecheck` after each module:

1. settings;
2. preview;
3. summary;
4. materials;
5. projects;
6. daily;
7. collection;
8. app/shared.

- [ ] **Step 3: Verify file responsibility**

No business source file should exceed 500 lines. Split mixed files into command,
view, hook, or utility units without changing behavior.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm run typecheck
npm run lint
npm test
npm run compile
```

Expected: all checks pass.

```bash
git add -A
git commit -m "refactor organize Host by feature"
```

### Task 11: Complete Webview Module-First Structure

**Files:**
- Replace: `web/src/App.tsx`
- Move: existing pages/components into matching modules
- Create: `web/src/app/layout/AppLayout.tsx`
- Create: `web/src/app/hooks/useAppNavigation.ts`
- Create: `web/src/daily/pages/DailyPage.tsx`
- Create: `web/src/summary/pages/SummaryPage.tsx`
- Create: `web/src/materials/pages/MaterialsPage.tsx`
- Create: `web/src/collection/pages/CollectionProgressPage.tsx`
- Create: `web/src/collection/pages/FillReviewPage.tsx`
- Create: `web/src/settings/pages/SystemSettingsPage.tsx`
- Create: `web/src/settings/pages/ProfileSettingsPage.tsx`
- Move: shared UI into `web/src/shared/views`
- Modify: `web/src/main.tsx`

- [ ] **Step 1: Add App composition test**

```ts
test('App is a composition root', () => {
  const app = fs.readFileSync(path.join(repoRoot, 'web/src/App.tsx'), 'utf-8');
  assert.ok(app.split(/\r?\n/).length < 200);
  assert.ok(!app.includes("case '"));
});
```

- [ ] **Step 2: Extract hooks**

Move message subscriptions and workflow state into feature hooks. Each page
receives typed view state and callbacks.

- [ ] **Step 3: Extract pages and layout**

Move the three tabs and all overlays into their feature modules. AppLayout owns
navigation slots, not feature state.

- [ ] **Step 4: Remove duplicate types**

Import Host-shared protocol/domain types via the Vite alias. Keep Webview-only
view state types in module `types`.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm run typecheck
npm run lint
npm test
npm run compile
```

Expected: App is below 200 lines and all checks pass.

```bash
git add -A
git commit -m "refactor organize Webview by feature"
```

### Task 12: Update Documentation and Perform Full Verification

**Files:**
- Modify: `README.md`
- Modify: `DEVELOPMENT.md`
- Modify: `docs/current-page-functionality.md`
- Create: `docs/sqlite-storage-and-migration.md`

- [ ] **Step 1: Document storage and migration**

Document:

- database and compatibility paths;
- automatic migration and idempotency;
- transition dual-write behavior;
- backup/recovery procedure;
- AI conversation storage and privacy;
- collector command/script;
- explicit project/unassigned assignment.

- [ ] **Step 2: Update current functionality**

Remove deleted flows and describe project-centric daily histories, AI evidence,
and the new module paths.

- [ ] **Step 3: Run full verification**

Run:

```bash
source /Users/acongm/.nvm/nvm.sh
nvm use 20
npm run typecheck
npm run lint
npm test
npm run compile
npm run package
git diff --check
git status --short --branch
```

Expected:

- typecheck exits zero;
- lint has zero warnings;
- all tests run and pass;
- extension and Webview builds pass;
- VSIX packaging passes;
- no whitespace errors;
- only intentional source/document changes remain.

- [ ] **Step 4: Review requirements**

Confirm every success criterion in
`docs/superpowers/specs/2026-07-26-sqlite-modular-refactor-design.md` against the
final diff and test evidence.

- [ ] **Step 5: Commit**

```bash
git add README.md DEVELOPMENT.md docs
git commit -m "docs explain SQLite project data"
```
