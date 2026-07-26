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

export class CodexConversationCollector implements AiConversationCollector {
  readonly provider = 'codex' as const;

  constructor(private readonly roots = [
    path.join(os.homedir(), '.codex', 'sessions'),
    path.join(os.homedir(), '.codex', 'archived_sessions'),
  ]) {}

  async discover(): Promise<ConversationSource[]> {
    return walkFiles(
      this.roots,
      (filePath) =>
        filePath.endsWith('.jsonl') &&
        (path.basename(filePath).startsWith('rollout-') ||
          filePath.includes('archived_sessions')),
    ).map((filePath) => ({ provider: this.provider, path: filePath }));
  }

  async collect(source: ConversationSource): Promise<CollectedConversation> {
    let externalSessionId = path.basename(source.path, '.jsonl');
    let cwd: string | undefined;
    let title: string | undefined;
    let startedAt: string | undefined;
    let updatedAt: string | undefined;
    const messages: CollectedConversationMessage[] = [];

    for (const line of fs.readFileSync(source.path, 'utf-8').split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const timestamp =
        typeof event.timestamp === 'string' ? event.timestamp : undefined;
      startedAt ||= timestamp;
      updatedAt = timestamp || updatedAt;
      const payload =
        event.payload && typeof event.payload === 'object'
          ? (event.payload as Record<string, unknown>)
          : event;
      if (event.type === 'session_meta' || payload.type === 'session_meta') {
        externalSessionId =
          (typeof payload.id === 'string' && payload.id) || externalSessionId;
        cwd = typeof payload.cwd === 'string' ? payload.cwd : cwd;
        title = typeof payload.title === 'string' ? payload.title : title;
      }
      const item =
        payload.item && typeof payload.item === 'object'
          ? (payload.item as Record<string, unknown>)
          : payload;
      const role = typeof item.role === 'string' ? item.role : '';
      const content = textFromContent(item.content);
      if (
        item.type === 'message' &&
        (role === 'user' || role === 'assistant') &&
        content
      ) {
        messages.push({
          externalMessageId:
            typeof item.id === 'string' ? item.id : undefined,
          role,
          content,
          createdAt: timestamp,
        });
      }
    }

    return {
      provider: this.provider,
      externalSessionId:
        externalSessionId ||
        stableConversationId(this.provider, source.path),
      sourcePath: source.path,
      sourceHash: hashFile(source.path),
      cwd,
      title,
      startedAt,
      updatedAt,
      messages,
    };
  }
}
