# SQLite Source Data and Modular Refactor Design

## 1. Goal

Refactor the extension into matching module-first structures under `src/` and
`web/src/`, make SQLite the source of truth for collected and manually recorded
work data, unify runtime files under `dailyWorkLog.storagePath`, and remove
unreachable or superseded functionality.

The resulting project must:

- preserve the current daily, collection, summary, materials, settings, preview,
  and project workflows unless this specification explicitly removes or changes
  them;
- show each project's collected and manually recorded work as one date-grouped
  project history;
- store complete Codex, Cursor, and Qoder conversations as traceable AI evidence;
- migrate existing JSON, TSV, and registry data automatically without deleting
  it;
- dual-write compatibility files for one transition version while reading from
  SQLite;
- remain buildable and testable after each migration phase.

## 2. Scope

### 2.1 Remove

- XLSX import UI, handlers, messages, state, and parsing code.
- The unused single-month file list flow (`listMonthFiles` / `monthFiles`).
- The unreachable single-timesheet email flow and its `sendEmail` message.
- Repository-level `gitlogLines` inference and transport.
- The legacy standalone daily and monthly Webviews in
  `src/commands/commands.ts`.
- The legacy commands that only open those standalone Webviews.
- The plugin setting `outputDir` and all fallback rules that choose between
  `outputDir` and `storagePath`.
- Superseded registry-as-source behavior once SQLite repositories are active.

### 2.2 Keep

- Daily log editing and automatic/manual save.
- Git collection, collection cache, confirmation, and AI polish workflows.
- Monthly summary, AI monthly generation, and timesheet generation.
- Materials listing, opening, confirmed deletion, and selected-attachment email.
- SMTP settings and email password because materials email remains supported.
- Daily GitLog display and GitLog as a timesheet content option.
- Daily and monthly Markdown preview panels.
- Repository open, pin, hide, clone selection, commit history, and project detail.

### 2.3 Add

- SQLite source database under the configured storage root.
- Automatic, idempotent legacy migration.
- Temporary compatibility dual-write.
- Project assignment for manually recorded daily items.
- Complete Codex, Cursor, and Qoder conversation collection.
- Typed Webview request/response protocol.
- Module-first Host and Webview structures.

## 3. Directory Architecture

The extension Host and React Webview remain separate builds. Both use the same
top-level feature modules.

```text
src/
├── app/
├── daily/
├── collection/
├── summary/
├── materials/
├── projects/
├── settings/
├── preview/
├── database/
└── shared/

web/src/
├── app/
├── daily/
├── collection/
├── summary/
├── materials/
├── projects/
├── settings/
├── preview/
└── shared/
```

Each module creates only the responsibility directories it uses:

```text
{module}/
├── pages/
├── commands/
├── views/
├── utils/
├── layout/
├── hooks/
└── types/
```

Responsibilities:

- `pages`: complete React pages.
- `commands`: user operations, message handlers, and application use cases.
- `views`: reusable React views or VS Code View/Panel adapters.
- `utils`: pure module-local functions.
- `layout`: page composition and layout components.
- `hooks`: Webview state and interaction workflows.
- `types`: module contracts and internal types.

Dependency rules:

- A module may import another module only through its explicit public types or
  command API.
- The Webview never imports database or filesystem code.
- `src/app` composes dependencies and dispatches typed messages but contains no
  business rules.
- `web/src/app` initializes the Webview and composes pages but contains no
  feature workflow implementation.
- Cross-module primitives live in `shared`; feature-specific helpers do not.

## 4. Storage Layout

`dailyWorkLog.storagePath` is the only runtime data root.

```text
<storagePath>/
├── work-log.sqlite
├── YYYY-MM/
│   ├── YYYY-MM-DD.json        transition compatibility output
│   ├── _commits.tsv           transition compatibility output
│   ├── generated materials
│   └── preview/report files
├── .runtime/
│   ├── collection configs
│   └── temporary files
└── .migration/
    └── optional migration diagnostics
```

`outputDir` is removed from types, defaults, settings UI, services, and path
resolution. Generated evidence, the project database, timesheets, materials,
runtime configuration, and compatibility files all resolve from the storage
root.

