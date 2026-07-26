import type { AiProvider } from '../../database/commands/aiConversationRepository';

export interface ConversationSource {
  provider: AiProvider;
  path: string;
}

export interface CollectedConversationMessage {
  externalMessageId?: string;
  role: string;
  content: string;
  createdAt?: string;
}

export interface CollectedConversation {
  provider: AiProvider;
  externalSessionId: string;
  sourcePath: string;
  sourceHash: string;
  cwd?: string;
  title?: string;
  startedAt?: string;
  updatedAt?: string;
  messages: CollectedConversationMessage[];
}

export interface AiConversationCollector {
  readonly provider: AiProvider;
  discover(): Promise<ConversationSource[]>;
  collect(source: ConversationSource): Promise<CollectedConversation>;
}

export interface CollectorDiagnostic {
  provider: AiProvider;
  sourcePath: string;
  message: string;
}
