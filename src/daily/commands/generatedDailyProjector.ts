import type { Database } from '../../database/types/database';
import {
  ProjectionRepository,
  type ProjectionGroup,
} from '../../database/commands/projectionRepository';
import type {
  GeneratedAiFields,
  GeneratedDailyJsonWriter,
  GeneratedGitFields,
  ProjectionResult,
} from '../types/generatedDailyFields';

export class GeneratedDailyProjector {
  private readonly projections: ProjectionRepository;

  constructor(
    private readonly database: Database,
    private readonly jsonWriter: GeneratedDailyJsonWriter,
    private readonly onLog?: (line: string) => void,
  ) {
    this.projections = new ProjectionRepository(database);
  }

  async project(
    date: string,
    groups: ProjectionGroup[],
    revision = Date.now(),
  ): Promise<ProjectionResult> {
    for (const group of groups) {
      await this.projections.markPending(date, group, revision);
      try {
        if (group === 'git') {
          const fields = this.loadGitFields(date);
          await this.jsonWriter.patchGeneratedFields(date, 'git', fields);
          this.onLog?.(
            `[JSON] ${date} Git 字段同步完成：${fields.gitCommit.length} commits / ${fields.gitlog.length} gitlog`,
          );
        } else {
          const fields = this.loadAiFields(date);
          await this.jsonWriter.patchGeneratedFields(date, 'ai', fields);
          this.onLog?.(
            `[JSON] ${date} AILog 同步完成：${fields.ailog.length} 条`,
          );
        }
        await this.projections.markProjected(date, group, revision);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.projections.markFailed(date, group, message);
        this.onLog?.(`[JSON] ${date} ${group} 字段同步失败：${message}`);
        throw error;
      }
    }
    return { date, groups };
  }

  private loadGitFields(date: string): GeneratedGitFields {
    const gitlog = this.database
      .all<{ content: string }>(
        `SELECT content
         FROM gitlog_entries
         WHERE date = ?
         ORDER BY id`,
        [date],
      )
      .map((row) => row.content);
    const gitCommit = this.database
      .all<{ sha: string; subject: string }>(
        `SELECT sha, subject
         FROM commits
         WHERE substr(committed_at, 1, 10) = ?
         ORDER BY committed_at, id`,
        [date],
      )
      .map((row) => {
        const shortSha = row.sha.slice(0, 8);
        return shortSha ? `${shortSha} ${row.subject}` : row.subject;
      });
    const origin_url = this.database
      .all<{ origin_url: string }>(
        `SELECT DISTINCT p.origin_url
         FROM projects p
         WHERE p.id IN (
           SELECT project_id
           FROM gitlog_entries
           WHERE date = ?
           UNION
           SELECT project_id
           FROM commits
           WHERE substr(committed_at, 1, 10) = ?
         )
         ORDER BY p.origin_url`,
        [date, date],
      )
      .map((row) => row.origin_url);
    return { gitlog, gitCommit, origin_url };
  }

  private loadAiFields(date: string): GeneratedAiFields {
    const ailog = this.database
      .all<{ content: string }>(
        `SELECT content
         FROM daily_items
         WHERE date = ? AND kind = 'ailog' AND source = 'ai'
         ORDER BY sort_order, created_at, id`,
        [date],
      )
      .map((row) => row.content);
    return { ailog };
  }
}
