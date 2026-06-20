export type AiPresetId = 'deepseek' | 'mimo' | 'custom';

export interface PluginSettings {
  displayName: string;
  outputDir: string;
  searchRoots: string[];
  /**
   * Git 远程地址过滤（留空=不过滤，保留全部仓库）。
   * 可填主机名（scm.starbucks.com）或 URL 片段（git@scm.starbucks.com:china/、:cpeng/）。
   * @deprecated 使用 originFilters；加载时自动合并 originHosts
   */
  originHosts?: string[];
  originFilters: string[];
  /** Git commit 作者过滤；留空则用本机 git user.name / user.email（严格匹配） */
  authorAliases: string[];
  timesheetContentField: 'completed' | 'gitlog' | 'ailog' | 'gitCommit';
  timesheetFullDateEnabled: boolean;
  aiEnabled: boolean;
  aiPreset: AiPresetId;
  aiModel: string;
  aiBaseUrl: string;
  aiUseApiKeyHeader: boolean;
  /** DeepSeek V4：thinking 模式（reasoning_content + 更长耗时） */
  aiThinkingEnabled: boolean;
  aiReasoningEffort: 'high' | 'max';
  /** 非 thinking 模式时生效；thinking 开启时 API 可能忽略 */
  aiTemperature: number;
  /** chat/completions 请求超时（毫秒） */
  aiTimeoutMs: number;
  /** 自定义 system prompt；空字符串表示使用内置默认 */
  aiSystemPrompt: string;
  /** 流式 Thinking 时把 reasoning_content 实时打到采集日志 */
  aiShowReasoningStream: boolean;
  visibleFields: string[];
  /** 为 true 时日报编辑/预览跟随 visibleFields；默认 false 显示全部字段 */
  dailySyncFieldVisibility: boolean;
  /** 历史日期 Git 采集优先读缓存，跳过重复扫描 */
  gitCollectCacheEnabled: boolean;
  email: {
    smtpHost: string;
    smtpPort: number;
    username: string;
    from: string;
    to: string;
    cc: string;
  };
}

export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = {
  displayName: '彭聪',
  outputDir: '',
  searchRoots: ['~/IdeaProjects', '~/code'],
  originFilters: [],
  authorAliases: [],
  timesheetContentField: 'ailog',
  timesheetFullDateEnabled: false,
  aiEnabled: true,
  aiPreset: 'deepseek',
  aiModel: 'deepseek-chat',
  aiBaseUrl: 'https://api.deepseek.com',
  aiUseApiKeyHeader: false,
  aiThinkingEnabled: true,
  aiReasoningEffort: 'high',
  aiTemperature: 0.2,
  aiTimeoutMs: 180_000,
  aiSystemPrompt: '',
  aiShowReasoningStream: true,
  /** 汇总/预览可选显示字段（完成 / AILog / 相关仓库始终显示） */
  visibleFields: [],
  dailySyncFieldVisibility: false,
  gitCollectCacheEnabled: true,
  email: {
    smtpHost: '',
    smtpPort: 587,
    username: '',
    from: '',
    to: '',
    cc: '',
  },
};

export const AI_PRESETS: Record<
  AiPresetId,
  { label: string; baseUrl: string; defaultModel: string; useApiKeyHeader?: boolean }
> = {
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
  },
  mimo: {
    label: '小米 MiMo',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    defaultModel: 'mimo-v2.5-pro',
    useApiKeyHeader: false,
  },
  custom: {
    label: '自定义 OpenAI 兼容',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
  },
};