Settings remain split by responsibility:

- VS Code configuration: storage path, autosave, preview enablement.
- Plugin global state: non-secret business settings.
- VS Code Secret Storage: API key and email password.

All reading and normalization move behind the `settings` module so consumers do
not access those stores directly.

## 5. SQLite Adapter

The initial implementation uses a SQLite WASM driver behind a small database
interface. This avoids coupling the extension to a specific VS Code/Electron
native-module ABI on the current macOS target.

The adapter:

- loads `<storagePath>/work-log.sqlite` once;
- serializes write transactions;
- enforces foreign keys;
- writes a temporary database image and atomically renames it after a successful
  transaction;
- keeps repository classes independent of the chosen SQLite driver;
- exposes transaction, execute, query-one, and query-all operations;
- closes and flushes during extension deactivation.

The interface permits replacing the WASM adapter with a native driver for a
future cross-platform release without changing feature modules.

## 6. Database Schema

### 6.1 Migration metadata

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE legacy_imports (
  source_path TEXT PRIMARY KEY,
  source_size INTEGER NOT NULL,
  source_mtime_ms INTEGER NOT NULL,
  source_hash TEXT NOT NULL,
  imported_at TEXT NOT NULL
);
```

`legacy_imports` makes file migration idempotent and allows a changed legacy file
to be imported again safely through record-level unique constraints.

### 6.2 Projects and collected Git facts

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  origin_url TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE project_clones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repo_root TEXT NOT NULL UNIQUE,
  clone_label TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_scanned_at TEXT,
  last_commit_at TEXT
);

CREATE TABLE collection_runs (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  anchor_date TEXT NOT NULL,
  range_start TEXT,
  range_end TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT
);

CREATE TABLE commits (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  clone_id TEXT NOT NULL REFERENCES project_clones(id),
  sha TEXT NOT NULL,
  subject TEXT NOT NULL,
  author TEXT,
  committed_at TEXT NOT NULL,
  collection_run_id TEXT REFERENCES collection_runs(id),
  UNIQUE(clone_id, sha)
);

CREATE TABLE gitlog_entries (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  clone_id TEXT REFERENCES project_clones(id),
  content TEXT NOT NULL,
  collection_run_id TEXT REFERENCES collection_runs(id)
);

CREATE TABLE gitlog_entry_commits (
  gitlog_entry_id TEXT NOT NULL REFERENCES gitlog_entries(id) ON DELETE CASCADE,
  commit_id TEXT NOT NULL REFERENCES commits(id) ON DELETE CASCADE,
  PRIMARY KEY (gitlog_entry_id, commit_id)
);
```

Commit rows are source facts. GitLog rows preserve the collected, human-readable
text while retaining traceability to commits.

### 6.3 Manually recorded and AI-derived daily items

```sql
CREATE TABLE daily_items (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (
    kind IN ('completed', 'ailog', 'todo', 'blocker', 'note')
  ),
  content TEXT NOT NULL,
  assignment TEXT NOT NULL CHECK (
    assignment IN ('project', 'unassigned')
  ),
  project_id TEXT REFERENCES projects(id),
  source TEXT NOT NULL CHECK (
    source IN ('manual', 'ai', 'migration')
  ),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (assignment = 'project' AND project_id IS NOT NULL) OR
    (assignment = 'unassigned' AND project_id IS NULL)
  )
);
```

Rules:

- New manual items require the user to choose a collected project or explicitly
  choose “未归属”.
- “未归属” is an explicit assignment, not a failed inference state.
- Legacy manual items without a reliable project link migrate as
  `unassigned/migration`.
- AI-derived AILog uses `source=ai` and preserves evidence links.

### 6.4 AI conversation evidence

