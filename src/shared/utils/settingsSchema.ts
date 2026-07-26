import type { PluginSettings } from '../../settings/types/pluginSettings';

export interface SettingFieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'stringList' | 'select' | 'secret';
  section: 'git' | 'ai' | 'timesheet' | 'email' | 'display';
  placeholder?: string;
  helpText?: string;
  options?: Array<{ value: string; label: string }>;
}

export const SETTINGS_FIELDS: SettingFieldDef[] = [
  {
    key: 'searchRoots',
    label: 'Git 搜索根目录',
    type: 'stringList',
    section: 'git',
    helpText: '每行一个路径，如 ~/code',
  },
  {
    key: 'originFilters',
    label: 'Origin 过滤',
    type: 'stringList',
    section: 'git',
    placeholder: 'scm.example.com',
  },
  {
    key: 'authorAliases',
    label: '作者别名',
    type: 'stringList',
    section: 'git',
    helpText: '留空则使用本机 git user.name / email',
  },
  {
    key: 'gitCollectCacheEnabled',
    label: '历史日期采集使用缓存',
    type: 'boolean',
    section: 'git',
  },
  {
    key: 'autoPolishAfterCollect',
    label: '采集后自动 AI 润色',
    type: 'boolean',
    section: 'git',
  },
  {
    key: 'weekendRollforward',
    label: '周末 commit 并入周一',
    type: 'boolean',
    section: 'git',
  },
  {
    key: 'aiPreset',
    label: 'AI 预设',
    type: 'select',
    section: 'ai',
    options: [
      { value: 'deepseek', label: 'DeepSeek' },
      { value: 'mimo', label: '小米 MiMo' },
      { value: 'custom', label: '自定义' },
    ],
  },
  {
    key: 'aiModel',
    label: 'AI 模型',
    type: 'text',
    section: 'ai',
  },
  {
    key: 'displayName',
    label: '显示姓名',
    type: 'text',
    section: 'display',
  },
  {
    key: 'timesheet.company',
    label: '工时表公司',
    type: 'text',
    section: 'timesheet',
  },
  {
    key: 'timesheet.approver',
    label: '审批人',
    type: 'text',
    section: 'timesheet',
  },
  {
    key: 'openRepoInNewWindow',
    label: '新窗口打开仓库',
    type: 'boolean',
    section: 'display',
  },
];

export function getNestedSetting(settings: PluginSettings, key: string): unknown {
  const parts = key.split('.');
  let cur: unknown = settings;
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object') {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function setNestedSetting(
  settings: PluginSettings,
  key: string,
  value: unknown,
): PluginSettings {
  const parts = key.split('.');
  if (parts.length === 1) {
    return { ...settings, [key]: value } as PluginSettings;
  }
  const [head, ...rest] = parts;
  const headVal = (settings as unknown as Record<string, unknown>)[head];
  const nested = { ...(typeof headVal === 'object' && headVal ? headVal : {}) } as Record<
    string,
    unknown
  >;
  let cursor: Record<string, unknown> = nested as Record<string, unknown>;
  for (let i = 0; i < rest.length - 1; i++) {
    const next = { ...(cursor[rest[i]] as object) };
    cursor[rest[i]] = next;
    cursor = next;
  }
  cursor[rest[rest.length - 1]] = value;
  return { ...settings, [head]: nested } as PluginSettings;
}
