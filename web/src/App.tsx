import * as React from 'react';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FillReviewOverlay,
  type FillPreview,
} from './pages/fill-review/FillReviewOverlay';
import {
  SettingsOverlay,
  type PluginSettingsForm,
  type VscodeConfigDisplay,
} from './pages/settings/SettingsOverlay';
import { ProfileOverlay } from './pages/profile/ProfileOverlay';
import {
  CollectLoadingOverlay,
  type CollectLoadingState,
} from './components/ui/CollectLoadingOverlay';
import { ScopeToggle, type CollectView } from './components/ui/ScopeToggle';
import {
  type CollectRequest,
  formatFillAnchorHint,
  formatFillAnchorLabel,
  normalizeCustomRange,
  resolveCustomRange,
  transitionCollectView,
  collectViewStateFromParts,
} from '@host-utils/fillAnchor';
import type { SecretMeta } from './components/ui/SecretField';
import { vscode } from './vscodeApi';
interface DailyLog {
  date: string;
  completed: string[];
  plan: string[];
  blockers: string[];
  notes: string;
  gitlog?: string[];
  ailog?: string[];
  gitCommit?: string[];
  origin_url?: string[];
}

interface MonthlyData {
  year: number;
  month: number;
  logs: DailyLog[];
}

interface EmailConfig {
  smtpHost: string;
  smtpPort: number;
  username: string;
  from: string;
  to: string;
  cc: string;
}

interface AppConfig {
  storagePath: string;
  autoSave: boolean;
  timesheetScript?: string;
  timesheetFullDateEnabled?: boolean;
  aiEnabled?: boolean;
  showCompletedInput?: boolean;
  showPlanInput?: boolean;
  showBlockersInput?: boolean;
  showNotesInput?: boolean;
  showGitlogInput?: boolean;
  showAilogInput?: boolean;
  showGitCommitInput?: boolean;
  showOriginUrlInput?: boolean;
  dailySyncFieldVisibility?: boolean;
  timesheetContentField?: string;
  email?: EmailConfig;
}

type TabType = 'today' | 'summary' | 'materials';
type EditableArrayField = 'completed' | 'plan' | 'blockers' | 'gitlog' | 'ailog' | 'gitCommit' | 'origin_url';

interface WebviewPersistedState {
  tab?: TabType;
  logDate?: string;
  collectView?: CollectView;
  collectRangeStart?: string;
  collectRangeEnd?: string;
}

// ============ 类型定义 ============
function getTodayStr(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function getYearMonth(dateStr: string): { year: number; month: number } {
  const [year, month] = dateStr.split('-').map(Number);
  return { year, month };
}

// ============ 样式 ============
const S = {
  app: { display: 'flex', flexDirection: 'column' as const, height: '100vh', background: 'var(--vscode-sideBar-background)' },
  tabs: { display: 'flex', borderBottom: '1px solid var(--vscode-panel-border)', flexShrink: 0 },
  tab: { flex: 1, padding: '8px', background: 'none', border: 'none', color: 'var(--vscode-foreground)', cursor: 'pointer', fontSize: '11px', position: 'relative' as const },
  tabActive: { color: 'var(--vscode-textLink-activeForeground)' },
  tabIndicator: { position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: '2px', background: 'var(--vscode-textLink-activeForeground)' },
  content: { flex: 1, overflowY: 'auto' as const, padding: '8px' },
  dateNav: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginBottom: '8px', padding: '6px', background: 'var(--vscode-editor-background)', borderRadius: '4px' },
  navBtn: { padding: '2px 6px', background: 'none', border: '1px solid var(--vscode-panel-border)', borderRadius: '3px', color: 'var(--vscode-foreground)', cursor: 'pointer', fontSize: '10px' },
  dateInput: { padding: '2px 4px', background: 'var(--vscode-input-background)', color: 'var(--vscode-input-foreground)', border: '1px solid var(--vscode-input-border)', borderRadius: '3px', fontSize: '11px', width: '110px', textAlign: 'center' as const },
  section: { marginBottom: '10px', padding: '8px', background: 'var(--vscode-editor-background)', border: '1px solid var(--vscode-panel-border)', borderRadius: '4px' },
  sectionTitle: { fontWeight: 600, fontSize: '11px', marginBottom: '6px', color: 'var(--vscode-editor-foreground)' },
  itemList: { maxHeight: '120px', overflowY: 'auto' as const },
  item: { display: 'flex', alignItems: 'center', padding: '4px 6px', background: 'var(--vscode-list-hoverBackground)', margin: '2px 0', borderRadius: '3px', fontSize: '11px', gap: '4px' },
  itemText: { flex: 1, wordBreak: 'break-word' as const },
  itemInput: { flex: 1, padding: '2px 4px', background: 'var(--vscode-input-background)', color: 'var(--vscode-input-foreground)', border: '1px solid var(--vscode-input-border)', borderRadius: '2px', fontSize: '11px' },
  iconBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '10px', padding: '2px', color: 'var(--vscode-foreground)', opacity: 0.7 },
  delBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '10px', padding: '2px', color: 'var(--vscode-errorForeground)' },
  addRow: { display: 'flex', gap: '4px', marginTop: '6px', paddingTop: '6px', borderTop: '1px solid var(--vscode-panel-border)' },
  input: { flex: 1, padding: '4px 6px', background: 'var(--vscode-input-background)', color: 'var(--vscode-input-foreground)', border: '1px solid var(--vscode-input-border)', borderRadius: '3px', fontSize: '11px' },
  btn: { padding: '4px 8px', background: 'var(--vscode-button-background)', color: 'var(--vscode-button-foreground)', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '10px', fontWeight: 500 },
  btnSm: { padding: '2px 6px', background: 'var(--vscode-button-secondaryBackground)', color: 'var(--vscode-button-secondaryForeground)', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '10px' },
  textarea: { width: '100%', minHeight: '40px', padding: '6px', background: 'var(--vscode-input-background)', color: 'var(--vscode-input-foreground)', border: '1px solid var(--vscode-input-border)', borderRadius: '3px', fontSize: '11px', resize: 'vertical' as const },
  footer: { padding: '8px', borderTop: '1px solid var(--vscode-panel-border)', flexShrink: 0 },
  primaryBtn: { width: '100%', padding: '6px', background: 'var(--vscode-button-background)', color: 'var(--vscode-button-foreground)', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '11px', fontWeight: 600 },
  notification: { position: 'fixed' as const, top: '8px', left: '50%', transform: 'translateX(-50%)', padding: '6px 12px', background: 'var(--vscode-notificationsInfoIcon-foreground)', color: 'white', borderRadius: '4px', fontSize: '11px', zIndex: 1000 },
  empty: { padding: '8px', textAlign: 'center' as const, color: 'var(--vscode-descriptionForeground)', fontSize: '10px' },
  link: { color: 'var(--vscode-textLink-foreground)', cursor: 'pointer', textDecoration: 'underline', background: 'none', border: 'none', padding: 0, fontSize: '10px' },
  monthNav: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '8px' },
  select: { padding: '4px', background: 'var(--vscode-input-background)', color: 'var(--vscode-input-foreground)', border: '1px solid var(--vscode-input-border)', borderRadius: '3px', fontSize: '11px' },
  summaryItem: { padding: '6px', background: 'var(--vscode-list-hoverBackground)', margin: '4px 0', borderRadius: '3px', fontSize: '10px', display: 'flex', gap: '6px', alignItems: 'flex-start', justifyContent: 'space-between' },
  summaryDate: { fontWeight: 600, marginBottom: '4px', color: 'var(--vscode-editor-foreground)' },
  summaryTasks: { color: 'var(--vscode-descriptionForeground)', lineHeight: 1.4, whiteSpace: 'pre-wrap' as const },
  summaryContainer: { display: 'flex', gap: '8px', height: '100%' },
  summaryLeft: { flex: '0 0 45%', display: 'flex', flexDirection: 'column' as const },
  summaryRight: { flex: 1, display: 'flex', flexDirection: 'column' as const },
  previewBox: { flex: 1, padding: '8px', background: 'var(--vscode-textCodeBlock-background)', color: 'var(--vscode-editor-foreground)', border: '1px solid var(--vscode-panel-border)', borderRadius: '4px', overflowY: 'auto' as const, fontSize: '11px', lineHeight: 1.5, whiteSpace: 'pre-wrap' as const, fontFamily: 'var(--vscode-editor-font-family)', margin: 0 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', borderBottom: '1px solid var(--vscode-panel-border)', flexShrink: 0 },
  headerTitle: { fontSize: '12px', fontWeight: 600, color: 'var(--vscode-foreground)' },
  settingsBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: 'var(--vscode-foreground)', padding: '2px 4px', opacity: 0.8 },
  settingRow: { marginBottom: '8px' },
  settingLabel: { fontSize: '10px', marginBottom: '2px', color: 'var(--vscode-foreground)' },
  settingValue: { fontSize: '10px', color: 'var(--vscode-descriptionForeground)', padding: '4px', background: 'var(--vscode-input-background)', borderRadius: '2px', wordBreak: 'break-all' as const },
  loadingBar: { padding: '6px 8px', marginBottom: '6px', background: 'var(--vscode-editorInfo-foreground)', color: 'white', borderRadius: '3px', fontSize: '10px', display: 'flex', gap: '8px', alignItems: 'center' },
};