```sql
CREATE TABLE ai_sessions (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (
    provider IN ('codex', 'cursor', 'qoder')
  ),
  external_session_id TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id),
  clone_id TEXT REFERENCES project_clones(id),
  cwd TEXT,
  title TEXT,
  started_at TEXT,
  updated_at TEXT,
  source_path TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  UNIQUE(provider, external_session_id)
);

CREATE TABLE ai_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
  external_message_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT,
  sequence INTEGER NOT NULL,
  UNIQUE(session_id, sequence)
);

CREATE TABLE daily_ai_evidence (
  daily_item_id TEXT NOT NULL REFERENCES daily_items(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES ai_messages(id) ON DELETE CASCADE,
  PRIMARY KEY (daily_item_id, session_id, message_id)
);
```

Complete conversation content is stored locally. Provider source paths and
content are never written to the Output Channel.

## 7. Project Detail Semantics

“个人中心 → 我的仓库 → 仓库详情” is a project-centric history.

For one project and date it combines:

1. collected Git facts:
   - commits;
   - collected GitLog entries;
2. manually recorded or AI-derived items:
   - completed;
   - AILog;
   - todo;
   - blockers;
   - notes;
3. linked AI conversation evidence.

The query uses explicit `project_id` relations. It never assigns all items from a
day to a project merely because that project had a commit that day.

The project detail page groups results by date and allows clone filtering only
for collected Git facts. Manual project items remain associated with the project
as a whole unless explicitly linked to a clone in a future schema migration.

## 8. Manual Entry UX

Daily entry editors add a project selector:

- collected, visible projects appear first;
- the user must select a project or “未归属” before adding an item;
- editing an item can change its project assignment;
- existing migrated unassigned items remain visibly labeled;
- notes and todos follow the same assignment rule as completed and AILog.

The Daily page works with typed `DailyItem` objects instead of string arrays.
Compatibility JSON serialization groups item content back into the legacy field
arrays during the transition version.

## 9. AI Conversation Collectors

Collectors implement a shared adapter:

```ts
interface AiConversationCollector {
  provider: 'codex' | 'cursor' | 'qoder';
  discover(): Promise<ConversationSource[]>;
  collect(source: ConversationSource): Promise<CollectedConversation>;
}
```

### 9.1 Codex

- Discover active sessions under `~/.codex/sessions/**/rollout-*.jsonl`.
- Discover archived sessions under `~/.codex/archived_sessions/*.jsonl`.
- Parse JSONL defensively by event type.
- Use session metadata and working directory to match a collected clone.

### 9.2 Cursor

- Discover global and workspace databases under
  `~/Library/Application Support/Cursor/User/`.
- Read source databases in read-only mode.
- Prefer stable conversation tables when available.
- Treat unknown schema versions as a skipped source with a diagnostic, not as
  an empty successful import.

### 9.3 Qoder

- Discover data under `~/.qoder` and
  `~/Library/Application Support/Qoder`.
- Support VS Code-style workspace/global state databases and provider-specific
  JSON/JSONL sources through a schema-detection adapter.
- Treat unavailable or unknown sources as a provider-specific warning while
  allowing other collectors to finish.

### 9.4 Incremental behavior

- Source hashes and external IDs make collection idempotent.
- Re-running updates changed sessions and inserts new messages without
  duplicating existing rows.
- Project matching uses normalized `cwd` against known clone roots.
- An unmatched conversation is stored without a project and remains available
  for later manual assignment.

The extension adds one AI conversation collection command that runs all enabled
collectors and reports per-provider progress.

## 10. Legacy Migration

Migration runs after database schema migration and before the Webview receives
its first data.

Inputs:

- `YYYY-MM/YYYY-MM-DD.json`;
- `YYYY-MM/_commits.tsv`;
- `.repos/registry.json`;
- existing Git artifact files required to reconstruct project and clone links.

Order:

1. Import projects and clones from registry and commit evidence.
2. Import commits with clone/project relationships.
3. Import GitLog entries where a project can be identified.
4. Import daily manual fields as daily items.
5. Mark ambiguous manual fields as explicit unassigned migration items.
6. Record the source fingerprint in `legacy_imports`.

The migration:

- is transactional per source file;
- never deletes or rewrites legacy inputs;
- reports imported/skipped/error counts;
- can resume after interruption;
- does not infer project ownership from “same date” alone.

## 11. Transition Dual-Write

SQLite is the read source immediately after migration.

During the transition version:

