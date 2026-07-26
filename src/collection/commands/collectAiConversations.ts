import type { Database } from '../../database/types/database';
import { AiConversationRepository } from '../../database/commands/aiConversationRepository';
import type {
  AiConversationCollector,
  CollectorDiagnostic,
} from '../types/aiConversation';
import { stableConversationId } from '../utils/conversationUtils';
import { matchConversationProject } from '../utils/conversationProjectMatcher';

export interface AiCollectionResult {
  sessions: number;
  messages: number;
  diagnostics: CollectorDiagnostic[];
  byProvider: Record<string, { sessions: number; messages: number }>;
}

export async function collectAiConversations(
  database: Database,
  collectors: AiConversationCollector[],
): Promise<AiCollectionResult> {
  const repository = new AiConversationRepository(database);
  const result: AiCollectionResult = {
    sessions: 0,
    messages: 0,
    diagnostics: [],
    byProvider: {},
  };

  for (const collector of collectors) {
    const counts = { sessions: 0, messages: 0 };
    result.byProvider[collector.provider] = counts;
    let sources;
    try {
      sources = await collector.discover();
    } catch (error) {
      result.diagnostics.push({
        provider: collector.provider,
        sourcePath: '',
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    for (const source of sources) {
      try {
        const conversation = await collector.collect(source);
        if (conversation.messages.length === 0) {
          result.diagnostics.push({
            provider: collector.provider,
            sourcePath: source.path,
            message: '未识别到受支持的对话消息结构',
          });
          continue;
        }
        const match = matchConversationProject(database, conversation.cwd);
        const sessionId = stableConversationId(
          'ai-session',
          `${conversation.provider}:${conversation.externalSessionId}`,
        );
        const session = await repository.upsertSession({
          id: sessionId,
          provider: conversation.provider,
          externalSessionId: conversation.externalSessionId,
          projectId: match?.projectId ?? null,
          cloneId: match?.cloneId ?? null,
          cwd: conversation.cwd ?? null,
          title: conversation.title ?? null,
          startedAt: conversation.startedAt ?? null,
          updatedAt: conversation.updatedAt ?? null,
          sourcePath: conversation.sourcePath,
          sourceHash: conversation.sourceHash,
        });
        await repository.replaceMessages(
          session.id,
          conversation.messages.map((message, sequence) => ({
            id: stableConversationId(
              'ai-message',
              `${session.id}:${message.externalMessageId || sequence}`,
            ),
            sessionId: session.id,
            externalMessageId: message.externalMessageId ?? null,
            role: message.role,
            content: message.content,
            createdAt: message.createdAt ?? null,
            sequence,
          })),
        );
        counts.sessions += 1;
        counts.messages += conversation.messages.length;
        result.sessions += 1;
        result.messages += conversation.messages.length;
      } catch (error) {
        result.diagnostics.push({
          provider: collector.provider,
          sourcePath: source.path,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return result;
}
