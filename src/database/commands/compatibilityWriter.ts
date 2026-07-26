import * as fs from 'fs';
import * as path from 'path';
import type { Database } from '../types/database';
import { resolveRuntimePaths } from '../../settings/utils/pathUtils';

export interface CompatibilityWriteResult {
  path?: string;
  warnings: string[];
}

interface DailyItemRow {
  kind: 'completed' | 'ailog' | 'todo' | 'blocker' | 'note';
  content: string;
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

  async exportDaily(date: string): Promise<CompatibilityWriteResult> {
    try {
      const items = this.database.all<DailyItemRow>(
        `SELECT kind, content FROM daily_items
         WHERE date = ?
         ORDER BY sort_order, created_at, id`,
        [date],
      );
      const gitlog = this.database
        .all<{ content: string }>(
          `SELECT content FROM gitlog_entries
           WHERE date = ?
           ORDER BY id`,
          [date],
        )
        .map((row) => row.content);
      const commits = this.database
        .all<{ subject: string }>(
          `SELECT subject FROM commits
           WHERE substr(committed_at, 1, 10) = ?
           ORDER BY committed_at, id`,
          [date],
        )
        .map((row) => row.subject);
      const origins = this.database
        .all<{ origin_url: string }>(
          `SELECT DISTINCT p.origin_url
           FROM projects p
           WHERE p.id IN (
             SELECT project_id FROM daily_items
               WHERE date = ? AND project_id IS NOT NULL
             UNION
             SELECT project_id FROM gitlog_entries WHERE date = ?
             UNION
             SELECT project_id FROM commits
               WHERE substr(committed_at, 1, 10) = ?
           )
           ORDER BY p.origin_url`,
          [date, date, date],
        )
        .map((row) => row.origin_url);

      const byKind = (kind: DailyItemRow['kind']): string[] =>
        items.filter((item) => item.kind === kind).map((item) => item.content);
      const daily = {
        date,
        completed: byKind('completed'),
        plan: byKind('todo'),
        blockers: byKind('blocker'),
        notes: byKind('note').join('\n'),
        gitlog,
        ailog: byKind('ailog'),
        gitCommit: commits,
        origin_url: origins,
      };
      const [year, month] = date.split('-').map(Number);
      const filePath = path.join(
        resolveRuntimePaths(this.storageRoot).month(year, month),
        `${date}.json`,
      );
      await writeAtomic(filePath, `${JSON.stringify(daily, null, 2)}\n`);
      return { path: filePath, warnings: [] };
    } catch (error) {
      return {
        warnings: [
          `日报兼容文件写入失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ],
      };
    }
  }

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
}