- daily item writes commit to SQLite first;
- collection writes commit to SQLite first;
- after commit, a compatibility writer exports affected daily JSON and monthly
  `_commits.tsv`;
- compatibility write failure produces a visible warning and Output Channel
  diagnostic but does not roll back SQLite;
- generated materials continue to be ordinary files under the storage root.

The compatibility writer is isolated behind an interface so a later release can
remove it without changing feature commands.

## 12. Typed Messaging

Host and Webview share discriminated request and response unions under
module `types` exports.

Examples:

```ts
type DailyRequest =
  | { command: 'daily/load'; date: string }
  | { command: 'daily/saveItems'; date: string; items: DailyItemInput[] };

type ProjectRequest =
  | { command: 'projects/list'; search?: string }
  | { command: 'projects/detail'; projectId: string; cloneId?: string };
```

The app dispatcher rejects unknown commands and validates required primitive
fields before invoking a module command. Feature hooks expose methods rather than
constructing raw message objects in pages.

## 13. Error Handling and Privacy

- Database initialization failure blocks data mutation and shows a recovery
  message with the database path.
- Migration failure preserves legacy files and leaves the failed source
  retryable.
- A collector failure is isolated per provider.
- SQLite writes use transactions and atomic persistence.
- Compatibility export errors are non-fatal but visible.
- Full AI messages remain local and are not logged.
- Secrets remain in VS Code Secret Storage.
- Material deletion retains the existing modal confirmation.

## 14. Testing

### 14.1 Foundation

- Track `.vscode-test.mjs` so a fresh clone discovers tests.
- Add unit-testable pure modules and database repositories.
- Keep `--fail-zero`.

### 14.2 Database

- schema creation and migration ordering;
- foreign key and assignment constraints;
- repository CRUD and project history queries;
- transaction rollback and atomic persistence;
- idempotent legacy migration;
- dual-write compatibility serialization.

### 14.3 Collectors

- provider fixture parsing without accessing personal real messages;
- incremental re-import;
- malformed and unknown schemas;
- cwd-to-project matching;
- no message content in diagnostics.

### 14.4 Host modules

- typed dispatch;
- storage root resolution;
- project detail semantics;
- daily item assignment validation;
- materials attachment email remains reachable;
- removed commands are no longer dispatched.

### 14.5 Webview

- daily item project selection;
- explicit unassigned flow;
- project history date grouping;
- feature hooks' message contracts;
- removed buttons and unreachable state are absent.

### 14.6 Verification

- TypeScript typecheck;
- ESLint with zero warnings;
- extension tests with non-zero discovery;
- Webview production build;
- extension production build/package;
- migration smoke test against copied fixtures, never live user data.

## 15. Implementation Sequence

1. Repair fresh-worktree test discovery.
2. Remove explicitly deleted flows and dependencies.
3. Unify storage root and settings access.
4. Introduce typed shared contracts.
5. Add database adapter, schema, repositories, and tests.
6. Add automatic legacy migration.
7. Move daily and collection reads/writes to SQLite with compatibility dual-write.
8. Add project-centric query and manual project assignment.
9. Add Codex, Cursor, and Qoder collectors.
10. Split Host code into module-first directories.
11. Split Webview code into matching module-first directories.
12. Update documentation and run full verification.

Each step must leave the project compilable and should commit independently.

## 16. Success Criteria

- A fresh checkout runs tests without an untracked local config.
- No XLSX import, single-month file list, legacy standalone Webview, or
  unreachable single-timesheet email code remains.
- `outputDir` is absent from runtime types, UI, and path decisions.
- SQLite is the source for daily items, projects, clones, commits, GitLog
  entries, and AI conversations.
- Existing files migrate automatically and remain untouched.
- Compatibility files are dual-written after SQLite commits.
- New manual items require project or explicit unassigned selection.
- Project detail shows only explicitly related project data.
- Codex, Cursor, and Qoder collectors are incremental and independently
  fault-tolerant.
- Host and Webview use matching module-first structures.
- `App.tsx` and `ChatViewProvider` act as composition roots rather than business
  logic containers.
- Typecheck, lint, tests, build, and packaging pass.
