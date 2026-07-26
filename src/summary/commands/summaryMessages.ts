import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { DailyLog } from '../../daily/utils/workLogManager';
const ExcelJS = require('exceljs');
import type { HostPanelDeps } from '../../app/types/hostDependencies';
import { getDisplayName, resolveStoragePath } from '../../shared/utils/panelUtils';
import { resolveRuntimePaths } from '../../settings/utils/pathUtils';
import { loadPluginSettings } from '../../settings/commands/settingsMessages';

function parseDailyGitlogMarkdown(filePath: string): Record<string, string[]> {
  const daily: Record<string, string[]> = {};
  let currentDate = '';
  const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/);

  lines.forEach(line => {
    const trimmed = line.trim();
    const match = trimmed.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
    if (match) {
      currentDate = `${match[1]}-${match[2]}-${match[3]}`;
      daily[currentDate] = daily[currentDate] || [];
      return;
    }
    if (currentDate && trimmed.startsWith('- ')) {
      const item = trimmed.slice(2).trim();
      if (item) {
        daily[currentDate].push(item);
      }
    }
  });

  return daily;
}

function mergeGitlogIntoDailyLogs(deps: HostPanelDeps, year: number, month: number): void {
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const monthDir = path.join(resolveStoragePath(), monthKey);
  const gitlogPath = path.join(monthDir, 'gitlog', '工作日报清单.md');
  if (!fs.existsSync(gitlogPath)) {
    return;
  }

  const dailyGitlog = parseDailyGitlogMarkdown(gitlogPath);
  const existingDates = fs.existsSync(monthDir)
    ? fs.readdirSync(monthDir)
      .filter(name => new RegExp(`^${monthKey}-\\d{2}\\.json$`).test(name))
      .map(name => name.replace(/\.json$/, ''))
    : [];
  const dates = [...new Set([...existingDates, ...Object.keys(dailyGitlog)])].sort();

  dates.forEach(date => {
    const logDate = new Date(date + 'T12:00:00');
    const existing = deps.workLogManager.getDailyLog(logDate) || {
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
    deps.workLogManager.saveDailyLog(logDate, {
      ...existing,
      date,
      gitlog: dailyGitlog[date] || existing.gitlog || [],
      ailog: existing.ailog || [],
      gitCommit: existing.gitCommit || [],
      origin_url: existing.origin_url || [],
    });
  });
}

function thinExcelBorder(): any {
  return {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' },
  };
}

async function generateArtifactsExcel(
  deps: HostPanelDeps,
  year: number,
  month: number,
  monthDir: string,
): Promise<string | null> {
  const artifactSource = path.join(monthDir, 'gitlog', '产物清单.tsv');
  if (!fs.existsSync(artifactSource)) {
    return null;
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('产物清单');
  const headers = ['序号', '仓库名称', 'Origin URL', '提交数', '首次提交时间', '最后提交时间', '本地路径'];
  sheet.columns = [
    { width: 8 },
    { width: 28 },
    { width: 58 },
    { width: 10 },
    { width: 26 },
    { width: 26 },
    { width: 58 },
  ];

  const headerRow = sheet.getRow(1);
  headers.forEach((header, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = header;
    cell.font = { name: '宋体', size: 11, bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = thinExcelBorder();
  });

  const lines = fs.readFileSync(artifactSource, 'utf-8').split(/\r?\n/).filter(Boolean);
  let rowNumber = 2;
  lines.forEach(line => {
    const cols = line.split('\t');
    if (cols[0] === 'repo_path') {
      return;
    }
    const [repoPath = '', repoName = '', originUrl = '', commits = '', firstCommit = '', lastCommit = ''] = cols;
    const values = [rowNumber - 1, repoName, originUrl, commits, firstCommit, lastCommit, repoPath];
    const row = sheet.getRow(rowNumber);
    values.forEach((value, index) => {
      const cell = row.getCell(index + 1);
      cell.value = value;
      cell.font = { name: '宋体', size: 11 };
      cell.alignment = { vertical: 'middle', horizontal: index === 1 || index === 2 || index === 6 ? 'left' : 'center', wrapText: true };
      cell.border = thinExcelBorder();
    });
    row.height = 28;
    rowNumber++;
  });

  const displayName = await getDisplayName(deps);
  const artifactPath = path.join(
    monthDir,
    `交付物_${displayName}_${year}${String(month).padStart(2, '0')}.xlsx`,
  );
  await workbook.xlsx.writeFile(artifactPath);
  return artifactPath;
}

export async function generateTimesheet(
  deps: HostPanelDeps,
  year: number,
  month: number,
  silent: boolean = false,
  includeLoggedNonWorkdays: boolean = false,
): Promise<string | null> {
  try {
    const pluginSettings = await loadPluginSettings(deps);
    const storagePath = resolveStoragePath();
    const monthDir = resolveRuntimePaths(storagePath).month(year, month);

    mergeGitlogIntoDailyLogs(deps, year, month);

    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: '正在生成工时表与交付物…',
        cancellable: false,
      },
      () =>
        deps.timesheetRunner.generate({
          extensionPath: deps.context.extensionPath,
          year,
          month,
          workLogDir: storagePath,
          settings: pluginSettings,
          includeLoggedNonWorkdays,
        }),
    );

    if (!silent) {
      vscode.window.showInformationMessage(
        `✅ 工时表已生成: ${path.basename(result.timesheetPath)}${
          result.artifactPath
            ? `，交付物: ${path.basename(result.artifactPath)}`
            : ''
        }`,
      );

      const action = await vscode.window.showInformationMessage(
        `工时表已保存到 ${result.timesheetPath}`,
        '打开文件夹',
        '在 Finder 中显示',
      );

      if (action === '打开文件夹') {
        vscode.commands.executeCommand(
          'revealFileInOS',
          vscode.Uri.file(monthDir),
        );
      } else if (action === '在 Finder 中显示') {
        vscode.commands.executeCommand(
          'revealFileInOS',
          vscode.Uri.file(result.timesheetPath),
        );
      }

      deps.postToWebview({
        command: 'timesheetGenerated',
        message: `✅ ${year}-${month} 工时表已生成`,
      });
    }

    return result.timesheetPath;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`生成工时表失败: ${errorMsg}`);
    console.error('生成工时表失败:', error);
    return null;
  }
}

