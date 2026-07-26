import { execFile } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import type {
  AiConversationCollector,
  CollectedConversation,
  CollectedConversationMessage,
  ConversationSource,
} from '../types/aiConversation';
import {
  hashFile,
  stableConversationId,
  textFromContent,
  walkFiles,
} from './conversationUtils';

const execFileAsync = promisify(execFile);

async function sqliteJson(
  filePath: string,
  sql: string,
): Promise<Array<Record<string, unknown>>> {
  const { stdout } = await execFileAsync('/usr/bin/sqlite3', [
    '-readonly',
    '-json',
    filePath,
    sql,
  ], { maxBuffer: 100 * 1024 * 1024 });
  return stdout.trim()
    ? (JSON.parse(stdout) as Array<Record<string, unknown>>)
    : [];
}

function messagesFromJson(value: unknown): CollectedConversationMessage[] {
  const results: CollectedConversationMessage[] = [];
  const visit = (candidate: unknown) => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!candidate || typeof candidate !== 'object') {
      return;
    }
    const record = candidate as Record<string, unknown>;
    const role =
      typeof record.role === 'string'
        ? record.role
        : typeof record.type === 'string' &&
            ['user', 'assistant'].includes(record.type)
          ? record.type
          : '';
    const content = textFromContent(record.content ?? record.text);
    if ((role === 'user' || role === 'assistant') && content) {
      results.push({
        externalMessageId:
          typeof record.id === 'string' ? record.id : undefined,
        role,
        content,
        createdAt:
          typeof record.createdAt === 'string'
            ? record.createdAt
            : typeof record.timestamp === 'string'
              ? record.timestamp
              : undefined,
      });
      return;
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  return results;
}

export class CursorConversationCollector implements AiConversationCollector {
  readonly provider = 'cursor' as const;

  constructor(private readonly roots = [
    path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User'),
  ]) {}

  async discover(): Promise<ConversationSource[]> {
    return walkFiles(this.roots, (filePath) =>
      ['state.vscdb', 'conversation-search.db'].includes(path.basename(filePath)),
    ).map((filePath) => ({ provider: this.provider, path: filePath }));
  }

  async collect(source: ConversationSource): Promise<CollectedConversation> {
    const tables = await sqliteJson(
      source.path,
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
    );
    const tableNames = new Set(tables.map((row) => String(row.name)));
    const messages: CollectedConversationMessage[] = [];
    let externalSessionId = stableConversationId(this.provider, source.path);

    if (tableNames.has('ai_messages')) {
      const rows = await sqliteJson(
        source.path,
        `SELECT * FROM ai_messages ORDER BY sequence, rowid`,
      );
      for (const row of rows) {
        const role = String(row.role || '');
        const content = String(row.content || '');
        if ((role === 'user' || role === 'assistant') && content) {
          messages.push({
            externalMessageId: row.id ? String(row.id) : undefined,
            role,
            content,
            createdAt: row.created_at ? String(row.created_at) : undefined,
          });
          externalSessionId = row.session_id
            ? String(row.session_id)
            : externalSessionId;
        }
      }
    } else {
      for (const table of ['ItemTable', 'cursorDiskKV']) {
        if (!tableNames.has(table)) {
          continue;
        }
        const rows = await sqliteJson(
          source.path,
          `SELECT key, value FROM ${table}
           WHERE key LIKE '%composer%' OR key LIKE '%conversation%'`,
        );
        for (const row of rows) {
          try {
            messages.push(...messagesFromJson(JSON.parse(String(row.value))));
          } catch {
            // Unknown values are skipped without exposing their content.
          }
        }
      }
    }

    return {
      provider: this.provider,
      externalSessionId,
      sourcePath: source.path,
      sourceHash: hashFile(source.path),
      messages,
    };
  }
}