// ============ 主组件 ============
export const App: React.FC = () => {
  const savedState = (vscode.getState() ?? {}) as WebviewPersistedState;
  const initialDate = savedState.logDate ?? getTodayStr();

  const [tab, setTab] = useState<TabType>(savedState.tab ?? 'today');
  const [log, setLog] = useState<DailyLog>({
    date: initialDate,
    completed: [],
    plan: [],
    blockers: [],
    notes: '',
    gitlog: [],
    ailog: [],
    gitCommit: [],
    origin_url: [],
  });
  const [config, setConfig] = useState<AppConfig>({ storagePath: '~/.work-logs', autoSave: true, aiEnabled: false });
  const [notification, setNotification] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [timesheetLoading, setTimesheetLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editIdx, setEditIdx] = useState<{ type: string; idx: number } | null>(null);
  const [editVal, setEditVal] = useState('');

  // 汇总页状态
  const [summaryYear, setSummaryYear] = useState(new Date().getFullYear());
  const [summaryMonth, setSummaryMonth] = useState(new Date().getMonth() + 1);
  const [monthlyData, setMonthlyData] = useState<MonthlyData | null>(null);
  const [importPreview, setImportPreview] = useState<{ source: string; items: { date: string; completed: string[]; exists: boolean }[] } | null>(null);
  const [importSelection, setImportSelection] = useState<Record<string, boolean>>({});
  const [materials, setMaterials] = useState<{ month: string; files: { name: string; path: string; size: number; selected: boolean }[] }[]>([]);
  const [filterDailyJson, setFilterDailyJson] = useState(true);
  const [repositoryOptions, setRepositoryOptions] = useState<string[]>([]);

  // 输入框
  const [completedInput, setCompletedInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [gitlogInput, setGitlogInput] = useState('');
  const [ailogInput, setAilogInput] = useState('');
  const [gitCommitInput, setGitCommitInput] = useState('');
  const [planInput, setPlanInput] = useState('');
  const [blockerInput, setBlockerInput] = useState('');
  const [originUrlInput, setOriginUrlInput] = useState('');
  const [fillReview, setFillReview] = useState<FillPreview | null>(null);
  const [showPanelSettings, setShowPanelSettings] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [pluginSettings, setPluginSettings] = useState<PluginSettingsForm | null>(null);
  const [pluginSecrets, setPluginSecrets] = useState<{
    apiKey: SecretMeta;
    emailPassword: SecretMeta;
  } | null>(null);
  const [vscodeConfig, setVscodeConfig] = useState<VscodeConfigDisplay | null>(null);
  const [apiKeyEdit, setApiKeyEdit] = useState('');
  const [emailPasswordEdit, setEmailPasswordEdit] = useState('');
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, string | null>>({
    apiKey: null,
    emailPassword: null,
  });
  const [collectView, setCollectView] = useState<CollectView>(savedState.collectView ?? 'day');
  const [collectRangeStart, setCollectRangeStart] = useState(
    savedState.collectRangeStart ?? initialDate,
  );
  const [collectRangeEnd, setCollectRangeEnd] = useState(
    savedState.collectRangeEnd ?? initialDate,
  );
  const [collectCacheHit, setCollectCacheHit] = useState(false);
  const [collectLoading, setCollectLoading] = useState<CollectLoadingState>({
    active: false,
    title: '',
    status: '处理中…',
    feedItems: [],
  });
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabRef = useRef(tab);
  const loadDateRef = useRef<(dateStr: string) => void>(() => {});
  const loadMonthRef = useRef<() => void>(() => {});

  tabRef.current = tab;

  const notify = useCallback((msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 2000);
  }, []);

  const mapPluginSettings = (
    raw: any,
    defaultPrompt = '',
  ): PluginSettingsForm => ({
    displayName: raw?.displayName || 'User',
    outputDir: raw?.outputDir || '',
    searchRoots: (raw?.searchRoots || []).join(', '),
    originFilters: (
      raw?.originFilters?.length
        ? raw.originFilters
        : raw?.originHosts || []
    ).join(', '),
    authorAliases: (raw?.authorAliases || []).join(', '),
    aiEnabled: !!raw?.aiEnabled,
    aiPreset: raw?.aiPreset || 'deepseek',
    aiModel: raw?.aiModel || 'deepseek-chat',
    aiBaseUrl: raw?.aiBaseUrl || 'https://api.deepseek.com',
    aiThinkingEnabled: raw?.aiThinkingEnabled !== false,
    aiReasoningEffort: raw?.aiReasoningEffort === 'max' ? 'max' : 'high',
    aiTemperature:
      typeof raw?.aiTemperature === 'number' ? raw.aiTemperature : 0.2,
    aiTimeoutMs:
      typeof raw?.aiTimeoutMs === 'number' && raw.aiTimeoutMs > 0
        ? raw.aiTimeoutMs
        : 180_000,
    aiSystemPrompt: raw?.aiSystemPrompt?.trim()
      ? raw.aiSystemPrompt
      : defaultPrompt,
    aiSystemPromptDefault: defaultPrompt,
    aiShowReasoningStream: raw?.aiShowReasoningStream !== false,
    timesheetContentField: raw?.timesheetContentField || 'ailog',
    visibleFields: Array.isArray(raw?.visibleFields) ? raw.visibleFields : [],
    dailySyncFieldVisibility: !!raw?.dailySyncFieldVisibility,
    gitCollectCacheEnabled: raw?.gitCollectCacheEnabled !== false,
    autoPolishAfterCollect: !!raw?.autoPolishAfterCollect,
    weekendRollforward: !!raw?.weekendRollforward,
    openRepoInNewWindow: !!raw?.openRepoInNewWindow,
    timesheet: {
      company: raw?.timesheet?.company || '',
      approver: raw?.timesheet?.approver || '',
      defaultHours: raw?.timesheet?.defaultHours ?? 8,
    },
    email: {
      smtpHost: raw?.email?.smtpHost || '',
      smtpPort: raw?.email?.smtpPort || 587,
      username: raw?.email?.username || '',
      from: raw?.email?.from || '',
      to: raw?.email?.to || '',
      cc: raw?.email?.cc || '',
    },
  });

  // 加载日期
  const loadDate = useCallback((dateStr: string) => {
    setLoading(true);
    setEditIdx(null);
    vscode.postMessage({ command: 'loadDate', date: dateStr });
    vscode.postMessage({ command: 'loadRepositoryOptions', month: dateStr.slice(0, 7) });
    vscode.postMessage({ command: 'updateDailyPreview', date: dateStr });
  }, []);

  loadDateRef.current = loadDate;

  useEffect(() => {
    vscode.setState({
      tab,
      logDate: log.date,
      collectView,
      collectRangeStart,
      collectRangeEnd,
    } satisfies WebviewPersistedState);
  }, [tab, log.date, collectView, collectRangeStart, collectRangeEnd]);

  // 消息监听
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data;
      switch (msg.command) {
        case 'init':
          if (msg.todayLog) {
            setLog(msg.todayLog);
          }
          if (msg.repositoryOptions) { setRepositoryOptions(msg.repositoryOptions); }
          if (msg.config) { setConfig(msg.config); }
          setDirty(false);
          setLoading(false);
          break;
        case 'dateLoaded':
          if (msg.log) { setLog(msg.log); setDirty(false); }
          if (msg.repositoryOptions) { setRepositoryOptions(msg.repositoryOptions); }
          setLoading(false);
          break;
        case 'repositoryOptionsLoaded':
          setRepositoryOptions(msg.options || []);
          break;
        case 'saved':
          notify(msg.message || '✅ 已保存');
          setDirty(false);
          break;
        case 'monthLogsLoaded':
          setMonthlyData(msg.data);
          break;
        case 'materials':
          setMaterials((msg.data || []).map((item: any) => ({
            month: item.month,
            files: (item.files || []).map((f: any) => ({ ...f, selected: true }))
          })));
          break;
        case 'importPreview':
          setImportPreview({ source: msg.source, items: msg.items || [] });
          setImportSelection(Object.fromEntries((msg.items || []).map((item: any) => [item.date, !item.exists])));
          notify(`✅ 已解析导入文件: ${msg.source}`);
          break;
        case 'importResult':
          notify(`✅ 导入完成: ${msg.imported} 条，跳过 ${msg.skipped} 条`);
          setImportPreview(null);
          setImportSelection({});
          if (tabRef.current === 'summary') {
            loadMonthRef.current();
          }
          break;
        case 'fullConfigUpdate':
          setConfig(msg.config);
          notify('✅ 配置已加载');
          break;
        case 'aiGenerated':
          notify(msg.message || '✅ AI 已生成');
          setAiLoading(false);
          break;
        case 'aiError':
          notify(msg.message || '❌ AI 生成失败');
          setAiLoading(false);
          break;
        case 'aiLoading':
          setAiLoading(!!msg.loading);
          if (msg.loading) {
            notify('⏳ AI 生成中...');
          }
          break;
        case 'timesheetGenerated':
          notify(msg.message);
          setTimesheetLoading(false);
          break;
        case 'emailSent':
          notify(msg.message);
          break;
        case 'openPanelSettings':
          setShowPanelSettings(true);
          setShowProfile(false);
          vscode.postMessage({ command: 'getPluginSettings' });
          break;
        case 'openProfile':
          setShowProfile(true);
          setShowPanelSettings(false);
          vscode.postMessage({ command: 'getPluginSettings' });
          break;
        case 'pluginSettingsLoaded': {
          const mapped = mapPluginSettings(
            msg.settings,
            msg.aiSystemPromptDefault || '',
          );
          setPluginSettings(mapped);
          setConfig((prev) => ({ ...prev, aiEnabled: mapped.aiEnabled }));
          setPluginSecrets(msg.secrets || null);
          setVscodeConfig(msg.vscodeConfig || null);
          setApiKeyEdit('');
          setEmailPasswordEdit('');
          setRevealedSecrets({ apiKey: null, emailPassword: null });
          break;
        }
        case 'secretRevealed':
          setRevealedSecrets((prev) => ({
            ...prev,
            [msg.field]: msg.value || '',
          }));
          break;
        case 'pluginSettingsSaved':
          notify('✅ 设置已保存');
          setShowPanelSettings(false);
          setShowProfile(false);
          vscode.postMessage({ command: 'getFullConfig' });
          vscode.postMessage({ command: 'getPluginSettings' });
          break;
        case 'collectLogStart':
          setCollectLoading({
            active: true,
            title: msg.title || '采集中',
            status: '处理中…',
            feedItems: [],
          });
          setFillReview(null);
          setCollectCacheHit(false);
          break;
        case 'collectLogAppend':
          setCollectLoading((prev) => ({
            ...prev,
            status: msg.line || prev.status,
            feedItems: msg.line ? [...prev.feedItems, msg.line] : prev.feedItems,
          }));
          break;
        case 'collectLogEnd':
          setCollectLoading((prev) => ({ ...prev, active: false }));
          if (msg.cancelled) {
            notify(msg.error || '已取消采集');
          } else if (msg.preview) {
            setFillReview(msg.preview);
            setCollectCacheHit(!!msg.fromCache);
            notify(
              msg.fromCache
                ? '✅ 已生成确认清单（来自缓存）'
                : '✅ 已生成确认清单',
            );
          } else if (msg.error) {
            notify(`❌ ${msg.error}`);
          }
          break;
        case 'fillPreviewReady':
          setFillReview(msg.preview);
          setCollectLoading((prev) => ({ ...prev, active: false }));
          notify('✅ 已生成确认清单');
          break;
        case 'fillApplied':
          notify(msg.message || '✅ 已写入');
          setFillReview(null);
          if (msg.reloadDate) {
            loadDateRef.current(String(msg.reloadDate));
          }
          break;
        case 'notify':
          if (msg.message) {
            notify(String(msg.message));
          }
          break;
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ command: 'ready', activeDate: initialDate });
    return () => window.removeEventListener('message', handler);
  }, [notify, initialDate]);

  // 更新日志
  const updateLog = useCallback((fn: (prev: DailyLog) => DailyLog) => {
    setLog(prev => { setDirty(true); return fn(prev); });
  }, []);

  // 添加项目
  const addItem = (type: EditableArrayField, val: string, setter: (v: string) => void) => {
    if (val.trim()) {
      const nextValue = val.trim();
      updateLog(prev => {
        const current = prev[type] || [];
        if (current.includes(nextValue)) {
          return prev;
        }
        return { ...prev, [type]: [...current, nextValue] };
      });
      setter('');
    }
  };

  // 删除项目
  const removeItem = (type: EditableArrayField, idx: number) => {
    updateLog(prev => ({ ...prev, [type]: (prev[type] || []).filter((_, i) => i !== idx) }));
  };

  // 编辑项目
  const startEdit = (type: string, idx: number, val: string) => {
    setEditIdx({ type, idx });
    setEditVal(val);
  };

  const saveEdit = () => {
    if (editIdx && editVal.trim()) {
      const { type, idx } = editIdx;
      updateLog(prev => ({
        ...prev,
        [type]: (prev[type as EditableArrayField] || []).map((v, i) => i === idx ? editVal.trim() : v)
      }));
    }
    setEditIdx(null);
    setEditVal('');
  };

  const cancelEdit = () => {
    setEditIdx(null);
    setEditVal('');
  };

  const save = useCallback(() => {
    vscode.postMessage({ command: 'save', log });
  }, [log]);

  useEffect(() => {
    if (!config.autoSave || !dirty || tab !== 'today') {
      return;
    }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      save();
    }, 800);
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [log, dirty, config.autoSave, tab, save]);

  const buildCollectRequest = (): CollectRequest => {
    if (collectView === 'custom') {
      const range = normalizeCustomRange(collectRangeStart, collectRangeEnd);
      return {
        scope: 'custom',
        anchorDate: range.start,
        rangeStart: range.start,
        rangeEnd: range.end,
      };
    }
    return {
      scope: collectView,
      anchorDate: log.date,
    };
  };

  const collectRequestMatchesPreview = (
    request: CollectRequest,
    preview: FillPreview,
  ): boolean => {
    if (preview.scope !== request.scope || preview.anchorDate !== request.anchorDate) {
      return false;
    }
    if (request.scope === 'custom') {
      return (
        preview.rangeStart === request.rangeStart &&
        preview.rangeEnd === request.rangeEnd
      );
    }
    return true;
  };

  const collectRequest = buildCollectRequest();
  const collectScopeLabel = formatFillAnchorLabel(
    collectRequest.scope,
    collectRequest.anchorDate,
    resolveCustomRange(collectRequest),
  );

  const handleCollectViewChange = (next: CollectView) => {
    if (fillReview && !window.confirm('切换采集范围将丢弃当前确认页，是否继续？')) {
      return;
    }
    const nextState = transitionCollectView(
      collectViewStateFromParts(
        collectView,
        log.date,
        collectRangeStart,
        collectRangeEnd,
      ),
      next,
    );
    setCollectView(nextState.view);
    setCollectRangeStart(nextState.customStart);
    setCollectRangeEnd(nextState.customEnd);
    if (nextState.logDate !== log.date) {
      loadDate(nextState.logDate);
    }
    if (fillReview) {
      setFillReview(null);
      vscode.postMessage({ command: 'discardFillPreview' });
    }
  };

  useEffect(() => {
    if (!fillReview) {
      return;
    }
    if (!collectRequestMatchesPreview(buildCollectRequest(), fillReview)) {
      setFillReview(null);
      vscode.postMessage({ command: 'discardFillPreview' });
    }
  }, [collectView, log.date, collectRangeStart, collectRangeEnd, fillReview]);

  const collectAndPolish = () => {
    if (pluginSecrets && !pluginSecrets.apiKey.configured) {
      notify('请先在系统设置中配置 API Key');
      vscode.postMessage({ command: 'openPanelSettings' });
      return;
    }
    const request = buildCollectRequest();
    vscode.postMessage({
      command: 'collectAndPolish',
      scope: request.scope,
      anchorDate: request.anchorDate,
      rangeStart: request.rangeStart,
      rangeEnd: request.rangeEnd,
    });
  };

  const collectGit = (forceRescan = false) => {
    const request = buildCollectRequest();
    vscode.postMessage({
      command: 'collectGitFill',
      scope: request.scope,
      anchorDate: request.anchorDate,
      rangeStart: request.rangeStart,
      rangeEnd: request.rangeEnd,
      forceRescan,
    });
  };

  const collectRescan = () => collectGit(true);

  const polishAi = (reuseInMemoryPreview = false) => {
    if (pluginSecrets && !pluginSecrets.apiKey.configured) {
      notify('请先在系统设置中配置 API Key');
      vscode.postMessage({ command: 'openPanelSettings' });
      return;
    }
    const request = buildCollectRequest();
    vscode.postMessage({
      command: 'aiPolishFill',
      scope: request.scope,
      anchorDate: request.anchorDate,
      rangeStart: request.rangeStart,
      rangeEnd: request.rangeEnd,
      // 仅确认页「重新 AI 润色」复用内存 preview；工具栏只润色已有采集数据
      preview: reuseInMemoryPreview && fillReview?.source === 'ai' ? fillReview : undefined,
    });
  };

  const cancelCollect = () => {
    vscode.postMessage({ command: 'cancelCollect' });
  };

  // 日期导航
  const goPrev = () => loadDate(addDays(log.date, -1));
  const goNext = () => loadDate(addDays(log.date, 1));
  const goToday = () => { if (log.date !== getTodayStr()) { loadDate(getTodayStr()); } };
  const isToday = log.date === getTodayStr();

  // 汇总页：加载月度数据
  const loadMonth = useCallback(() => {
    vscode.postMessage({ command: 'loadMonthLogs', year: summaryYear, month: summaryMonth });
    vscode.postMessage({ command: 'updateSummaryPreview', year: summaryYear, month: summaryMonth });
  }, [summaryYear, summaryMonth]);

  loadMonthRef.current = loadMonth;

  useEffect(() => {
    if (tab === 'summary') { loadMonth(); }
  }, [tab, loadMonth]);

  useEffect(() => {
    if (tab === 'summary') {
      vscode.postMessage({ command: 'closeDailyPreview' });
      vscode.postMessage({ command: 'openSummaryPreview', year: summaryYear, month: summaryMonth });
    } else if (tab === 'materials') {
      vscode.postMessage({ command: 'closeSummaryPreview' });
      vscode.postMessage({ command: 'closeDailyPreview' });
      vscode.postMessage({ command: 'listMaterials' });
    } else {
      vscode.postMessage({ command: 'closeSummaryPreview' });
      vscode.postMessage({ command: 'openDailyPreview', date: log.date });
    }
  }, [tab, summaryYear, summaryMonth]);

  useEffect(() => {
    if (tab === 'today') {
      vscode.postMessage({ command: 'updateDailyPreview', date: log.date });
    }
  }, [tab, log.date]);

  // 生成工时表
  const generateTimesheet = () => {
    if (timesheetLoading) {
      return;
    }
    setTimesheetLoading(true);
    vscode.postMessage({ command: 'generateTimesheet', year: summaryYear, month: summaryMonth });
  };

  const generateTimesheetFull = () => {
    vscode.postMessage({ command: 'generateTimesheetFull', year: summaryYear, month: summaryMonth });
  };

  const selectXlsxImport = () => {
    vscode.postMessage({ command: 'selectXlsxImport', year: summaryYear, month: summaryMonth });
  };

  const confirmImport = () => {
    const dates = Object.keys(importSelection).filter((d) => importSelection[d]);
    vscode.postMessage({ command: 'confirmImport', year: summaryYear, month: summaryMonth, dates });
  };

  const generateAiAll = () => {
    if (aiLoading) {
      return;
    }
    setAiLoading(true);
    vscode.postMessage({ command: 'aiGenerateAll', year: summaryYear, month: summaryMonth });
  };

  const sendSelectedFiles = (month: string, files: { path: string; selected: boolean }[]) => {
    const subject = `${month} 工作汇总材料`;
    const body = `请查收 ${month} 工作材料。`;
    const attachments = files.filter((f: { selected: boolean; path: string }) => f.selected).map((f: { path: string }) => f.path);
    vscode.postMessage({ command: 'sendEmailWithAttachments', subject, body, attachments });
  };

  const openMaterial = (filePath: string) => {
    vscode.postMessage({ command: 'openMaterial', path: filePath });
  };

  const deleteMaterial = (filePath: string) => {
    vscode.postMessage({ command: 'deleteMaterial', path: filePath });
  };

  const openPanelSettings = () => {
    setShowPanelSettings(true);
    vscode.postMessage({ command: 'getPluginSettings' });
  };
  const refreshConfig = () => vscode.postMessage({ command: 'getFullConfig' });

  const savePluginSettings = (apiKey: string, emailPassword: string) => {
    if (!pluginSettings) {
      return;
    }
    vscode.postMessage({
      command: 'savePluginSettings',
      settings: {
        ...pluginSettings,
        searchRoots: pluginSettings.searchRoots
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        originFilters: pluginSettings.originFilters
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        authorAliases: pluginSettings.authorAliases
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      },
      apiKey: apiKey || undefined,
      emailPassword: emailPassword || undefined,
    });
  };


  // ============ 渲染列表项 ============
  const renderItems = (type: Exclude<EditableArrayField, 'origin_url'>, items: string[], placeholder: string, input: string, setInput: (v: string) => void) => (
    <div style={S.section}>
      <div style={S.sectionTitle}>
        {type === 'completed' && '✅ 今日完成'}
        {type === 'gitlog' && '🧾 GitLog'}
        {type === 'ailog' && '🤖 AILog'}
        {type === 'gitCommit' && '📝 GitCommit'}
        {type === 'plan' && '📝 明日计划'}
        {type === 'blockers' && '⚠️ 阻碍/问题'}
      </div>
      <div style={S.itemList}>
        {items.length === 0 ? (
          <div style={S.empty}>暂无记录</div>
        ) : items.map((item, idx) => (
          <div key={idx} style={S.item}>
            {editIdx?.type === type && editIdx?.idx === idx ? (
              <>
                <textarea
                  style={{ ...S.itemInput, minHeight: '60px', resize: 'vertical' }}
                  value={editVal}
                  onChange={e => setEditVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { saveEdit(); } else if (e.key === 'Escape') { cancelEdit(); } }}
                  autoFocus
                  rows={3}
                />
                <button style={S.iconBtn} onClick={saveEdit} title="保存">✓</button>
                <button style={S.iconBtn} onClick={cancelEdit} title="取消">✕</button>
              </>
            ) : (
              <>
                <span style={S.itemText}>{item}</span>
                <button style={S.iconBtn} onClick={() => startEdit(type, idx, item)} title="编辑">✎</button>
                <button style={S.delBtn} onClick={() => removeItem(type, idx)} title="删除">✕</button>
              </>
            )}
          </div>
        ))}
      </div>
      <div style={S.addRow}>
        <textarea
          style={{ ...S.input, minHeight: '32px', resize: 'vertical' }}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { addItem(type, input, setInput); } }}
          placeholder={`${placeholder} (Ctrl+Enter 添加)`}
          rows={1}
        />
        <button style={S.btn} onClick={() => addItem(type, input, setInput)}>添加</button>
      </div>
    </div>
  );

  const renderOriginUrlItems = () => (
    <div style={S.section}>
      <div style={S.sectionTitle}>🔗 相关仓库</div>
      <div style={S.itemList}>
        {(log.origin_url || []).length === 0 ? (
          <div style={S.empty}>暂无记录</div>
        ) : (log.origin_url || []).map((item, idx) => (
          <div key={item} style={S.item}>
            {editIdx?.type === 'origin_url' && editIdx?.idx === idx ? (
              <>
                <input
                  style={S.itemInput}
                  value={editVal}
                  onChange={e => setEditVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { saveEdit(); } else if (e.key === 'Escape') { cancelEdit(); } }}
                  autoFocus
                />
                <button style={S.iconBtn} onClick={saveEdit} title="保存">✓</button>
                <button style={S.iconBtn} onClick={cancelEdit} title="取消">✕</button>
              </>
            ) : (
              <>
                <span style={S.itemText}>{item}</span>
                <button style={S.iconBtn} onClick={() => startEdit('origin_url', idx, item)} title="编辑">✎</button>
                <button style={S.delBtn} onClick={() => removeItem('origin_url', idx)} title="删除">✕</button>
              </>
            )}
          </div>
        ))}
      </div>
      <div style={S.addRow}>
        <input
          list="origin-url-options"
          style={S.input}
          value={originUrlInput}
          onChange={e => setOriginUrlInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { addItem('origin_url', originUrlInput, setOriginUrlInput); } }}
          placeholder="选择或输入仓库 origin_url"
        />
        <datalist id="origin-url-options">
          {repositoryOptions.map(option => <option key={option} value={option} />)}
        </datalist>
        <button style={S.btn} onClick={() => addItem('origin_url', originUrlInput, setOriginUrlInput)}>添加</button>
      </div>
    </div>
  );

  const showDailyOptionalField = (
    field: 'gitlog' | 'gitCommit' | 'plan' | 'blockers' | 'notes',
  ): boolean => {
    if (!config.dailySyncFieldVisibility) {
      return true;
    }
    switch (field) {
      case 'gitlog':
        return !!config.showGitlogInput;
      case 'gitCommit':
        return !!config.showGitCommitInput;
      case 'plan':
        return !!config.showPlanInput;
      case 'blockers':
        return !!config.showBlockersInput;
      case 'notes':
        return !!config.showNotesInput;
      default:
        return false;
    }
  };

  // ============ 日报 Tab ============
  const renderTodayTab = () => (
    <div>
      <div className="today-toolbar">
        <div className="today-toolbar-row today-toolbar-row--date">
          <button style={S.navBtn} type="button" onClick={goPrev} aria-label="前一天">
            ◀
          </button>
          <input
            type="date"
            style={S.dateInput}
            value={log.date}
            onChange={e => e.target.value && loadDate(e.target.value)}
          />
          <button style={S.navBtn} type="button" onClick={goNext} aria-label="后一天">
            ▶
          </button>
          {!isToday && (
            <button style={S.btnSm} type="button" onClick={goToday}>
              今天
            </button>
          )}
        </div>
        <div className="today-toolbar-row today-toolbar-row--collect">
          <div className="today-toolbar-collect-left">
            <ScopeToggle value={collectView} onChange={handleCollectViewChange} />
            {collectView === 'custom' ? (
              <div className="collect-date-range">
                <label className="collect-date-field">
                  <span className="collect-date-label">开始</span>
                  <input
                    type="date"
                    className="collect-date-input"
                    value={collectRangeStart}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (next) {
                        setCollectRangeStart(next);
                      }
                    }}
                  />
                </label>
                <span className="collect-date-sep">~</span>
                <label className="collect-date-field">
                  <span className="collect-date-label">结束</span>
                  <input
                    type="date"
                    className="collect-date-input"
                    value={collectRangeEnd}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (next) {
                        setCollectRangeEnd(next);
                      }
                    }}
                  />
                </label>
              </div>
            ) : (
              <span
                className="collect-scope-label"
                title={formatFillAnchorHint(collectRequest)}
              >
                范围 {collectScopeLabel}
              </span>
            )}
          </div>
          <div className="today-toolbar-collect-right">
            {collectCacheHit && (
              <span className="collect-cache-badge" title="上次采集命中缓存">
                缓存
              </span>
            )}
            <button type="button" className="btn secondary" onClick={() => collectGit()}>
              Git 采集
            </button>
            {collectCacheHit && (
              <button
                type="button"
                className="btn secondary"
                onClick={collectRescan}
                title="忽略缓存，重新扫描 Git"
              >
                重新扫描
              </button>
            )}
            <button type="button" className="btn" onClick={collectAndPolish}>
              采集并润色
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => polishAi()}
              title={
                pluginSecrets?.apiKey.configured
                  ? '基于已有 Git 采集数据润色 AILog（不重复脚本采集）'
                  : '请先在系统设置配置 API Key 并启用 AI 润色'
              }
            >
              AI 润色
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div style={S.empty}>加载中...</div>
      ) : (
        <>
          {renderItems('completed', log.completed, '输入完成的任务...', completedInput, setCompletedInput)}
          {showDailyOptionalField('gitlog') && renderItems('gitlog', log.gitlog || [], '输入 GitLog...', gitlogInput, setGitlogInput)}
          {renderItems('ailog', log.ailog || [], '输入 AILog...', ailogInput, setAilogInput)}
          {showDailyOptionalField('gitCommit') && renderItems('gitCommit', log.gitCommit || [], '输入 GitCommit...', gitCommitInput, setGitCommitInput)}
          {renderOriginUrlItems()}
          {showDailyOptionalField('plan') && renderItems('plan', log.plan, '输入明日计划...', planInput, setPlanInput)}
          {showDailyOptionalField('blockers') && renderItems('blockers', log.blockers, '输入阻碍或问题...', blockerInput, setBlockerInput)}
          {showDailyOptionalField('notes') && (
          <div style={S.section}>
            <div style={S.sectionTitle}>📌 备注</div>
            <textarea
              style={S.textarea}
              value={log.notes}
              onChange={e => updateLog(prev => ({ ...prev, notes: e.target.value }))}
              placeholder="其他备注..."
            />
          </div>
          )}
        </>
      )}
    </div>
  );

  // ============ 汇总 Tab ============
  const renderSummaryTab = () => (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {(aiLoading || timesheetLoading) && (
        <div style={S.loadingBar}>
          {aiLoading && <span>AI 生成中...</span>}
          {timesheetLoading && <span>工时表生成中...</span>}
        </div>
      )}
      <div style={S.monthNav}>
        <button
          style={S.navBtn}
          onClick={() => {
            const prev = summaryMonth - 1;
            if (prev < 1) {
              setSummaryYear(summaryYear - 1);
              setSummaryMonth(12);
            } else {
              setSummaryMonth(prev);
            }
          }}
        >
          ◀
        </button>
        <select style={S.select} value={summaryYear} onChange={e => setSummaryYear(Number(e.target.value))}>
          {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}年</option>)}
        </select>
        <select style={S.select} value={summaryMonth} onChange={e => setSummaryMonth(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}月</option>)}
        </select>
        <button
          style={S.navBtn}
          onClick={() => {
            const next = summaryMonth + 1;
            if (next > 12) {
              setSummaryYear(summaryYear + 1);
              setSummaryMonth(1);
            } else {
              setSummaryMonth(next);
            }
          }}
        >
          ▶
        </button>
        <button
          style={S.btnSm}
          onClick={() => {
            vscode.postMessage({ command: 'clearSummaryCache', year: summaryYear, month: summaryMonth });
            loadMonth();
          }}
        >
          刷新
        </button>
      </div>

      {importPreview && (
        <div style={{ ...S.section, marginBottom: '8px' }}>
          <div style={{ ...S.sectionTitle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>📥 导入预览 ({importPreview.source})</span>
            <button
              type="button"
              style={S.btnSm}
              onClick={() => {
                const all: Record<string, boolean> = {};
                for (const item of importPreview.items) {
                  all[item.date] = true;
                }
                setImportSelection(all);
              }}
            >
              全选
            </button>
          </div>
          <div style={{ maxHeight: '120px', overflowY: 'auto', fontSize: '10px' }}>
            {importPreview.items.map(item => (
              <label key={item.date} style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', marginBottom: '4px' }}>
                <input
                  type="checkbox"
                  checked={!!importSelection[item.date]}
                  onChange={(e) => {
                    setImportSelection(prev => ({ ...prev, [item.date]: e.target.checked }));
                  }}
                />
                <div>
                  <strong>{item.date}</strong> {item.exists ? '(已存在)' : ''}
                  <div style={{ color: 'var(--vscode-descriptionForeground)' }}>
                    {(item.completed || []).join(' | ') || '(无内容)'}
                  </div>
                </div>
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
            <button style={S.btnSm} onClick={confirmImport}>确认导入</button>
            <button style={S.btnSm} onClick={() => setImportPreview(null)}>取消</button>
          </div>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0 }}>
        <div style={{ ...S.section, height: '100%', marginBottom: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ ...S.sectionTitle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>📋 日志列表 ({monthlyData?.logs.length || 0}条)</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                style={{ ...S.btnSm, border: '1px solid var(--vscode-panel-border)', opacity: timesheetLoading ? 0.6 : 1 }}
                onClick={generateTimesheet}
                title={timesheetLoading ? '工时表生成中...' : '生成工时表'}
                disabled={timesheetLoading}
              >
                📄
              </button>
              {config.aiEnabled && (
                <button
                  style={{ ...S.btnSm, border: '1px solid var(--vscode-panel-border)', opacity: aiLoading ? 0.6 : 1 }}
                  onClick={generateAiAll}
                  disabled={aiLoading}
                  title={aiLoading ? 'AI 生成中...' : 'AI 润色/总结'}
                >
                  🧠
                </button>
              )}
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {!monthlyData || monthlyData.logs.length === 0 ? (
              <div style={S.empty}>暂无日志</div>
            ) : (
              monthlyData.logs.map(l => (
                <div key={l.date} style={S.summaryItem}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={S.summaryDate}>{l.date}</div>
                    <div style={S.summaryTasks}>
                      完成: {(l.completed || []).join(' | ') || '(无)'}
                    </div>
                    {config.showGitlogInput && (
                      <div style={S.summaryTasks}>
                        GitLog: {(l.gitlog || []).join(' | ') || '(无)'}
                      </div>
                    )}
                    <div style={S.summaryTasks}>
                      AILog: {(l.ailog || []).join(' | ') || '(无)'}
                    </div>
                    {config.showGitCommitInput && (l.gitCommit || []).length > 0 && (
                      <div style={S.summaryTasks}>GitCommit: {(l.gitCommit || []).join(' | ')}</div>
                    )}
                    <div style={S.summaryTasks}>
                      仓库: {(l.origin_url || []).join(' | ') || '(无)'}
                    </div>
                    {config.showPlanInput && (l.plan || []).length > 0 && (
                      <div style={S.summaryTasks}>计划: {(l.plan || []).join(' | ')}</div>
                    )}
                    {config.showBlockersInput && (l.blockers || []).length > 0 && (
                      <div style={S.summaryTasks}>阻碍: {(l.blockers || []).join(' | ')}</div>
                    )}
                    {config.showNotesInput && l.notes && (
                      <div style={S.summaryTasks}>备注: {l.notes}</div>
                    )}
                  </div>
                  <button
                    style={{ ...S.btnSm, padding: '2px 6px', border: '1px solid var(--vscode-panel-border)' }}
                    onClick={() => {
                      setTab('today');
                      loadDate(l.date);
                    }}
                    title="编辑日报"
                  >
                    ✏️
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

    </div>
  );

  const renderMaterialsTab = () => (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={S.sectionTitle}>📦 月度材料</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px' }}>
          <input
            type="checkbox"
            checked={filterDailyJson}
            onChange={(e) => setFilterDailyJson(e.target.checked)}
          />
          过滤日报 JSON
        </label>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {materials.length === 0 ? (
          <div style={S.empty}>暂无材料</div>
        ) : (
          materials.map((item, idx) => (
            <div key={item.month} style={{ ...S.section, marginBottom: '8px' }}>
              <div style={{ ...S.sectionTitle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>{item.month}</span>
              <button
                style={S.btnSm}
                onClick={() => sendSelectedFiles(item.month, item.files)}
                title="发送选中文件"
              >
                📤
              </button>
              </div>
              {item.files.filter(file => !(filterDailyJson && file.name.endsWith('.json') && /^\d{4}-\d{2}-\d{2}\.json$/.test(file.name))).length === 0 ? (
                <div style={S.empty}>暂无文件</div>
              ) : (
                item.files
                  .filter(file => !(filterDailyJson && file.name.endsWith('.json') && /^\d{4}-\d{2}-\d{2}\.json$/.test(file.name)))
                  .map((file, fIdx) => (
                  <label key={file.path} style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px', justifyContent: 'space-between' }}>
                    <input
                      type="checkbox"
                      checked={file.selected}
                      onChange={(e) => {
                        setMaterials(prev => prev.map((m, mi) => {
                          if (mi !== idx) {
                            return m;
                          }
                          return {
                            ...m,
                            files: m.files.map((f, fi) => fi === fIdx ? { ...f, selected: e.target.checked } : f)
                          };
                        }));
                      }}
                    />
                    <span style={{ flex: 1 }}>{file.name}</span>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button
                        style={S.btnSm}
                        onClick={() => openMaterial(file.path)}
                        title="打开"
                      >
                        📂
                      </button>
                      <button
                        style={S.btnSm}
                        onClick={() => deleteMaterial(file.path)}
                        title="删除"
                      >
                        🗑️
                      </button>
                    </div>
                  </label>
                ))
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );

  const secretHandlers = {
    onReveal: (field: 'apiKey' | 'emailPassword') =>
      vscode.postMessage({ command: 'revealPluginSecret', field }),
    onHide: (field: 'apiKey' | 'emailPassword') =>
      setRevealedSecrets((prev) => ({ ...prev, [field]: null })),
  };

  if (showProfile && pluginSettings) {
    return (
      <div style={S.app}>
        <ProfileOverlay
          settings={pluginSettings}
          secrets={
            pluginSecrets || {
              apiKey: { configured: false, masked: '' },
              emailPassword: { configured: false, masked: '' },
            }
          }
          onChange={setPluginSettings}
          onSave={savePluginSettings}
          onClose={() => setShowProfile(false)}
          apiKeyEdit={apiKeyEdit}
          emailPasswordEdit={emailPasswordEdit}
          onApiKeyEdit={setApiKeyEdit}
          onEmailPasswordEdit={setEmailPasswordEdit}
          revealed={revealedSecrets}
          {...secretHandlers}
        />
      </div>
    );
  }

  if (showPanelSettings && pluginSettings) {
    return (
      <div style={S.app}>
        <SettingsOverlay
          settings={pluginSettings}
          secrets={
            pluginSecrets || {
              apiKey: { configured: false, masked: '' },
              emailPassword: { configured: false, masked: '' },
            }
          }
          vscodeConfig={vscodeConfig || undefined}
          onChange={setPluginSettings}
          onSave={savePluginSettings}
          onClose={() => setShowPanelSettings(false)}
          apiKeyEdit={apiKeyEdit}
          emailPasswordEdit={emailPasswordEdit}
          onApiKeyEdit={setApiKeyEdit}
          onEmailPasswordEdit={setEmailPasswordEdit}
          revealed={revealedSecrets}
          {...secretHandlers}
        />
      </div>
    );
  }

  if (showPanelSettings || showProfile) {
    return (
      <div style={S.app}>
        <div className="collect-terminal-overlay">
          <p className="collect-terminal-hint">加载设置中…</p>
        </div>
      </div>
    );
  }

  if (collectLoading.active) {
    return (
      <div style={S.app}>
        <CollectLoadingOverlay loading={collectLoading} onCancel={cancelCollect} />
      </div>
    );
  }

  if (fillReview) {
    return (
      <div style={S.app}>
        {notification && <div style={S.notification}>{notification}</div>}
        <FillReviewOverlay
          preview={fillReview}
          onChange={setFillReview}
          onBack={() => {
            setFillReview(null);
            vscode.postMessage({ command: 'discardFillPreview' });
            loadDate(log.date);
          }}
          onApplyGit={() =>
            vscode.postMessage({
              command: 'applyFillPreview',
              preview: fillReview,
              mode: 'git',
            })
          }
          onApplyAi={() =>
            vscode.postMessage({
              command: 'applyFillPreview',
              preview: fillReview,
              mode: 'ai',
            })
          }
          onRepolish={() => polishAi(true)}
        />
      </div>
    );
  }

  return (
    <div style={S.app}>
      {notification && <div style={S.notification}>{notification}</div>}

      <div style={S.tabs}>
        {(['today', 'summary', 'materials'] as TabType[]).map(t => (
          <button key={t} style={{ ...S.tab, ...(tab === t ? S.tabActive : {}) }} onClick={() => setTab(t)}>
            {t === 'today' && '📋 日报'}
            {t === 'summary' && '📊 汇总'}
            {t === 'materials' && '📦 材料'}
            {tab === t && <span style={S.tabIndicator} />}
          </button>
        ))}
      </div>

      <div style={S.content}>
        {tab === 'today' && renderTodayTab()}
        {tab === 'summary' && renderSummaryTab()}
        {tab === 'materials' && renderMaterialsTab()}
      </div>

      {tab === 'today' && !config.autoSave && (
        <div style={S.footer}>
          <button style={S.primaryBtn} onClick={save}>
            💾 保存 {dirty && '(有修改)'}
          </button>
        </div>
      )}
      
      {tab === 'summary' && (
        <div style={S.footer}>
          <div style={{ display: 'flex', gap: '6px' }}>
            {config.timesheetFullDateEnabled && (
              <button style={{ ...S.primaryBtn, width: 'auto', flex: 1 }} onClick={generateTimesheetFull}>🗓️ 全日期工时表</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