interface MaterialsEmailRequest {
  subject: string;
  body: string;
  attachments: string[];
}

export async function sendMaterialsEmail(
  deps: HostPanelDeps,
  data: MaterialsEmailRequest,
): Promise<void> {
  const settings = await loadPluginSettings(deps);
  const smtpHost = settings.email.smtpHost;

  if (!smtpHost) {
    vscode.window.showErrorMessage('请先在插件设置中配置邮件 SMTP 服务器');
    return;
  }

  let password =
    (await deps.context.secrets.get('dailyWorkLog.email.password')) || '';
  if (!password) {
    password = await vscode.window.showInputBox({
      prompt: '请输入邮箱密码（建议在插件设置中配置）',
      password: true,
    }) || '';
    if (!password) {
      return;
    }
  }

  const bundledEmailScript = path.join(
    deps.context.extensionPath,
    'scripts',
    'send_email.py',
  );
  const emailScript = fs.existsSync(bundledEmailScript)
    ? bundledEmailScript
    : path.join(resolveStoragePath(), 'send_email.py');
  const emailScriptContent = `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import smtplib
import ssl
import sys
import json
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email.mime.text import MIMEText
from email import encoders
import os

config = json.loads(sys.argv[1])
attachments_arg = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else ''
attachment_paths = [p for p in attachments_arg.split(',') if p.strip()]

msg = MIMEMultipart()
msg['From'] = config['from']
msg['To'] = config['to']
if config.get('cc'):
    msg['Cc'] = config['cc']
msg['Subject'] = config['subject']

msg.attach(MIMEText(config['body'], 'plain', 'utf-8'))

for attachment_path in attachment_paths:
    if attachment_path and os.path.exists(attachment_path):
        with open(attachment_path, 'rb') as f:
            part = MIMEBase('application', 'octet-stream')
            part.set_payload(f.read())
            encoders.encode_base64(part)
            part.add_header('Content-Disposition', f'attachment; filename="{os.path.basename(attachment_path)}"')
            msg.attach(part)

recipients = [r.strip() for r in config['to'].split(',')]
if config.get('cc'):
    recipients += [r.strip() for r in config['cc'].split(',')]

port = config['port']
host = config['host']
if port == 465:
    context = ssl.create_default_context()
    with smtplib.SMTP_SSL(host, port, context=context, timeout=30) as server:
        server.login(config['username'], config['password'])
        server.sendmail(config['from'], recipients, msg.as_string())
else:
    with smtplib.SMTP(host, port, timeout=30) as server:
        server.ehlo()
        server.starttls()
        server.ehlo()
        server.login(config['username'], config['password'])
        server.sendmail(config['from'], recipients, msg.as_string())

print('Email sent successfully!')
`;

  if (!fs.existsSync(bundledEmailScript)) {
    fs.writeFileSync(emailScript, emailScriptContent, 'utf-8');
  }

  const emailConfig = {
    host: settings.email.smtpHost,
    port: settings.email.smtpPort,
    username: settings.email.username,
    password,
    from: settings.email.from,
    to: settings.email.to,
    cc: settings.email.cc,
    subject: data.subject,
    body: data.body,
  };

  const terminal = vscode.window.createTerminal('Send Email');
  terminal.show();
  terminal.sendText(
    `python3 "${emailScript}" '${JSON.stringify(emailConfig)}' "${data.attachments.join(',')}"`,
  );

  deps.postToWebview({
    command: 'emailSent',
    message: '📧 正在发送邮件...',
  });
}

