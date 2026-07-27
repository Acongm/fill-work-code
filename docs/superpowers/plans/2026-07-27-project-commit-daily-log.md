# Project Commit Daily Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace duplicate GitLog/Commit rendering in project details with date-grouped expandable commits and let users generate project-linked daily JSON entries for selected dates.

**Architecture:** SQLite project history remains the read-only evidence source. A project-domain command converts selected date facts into completed entries, then uses `WorkLogManager.saveUserFields` to update JSON and `projectLinks`; the Webview only coordinates selection and renders the returned JSON-backed history.

**Tech Stack:** TypeScript, React, VS Code Webview messaging, sql.js SQLite, Mocha, ESLint, Vite.

---

## Test Environment

The default test CLI download is unreliable in this environment. Before Task 1,
create the ignored `.vscode-test.local.mjs` with:

```ts
import { defineConfig } from '@vscode/test-cli';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  files: 'out/test/**/*.test.js',
  useInstallation: {
    fromPath: '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
  },
  launchArgs: [
    `--user-data-dir=${join(tmpdir(), 'daily-work-log-vscode-test-project-log')}`,
  ],
  env: {
    DAILY_WORK_LOG_TEST_STORAGE: join(
      tmpdir(),
      `daily-work-log-extension-test-project-log-${process.pid}`,
    ),
  },
});
```

This file is a local test fixture only. Delete it before the final status check.

## File Map

- Create `src/projects/utils/buildProjectDailyEntries.ts`: pure GitLog/Commit-to-daily-entry mapping and date validation.
- Create `src/projects/commands/generateProjectDailyLogs.ts`: selected-date orchestration and JSON writes.
- Create `src/shared/utils/projectDateSelection.ts`: pure selection reconciliation shared with Webview tests.
- Modify `src/app/views/ChatViewProvider.ts`: route the new Webview command.
- Create `web/src/projects/types/projectHistory.ts`: project-detail message and history types.
- Create `web/src/projects/views/ProjectCommitDay.tsx`: one date’s checkbox, accordion, commits, and generated/manual log items.
- Modify `web/src/projects/pages/ProjectDetailPage.tsx`: selection/generation page orchestration.
- Modify `web/src/app/layout/index.css`: scoped project detail controls and accordion styling.
- Create `test/projectDailyLogs.test.ts`: pure mapping, multi-date JSON writes, dedupe, and failure tests.
- Modify `docs/current-page-functionality.md`: describe the new project detail workflow.

### Task 1: Define daily-entry generation rules

**Files:**
- Create: `src/projects/utils/buildProjectDailyEntries.ts`
- Create: `src/shared/utils/projectDateSelection.ts`
- Create: `test/projectDailyLogs.test.ts`

- [ ] **Step 1: Write failing pure-function tests**

Add tests that express the approved precedence, fallback, and selection behavior:

```ts
test('uses deduplicated structured GitLog before commit subjects', () => {
  assert.deepStrictEqual(
    buildProjectDailyEntries({
      gitlog: [
        { id: 'g1', cloneId: 'c1', content: '完成仓库详情调整' },
        { id: 'g2', cloneId: 'c1', content: ' 完成仓库详情调整 ' },
      ],
      commits: [
        {
          id: 'c1',
          cloneId: 'clone-a',
          sha: 'abcdef',
          subject: 'raw commit',
          author: null,
          committedAt: '2026-07-27T10:00:00.000Z',
        },
      ],
    }),
    ['完成仓库详情调整'],
  );
});

test('falls back to deduplicated commit subjects without GitLog', () => {
  assert.deepStrictEqual(
    buildProjectDailyEntries({
      gitlog: [],
      commits: [
        commit('a', '修复日报闪烁'),
        commit('b', ' 修复日报闪烁 '),
      ],
    }),
    ['修复日报闪烁'],
  );
});

test('keeps failed selected dates and removes successful dates', () => {
  assert.deepStrictEqual(
    remainingSelectedDates(
      ['2026-07-25', '2026-07-26', '2026-07-27'],
      ['2026-07-25', '2026-07-27'],
    ),
    ['2026-07-26'],
  );
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
export PATH=/Users/acongm/.nvm/versions/node/v22.15.0/bin:$PATH
npm run compile-tests
```

