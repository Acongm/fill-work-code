import * as vscode from 'vscode';
import MarkdownIt from 'markdown-it';
import type { DailyLog } from '../../daily/utils/workLogManager';
import type { PluginSettings } from '../../settings/types/pluginSettings';
import type { HostPanelDeps } from '../../app/types/hostDependencies';
import { isPreviewEnabled } from '../../shared/utils/panelUtils';
import { loadPluginSettings } from '../../settings/commands/settingsMessages';

function optionalFieldVisible(
  settings: PluginSettings,
  field: 'gitlog' | 'gitCommit' | 'plan' | 'blockers' | 'notes',
  context: 'daily' | 'summary' = 'summary',
): boolean {
  if (context === 'daily' && !settings.dailySyncFieldVisibility) {
    return true;
  }
  return new Set(settings.visibleFields).has(field);
}

function buildMonthlyPreviewWithAi(
  deps: HostPanelDeps,
  year: number,
  month: number,
  settings: PluginSettings,
): string {
  const monthly = deps.workLogManager.getMonthlyLogs(year, month);
  const showGitlog = optionalFieldVisible(settings, 'gitlog');
  const showGitCommit = optionalFieldVisible(settings, 'gitCommit');
  const showPlan = optionalFieldVisible(settings, 'plan');
  const showBlockers = optionalFieldVisible(settings, 'blockers');
  const showNotes = optionalFieldVisible(settings, 'notes');
  let text = `# ${year}年${month}月工作日报\n\n`;

  (monthly.logs || [])
    .filter(log => log.date)
    .forEach(log => {
      const completed = Array.isArray(log.completed) ? log.completed : [];
      const plan = Array.isArray(log.plan) ? log.plan : [];
      const blockers = Array.isArray(log.blockers) ? log.blockers : [];
      const gitlog = Array.isArray(log.gitlog) ? log.gitlog : [];
      const ailog = Array.isArray(log.ailog) ? log.ailog : [];
      const gitCommit = Array.isArray(log.gitCommit) ? log.gitCommit : [];
      const originUrls = Array.isArray(log.origin_url) ? log.origin_url : [];
      const notes = typeof log.notes === 'string' ? log.notes : '';

      text += `## ${log.date}\n`;
      text += `**完成:**\n${completed.map(t => `- ${t}`).join('\n') || '-'}\n\n`;
      if (showPlan) {
        text += `**计划:**\n${plan.map(t => `- ${t}`).join('\n') || '-'}\n\n`;
      }
      if (showBlockers && blockers.length > 0) {
        text += `**阻碍/问题:**\n${blockers.map(t => `- ${t}`).join('\n')}\n\n`;
      }
      if (showGitlog && gitlog.length > 0) {
        text += `**GitLog:**\n${gitlog.map(t => `- ${t}`).join('\n')}\n\n`;
      }
      text += `**AILog:**\n${ailog.map(t => `- ${t}`).join('\n') || '-'}\n\n`;
      if (showGitCommit && gitCommit.length > 0) {
        text += `**GitCommit:**\n${gitCommit.map(t => `- ${t}`).join('\n')}\n\n`;
      }
      text += `**相关仓库:**\n${originUrls.map(t => `- ${t}`).join('\n') || '-'}\n\n`;
      if (showNotes && notes) {
        text += `**备注:** ${notes}\n\n`;
      }
    });

  return text;
}

function renderDailyMarkdown(log: DailyLog, settings: PluginSettings): string {
  const safeDate = log.date || '未知日期';
  const completed = Array.isArray(log.completed) ? log.completed : [];
  const plan = Array.isArray(log.plan) ? log.plan : [];
  const blockers = Array.isArray(log.blockers) ? log.blockers : [];
  const gitlog = Array.isArray(log.gitlog) ? log.gitlog : [];
  const ailog = Array.isArray(log.ailog) ? log.ailog : [];
  const gitCommit = Array.isArray(log.gitCommit) ? log.gitCommit : [];
  const originUrls = Array.isArray(log.origin_url) ? log.origin_url : [];
  const notes = typeof log.notes === 'string' ? log.notes : '';
  const showGitlog = optionalFieldVisible(settings, 'gitlog', 'daily');
  const showGitCommit = optionalFieldVisible(settings, 'gitCommit', 'daily');
  const showPlan = optionalFieldVisible(settings, 'plan', 'daily');
  const showBlockers = optionalFieldVisible(settings, 'blockers', 'daily');
  const showNotes = optionalFieldVisible(settings, 'notes', 'daily');

  let text = `# ${safeDate} 日报\n\n`;
  text += `## 完成\n${completed.map(item => `- ${item}`).join('\n') || '-'}\n\n`;
  if (showPlan) {
    text += `## 计划\n${plan.map(item => `- ${item}`).join('\n') || '-'}\n\n`;
  }
  if (showBlockers) {
    text += `## 阻碍/问题\n${blockers.map(item => `- ${item}`).join('\n') || '-'}\n\n`;
  }
  if (showGitlog && gitlog.length > 0) {
    text += `## GitLog\n${gitlog.map(item => `- ${item}`).join('\n')}\n\n`;
  }
  text += `## AILog\n${ailog.map(item => `- ${item}`).join('\n') || '-'}\n\n`;
  if (showGitCommit && gitCommit.length > 0) {
    text += `## GitCommit\n${gitCommit.map(item => `- ${item}`).join('\n')}\n\n`;
  }
  text += `## 相关仓库\n${originUrls.map(item => `- ${item}`).join('\n') || '-'}\n\n`;
  if (showNotes && notes) {
    text += `## 备注\n${notes}\n`;
  }
  return text;
}