export async function generateAiAll(
  deps: HostPanelDeps,
  year: number,
  month: number,
): Promise<void> {
  try {
    deps.postToWebview({
      command: 'aiLoading',
      loading: true,
    });
    const settings = await loadPluginSettings(deps);
    const apiKey = (await deps.context.secrets.get('dailyWorkLog.ai.apiKey')) || '';
    const result = await deps.aiReportGenerator.generateAll(
      year,
      month,
      settings,
      apiKey,
    );
    vscode.window.showInformationMessage(
      `AI 报告已生成: ${path.basename(result.mdPath)}（未自动写入日报，请使用日报 Tab 采集确认流程）`,
    );
    vscode.window.showInformationMessage(`✅ AI 输出已生成: ${path.basename(result.mdPath)}`);
    vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(path.dirname(result.mdPath)));
    deps.postToWebview({
      command: 'aiGenerated',
      message: `✅ AI 已生成: ${path.basename(result.mdPath)}`,
    });
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    vscode.window.showErrorMessage(`AI 生成失败: ${errorMsg}`);
    deps.postToWebview({
      command: 'aiError',
      message: `❌ AI 生成失败: ${errorMsg}`,
    });
  } finally {
    deps.postToWebview({
      command: 'aiLoading',
      loading: false,
    });
  }
}

function mergeAiLogIntoDailyLogs(deps: HostPanelDeps, aiJsonPath: string): void {
  if (!fs.existsSync(aiJsonPath)) {
    return;
  }
  try {
    const aiOutput = JSON.parse(fs.readFileSync(aiJsonPath, 'utf-8'));
    Object.entries(aiOutput.daily || {}).forEach(([date, value]) => {
      const daily = value as any;
      const polished = daily.polished || {};
      const ailog = Array.isArray(polished.completed) ? polished.completed : [];
      const logDate = new Date(date + 'T12:00:00');
      const existing = deps.workLogManager.getDailyLog(logDate);
      if (!existing) {
        return;
      }
      deps.workLogManager.saveDailyLog(logDate, {
        ...existing,
        ailog,
        gitlog: existing.gitlog || [],
        origin_url: existing.origin_url || [],
      });
    });
  } catch (e) {
    console.warn('合并 AILog 到每日 JSON 失败:', e);
  }
}

export function listMaterials(deps: HostPanelDeps): void {
  const storagePath = resolveStoragePath();
  if (!fs.existsSync(storagePath)) {
    deps.postToWebview({
      command: 'materials',
      data: [],
    });
    return;
  }

  const monthDirs = fs.readdirSync(storagePath)
    .filter(name => /^\d{4}-\d{2}$/.test(name))
    .sort()
    .reverse();

  const materials = monthDirs.map(dir => {
    const monthDir = path.join(storagePath, dir);
    let files: { name: string; path: string; size: number; mtime: number }[] = [];
    try {
      files = fs.readdirSync(monthDir)
        .filter(name => !name.startsWith('.'))
        .map(name => {
          const fullPath = path.join(monthDir, name);
          const stat = fs.existsSync(fullPath) ? fs.statSync(fullPath) : null;
          return {
            name,
            path: fullPath,
            size: stat ? stat.size : 0,
            mtime: stat ? stat.mtimeMs : 0,
          };
        })
        .filter(item => item.path && item.name !== '_summary.md');

      const timesheets = files
        .filter(item => item.name.startsWith('Timesheet-') && item.name.endsWith('.xlsx'))
        .sort((a, b) => b.mtime - a.mtime);
      const latestTimesheet = timesheets[0];
      files = files.filter(item => !item.name.startsWith('Timesheet-') || item.path === latestTimesheet?.path);
    } catch (e) {
      files = [];
    }
    return {
      month: dir,
      files,
    };
  });

  deps.postToWebview({
    command: 'materials',
    data: materials,
  });
}

export function openMaterial(filePath: string): void {
  if (!filePath) {
    return;
  }
  vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(filePath));
}