Expected: TypeScript fails because `buildProjectDailyEntries` and
`remainingSelectedDates` do not exist.

- [ ] **Step 3: Implement minimal pure functions**

Create:

```ts
import type { ProjectHistoryDay } from '../../database/commands/projectRepository';

function uniqueContent(values: string[]): string[] {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      return [];
    }
    seen.add(normalized);
    return [normalized];
  });
}

export function buildProjectDailyEntries(
  day: Pick<ProjectHistoryDay, 'gitlog' | 'commits'>,
): string[] {
  const gitlog = uniqueContent(day.gitlog.map((entry) => entry.content));
  return gitlog.length > 0
    ? gitlog
    : uniqueContent(day.commits.map((commit) => commit.subject));
}

export function isDailyLogDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
```

Create:

```ts
export function remainingSelectedDates(
  selectedDates: string[],
  generatedDates: string[],
): string[] {
  const generated = new Set(generatedDates);
  return selectedDates.filter((date) => !generated.has(date));
}
```

- [ ] **Step 4: Compile and run the focused tests**

Run:

```bash
npm run compile-tests
npx vscode-test --config .vscode-test.local.mjs --grep "Project daily logs" --fail-zero
```

Expected: all focused pure-function tests pass.

- [ ] **Step 5: Commit the pure domain rules**

```bash
git add src/projects/utils/buildProjectDailyEntries.ts \
  src/shared/utils/projectDateSelection.ts test/projectDailyLogs.test.ts
git commit -m "feat generate project daily entries"
```

### Task 2: Generate project-linked JSON logs per selected date

**Files:**
- Create: `src/projects/commands/generateProjectDailyLogs.ts`
- Modify: `test/projectDailyLogs.test.ts`

- [ ] **Step 1: Write failing command tests**

Set up a temporary SQLite database, project, clone, two days of Commit/GitLog
facts, and a temporary `WorkLogManager`. Assert:

```ts
const result = await generateProjectDailyLogs(
  database,
  manager,
  'https://example.com/a.git',
  ['2026-07-26', '2026-07-27'],
);

assert.deepStrictEqual(result.generatedDates, [
  '2026-07-26',
  '2026-07-27',
]);
assert.deepStrictEqual(
  loadDailyLog(manager, '2026-07-26').completed,
  ['完成第一天功能'],
);
assert.deepStrictEqual(
  loadDailyLog(manager, '2026-07-26').projectLinks,
  [{
    field: 'completed',
    content: '完成第一天功能',
    assignment: 'project',
    projectOriginUrl: 'https://example.com/a.git',
  }],
);
```

Add a second test that runs the command twice and verifies `completed` and
`projectLinks` are not duplicated. Add invalid/no-Commit dates and verify they
appear in `failures` while valid dates are still written.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm run compile-tests
```

Expected: compilation fails because `generateProjectDailyLogs` is missing.

- [ ] **Step 3: Implement selected-date orchestration**

Create a result contract and implementation:

```ts
export interface GenerateProjectDailyLogsResult {
  generatedDates: string[];
  failures: Array<{ date: string; message: string }>;
}

