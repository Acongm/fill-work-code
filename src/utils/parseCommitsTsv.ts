export interface ParsedCommitRow {
  repoRoot: string;
  repoName: string;
  originUrl: string;
  sha: string;
  commitDay: string;
  subject: string;
  topDirs?: string;
}

export function normalizeCommitDay(raw: string): string {
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : raw.slice(0, 10);
}

/** Parse _commits.tsv lines (tab-separated, >=9 cols). */
export function parseCommitsTsv(content: string): ParsedCommitRow[] {
  const rows: ParsedCommitRow[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const cols = line.split('\t');
    if (cols.length < 9) {
      continue;
    }
    const repoRoot = cols[0]?.trim() || '';
    const repoName = cols[1]?.trim() || 'unknown';
    const originUrl = cols[2]?.trim() || '';
    const sha = cols[3]?.trim() || '';
    const commitDay = cols[5]?.trim();
    const subject = cols[8]?.trim();
    if (!commitDay || !subject) {
      continue;
    }
    rows.push({
      repoRoot,
      repoName,
      originUrl,
      sha,
      commitDay: normalizeCommitDay(commitDay),
      subject,
      topDirs: cols.length > 9 ? cols[9]?.trim() : undefined,
    });
  }
  return rows;
}

export function groupCommitsByDay(
  rows: ParsedCommitRow[],
): Record<string, ParsedCommitRow[]> {
  const byDay: Record<string, ParsedCommitRow[]> = {};
  for (const row of rows) {
    if (!byDay[row.commitDay]) {
      byDay[row.commitDay] = [];
    }
    byDay[row.commitDay].push(row);
  }
  return byDay;
}

export function uniqueReposFromRows(rows: ParsedCommitRow[]): Array<{
  repoRoot: string;
  repoName: string;
  originUrl: string;
}> {
  const seen = new Set<string>();
  const out: Array<{ repoRoot: string; repoName: string; originUrl: string }> = [];
  for (const r of rows) {
    if (!r.repoRoot || seen.has(r.repoRoot)) {
      continue;
    }
    seen.add(r.repoRoot);
    out.push({ repoRoot: r.repoRoot, repoName: r.repoName, originUrl: r.originUrl });
  }
  return out;
}