function renderLoadingHtml(message: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>加载中</title>
  <style>
    body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; }
    .hint { color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <div class="hint">${message}</div>
</body>
</html>`;
}

function renderMarkdownHtml(rendered: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; line-height: 1.6; }
    h1, h2, h3 { color: var(--vscode-foreground); margin: 16px 0 8px; }
    pre, code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); }
    pre { padding: 12px; border-radius: 6px; border: 1px solid var(--vscode-panel-border); overflow: auto; }
    ul { padding-left: 20px; }
    a { color: var(--vscode-textLink-foreground); }
  </style>
</head>
<body>
  ${rendered}
</body>
</html>`;
}

async function renderSummaryPreviewHtml(
  deps: HostPanelDeps,
  year: number,
  month: number,
): Promise<void> {
  if (!deps.state.summaryPreviewPanel) {
    return;
  }

  const settings = await loadPluginSettings(deps);
  const summary = buildMonthlyPreviewWithAi(deps, year, month, settings);
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
  });
  const rendered = md.render(summary);

  deps.state.summaryPreviewPanel.title = `📊 ${year}年${month}月报预览`;
  deps.state.summaryPreviewPanel.webview.html = renderMarkdownHtml(rendered, '工作汇总预览');
}

function updateSummaryPreview(deps: HostPanelDeps, year: number, month: number): void {
  if (!deps.state.summaryPreviewPanel) {
    return;
  }

  if (deps.state.summaryPreviewTimer) {
    clearTimeout(deps.state.summaryPreviewTimer);
  }

  deps.state.summaryPreviewPanel.webview.html = renderLoadingHtml('正在加载月报预览...');
  deps.state.summaryPreviewTimer = setTimeout(() => {
    void renderSummaryPreviewHtml(deps, year, month);
  }, 200);
}

export function openSummaryPreview(deps: HostPanelDeps, year: number, month: number): void {
  if (!isPreviewEnabled()) {
    return;
  }

  if (deps.state.summaryPreviewPanel) {
    deps.state.summaryPreviewPanel.reveal(vscode.ViewColumn.One);
    updateSummaryPreview(deps, year, month);
    return;
  }

  deps.state.summaryPreviewPanel = vscode.window.createWebviewPanel(
    'workLogSummaryPreview',
    `📊 ${year}年${month}月报预览`,
    vscode.ViewColumn.One,
    { enableScripts: true },
  );

  deps.state.summaryPreviewPanel.onDidDispose(() => {
    deps.state.summaryPreviewPanel = undefined;
  });

  updateSummaryPreview(deps, year, month);
}

export function handleUpdateSummaryPreview(
  deps: HostPanelDeps,
  year: number,
  month: number,
): void {
  if (isPreviewEnabled()) {
    updateSummaryPreview(deps, year, month);
  }
}

export function closeSummaryPreview(deps: HostPanelDeps): void {
  if (deps.state.summaryPreviewPanel) {
    deps.state.summaryPreviewPanel.dispose();
    deps.state.summaryPreviewPanel = undefined;
  }
}

async function renderDailyPreviewHtml(deps: HostPanelDeps, date: string): Promise<void> {
  if (!deps.state.dailyPreviewPanel) {
    return;
  }

  const logDate = new Date(date + 'T12:00:00');
  const log = deps.workLogManager.getDailyLog(logDate) || {
    date,
    completed: [],
    plan: [],
    blockers: [],
    notes: '',
    gitlog: [],
    ailog: [],
    gitCommit: [],
    origin_url: [],
  };

  const settings = await loadPluginSettings(deps);
  const markdown = renderDailyMarkdown(log, settings);
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
  });
  const rendered = md.render(markdown);

  deps.state.dailyPreviewPanel.title = `📅 ${date} 日报预览`;
  deps.state.dailyPreviewPanel.webview.html = renderMarkdownHtml(rendered, '日报预览');
}

function updateDailyPreview(deps: HostPanelDeps, date: string): void {
  if (!deps.state.dailyPreviewPanel) {
    return;
  }

  if (deps.state.dailyPreviewTimer) {
    clearTimeout(deps.state.dailyPreviewTimer);
  }

  deps.state.dailyPreviewPanel.webview.html = renderLoadingHtml('正在加载日报预览...');
  deps.state.dailyPreviewTimer = setTimeout(() => {
    void renderDailyPreviewHtml(deps, date);
  }, 200);
}

export function openDailyPreview(deps: HostPanelDeps, date: string): void {
  if (!isPreviewEnabled()) {
    return;
  }

  if (deps.state.dailyPreviewPanel) {
    deps.state.dailyPreviewPanel.reveal(vscode.ViewColumn.One);
    updateDailyPreview(deps, date);
    return;
  }

  deps.state.dailyPreviewPanel = vscode.window.createWebviewPanel(
    'workLogDailyPreview',
    `📅 ${date} 日报预览`,
    vscode.ViewColumn.One,
    { enableScripts: true },
  );

  deps.state.dailyPreviewPanel.onDidDispose(() => {
    deps.state.dailyPreviewPanel = undefined;
  });

  updateDailyPreview(deps, date);
}

export function handleUpdateDailyPreview(deps: HostPanelDeps, date: string): void {
  if (isPreviewEnabled()) {
    updateDailyPreview(deps, date);
  }
}

export function closeDailyPreview(deps: HostPanelDeps): void {
  if (deps.state.dailyPreviewPanel) {
    deps.state.dailyPreviewPanel.dispose();
    deps.state.dailyPreviewPanel = undefined;
  }
}
