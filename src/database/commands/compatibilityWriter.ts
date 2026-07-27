import * as fs from 'fs';
import * as path from 'path';
import type { Database } from '../types/database';
import { resolveRuntimePaths } from '../../settings/utils/pathUtils';
import { registryPath } from '../../shared/utils/repoRegistry';
import type { RepoRecord, ReposRegistry } from '../../shared/types/repoRegistry';

export interface CompatibilityWriteResult {
  path?: string;
  warnings: string[];
}

async function writeAtomic(filePath: string, content: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await fs.promises.writeFile(temporaryPath, content, 'utf-8');
  await fs.promises.rename(temporaryPath, filePath);
}

export class CompatibilityWriter {
  constructor(
    private readonly database: Database,
    private readonly storageRoot: string,
  ) {}

  async exportCommits(year: number, month: number): Promise<CompatibilityWriteResult> {
    try {
      const monthKey = `${year}-${String(month).padStart(2, '0')}`;
      const rows = this.database.all<{
        repo_root: string;
        name: string;
        origin_url: string;
        sha: string;
        author: string | null;
        committed_at: string;
        subject: string;
      }>(
        `SELECT
           pc.repo_root,
           p.name,
           p.origin_url,
           c.sha,
           c.author,
           c.committed_at,
           c.subject
         FROM commits c
         JOIN projects p ON p.id = c.project_id
         JOIN project_clones pc ON pc.id = c.clone_id
         WHERE substr(c.committed_at, 1, 7) = ?
         ORDER BY c.committed_at, pc.repo_root, c.sha`,
        [monthKey],
      );
      const content = rows
        .map((row) =>
          [
            row.repo_root,
            row.name,
            row.origin_url,
            row.sha,
            '',
            row.committed_at.slice(0, 10),
            '',
            row.author || '',
            row.subject,
            '',
            '',
          ].join('\t'),
        )
        .join('\n');
      const filePath = path.join(
        resolveRuntimePaths(this.storageRoot).month(year, month),
        '_commits.tsv',
      );
      await writeAtomic(filePath, content ? `${content}\n` : '');
      return { path: filePath, warnings: [] };
    } catch (error) {
      return {
        warnings: [
          `Git 兼容文件写入失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ],
      };
    }
  }

  async exportRegistry(): Promise<CompatibilityWriteResult> {
    try {
      const rows = this.database.all<{
        id: string;
        repo_root: string;
        clone_label: string;
        first_seen_at: string;
        last_scanned_at: string | null;
        last_commit_at: string | null;
        origin_url: string;
        name: string;
        pinned: number;
        hidden: number;
        commit_count: number;
      }>(
        `SELECT
           pc.id,
           pc.repo_root,
           pc.clone_label,
           pc.first_seen_at,
           pc.last_scanned_at,
           pc.last_commit_at,
           p.origin_url,
           p.name,
           p.pinned,
           p.hidden,
           (
             SELECT COUNT(*) FROM commits c WHERE c.clone_id = pc.id
           ) AS commit_count
         FROM project_clones pc
         JOIN projects p ON p.id = pc.project_id
         ORDER BY p.origin_url, pc.repo_root`,
      );
      const now = new Date().toISOString();
      const repos: RepoRecord[] = rows.map((row) => ({
        id: row.id,
        repoRoot: row.repo_root,
        repoName: row.name,
        originUrl: row.origin_url,
        cloneLabel: row.clone_label,
        firstSeenAt: row.first_seen_at,
        lastScannedAt: row.last_scanned_at || now,
        lastCommitAt: row.last_commit_at || undefined,
        commitCountTotal: row.commit_count,
        pinned: Boolean(row.pinned),
        hidden: Boolean(row.hidden),
        scanMissCount: 0,
      }));
      const registry: ReposRegistry = {
        version: 1,
        updatedAt: now,
        repos,
      };
      const filePath = registryPath(this.storageRoot);
      await writeAtomic(filePath, `${JSON.stringify(registry, null, 2)}\n`);
      return { path: filePath, warnings: [] };
    } catch (error) {
      return {
        warnings: [
          `仓库注册表兼容文件写入失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ],
      };
    }
  }
}
