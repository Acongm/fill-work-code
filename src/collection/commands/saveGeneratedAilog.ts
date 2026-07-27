import * as crypto from 'crypto';
import type { Database } from '../../database/types/database';
import type { WorkLogManager } from '../../daily/utils/workLogManager';
import { GeneratedDailyProjector } from '../../daily/commands/generatedDailyProjector';

function stableAilogId(date: string, index: number, content: string): string {
  const digest = crypto
    .createHash('sha256')
    .update(`${date}:${index}:${content}`)
    .digest('hex')
    .slice(0, 24);
  return `ai:polish:${date}:${digest}`;
}

export async function saveGeneratedAilog(
  database: Database,
  workLogManager: WorkLogManager,
  date: string,
  entries: string[],
  onLog?: (line: string) => void,
): Promise<void> {
  const normalized = [...new Set(entries.map((entry) => entry.trim()))].filter(
    Boolean,
  );
  const now = new Date().toISOString();
  database.transaction(() => {
    database.execute(
      `DELETE FROM daily_items
       WHERE date = ? AND kind = 'ailog' AND id LIKE ?`,
      [date, `ai:polish:${date}:%`],
    );
    normalized.forEach((content, index) => {
      database.execute(
        `INSERT INTO daily_items(
          id, date, kind, content, assignment, project_id, source,
          sort_order, created_at, updated_at
        ) VALUES (?, ?, 'ailog', ?, 'unassigned', NULL, 'ai', ?, ?, ?)`,
        [
          stableAilogId(date, index, content),
          date,
          content,
          index,
          now,
          now,
        ],
      );
    });
  });
  await database.flush();
  onLog?.(`[SQLite] ${date} 写入 ${normalized.length} 条 AI 润色记录`);
  await new GeneratedDailyProjector(
    database,
    workLogManager,
    onLog,
  ).project(date, ['ai']);
}
