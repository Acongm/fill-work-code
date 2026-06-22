export interface DailyFieldDef {
  key: string;
  label: string;
  alwaysVisible?: boolean;
}

export const DAILY_FIELD_DEFS: DailyFieldDef[] = [
  { key: 'completed', label: '今日完成', alwaysVisible: true },
  { key: 'ailog', label: 'AILog', alwaysVisible: true },
  { key: 'origin_url', label: '相关仓库', alwaysVisible: true },
  { key: 'gitlog', label: 'GitLog' },
  { key: 'gitCommit', label: 'GitCommit' },
  { key: 'plan', label: '明日计划' },
  { key: 'blockers', label: '阻碍' },
  { key: 'notes', label: '备注' },
];

export const SUMMARY_OPTIONAL_FIELDS = ['gitlog', 'gitCommit', 'plan', 'blockers', 'notes'] as const;