export async function deleteMaterial(deps: HostPanelDeps, filePath: string): Promise<void> {
  if (!filePath || !fs.existsSync(filePath)) {
    return;
  }
  const confirm = await vscode.window.showWarningMessage(
    `确认删除文件？\n${filePath}`,
    { modal: true },
    '删除',
    '取消',
  );
  if (confirm !== '删除') {
    return;
  }
  try {
    fs.unlinkSync(filePath);
    listMaterials(deps);
  } catch (e) {
    vscode.window.showErrorMessage(`删除失败: ${e}`);
  }
}

function getAiMonthlySummary(year: number, month: number): string | null {
  const storagePath = resolveStoragePath();
  const monthDir = path.join(storagePath, `${year}-${String(month).padStart(2, '0')}`);
  const aiPath = path.join(monthDir, 'AI_summary.md');
  if (!fs.existsSync(aiPath)) {
    return null;
  }
  try {
    return fs.readFileSync(aiPath, 'utf-8');
  } catch (e) {
    console.warn('读取 AI_summary.md 失败:', e);
    return null;
  }
}

function extractWeeklyMonthly(aiText: string): string | null {
  if (!aiText) {
    return null;
  }
  const weeklyIndex = aiText.indexOf('## 周报总结');
  const monthlyIndex = aiText.indexOf('## 月报总结');
  if (weeklyIndex >= 0) {
    return aiText.slice(weeklyIndex).trim();
  }
  if (monthlyIndex >= 0) {
    return aiText.slice(monthlyIndex).trim();
  }
  return null;
}

function readAiJson(yearMonth: string): any | null {
  const storagePath = resolveStoragePath();
  const aiJsonPath = path.join(storagePath, yearMonth, `AI_${yearMonth}.json`);
  if (!fs.existsSync(aiJsonPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(aiJsonPath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.warn('读取 AI json 失败:', e);
    return null;
  }
}

function getAiDailyResult(date: string): DailyLog | null {
  if (!date) {
    return null;
  }
  const yearMonth = date.slice(0, 7);
  const storagePath = resolveStoragePath();
  const aiJsonPath = path.join(storagePath, yearMonth, `AI_${yearMonth}.json`);
  if (!fs.existsSync(aiJsonPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(aiJsonPath, 'utf-8');
    const data = JSON.parse(raw) as any;
    const daily = data?.daily?.[date];
    if (!daily || !daily.polished) {
      return null;
    }
    return {
      date,
      completed: Array.isArray(daily.polished.completed) ? daily.polished.completed : [],
      plan: Array.isArray(daily.polished.plan) ? daily.polished.plan : [],
      blockers: Array.isArray(daily.polished.blockers) ? daily.polished.blockers : [],
      notes: typeof daily.polished.notes === 'string' ? daily.polished.notes : '',
      gitlog: [],
      ailog: Array.isArray(daily.polished.completed) ? daily.polished.completed : [],
      origin_url: [],
    };
  } catch (e) {
    console.warn('读取 AI json 失败:', e);
    return null;
  }
}

function renderAiDailyMarkdown(date: string): string | null {
  if (!date) {
    return null;
  }
  const yearMonth = date.slice(0, 7);
  const storagePath = resolveStoragePath();
  const aiJsonPath = path.join(storagePath, yearMonth, `AI_${yearMonth}.json`);
  if (!fs.existsSync(aiJsonPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(aiJsonPath, 'utf-8');
    const data = JSON.parse(raw) as any;
    const daily = data?.daily?.[date];
    if (!daily) {
      return null;
    }
    const advice = Array.isArray(daily.advice) ? daily.advice : [];
    const polished = daily.polished || {};
    const completed = Array.isArray(polished.completed) ? polished.completed : [];
    const plan = Array.isArray(polished.plan) ? polished.plan : [];
    const blockers = Array.isArray(polished.blockers) ? polished.blockers : [];
    const notes = typeof polished.notes === 'string' ? polished.notes : '';

    let text = `## AI 润色\n\n`;
    text += `**润色建议**\n`;
    text += advice.length > 0 ? advice.map((t: string) => `- ${t}`).join('\n') : '- (无)';
    text += `\n\n**润色结果**\n`;
    text += `- 完成: ${completed.join(' | ') || '(空)'}\n`;
    text += `- 计划: ${plan.join(' | ') || '(空)'}\n`;
    text += `- 阻碍: ${blockers.join(' | ') || '(空)'}\n`;
    text += `- 备注: ${notes || '(空)'}\n`;
    return text;
  } catch (e) {
    console.warn('读取 AI json 失败:', e);
    return null;
  }
}
