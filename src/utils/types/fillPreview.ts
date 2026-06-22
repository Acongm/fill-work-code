export type FillScope = 'day' | 'workWeek' | 'custom';
export type FillPreviewSource = 'git' | 'ai';

export interface FillPreviewDay {
  date: string;
  completed: string[];
  gitlog: string[];
  gitCommit: string[];
  originUrl: string[];
  ailogDraft: string[];
  warnings: string[];
  appliedGit?: boolean;
  appliedAi?: boolean;
  /** 确认页是否写入此日（默认 true） */
  includeInApply?: boolean;
}

export interface FillPreview {
  scope: FillScope;
  anchorDate: string;
  rangeStart?: string;
  rangeEnd?: string;
  dates: string[];
  days: FillPreviewDay[];
  /** 由 Git 采集或 AI 润色触发，决定确认页展示的字段与操作 */
  source?: FillPreviewSource;
  collectedAt?: string;
  error?: string;
}

export interface FillCacheFile {
  scope: FillScope;
  anchorDate: string;
  rangeStart?: string;
  rangeEnd?: string;
  updatedAt: string;
  days: FillPreviewDay[];
  collectedAt?: string;
  error?: string;
}
