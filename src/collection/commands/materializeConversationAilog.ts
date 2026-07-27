import type { Database } from '../../database/types/database';
import type { WorkLogManager } from '../../daily/utils/workLogManager';
import { GeneratedDailyProjector } from '../../daily/commands/generatedDailyProjector';

interface SessionRow {
  id: string;
  provider: 'codex' | 'cursor' | 'qoder';
  project_id: string | null;
  title: string | null;
  started_at: string | null;
  updated_at: string | null;
}

interface MessageRow {
  id: string;
  role: string;
  content: string;
  created_at: string | null;
  sequence: number;
}

function localDateKey(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
  }
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(parsed.getDate()).padStart(2, '0')}`;
}

function providerLabel(provider: SessionRow['provider']): string {
  return `${provider.slice(0, 1).toUpperCase()}${provider.slice(1)}`;
}

function summarizeSession(session: SessionRow, messages: MessageRow[]): string {
  const firstUser =
    messages.find((message) => message.role === 'user') ?? messages[0];
  const detail = firstUser?.content.replace(/\s+/g, ' ').trim().slice(0, 120);
  const title = session.title?.trim();
  const summary = title && detail && title !== detail ? `${title}：${detail}` : title || detail;
  return `[${providerLabel(session.provider)}] ${summary || 'AI 编程会话'}`;
}

export async function materializeConversationAilog(
  database: Database,
  workLogManager: WorkLogManager,
  sessionIds: string[],
  onLog?: (line: string) => void,
): Promise<string[]> {
  const affectedDates = new Set<string>();

  database.transaction(() => {
    for (const sessionId of [...new Set(sessionIds)]) {
      const session = database.get<SessionRow>(
        `SELECT id, provider, project_id, title, started_at, updated_at
         FROM ai_sessions
         WHERE id = ?`,
        [sessionId],
      );
      if (!session) {
        continue;
      }
      for (const row of database.all<{ date: string }>(
        `SELECT date FROM daily_items WHERE id LIKE ?`,
        [`ai:conversation:${sessionId}:%`],
      )) {
        affectedDates.add(row.date);
      }
      database.execute('DELETE FROM daily_items WHERE id LIKE ?', [
        `ai:conversation:${sessionId}:%`,
      ]);

      const messages = database.all<MessageRow>(
        `SELECT id, role, content, created_at, sequence
         FROM ai_messages
         WHERE session_id = ?
         ORDER BY sequence`,
        [sessionId],
      );
      const fallbackDate = localDateKey(
        session.started_at ?? session.updated_at,
      );
      const byDate = new Map<string, MessageRow[]>();
      for (const message of messages) {
        const date = localDateKey(message.created_at) ?? fallbackDate;
        if (!date) {
          continue;
        }
        const current = byDate.get(date) ?? [];
        current.push(message);
        byDate.set(date, current);
      }

      for (const [date, dateMessages] of byDate) {
        affectedDates.add(date);
        const id = `ai:conversation:${sessionId}:${date}`;
        const now = new Date().toISOString();
        database.execute(
          `INSERT INTO daily_items(
            id, date, kind, content, assignment, project_id, source,
            sort_order, created_at, updated_at
          ) VALUES (?, ?, 'ailog', ?, ?, ?, 'ai', 0, ?, ?)`,
          [
            id,
            date,
            summarizeSession(session, dateMessages),
            session.project_id ? 'project' : 'unassigned',
            session.project_id,
            now,
            now,
          ],
        );
        for (const message of dateMessages) {
          database.execute(
            `INSERT INTO daily_ai_evidence(
              daily_item_id, session_id, message_id
            ) VALUES (?, ?, ?)`,
            [id, sessionId, message.id],
          );
        }
      }
    }
  });
  await database.flush();

  const dates = [...affectedDates].sort();
  const projector = new GeneratedDailyProjector(
    database,
    workLogManager,
    onLog,
  );
  for (const date of dates) {
    await projector.project(date, ['ai']);
  }
  onLog?.(`[SQLite] AI 对话映射到 ${dates.length} 个日报日期`);
  return dates;
}
