import type { ParsedCommitRow } from './parseCommitsTsv';

/** Deduplicate commits: same originUrl + sha keeps one row (prefer latest repoRoot in list). */
export function dedupeCommitsBySha(rows: ParsedCommitRow[]): ParsedCommitRow[] {
  const byKey = new Map<string, ParsedCommitRow>();
  for (const row of rows) {
    const origin = row.originUrl || row.repoRoot;
    const key = `${origin}\0${row.sha}`;
    byKey.set(key, row);
  }
  return [...byKey.values()];
}

export function dedupeCommitsByShaOnly(rows: ParsedCommitRow[]): ParsedCommitRow[] {
  const bySha = new Map<string, ParsedCommitRow>();
  for (const row of rows) {
    if (row.sha) {
      bySha.set(row.sha, row);
    }
  }
  return [...bySha.values()];
}
