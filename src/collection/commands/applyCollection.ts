import type { Database } from '../../database/types/database';
import {
  CollectionRepository,
  type CommitInput,
  type GitlogEntryInput,
} from '../../database/commands/collectionRepository';
import { CompatibilityWriter } from '../../database/commands/compatibilityWriter';

export interface ApplyCollectionRequest {
  commits: CommitInput[];
  gitlogEntries: GitlogEntryInput[];
}

export async function applyCollection(
  database: Database,
  storageRoot: string,
  request: ApplyCollectionRequest,
): Promise<{ warnings: string[] }> {
  for (const commit of request.commits) {
    if (!commit.projectId || !commit.cloneId) {
      throw new Error('采集提交缺少项目或克隆关联');
    }
  }
  for (const entry of request.gitlogEntries) {
    if (!entry.projectId) {
      throw new Error('GitLog 缺少项目关联');
    }
  }
  await new CollectionRepository(database).saveFacts(
    request.commits,
    request.gitlogEntries,
  );
  const months = new Set(
    request.commits.map((commit) => commit.committedAt.slice(0, 7)),
  );
  const warnings: string[] = [];
  const writer = new CompatibilityWriter(database, storageRoot);
  for (const month of months) {
    const [year, monthNumber] = month.split('-').map(Number);
    warnings.push(...(await writer.exportCommits(year, monthNumber)).warnings);
  }
  return { warnings };
}