export async function generateProjectDailyLogs(
  database: Database,
  workLogManager: WorkLogManager,
  originUrl: string,
  requestedDates: string[],
): Promise<GenerateProjectDailyLogsResult> {
  const projectRepository = new ProjectRepository(database);
  const project = projectRepository.getByOrigin(originUrl);
  if (!project) {
    throw new Error('项目不存在');
  }

  const history = await projectRepository.getHistory(project.id);
  const days = new Map(history.days.map((day) => [day.date, day]));
  const generatedDates: string[] = [];
  const failures: Array<{ date: string; message: string }> = [];

  for (const date of [...new Set(requestedDates)]) {
    const day = days.get(date);
    if (!isDailyLogDate(date)) {
      failures.push({ date, message: '日期格式无效' });
      continue;
    }
    if (!day || day.commits.length === 0) {
      failures.push({ date, message: '该日期没有可用 Commit' });
      continue;
    }

    try {
      const entries = buildProjectDailyEntries(day);
      const current = loadDailyLog(workLogManager, date);
      const completed = appendUniqueCompleted(current.completed, entries);
      let projectLinks = current.projectLinks || [];
      for (const content of entries) {
        projectLinks = setProjectLink(
          projectLinks,
          'completed',
          content,
          originUrl,
        );
      }
      await workLogManager.saveUserFields(date, {
        ...current,
        completed,
        projectLinks,
      });
      generatedDates.push(date);
    } catch (error) {
      failures.push({
        date,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { generatedDates, failures };
}
```

Add `handleGenerateProjectDailyLogs` in the same file. It calls the pure
orchestrator, writes per-date failures to `deps.outputChannel`, and posts:

```ts
deps.postToWebview({
  command: 'projectDailyLogsGenerated',
  originUrl,
  ...result,
});
```

If project lookup fails, post the same response with an empty
`generatedDates` array and one failure entry instead of leaving the Webview in
a loading state.

- [ ] **Step 4: Run focused and project-history tests**

Run:

```bash
npm run compile-tests
npx vscode-test --config .vscode-test.local.mjs \
  --grep "Project daily logs|Project history" --fail-zero
```

Expected: focused tests pass, duplicate execution leaves one JSON entry, and
project history continues to merge the project-linked JSON entry.

- [ ] **Step 5: Commit JSON generation**

```bash
git add src/projects/commands/generateProjectDailyLogs.ts \
  test/projectDailyLogs.test.ts
git commit -m "feat write selected project dates to JSON"
```

### Task 3: Route generation through the extension host

**Files:**
- Modify: `src/app/views/ChatViewProvider.ts`
- Modify: `test/extension.test.ts`

- [ ] **Step 1: Add a failing routing characterization**

Add a source-level test following the existing removed-command checks:

```ts
test('routes project daily log generation through the host', () => {
  const projectRoot = path.resolve(__dirname, '../..');
  const provider = fs.readFileSync(
    path.join(projectRoot, 'src/app/views/ChatViewProvider.ts'),
    'utf8',
  );
  assert.match(provider, /case 'generateProjectDailyLogs'/);
  assert.match(provider, /handleGenerateProjectDailyLogs/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run compile-tests
npx vscode-test --config .vscode-test.local.mjs \
  --grep "routes project daily log generation" --fail-zero
```

Expected: FAIL because the route is absent.

- [ ] **Step 3: Add the host command route**

Import `handleGenerateProjectDailyLogs` and add:

```ts
case 'generateProjectDailyLogs':
  await handleGenerateProjectDailyLogs(
    deps,
    String(data.originUrl || ''),
    Array.isArray(data.dates)
      ? data.dates.filter((date: unknown): date is string =>
          typeof date === 'string')
      : [],
  );
  break;
```

- [ ] **Step 4: Run the route and extension tests**

Run:

```bash
npm run compile-tests
npx vscode-test --config .vscode-test.local.mjs \
  --grep "routes project daily log generation|Extension Test Suite" \
  --fail-zero
```

Expected: route test and existing extension tests pass.

- [ ] **Step 5: Commit host routing**

```bash
git add src/app/views/ChatViewProvider.ts test/extension.test.ts
git commit -m "feat route project daily log generation"
```

### Task 4: Replace duplicate project activity UI

**Files:**
- Create: `web/src/projects/types/projectHistory.ts`
- Create: `web/src/projects/views/ProjectCommitDay.tsx`
- Modify: `web/src/projects/pages/ProjectDetailPage.tsx`
- Modify: `web/src/app/layout/index.css`

- [ ] **Step 1: Extract project history types**

Move the local `ProjectHistory` declaration into
`web/src/projects/types/projectHistory.ts`, including:

```ts
export interface ProjectHistoryDay {
  date: string;
  commits: ProjectHistoryCommit[];
  gitlog: Array<{ id: string; content: string }>;
  items: ProjectHistoryItem[];
}

export interface ProjectDailyLogsGeneratedMessage {
  command: 'projectDailyLogsGenerated';
  originUrl: string;
  generatedDates: string[];
  failures: Array<{ date: string; message: string }>;
}
```

- [ ] **Step 2: Create the date-group view**

Implement `ProjectCommitDay` with controlled props:

```ts
interface ProjectCommitDayProps {
  day: ProjectHistoryDay;
  selected: boolean;
  expanded: boolean;
  disabled: boolean;
  onSelectedChange: (date: string, selected: boolean) => void;
  onExpandedChange: (date: string, expanded: boolean) => void;
}
```

Render a checkbox only for days containing Commit facts. The header shows
`YYYY-MM-DD · N commits`; a button toggles the Commit list. Expanded rows show
short SHA, subject, and local time. Render `day.items` below a “工作日志” label,
but do not render `day.gitlog`.

- [ ] **Step 3: Rewrite page orchestration around dates**

In `ProjectDetailPage.tsx`:

```ts
const [selectedDates, setSelectedDates] = useState<string[]>([]);
const [expandedDates, setExpandedDates] = useState<string[]>([]);
const [generating, setGenerating] = useState(false);
const [generationFailures, setGenerationFailures] = useState<
  Array<{ date: string; message: string }>
>([]);
```

On `projectDailyLogsGenerated` for the current `originUrl`:

```ts
setSelectedDates((current) =>
  remainingSelectedDates(current, data.generatedDates || []),
);
setGenerationFailures(data.failures || []);
setGenerating(false);
vscode.postMessage({
  command: 'getRepoDetail',
  originUrl: group.originUrl,
  cloneId: activeTag === 'all' ? undefined : activeTag,
});
```

Add a toolbar button:

```tsx
<button
  type="button"
  className="btn"
  disabled={generating || selectedDates.length === 0}
  onClick={() => {
    setGenerating(true);
    setGenerationFailures([]);
    vscode.postMessage({
      command: 'generateProjectDailyLogs',
      originUrl: group.originUrl,
      dates: selectedDates,
    });
  }}
>
  {generating
    ? '生成中…'
    : `生成单日工作日志 (${selectedDates.length})`}
</button>
```

Remove the flattened `commits`, global `showCommits`, the GitLog rows, and the
second Commit section.

- [ ] **Step 4: Add scoped styles**

Add styles for `.repo-activity-toolbar`, `.repo-day-heading`,
`.repo-day-select`, `.repo-day-toggle`, `.repo-day-commits`,
`.repo-day-log-items`, and `.repo-generation-errors`. Use existing VS Code
theme variables and do not change unrelated page styles.

- [ ] **Step 5: Compile and lint the UI**

Run:

```bash
npm run typecheck
npm run compile
npm run lint
```

Expected: TypeScript, Vite build, and ESLint all exit 0.

- [ ] **Step 6: Commit the project detail UI**

```bash
git add web/src/projects/types/projectHistory.ts \
  web/src/projects/views/ProjectCommitDay.tsx \
  web/src/projects/pages/ProjectDetailPage.tsx \
  web/src/app/layout/index.css
git commit -m "feat group project commits by selectable date"
```

### Task 5: Document, verify, integrate, and release

**Files:**
- Modify: `docs/current-page-functionality.md`

- [ ] **Step 1: Update current functionality documentation**

Document that project detail:

- reads Commit facts from SQLite and groups them by date;
- no longer renders a separate GitLog list;
- can select multiple Commit dates;
- writes generated completed entries and project links to each date JSON;
- reloads JSON-backed project work logs after generation.

- [ ] **Step 2: Run the full verification suite**

Delete `.vscode-test.local.mjs` only after the Extension Host command completes.
Run with Node 22:

```bash
export PATH=/Users/acongm/.nvm/versions/node/v22.15.0/bin:$PATH
npm run typecheck
npm run compile-tests
npm run compile
npm run lint
npx vscode-test --config .vscode-test.local.mjs --fail-zero
git diff --check
```

Expected: every command exits 0 and the Extension Host reports all tests
passing with zero failures.

- [ ] **Step 3: Commit documentation**

```bash
git add docs/current-page-functionality.md
git commit -m "docs describe project commit daily logs"
```

- [ ] **Step 4: Finish the development branch**

Use `finishing-a-development-branch`. The user has already requested local
integration and release, so select local merge into `main`, pull/fetch first,
and rerun the full verification suite on merged `main`.

- [ ] **Step 5: Publish a patch release**

On clean `main`:

```bash
npm run release:patch
code --install-extension \
  artifacts/daily-work-log-0.2.5.vsix --force
git push --atomic origin main v0.2.5
```

Track the tag-triggered `publish-extension.yml` run with `gh run watch
--exit-status` and report the Marketplace publication result.
