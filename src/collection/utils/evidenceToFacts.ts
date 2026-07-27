import type { Database } from '../../database/types/database';
import {
  ensureProjectAndClone,
  stableId,
} from '../../database/utils/projectIdentity';
import type {
  CommitInput,
  GitlogEntryInput,
} from '../../database/commands/collectionRepository';
import {
  dedupeCommitsBySha,
} from '../../shared/utils/dedupeCommits';
import {
  parseCommitsTsv,
  type ParsedCommitRow,
} from '../../shared/utils/parseCommitsTsv';

export interface EvidenceFacts {
  commits: CommitInput[];
  gitlogEntries: GitlogEntryInput[];
  projectCount: number;
}

function filterRowsByDates(
  rows: ParsedCommitRow[],
  dates?: Set<string>,
): ParsedCommitRow[] {
  if (!dates || dates.size === 0) {
    return rows;
  }
  return rows.filter((row) => dates.has(row.commitDay));
}

/** 将 _commits.tsv 内容映射为带 project/clone 关联的采集事实，并 upsert 项目。 */
export function evidenceTsvToFacts(
  database: Database,
  tsvContent: string,
  options?: {
    dates?: Set<string>;
    collectionRunId?: string | null;
  },
): EvidenceFacts {
  const rows = filterRowsByDates(
    dedupeCommitsBySha(parseCommitsTsv(tsvContent)),
    options?.dates,
  );
  const commits: CommitInput[] = [];
  const gitlogEntries: GitlogEntryInput[] = [];
  const seenProjects = new Set<string>();
  const now = new Date().toISOString();

  database.transaction(() => {
    for (const row of rows) {
      if (!row.repoRoot || !row.subject) {
        continue;
      }
      const identity = ensureProjectAndClone(database, {
        repoRoot: row.repoRoot,
        repoName: row.repoName,
        originUrl: row.originUrl,
        lastScannedAt: now,
        lastCommitAt: row.commitDay,
      });
      seenProjects.add(identity.projectId);

      const commitKey =
        row.sha || `${row.repoRoot}:${row.commitDay}:${row.subject}`;
      const commitId = stableId('commit', `${identity.cloneId}:${commitKey}`);
      commits.push({
        id: commitId,
        projectId: identity.projectId,
        cloneId: identity.cloneId,
        sha: row.sha || commitId,
        subject: row.subject,
        author: null,
        committedAt: `${row.commitDay}T12:00:00.000Z`,
        collectionRunId: options?.collectionRunId ?? null,
      });

      const gitlogId = stableId('gitlog', commitId);
      gitlogEntries.push({
        id: gitlogId,
        date: row.commitDay,
        projectId: identity.projectId,
        cloneId: identity.cloneId,
        content: row.subject,
        collectionRunId: options?.collectionRunId ?? null,
        commitIds: [commitId],
      });
    }
  });

  return {
    commits,
    gitlogEntries,
    projectCount: seenProjects.size,
  };
}
