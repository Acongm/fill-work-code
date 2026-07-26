# Known Issues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent repository detail loading from crashing for months without stored data and restore a warning-free lint baseline.

**Architecture:** Keep repository activity aggregation tolerant of missing month directories at the filesystem boundary. Preserve all existing aggregation behavior for directories that exist, and cover the missing-directory behavior with an extension regression test.

**Tech Stack:** TypeScript, Node.js filesystem APIs, Mocha through `@vscode/test-cli`, ESLint.

---

### Task 0: Restore test discovery

**Files:**
- Create: `tsconfig.test.json`
- Modify: `package.json`

- [x] **Step 1: Reproduce missing test discovery**

Run: `npm run compile-tests`

Expected: No `out/test/extension.test.js` is generated because `tsconfig.json` excludes `test`.

- [x] **Step 2: Add a dedicated test compiler configuration**

Extend the production TypeScript configuration, set `rootDir` to the repository root, and include both `src/**/*.ts` and `test/**/*.ts`.

- [x] **Step 3: Use the test configuration**

Change `compile-tests` to run `tsc -p tsconfig.test.json` and make `test` pass `--fail-zero` so an empty suite cannot silently succeed.

- [x] **Step 4: Verify test compilation**

Run: `npm run compile-tests`

Expected: Exit 0 and `out/test/extension.test.js` exists.

### Task 1: Missing month repository activity

**Files:**
- Modify: `src/utils/repoRegistry.ts`
- Test: `test/extension.test.ts`

- [x] **Step 1: Write the failing test**

Create a temporary storage root, call `aggregateRepoActivity` for a month that has no directory, and assert that commits, GitLog lines, and AILog lines are empty.

- [x] **Step 2: Run the test to verify it fails**

Run: `npm test -- --grep "returns empty activity for a missing month directory"`

Expected: FAIL with an `ENOENT` error from `readdirSync`.

- [x] **Step 3: Write the minimal implementation**

At the start of the month-directory loop, skip entries that do not exist.

- [x] **Step 4: Run the test to verify it passes**

Run: `npm test -- --grep "returns empty activity for a missing month directory"`

Expected: PASS.

### Task 2: Obsolete lint suppressions

**Files:**
- Modify: `src/panels/handlers/importHandler.ts`
- Modify: `src/panels/handlers/timesheetHandler.ts`

- [x] **Step 1: Use the current lint output as the failing check**

Run: `npm run lint`

Expected: Two `Unused eslint-disable directive` warnings.

- [x] **Step 2: Remove the obsolete comments**

Delete the `eslint-disable-next-line @typescript-eslint/no-var-requires` line immediately before each `require('exceljs')`.

- [x] **Step 3: Verify lint is clean**

Run: `npm run lint`

Expected: Exit 0 with no warnings.

### Task 3: Full verification

**Files:**
- Verify only.

- [x] **Step 1: Run type checking**

Run: `npm run typecheck`

Expected: Exit 0.

- [x] **Step 2: Run the full test suite**

Run: `npm test`

Expected: All tests pass.

- [x] **Step 3: Run the production build**

Run: `npm run compile`

Expected: Exit 0.
