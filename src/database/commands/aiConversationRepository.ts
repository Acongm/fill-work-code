import type { Database } from '../types/database';

export type AiProvider = 'codex' | 'cursor' | 'qoder';

export interface AiSessionInput {
  id: string;
  provider: AiProvider;
  externalSessionId: string;
  projectId?: string | null;
  cloneId?: string | null;
  cwd?: string | null;
  title?: string | null;
  startedAt?: string | null;
  updatedAt?: string | null;
  sourcePath: string;
  sourceHash: string;
}

export interface AiSession extends AiSessionInput {
  projectId: string | null;
  cloneId: string | null;
  cwd: string | null;
  title: string | null;
  startedAt: string | null;
  updatedAt: string | null;
}

export interface AiMessageInput {
  id: string;
  sessionId: string;
  externalMessageId?: string | null;
  role: string;
  content: string;
  createdAt?: string | null;
  sequence: number;
}

export interface AiMessage extends AiMessageInput {
  externalMessageId: string | null;
  createdAt: string | null;
}

interface AiSessionRow {
  id: string;
  provider: AiProvider;
  external_session_id: string;
  project_id: string | null;
  clone_id: string | null;
  cwd: string | null;
  title: string | null;
  started_at: string | null;
  updated_at: string | null;
  source_path: string;
  source_hash: string;
}

interface AiMessageRow {
  id: string;
  session_id: string;
  external_message_id: string | null;
  role: string;
  content: string;
  created_at: string | null;
  sequence: number;
}

function mapSession(row: AiSessionRow): AiSession {
  return {
    id: row.id,
    provider: row.provider,
    externalSessionId: row.external_session_id,
    projectId: row.project_id,
    cloneId: row.clone_id,
    cwd: row.cwd,
    title: row.title,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    sourcePath: row.source_path,
    sourceHash: row.source_hash,
  };
}

function mapMessage(row: AiMessageRow): AiMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    externalMessageId: row.external_message_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    sequence: row.sequence,
  };
}

export class AiConversationRepository {
  constructor(private readonly database: Database) {}

  async upsertSession(input: AiSessionInput): Promise<AiSession> {
    this.database.transaction(() => {
      this.database.execute(
        `INSERT INTO ai_sessions(
          id, provider, external_session_id, project_id, clone_id, cwd,
          title, started_at, updated_at, source_path, source_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider, external_session_id) DO UPDATE SET
          project_id = excluded.project_id,
          clone_id = excluded.clone_id,
          cwd = excluded.cwd,
          title = excluded.title,
          started_at = excluded.started_at,
          updated_at = excluded.updated_at,
          source_path = excluded.source_path,
          source_hash = excluded.source_hash`,
        [
          input.id,
          input.provider,
          input.externalSessionId,
          input.projectId ?? null,
          input.cloneId ?? null,
          input.cwd ?? null,
          input.title ?? null,
          input.startedAt ?? null,
          input.updatedAt ?? null,
          input.sourcePath,
          input.sourceHash,
        ],
      );
    });
    await this.database.flush();
    const saved = this.getByExternalId(input.provider, input.externalSessionId);
    if (!saved) {
      throw new Error('Failed to save AI session');
    }
    return saved;
  }

  getByExternalId(
    provider: AiProvider,
    externalSessionId: string,
  ): AiSession | undefined {
    const row = this.database.get<AiSessionRow>(
      `SELECT * FROM ai_sessions
       WHERE provider = ? AND external_session_id = ?`,
      [provider, externalSessionId],
    );
    return row ? mapSession(row) : undefined;
  }

  listForProject(projectId: string): AiSession[] {
    return this.database
      .all<AiSessionRow>(
        `SELECT * FROM ai_sessions
         WHERE project_id = ?
         ORDER BY COALESCE(updated_at, started_at) DESC, id`,
        [projectId],
      )
      .map(mapSession);
  }

  async replaceMessages(
    sessionId: string,
    messages: AiMessageInput[],
  ): Promise<void> {
    this.database.transaction(() => {
      this.database.execute('DELETE FROM ai_messages WHERE session_id = ?', [
        sessionId,
      ]);
      for (const message of messages) {
        this.database.execute(
          `INSERT INTO ai_messages(
            id, session_id, external_message_id, role, content,
            created_at, sequence
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            message.id,
            sessionId,
            message.externalMessageId ?? null,
            message.role,
            message.content,
            message.createdAt ?? null,
            message.sequence,
          ],
        );
      }
    });
    await this.database.flush();
  }

  listMessages(sessionId: string): AiMessage[] {
    return this.database
      .all<AiMessageRow>(
        `SELECT * FROM ai_messages
         WHERE session_id = ?
         ORDER BY sequence`,
        [sessionId],
      )
      .map(mapMessage);
  }

  async linkDailyEvidence(
    dailyItemId: string,
    sessionId: string,
    messageId: string | null = null,
  ): Promise<void> {
    this.database.transaction(() => {
      this.database.execute(
        `INSERT OR IGNORE INTO daily_ai_evidence(
          daily_item_id, session_id, message_id
        ) VALUES (?, ?, ?)`,
        [dailyItemId, sessionId, messageId],
      );
    });
    await this.database.flush();
  }
}
