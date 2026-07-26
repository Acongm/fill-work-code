import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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

function extractMessages(value: unknown): CollectedConversationMessage[] {
  const messages: CollectedConversationMessage[] = [];
  const visit = (candidate: unknown) => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!candidate || typeof candidate !== 'object') {
      return;
    }
    const record = candidate as Record<string, unknown>;
    const role = typeof record.role === 'string' ? record.role : '';
    const content = textFromContent(record.content ?? record.text);
    if ((role === 'user' || role === 'assistant') && content) {
      messages.push({
        externalMessageId:
          typeof record.id === 'string' ? record.id : undefined,
        role,
        content,
      });
      return;
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  return messages;
}

export class QoderConversationCollector implements AiConversationCollector {
  readonly provider = 'qoder' as const;

  constructor(private readonly roots = [
    path.join(os.homedir(), '.qoder'),
    path.join(os.homedir(), 'Library', 'Application Support', 'Qoder'),
  ]) {}

  async discover(): Promise<ConversationSource[]> {
    return walkFiles(
      this.roots,
      (filePath) =>
        filePath.endsWith('.json') ||
        filePath.endsWith('.jsonl'),
    ).map((filePath) => ({ provider: this.provider, path: filePath }));
  }

  async collect(source: ConversationSource): Promise<CollectedConversation> {
    const raw = fs.readFileSync(source.path, 'utf-8');
    const values = source.path.endsWith('.jsonl')
      ? raw
          .split(/\r?\n/)
          .filter(Boolean)
          .flatMap((line) => {
            try {
              return [JSON.parse(line)];
            } catch {
              return [];
            }
          })
      : [JSON.parse(raw)];
    const root =
      values.find((value) => value && typeof value === 'object') || {};
    const record = root as Record<string, unknown>;
    return {
      provider: this.provider,
      externalSessionId:
        (typeof record.sessionId === 'string' && record.sessionId) ||
        (typeof record.id === 'string' && record.id) ||
        stableConversationId(this.provider, source.path),
      sourcePath: source.path,
      sourceHash: hashFile(source.path),
      cwd: typeof record.cwd === 'string' ? record.cwd : undefined,
      title: typeof record.title === 'string' ? record.title : undefined,
      messages: values.flatMap(extractMessages),
    };
  }
}
