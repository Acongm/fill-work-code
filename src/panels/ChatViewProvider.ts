import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { WorkLogManager, DailyLog } from '../lib/workLogManager';
import { AiReportGenerator } from '../lib/aiReportGenerator';
import { TimesheetRunner } from '../services/timesheetRunner';
import { getNonce } from '../utilities/getNonce';
import { getUri } from '../utilities/getUri';
import {
  DEFAULT_PLUGIN_SETTINGS,
  type PluginSettings,
} from '../features/settings/pluginSettings';
import {
  DEFAULT_AI_SYSTEM_PROMPT,
  normalizeAiSystemPromptForSave,
} from '../features/settings/aiSystemPrompt';
import { resolveOriginFilters } from '../utils/originFilter';
import { GitEvidenceService } from '../services/gitEvidenceService';
import {
  type CollectRequest,
  formatFillAnchorLabel,
  formatFillScopeAnchorTitle,
  isHistoricalCollectRange,
  resolveCollectDates,
  resolveCustomRange,
} from '../utils/fillAnchor';
import { AiPolishService } from '../services/aiPolishService';
import {
  buildFillCacheSearchConfig,
  FillCacheService,
} from '../services/fillCacheService';
import { secretDisplayInfo } from '../lib/secretMask';
import type { FillPreview, FillScope } from '../utils/types/fillPreview';
import MarkdownIt from 'markdown-it';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ExcelJS = require('exceljs');

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'daily-work-log.chatView';

  private _view?: vscode.WebviewView;
  private workLogManager: WorkLogManager;
  private summaryPreviewPanel?: vscode.WebviewPanel;
  private dailyPreviewPanel?: vscode.WebviewPanel;
  private summaryPreviewTimer?: NodeJS.Timeout;
  private dailyPreviewTimer?: NodeJS.Timeout;
  private pendingImportItems: DailyLog[] | null = null;
  private aiReportGenerator: AiReportGenerator;
  private gitEvidenceService: GitEvidenceService;
  private aiPolishService: AiPolishService;
  private timesheetRunner: TimesheetRunner;
  private fillCacheService: FillCacheService;
  private outputChannel: vscode.OutputChannel;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    workLogManager: WorkLogManager,
    private readonly _context: vscode.ExtensionContext,
  ) {
    this.workLogManager = workLogManager;
    this.aiReportGenerator = new AiReportGenerator(workLogManager);
    const storagePath = workLogManager.getStorageDir();
    this.gitEvidenceService = new GitEvidenceService(
      this._context.extensionPath,
      storagePath,
    );
    this.aiPolishService = new AiPolishService();
    this.timesheetRunner = new TimesheetRunner();
    this.fillCacheService = new FillCacheService(storagePath);
    this.outputChannel = vscode.window.createOutputChannel('Daily Work Log');
    this._context.subscriptions.push(this.outputChannel);
  }

  public postToWebview(message: Record<string, unknown>): void {
    this._view?.webview.postMessage(message);
  }

  public showOutput(): void {
    this.outputChannel.show(true);
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, 'web', 'dist'),
        vscode.Uri.joinPath(this._extensionUri, 'dist'),
      ],
    };

    webviewView.webview.html = this._renderHtml(webviewView.webview);

    // 监听来自 Webview 的消息
    webviewView.webview.onDidReceiveMessage(
      data => this._handleMessage(data),
      undefined
    );

    // Webview 可见时发送初始数据
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this._updateWebview();
      }
    });

    // 初始发送数据
    setTimeout(() => this._updateWebview(), 100);
  }

  private async _handleMessage(data: any) {
    switch (data.command) {
      case 'ready':
        this._updateWebview();
        break;

      case 'save':
        try {
          const logDate = new Date(data.log.date + 'T12:00:00');
          this.workLogManager.saveDailyLog(logDate, data.log);
          this._view?.webview.postMessage({
            command: 'saved',
            message: `✅ ${data.log.date} 日志已保存`
          });
        } catch (e) {
          vscode.window.showErrorMessage(`保存失败: ${e}`);
        }
        break;

      case 'loadDate':
        try {
          const date = new Date(data.date + 'T12:00:00');
          const log = this.workLogManager.getDailyLog(date);
          this._view?.webview.postMessage({
            command: 'dateLoaded',
            log: log || {
              date: data.date,
              completed: [],
              plan: [],
              blockers: [],
              notes: '',
              gitlog: [],
              ailog: [],
              gitCommit: [],
              origin_url: []
            },
            repositoryOptions: this._getRepositoryOptions(data.date.slice(0, 7))
          });
        } catch (e) {
          this._view?.webview.postMessage({
            command: 'dateLoaded',
            log: {
              date: data.date,
              completed: [],
              plan: [],
              blockers: [],
              notes: '',
              gitlog: [],
              ailog: [],
              gitCommit: [],
              origin_url: []
            },
            repositoryOptions: this._getRepositoryOptions(data.date.slice(0, 7))
          });
        }
        break;

      case 'loadMonthLogs':
        try {
          const { year, month } = data;
          const monthlyLogs = this.workLogManager.getMonthlyLogs(year, month);
          const monthKey = `${year}-${String(month).padStart(2, '0')}`;
          const storagePath = this._resolveStoragePath();
          const settings = await this._loadPluginSettings();
          const outputDir = settings.outputDir.trim()
            ? this._expandHome(settings.outputDir)
            : storagePath;
          const monthDir = path.join(outputDir, monthKey);
          monthlyLogs.logs = this.gitEvidenceService.enrichLogsFromCommits(
            monthDir,
            monthlyLogs.logs,
          );
          this._view?.webview.postMessage({
            command: 'monthLogsLoaded',
            data: monthlyLogs,
          });
        } catch (e) {
          vscode.window.showErrorMessage(`加载月度日志失败: ${e}`);
        }
        break;

      case 'generateTimesheet':
        await this._generateTimesheet(data.year, data.month, false, false);
        break;

      case 'generateTimesheetFull':
        await this._generateTimesheet(data.year, data.month, false, true);
        break;

      case 'sendEmail':
        await this._sendEmail(data);
        break;

      case 'openSettings':
      case 'openPanelSettings':
        this._view?.webview.postMessage({ command: 'openPanelSettings' });
        break;

      case 'getPluginSettings':
        await this._sendPluginSettings();
        break;

      case 'savePluginSettings':
        await this._savePluginSettings(
          data.settings,
          data.apiKey,
          data.emailPassword,
        );
        break;

      case 'collectGitFill':
        await this._collectGitFill(this._parseCollectRequest(data));
        break;

      case 'cancelCollect':
        this._cancelCollect();
        break;

      case 'aiPolishFill':
        await this._aiPolishFill(this._parseCollectRequest(data), data.preview);
        break;

      case 'applyFillPreview':
        await this._applyFillPreview(data.preview, data.mode);
        break;

      case 'discardFillPreview':
        break;

      case 'revealPluginSecret':
        await this._revealPluginSecret(data.field as 'apiKey' | 'emailPassword');
        break;

      case 'refresh':
        this._updateWebview();
        break;

      case 'openProfile':
        this._view?.webview.postMessage({ command: 'openProfile' });
        break;

      case 'openSummaryPreview':
        if (this._isPreviewEnabled()) {
          this._openSummaryPreview(data.year, data.month);
        }
        break;

      case 'updateSummaryPreview':
        if (this._isPreviewEnabled()) {
          this._updateSummaryPreview(data.year, data.month);
        }
        break;

      case 'closeSummaryPreview':
        if (this.summaryPreviewPanel) {
          this.summaryPreviewPanel.dispose();
          this.summaryPreviewPanel = undefined;
        }
        break;

      case 'openDailyPreview':
        if (this._isPreviewEnabled()) {
          this._openDailyPreview(data.date);
        }
        break;

      case 'updateDailyPreview':
        if (this._isPreviewEnabled()) {
          this._updateDailyPreview(data.date);
        }
        break;

      case 'closeDailyPreview':
        if (this.dailyPreviewPanel) {
          this.dailyPreviewPanel.dispose();
          this.dailyPreviewPanel = undefined;
        }
        break;

      case 'clearSummaryCache':
        this.workLogManager.clearMonthSummaryCache(data.year, data.month);
        break;

      case 'selectXlsxImport':
        await this._selectXlsxImport(data.year, data.month);
        break;

      case 'confirmImport':
        await this._confirmImport(data.year, data.month, data.dates || []);
        break;

      case 'aiGenerateAll':
        await this._generateAiAll(data.year, data.month);
        break;

      case 'listMonthFiles':
        this._listMonthFiles(data.year, data.month);
        break;

      case 'listMaterials':
        this._listMaterials();
        break;

      case 'loadRepositoryOptions':
        this._view?.webview.postMessage({
          command: 'repositoryOptionsLoaded',
          options: this._getRepositoryOptions(data.month || data.date?.slice(0, 7) || '')
        });
        break;

      case 'openMaterial':
        this._openMaterial(data.path);
        break;

      case 'deleteMaterial':
        await this._deleteMaterial(data.path);
        break;

      case 'sendEmailWithAttachments':
        await this._sendEmail({
          subject: data.subject,
          body: data.body,
          attachment: (data.attachments || []).join(',')
        });
        break;

      case 'refreshConfig':
        this._updateWebview();
        break;

      case 'getFullConfig':
        this._sendFullConfig();
        break;
    }
  }

  private async _buildWebConfig() {
    const settings = await this._loadPluginSettings();
    const optional = new Set(settings.visibleFields);
    const vsConfig = vscode.workspace.getConfiguration('dailyWorkLog');
    const hasPassword = Boolean(
      await this._context.secrets.get('dailyWorkLog.email.password'),
    );
    return {
      storagePath: vsConfig.get<string>('storagePath') || '~/.work-logs',
      autoSave: vsConfig.get<boolean>('autoSave') ?? true,
      timesheetFullDateEnabled: settings.timesheetFullDateEnabled,
      aiEnabled: settings.aiEnabled,
      dailySyncFieldVisibility: settings.dailySyncFieldVisibility,
      showCompletedInput: true,
      showAilogInput: true,
      showOriginUrlInput: true,
      showPlanInput: optional.has('plan'),
      showBlockersInput: optional.has('blockers'),
      showNotesInput: optional.has('notes'),
      showGitlogInput: optional.has('gitlog'),
      showGitCommitInput: optional.has('gitCommit'),
      timesheetContentField: settings.timesheetContentField,
      email: {
        ...settings.email,
        hasPassword,
      },
    };
  }

  private async _sendFullConfig() {
    const config = await this._buildWebConfig();
    this._view?.webview.postMessage({
      command: 'fullConfigUpdate',
      config,
    });
  }

  private async _generateTimesheet(
    year: number,
    month: number,
    silent: boolean = false,
    includeLoggedNonWorkdays: boolean = false
  ): Promise<string | null> {
    try {
      const pluginSettings = await this._loadPluginSettings();
      const storagePath = this._resolveStoragePath();
      const monthKey = `${year}-${String(month).padStart(2, '0')}`;
      const outputDir = pluginSettings.outputDir.trim()
        ? this._expandHome(pluginSettings.outputDir)
        : path.join(storagePath, monthKey);

      this._mergeGitlogIntoDailyLogs(year, month);

      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: '正在生成工时表与交付物…',
          cancellable: false,
        },
        () =>
          this.timesheetRunner.generate({
            extensionPath: this._context.extensionPath,
            year,
            month,
            workLogDir: storagePath,
            outputDir,
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
            vscode.Uri.file(outputDir),
          );
        } else if (action === '在 Finder 中显示') {
          vscode.commands.executeCommand(
            'revealFileInOS',
            vscode.Uri.file(result.timesheetPath),
          );
        }

        this._view?.webview.postMessage({
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

  private _expandHome(inputPath: string): string {
    if (inputPath.startsWith('~/')) {
      return path.join(os.homedir(), inputPath.slice(2));
    }
    if (inputPath === '~') {
      return os.homedir();
    }
    return inputPath;
  }

  private _mergeGitlogIntoDailyLogs(year: number, month: number): void {
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const monthDir = path.join(this._resolveStoragePath(), monthKey);
    const gitlogPath = path.join(monthDir, 'gitlog', '工作日报清单.md');
    if (!fs.existsSync(gitlogPath)) {
      return;
    }

    const dailyGitlog = this._parseDailyGitlogMarkdown(gitlogPath);
    const existingDates = fs.existsSync(monthDir)
      ? fs.readdirSync(monthDir)
        .filter(name => new RegExp(`^${monthKey}-\\d{2}\\.json$`).test(name))
        .map(name => name.replace(/\.json$/, ''))
      : [];
    const dates = [...new Set([...existingDates, ...Object.keys(dailyGitlog)])].sort();

    dates.forEach(date => {
      const logDate = new Date(date + 'T12:00:00');
      const existing = this.workLogManager.getDailyLog(logDate) || {
        date,
        completed: [],
        plan: [],
        blockers: [],
        notes: '',
        gitlog: [],
        ailog: [],
        gitCommit: [],
        origin_url: []
      };
      this.workLogManager.saveDailyLog(logDate, {
        ...existing,
        date,
        gitlog: dailyGitlog[date] || existing.gitlog || [],
        ailog: existing.ailog || [],
        gitCommit: existing.gitCommit || [],
        origin_url: existing.origin_url || []
      });
    });
  }

  private _parseDailyGitlogMarkdown(filePath: string): Record<string, string[]> {
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

  private async _generateArtifactsExcel(year: number, month: number, monthDir: string): Promise<string | null> {
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
      { width: 58 }
    ];

    const headerRow = sheet.getRow(1);
    headers.forEach((header, index) => {
      const cell = headerRow.getCell(index + 1);
      cell.value = header;
      cell.font = { name: '宋体', size: 11, bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = this._thinExcelBorder();
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
        cell.border = this._thinExcelBorder();
      });
      row.height = 28;
      rowNumber++;
    });

    const displayName = await this._getDisplayName();
    const artifactPath = path.join(
      monthDir,
      `交付物_${displayName}_${year}${String(month).padStart(2, '0')}.xlsx`,
    );
    await workbook.xlsx.writeFile(artifactPath);
    return artifactPath;
  }

  private _thinExcelBorder(): any {
    return {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    };
  }

  private async _sendEmail(data: any) {
    const settings = await this._loadPluginSettings();
    const smtpHost = settings.email.smtpHost;

    if (!smtpHost) {
      vscode.window.showErrorMessage('请先在插件设置中配置邮件 SMTP 服务器');
      return;
    }

    let attachment = data.attachment || '';
    if (!attachment && data.year && data.month) {
      vscode.window.showInformationMessage('正在生成工时表...');
      const generatedPath = await this._generateTimesheet(data.year, data.month, true, false);
      if (generatedPath) {
        attachment = generatedPath;
        vscode.window.showInformationMessage(`工时表已生成: ${path.basename(attachment)}`);
      } else {
        const proceed = await vscode.window.showWarningMessage(
          '工时表生成失败，是否继续发送邮件（无附件）？',
          '继续发送',
          '取消'
        );
        if (proceed !== '继续发送') {
          return;
        }
      }
    }

    let password =
      (await this._context.secrets.get('dailyWorkLog.email.password')) || '';
    if (!password) {
      password = await vscode.window.showInputBox({
        prompt: '请输入邮箱密码（建议在插件设置中配置）',
        password: true
      }) || '';
      if (!password) {
        return;
      }
    }

    const storagePath =
      vscode.workspace.getConfiguration('dailyWorkLog').get<string>('storagePath') ||
      '~/.work-logs';
    const expandedPath = storagePath.startsWith('~/')
      ? path.join(os.homedir(), storagePath.slice(2))
      : storagePath;

    const bundledEmailScript = path.join(
      this._context.extensionPath,
      'scripts',
      'send_email.py',
    );
    const emailScript = fs.existsSync(bundledEmailScript)
      ? bundledEmailScript
      : path.join(expandedPath, 'send_email.py');
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

    const aiAttachment = this._getAiSummaryPath(data.year, data.month);
    let attachments = data.attachment || '';
    if (aiAttachment) {
      attachments = attachments ? `${attachments},${aiAttachment}` : aiAttachment;
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
    terminal.sendText(`python3 "${emailScript}" '${JSON.stringify(emailConfig)}' "${attachments}"`);

    this._view?.webview.postMessage({
      command: 'emailSent',
      message: '📧 正在发送邮件...'
    });
  }

  private async _generateAiAll(year: number, month: number) {
    try {
      this._view?.webview.postMessage({
        command: 'aiLoading',
        loading: true
      });
      const result = await this.aiReportGenerator.generateAll(year, month);
      // 月度 AI 不再自动写入日报 JSON，避免未经确认批量覆盖
      vscode.window.showInformationMessage(
        `AI 报告已生成: ${path.basename(result.mdPath)}（未自动写入日报，请使用日报 Tab 采集确认流程）`,
      );
      vscode.window.showInformationMessage(`✅ AI 输出已生成: ${path.basename(result.mdPath)}`);
      vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(path.dirname(result.mdPath)));
      this._view?.webview.postMessage({
        command: 'aiGenerated',
        message: `✅ AI 已生成: ${path.basename(result.mdPath)}`
      });
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      vscode.window.showErrorMessage(`AI 生成失败: ${errorMsg}`);
      this._view?.webview.postMessage({
        command: 'aiError',
        message: `❌ AI 生成失败: ${errorMsg}`
      });
    } finally {
      this._view?.webview.postMessage({
        command: 'aiLoading',
        loading: false
      });
    }
  }

  private _mergeAiLogIntoDailyLogs(aiJsonPath: string): void {
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
        const existing = this.workLogManager.getDailyLog(logDate);
        if (!existing) {
          return;
        }
        this.workLogManager.saveDailyLog(logDate, {
          ...existing,
          ailog,
          gitlog: existing.gitlog || [],
          origin_url: existing.origin_url || []
        });
      });
    } catch (e) {
      console.warn('合并 AILog 到每日 JSON 失败:', e);
    }
  }

  private _listMonthFiles(year: number, month: number) {
    const storagePath = this._resolveStoragePath();
    const monthDir = path.join(storagePath, `${year}-${String(month).padStart(2, '0')}`);
    if (!fs.existsSync(monthDir)) {
      this._view?.webview.postMessage({
        command: 'monthFiles',
        files: []
      });
      return;
    }

    const files = fs.readdirSync(monthDir)
      .filter(name => !name.startsWith('.'))
      .map(name => {
        const fullPath = path.join(monthDir, name);
        const stat = fs.existsSync(fullPath) ? fs.statSync(fullPath) : null;
        return {
          name,
          path: fullPath,
          size: stat ? stat.size : 0
        };
      })
      .filter(item => item.path && item.name !== '_summary.md');

    this._view?.webview.postMessage({
      command: 'monthFiles',
      files
    });
  }

  private _listMaterials() {
    const storagePath = this._resolveStoragePath();
    if (!fs.existsSync(storagePath)) {
      this._view?.webview.postMessage({
        command: 'materials',
        data: []
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
              mtime: stat ? stat.mtimeMs : 0
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
        files
      };
    });

    this._view?.webview.postMessage({
      command: 'materials',
      data: materials
    });
  }

  private _openMaterial(filePath: string) {
    if (!filePath) {
      return;
    }
    vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(filePath));
  }

  private async _deleteMaterial(filePath: string) {
    if (!filePath || !fs.existsSync(filePath)) {
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `确认删除文件？\n${filePath}`,
      { modal: true },
      '删除',
      '取消'
    );
    if (confirm !== '删除') {
      return;
    }
    try {
      fs.unlinkSync(filePath);
      this._listMaterials();
    } catch (e) {
      vscode.window.showErrorMessage(`删除失败: ${e}`);
    }
  }

  private _getAiSummaryPath(year?: number, month?: number): string {
    if (!year || !month) {
      return '';
    }
    const storagePath = this._resolveStoragePath();
    const monthDir = path.join(storagePath, `${year}-${String(month).padStart(2, '0')}`);
    const aiPath = path.join(monthDir, 'AI_summary.md');
    return fs.existsSync(aiPath) ? aiPath : '';
  }

  private _resolveStoragePath(): string {
    const config = vscode.workspace.getConfiguration('dailyWorkLog');
    let storagePath = config.get<string>('storagePath') || '~/.work-logs';
    if (storagePath.startsWith('~/')) {
      storagePath = path.join(os.homedir(), storagePath.slice(2));
    } else if (storagePath === '~') {
      storagePath = os.homedir();
    }
    return storagePath;
  }

  private _getAiMonthlySummary(year: number, month: number): string | null {
    const storagePath = this._resolveStoragePath();
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

  private _optionalFieldVisible(
    settings: PluginSettings,
    field: 'gitlog' | 'gitCommit' | 'plan' | 'blockers' | 'notes',
    context: 'daily' | 'summary' = 'summary',
  ): boolean {
    if (context === 'daily' && !settings.dailySyncFieldVisibility) {
      return true;
    }
    return new Set(settings.visibleFields).has(field);
  }

  private _buildMonthlyPreviewWithAi(
    year: number,
    month: number,
    settings: PluginSettings,
  ): string {
    const monthly = this.workLogManager.getMonthlyLogs(year, month);
    const showGitlog = this._optionalFieldVisible(settings, 'gitlog');
    const showGitCommit = this._optionalFieldVisible(settings, 'gitCommit');
    const showPlan = this._optionalFieldVisible(settings, 'plan');
    const showBlockers = this._optionalFieldVisible(settings, 'blockers');
    const showNotes = this._optionalFieldVisible(settings, 'notes');
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

  private _extractWeeklyMonthly(aiText: string): string | null {
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

  private _readAiJson(yearMonth: string): any | null {
    const storagePath = this._resolveStoragePath();
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

  private _getAiDailyResult(date: string): DailyLog | null {
    if (!date) {
      return null;
    }
    const yearMonth = date.slice(0, 7);
    const storagePath = this._resolveStoragePath();
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
        origin_url: []
      };
    } catch (e) {
      console.warn('读取 AI json 失败:', e);
      return null;
    }
  }

  private _renderAiDailyMarkdown(date: string): string | null {
    if (!date) {
      return null;
    }
    const yearMonth = date.slice(0, 7);
    const storagePath = this._resolveStoragePath();
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

  private async _updateWebview() {
    if (!this._view) {
      return;
    }
    const todayLog = this.workLogManager.getTodayLog();
    const config = await this._buildWebConfig();
    this._view.webview.postMessage({
      command: 'init',
      todayLog,
      repositoryOptions: this._getRepositoryOptions(todayLog.date.slice(0, 7)),
      config,
    });
  }

  private _openSummaryPreview(year: number, month: number) {
    if (this.summaryPreviewPanel) {
      this.summaryPreviewPanel.reveal(vscode.ViewColumn.One);
      this._updateSummaryPreview(year, month);
      return;
    }

    this.summaryPreviewPanel = vscode.window.createWebviewPanel(
      'workLogSummaryPreview',
      `📊 ${year}年${month}月报预览`,
      vscode.ViewColumn.One,
      { enableScripts: true }
    );

    this.summaryPreviewPanel.onDidDispose(() => {
      this.summaryPreviewPanel = undefined;
    });

    this._updateSummaryPreview(year, month);
  }

  private _updateSummaryPreview(year: number, month: number) {
    if (!this.summaryPreviewPanel) {
      return;
    }

    if (this.summaryPreviewTimer) {
      clearTimeout(this.summaryPreviewTimer);
    }

    this.summaryPreviewPanel.webview.html = this._renderLoadingHtml('正在加载月报预览...');
    this.summaryPreviewTimer = setTimeout(() => {
      void this._renderSummaryPreviewHtml(year, month);
    }, 200);
  }

  private async _renderSummaryPreviewHtml(year: number, month: number) {
    if (!this.summaryPreviewPanel) {
      return;
    }

    const settings = await this._loadPluginSettings();
    const summary = this._buildMonthlyPreviewWithAi(year, month, settings);
    const md = new MarkdownIt({
      html: false,
      linkify: true,
      typographer: false
    });
    const rendered = md.render(summary);

    this.summaryPreviewPanel.title = `📊 ${year}年${month}月报预览`;
    this.summaryPreviewPanel.webview.html = this._renderMarkdownHtml(rendered, '工作汇总预览');
  }

  private _openDailyPreview(date: string) {
    if (this.dailyPreviewPanel) {
      this.dailyPreviewPanel.reveal(vscode.ViewColumn.One);
      this._updateDailyPreview(date);
      return;
    }

    this.dailyPreviewPanel = vscode.window.createWebviewPanel(
      'workLogDailyPreview',
      `📅 ${date} 日报预览`,
      vscode.ViewColumn.One,
      { enableScripts: true }
    );

    this.dailyPreviewPanel.onDidDispose(() => {
      this.dailyPreviewPanel = undefined;
    });

    this._updateDailyPreview(date);
  }

  private _updateDailyPreview(date: string) {
    if (!this.dailyPreviewPanel) {
      return;
    }

    if (this.dailyPreviewTimer) {
      clearTimeout(this.dailyPreviewTimer);
    }

    this.dailyPreviewPanel.webview.html = this._renderLoadingHtml('正在加载日报预览...');
    this.dailyPreviewTimer = setTimeout(() => {
      void this._renderDailyPreviewHtml(date);
    }, 200);
  }

  private async _renderDailyPreviewHtml(date: string) {
    if (!this.dailyPreviewPanel) {
      return;
    }

    const logDate = new Date(date + 'T12:00:00');
    const log = this.workLogManager.getDailyLog(logDate) || {
      date,
      completed: [],
      plan: [],
      blockers: [],
      notes: '',
      gitlog: [],
      ailog: [],
      gitCommit: [],
      origin_url: []
    };

    const settings = await this._loadPluginSettings();
    const markdown = this._renderDailyMarkdown(log, settings);
    const md = new MarkdownIt({
      html: false,
      linkify: true,
      typographer: false
    });
    const rendered = md.render(markdown);

    this.dailyPreviewPanel.title = `📅 ${date} 日报预览`;
    this.dailyPreviewPanel.webview.html = this._renderMarkdownHtml(rendered, '日报预览');
  }

  private _renderDailyMarkdown(log: DailyLog, settings: PluginSettings): string {
    const safeDate = log.date || '未知日期';
    const completed = Array.isArray(log.completed) ? log.completed : [];
    const plan = Array.isArray(log.plan) ? log.plan : [];
    const blockers = Array.isArray(log.blockers) ? log.blockers : [];
    const gitlog = Array.isArray(log.gitlog) ? log.gitlog : [];
    const ailog = Array.isArray(log.ailog) ? log.ailog : [];
    const gitCommit = Array.isArray(log.gitCommit) ? log.gitCommit : [];
    const originUrls = Array.isArray(log.origin_url) ? log.origin_url : [];
    const notes = typeof log.notes === 'string' ? log.notes : '';
    const showGitlog = this._optionalFieldVisible(settings, 'gitlog', 'daily');
    const showGitCommit = this._optionalFieldVisible(settings, 'gitCommit', 'daily');
    const showPlan = this._optionalFieldVisible(settings, 'plan', 'daily');
    const showBlockers = this._optionalFieldVisible(settings, 'blockers', 'daily');
    const showNotes = this._optionalFieldVisible(settings, 'notes', 'daily');

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

  private _renderLoadingHtml(message: string): string {
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

  private _renderMarkdownHtml(rendered: string, title: string): string {
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

  private async _selectXlsxImport(year: number, month: number) {
    const selections = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { Excel: ['xlsx'] }
    });

    if (!selections || selections.length === 0) {
      return;
    }

    const filePath = selections[0].fsPath;
    console.log(`[xlsx-import] selected: ${filePath}`);
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      const sheet = workbook.worksheets[0];
      console.log(`[xlsx-import] sheet: ${sheet?.name || 'unknown'} rows=${sheet?.rowCount} actualRows=${sheet?.actualRowCount}`);

      const allParsed = this._parseTimesheetSheet(sheet);
      console.log(`[xlsx-import] parsed total=${allParsed.length}`);
      if (allParsed.length === 0) {
        vscode.window.showWarningMessage('未在该文件中找到可导入的日期记录');
        return;
      }

      const parsed = allParsed.filter(item => {
        const [y, m] = item.date.split('-').map(Number);
        return y === year && m === month;
      });

      if (parsed.length === 0) {
        const choice = await vscode.window.showWarningMessage(
          `未匹配到 ${year}-${String(month).padStart(2, '0')} 的记录，是否导入全部日期？`,
          { modal: true },
          '导入全部',
          '取消'
        );
        if (choice !== '导入全部') {
          return;
        }
      }

      const finalItems = parsed.length > 0 ? parsed : allParsed;
      console.log(`[xlsx-import] final items=${finalItems.length}`);

      this.pendingImportItems = finalItems;
      this._view?.webview.postMessage({
        command: 'importPreview',
        source: path.basename(filePath),
        year,
        month,
        items: finalItems.map(item => ({
          date: item.date,
          completed: item.completed,
          exists: this.workLogManager.getDailyLog(new Date(item.date + 'T12:00:00')) !== null
        }))
      });
    } catch (e) {
      console.error('[xlsx-import] failed:', e);
      vscode.window.showErrorMessage(`导入失败: ${e}`);
    }
  }

  private async _confirmImport(year: number, month: number, dates: string[]) {
    if (!this.pendingImportItems || this.pendingImportItems.length === 0) {
      vscode.window.showWarningMessage('没有可导入的数据');
      return;
    }

    const selectedSet = new Set(dates);
    const items = dates.length > 0
      ? this.pendingImportItems.filter(item => selectedSet.has(item.date))
      : this.pendingImportItems;

    if (items.length === 0) {
      vscode.window.showWarningMessage('未选择任何要导入的日期');
      return;
    }

    const existing = items.filter(item => {
      return this.workLogManager.getDailyLog(new Date(item.date + 'T12:00:00')) !== null;
    });

    let overwrite = false;
    if (existing.length > 0) {
      const choice = await vscode.window.showWarningMessage(
        `检测到 ${existing.length} 条已存在日志，如何处理？`,
        { modal: true },
        '覆盖全部',
        '跳过已存在',
        '取消'
      );
      if (choice === '覆盖全部') {
        overwrite = true;
      } else if (choice === '跳过已存在') {
        overwrite = false;
      } else {
        return;
      }
    }

    let imported = 0;
    let skipped = 0;
    for (const item of items) {
      const date = new Date(item.date + 'T12:00:00');
      const exists = this.workLogManager.getDailyLog(date) !== null;
      if (exists && !overwrite) {
        skipped++;
        continue;
      }
      this.workLogManager.saveDailyLog(date, item);
      imported++;
    }

    this.pendingImportItems = null;

    this._view?.webview.postMessage({
      command: 'importResult',
      year,
      month,
      imported,
      skipped
    });
  }

  private _parseTimesheetSheet(sheet: any): DailyLog[] {
    const items: Record<string, DailyLog> = {};
    const endRow = sheet.actualRowCount || sheet.rowCount || 2000;
    const { startRow, dateCol, detailCol } = this._detectColumns(sheet, endRow);
    console.log(`[xlsx-import] detect startRow=${startRow} dateCol=${dateCol} detailCol=${detailCol} endRow=${endRow}`);

    for (let i = startRow; i <= endRow; i++) {
      const row = sheet.getRow(i);
      const dateValue = row.getCell(dateCol).value;
      if (i === startRow || i === startRow + 1) {
        console.log(`[xlsx-import] row ${i} raw date=`, dateValue);
        console.log(`[xlsx-import] row ${i} raw detail=`, row.getCell(detailCol).value);
      }
      const dateStr = this._parseDateCell(dateValue);
      if (!dateStr) {
        continue;
      }

      const detailValue = row.getCell(detailCol).value;
      const detailText = this._cellToText(detailValue);
      if (detailText.includes('Detail Description') || detailText.includes('Working Hours')) {
        continue;
      }
      const tasks = this._splitTasks(detailText);

      if (!items[dateStr]) {
        items[dateStr] = {
          date: dateStr,
          completed: [],
          plan: [],
          blockers: [],
          notes: '',
          gitlog: [],
          ailog: [],
          gitCommit: [],
          origin_url: []
        };
      }

      if (tasks.length > 0) {
        items[dateStr].completed.push(...tasks);
      }
    }

    return Object.values(items).sort((a, b) => a.date.localeCompare(b.date));
  }

  private _getRepositoryOptions(yearMonth: string): string[] {
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
      return [];
    }

    const storagePath = this._resolveStoragePath();
    const monthDir = path.join(storagePath, yearMonth);
    const candidates = [
      path.join(monthDir, 'gitlog', '产物清单.tsv'),
      path.join(monthDir, '_artifacts.tsv')
    ];
    const urls = new Set<string>();

    for (const filePath of candidates) {
      if (!fs.existsSync(filePath)) {
        continue;
      }
      try {
        const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          const cols = line.split('\t');
          const originUrl = cols[2];
          if (originUrl && originUrl !== 'origin_url') {
            urls.add(originUrl);
          }
        }
      } catch (e) {
        console.warn(`读取仓库清单失败: ${filePath}`, e);
      }
    }

    return [...urls].sort();
  }

  private _detectColumns(sheet: any, endRow: number): { startRow: number; dateCol: number; detailCol: number } {
    const maxRow = Math.min(endRow, 15);
    let headerRow = 5;
    let dateCol = 2;
    let detailCol = 4;

    for (let i = 1; i <= maxRow; i++) {
      const row = sheet.getRow(i);
      const cells = row.values || [];
      let foundDateCol: number | null = null;
      let foundDetailCol: number | null = null;

      for (let col = 1; col < cells.length; col++) {
        const text = this._cellToText(row.getCell(col).value).toLowerCase();
        if (!foundDateCol && (text.includes('date') || text.includes('日期'))) {
          foundDateCol = col;
        }
        if (!foundDetailCol && (text.includes('detail') || text.includes('description') || text.includes('内容') || text.includes('工作') || text.includes('任务'))) {
          foundDetailCol = col;
        }
      }

      if (foundDateCol) {
        headerRow = i;
        dateCol = foundDateCol;
        if (foundDetailCol) {
          detailCol = foundDetailCol;
        }
        break;
      }
    }

    return { startRow: headerRow + 1, dateCol, detailCol };
  }

  private _parseDateCell(value: any): string | null {
    if (!value) {
      return null;
    }

    if (value instanceof Date) {
      return this._formatDate(value);
    }

    if (typeof value === 'number') {
      if (value >= 19000101 && value <= 21001231) {
        const raw = String(Math.trunc(value));
        if (raw.length === 8) {
          return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
        }
      }

      const date = new Date(Math.round((value - 25569) * 86400 * 1000));
      if (!isNaN(date.getTime())) {
        return this._formatDate(date);
      }
    }

    if (typeof value === 'object') {
      if (value.result) {
        return this._parseDateCell(value.result);
      }
      if (value.text) {
        return this._parseDateCell(value.text);
      }
      if (value.richText) {
        return this._parseDateCell(this._cellToText(value));
      }
    }

    const text = this._cellToText(value);
    if (!text) {
      return null;
    }

    const cleaned = text.trim();
    if (/^\d{8}$/.test(cleaned)) {
      return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}`;
    }
    if (/^\d{8}\.\d+$/.test(cleaned)) {
      const raw = cleaned.split('.')[0];
      return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    }
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(cleaned)) {
      const [y, m, d] = cleaned.split('-');
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    if (/^\d{4}[/.]\d{1,2}[/.]\d{1,2}$/.test(cleaned)) {
      const parts = cleaned.replace(/\./g, '/').split('/');
      const [y, m, d] = parts;
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }

    const parsed = Date.parse(cleaned);
    if (!Number.isNaN(parsed)) {
      return this._formatDate(new Date(parsed));
    }

    return null;
  }

  private _cellToText(value: any): string {
    if (!value) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number') {
      return String(value);
    }
    if (value.text) {
      return String(value.text);
    }
    if (Array.isArray(value.richText)) {
      return value.richText.map((t: any) => t.text || '').join('');
    }
    return String(value);
  }

  private _splitTasks(text: string): string[] {
    if (!text || !text.trim()) {
      return [];
    }

    const normalized = text.replace(/\r/g, '\n');
    const parts = normalized.split(/\n|\s*&\s*|\s*\|\s*|；|;|、/g);
    const tasks = parts.map(p => p.trim()).filter(Boolean);
    return tasks.length > 0 ? tasks : [text.trim()];
  }

  private _formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private _isPreviewEnabled(): boolean {
    const config = vscode.workspace.getConfiguration('dailyWorkLog');
    return config.get<boolean>('preview.enabled') ?? true;
  }

  private async _loadPluginSettings(): Promise<PluginSettings> {
    const stored = this._context.globalState.get<PluginSettings>('pluginSettings');
    const config = vscode.workspace.getConfiguration('dailyWorkLog');
    const merged: PluginSettings = {
      ...DEFAULT_PLUGIN_SETTINGS,
      ...stored,
      aiThinkingEnabled: stored?.aiThinkingEnabled ?? DEFAULT_PLUGIN_SETTINGS.aiThinkingEnabled,
      aiReasoningEffort: stored?.aiReasoningEffort ?? DEFAULT_PLUGIN_SETTINGS.aiReasoningEffort,
      aiTemperature: stored?.aiTemperature ?? DEFAULT_PLUGIN_SETTINGS.aiTemperature,
      aiTimeoutMs: stored?.aiTimeoutMs ?? DEFAULT_PLUGIN_SETTINGS.aiTimeoutMs,
      aiSystemPrompt: stored?.aiSystemPrompt ?? DEFAULT_PLUGIN_SETTINGS.aiSystemPrompt,
      aiShowReasoningStream:
        stored?.aiShowReasoningStream ??
        DEFAULT_PLUGIN_SETTINGS.aiShowReasoningStream,
      dailySyncFieldVisibility:
        stored?.dailySyncFieldVisibility ??
        DEFAULT_PLUGIN_SETTINGS.dailySyncFieldVisibility,
      gitCollectCacheEnabled:
        stored?.gitCollectCacheEnabled ??
        DEFAULT_PLUGIN_SETTINGS.gitCollectCacheEnabled,
      originFilters: resolveOriginFilters({
        originFilters: stored?.originFilters,
        originHosts: stored?.originHosts,
      }),
      email: {
        ...DEFAULT_PLUGIN_SETTINGS.email,
        ...stored?.email,
        smtpHost:
          stored?.email?.smtpHost || config.get<string>('email.smtpHost') || '',
        smtpPort:
          stored?.email?.smtpPort || config.get<number>('email.smtpPort') || 587,
        username:
          stored?.email?.username || config.get<string>('email.username') || '',
        from: stored?.email?.from || config.get<string>('email.from') || '',
        to: stored?.email?.to || config.get<string>('email.to') || '',
        cc: stored?.email?.cc || config.get<string>('email.cc') || '',
      },
    };
    if (!merged.displayName) {
      merged.displayName = (await this._getDisplayName()) || '彭聪';
    }
    return merged;
  }

  private async _savePluginSettings(
    settings: PluginSettings,
    apiKey?: string,
    emailPassword?: string,
  ): Promise<void> {
    const normalized: PluginSettings = {
      ...settings,
      aiSystemPrompt: normalizeAiSystemPromptForSave(settings.aiSystemPrompt),
    };
    await this._context.globalState.update('pluginSettings', normalized);
    if (apiKey?.trim()) {
      await this._context.secrets.store('dailyWorkLog.ai.apiKey', apiKey.trim());
    }
    if (emailPassword?.trim()) {
      await this._context.secrets.store(
        'dailyWorkLog.email.password',
        emailPassword.trim(),
      );
    }
    this._view?.webview.postMessage({ command: 'pluginSettingsSaved' });
    this._updateWebview();
  }

  private async _sendPluginSettings(): Promise<void> {
    const settings = await this._loadPluginSettings();
    const apiKeyRaw = (await this._context.secrets.get('dailyWorkLog.ai.apiKey')) || '';
    const emailPasswordRaw =
      (await this._context.secrets.get('dailyWorkLog.email.password')) || '';
    const config = vscode.workspace.getConfiguration('dailyWorkLog');
    const storagePath = config.get<string>('storagePath') || '~/.work-logs';
    this._view?.webview.postMessage({
      command: 'pluginSettingsLoaded',
      settings,
      aiSystemPromptDefault: DEFAULT_AI_SYSTEM_PROMPT,
      secrets: {
        apiKey: secretDisplayInfo(apiKeyRaw),
        emailPassword: secretDisplayInfo(emailPasswordRaw),
      },
      vscodeConfig: {
        storagePath,
        storagePathResolved: this._expandHome(storagePath),
        autoSave: config.get<boolean>('autoSave') ?? true,
        previewEnabled: config.get<boolean>('preview.enabled') ?? true,
      },
    });
  }

  private async _revealPluginSecret(
    field: 'apiKey' | 'emailPassword',
  ): Promise<void> {
    const key =
      field === 'apiKey'
        ? 'dailyWorkLog.ai.apiKey'
        : 'dailyWorkLog.email.password';
    const value = (await this._context.secrets.get(key)) || '';
    this._view?.webview.postMessage({
      command: 'secretRevealed',
      field,
      value,
    });
    if (value) {
      this.outputChannel.appendLine(
        `${field === 'apiKey' ? 'API Key' : '邮件密码'}: ${value}`,
      );
    }
  }

  private _collectRunId = 0;

  private _postCollectLog(line: string, runId?: number): void {
    if (runId !== undefined && runId !== this._collectRunId) {
      return;
    }
    const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const formatted = `[${ts}] ${line}`;
    this.outputChannel.appendLine(formatted);
    this._view?.webview.postMessage({ command: 'collectLogAppend', line: formatted });
  }

  private _cancelCollect(): void {
    this._collectRunId += 1;
    this.gitEvidenceService.cancelActiveCollect();
    this._view?.webview.postMessage({
      command: 'collectLogEnd',
      cancelled: true,
      error: '已取消采集',
    });
  }

  private _parseCollectRequest(data: {
    scope: FillScope;
    anchorDate: string;
    rangeStart?: string;
    rangeEnd?: string;
  }): CollectRequest {
    return {
      scope: data.scope,
      anchorDate: data.anchorDate,
      rangeStart: data.rangeStart,
      rangeEnd: data.rangeEnd,
    };
  }

  private _collectMonthKey(request: CollectRequest): string {
    const custom = resolveCustomRange(request);
    return (custom?.start ?? request.anchorDate).slice(0, 7);
  }

  private _fillCacheLookup(request: CollectRequest): FillPreview {
    return {
      scope: request.scope,
      anchorDate: request.anchorDate,
      rangeStart: request.rangeStart,
      rangeEnd: request.rangeEnd,
      dates: [],
      days: [],
    };
  }

  private async _collectGitFill(request: CollectRequest): Promise<void> {
    const settings = await this._loadPluginSettings();
    const dates = resolveCollectDates(request);
    const existingLogs = await this._loadLogsForDates(dates);
    const monthKey = this._collectMonthKey(request);
    const runId = ++this._collectRunId;
    const customRange = resolveCustomRange(request);
    const cacheSearchConfig = buildFillCacheSearchConfig(settings);
    const cacheLookup = this._fillCacheLookup(request);

    const anchorLabel = formatFillAnchorLabel(request.scope, request.anchorDate, customRange);
    const targetDates = dates.join(', ');
    this._view?.webview.postMessage({
      command: 'collectLogStart',
      title: `Git 采集（${formatFillScopeAnchorTitle(request)}）`,
      scope: request.scope,
      dates,
      anchorDate: request.anchorDate,
    });

    const tryCache =
      settings.gitCollectCacheEnabled && isHistoricalCollectRange(dates);
    if (tryCache) {
      const cached = this.fillCacheService.load(
        monthKey,
        cacheLookup,
        cacheSearchConfig,
      );
      if (cached && this._previewHasGitEvidence(cached)) {
        this._postCollectLog(
          `准备采集（命中历史采集缓存）| 范围 ${anchorLabel} | 写入目标日 ${targetDates} | 共 ${dates.length} 天`,
          runId,
        );
        this._view?.webview.postMessage({
          command: 'collectLogEnd',
          preview: { ...cached, source: 'git' },
        });
        return;
      }
    }

    this._postCollectLog(
      `准备采集（重新扫描 Git）| 范围 ${anchorLabel} | 写入目标日 ${targetDates} | 共 ${dates.length} 天`,
      runId,
    );

    try {
      const preview = await this.gitEvidenceService.collect(
        request,
        settings,
        existingLogs,
        (line) => this._postCollectLog(line, runId),
      );
      if (runId !== this._collectRunId) {
        return;
      }
      this.fillCacheService.save(
        monthKey,
        { ...preview, source: 'git' },
        cacheSearchConfig,
      );
      this._view?.webview.postMessage({
        command: 'collectLogEnd',
        preview: { ...preview, source: 'git' },
      });
    } catch (error) {
      if (runId !== this._collectRunId) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this._view?.webview.postMessage({
        command: 'collectLogEnd',
        error: message,
        cancelled: message.includes('取消'),
      });
    }
  }

  private _buildPreviewFromLogs(
    request: CollectRequest,
    existingLogs: Record<string, DailyLog | null>,
  ): FillPreview {
    const dates = resolveCollectDates(request);
    return {
      scope: request.scope,
      anchorDate: request.anchorDate,
      rangeStart: request.rangeStart,
      rangeEnd: request.rangeEnd,
      dates,
      source: 'ai',
      days: dates.map((date) => {
        const log = existingLogs[date];
        return {
          date,
          completed: log?.completed || [],
          gitlog: log?.gitlog || [],
          gitCommit: log?.gitCommit || [],
          originUrl: log?.origin_url || [],
          ailogDraft: log?.ailog || [],
          warnings: [],
        };
      }),
    };
  }

  private _previewHasGitEvidence(preview: FillPreview): boolean {
    return preview.days.some(
      (day) => day.gitlog.length > 0 || day.gitCommit.length > 0,
    );
  }

  private async _resolveAiPolishPreview(
    request: CollectRequest,
    preview?: FillPreview,
  ): Promise<FillPreview | null> {
    if (preview) {
      return { ...preview, source: 'ai' };
    }

    const settings = await this._loadPluginSettings();
    const monthKey = this._collectMonthKey(request);
    const cacheLookup = this._fillCacheLookup(request);
    const cacheSearchConfig = buildFillCacheSearchConfig(settings);
    const cached = this.fillCacheService.load(
      monthKey,
      cacheLookup,
      cacheSearchConfig,
    );
    if (cached && this._previewHasGitEvidence(cached)) {
      return { ...cached, source: 'ai' };
    }

    const existingLogs = await this._loadLogsForDates(resolveCollectDates(request));
    const fromLogs = this._buildPreviewFromLogs(request, existingLogs);
    if (this._previewHasGitEvidence(fromLogs)) {
      return fromLogs;
    }

    return null;
  }

  private async _aiPolishFill(
    request: CollectRequest,
    preview?: FillPreview,
  ): Promise<void> {
    const settings = await this._loadPluginSettings();
    const apiKey = (await this._context.secrets.get('dailyWorkLog.ai.apiKey')) || '';
    if (!apiKey) {
      vscode.window.showWarningMessage('请先在设置中配置 AI API Key');
      return;
    }

    const monthKey = this._collectMonthKey(request);
    const cacheSearchConfig = buildFillCacheSearchConfig(settings);
    const workingPreview = await this._resolveAiPolishPreview(request, preview);
    if (!workingPreview) {
      vscode.window.showWarningMessage(
        '请先执行 Git 采集，或确保当前范围已有 GitLog / GitCommit 数据后再润色',
      );
      this._view?.webview.postMessage({
        command: 'collectLogEnd',
        error: '缺少 Git 采集数据，请先点击「Git 采集」',
      });
      return;
    }

    const runId = ++this._collectRunId;
    this._view?.webview.postMessage({
      command: 'collectLogStart',
      title: `AI 润色（${formatFillScopeAnchorTitle(request)}）`,
      scope: request.scope,
      dates: workingPreview.dates,
      anchorDate: request.anchorDate,
    });

    try {
      this._postCollectLog(
        preview
          ? '[AI] 基于当前确认页数据重新润色（不重复 Git 采集）'
          : '[AI] 基于已有 Git 采集数据润色 → 剔除发布版本类 commit → 生成 AILog',
        runId,
      );
      const existingLogs = await this._loadLogsForDates(workingPreview.dates);
      const polishedDays = await this.aiPolishService.polishDays(
        workingPreview.days,
        settings,
        apiKey,
        existingLogs,
        (line) => this._postCollectLog(line, runId),
      );
      const nextPreview: FillPreview = {
        ...workingPreview,
        source: 'ai',
        days: polishedDays,
      };
      this.fillCacheService.save(monthKey, nextPreview, cacheSearchConfig);
      this._view?.webview.postMessage({
        command: 'collectLogEnd',
        preview: nextPreview,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this._view?.webview.postMessage({
        command: 'collectLogEnd',
        error: message,
      });
    }
  }

  private async _applyFillPreview(
    preview: FillPreview,
    mode: 'git' | 'ai',
  ): Promise<void> {
    let applied = 0;
    const monthKey = preview.anchorDate.slice(0, 7);

    for (const day of preview.days) {
      const logDate = new Date(`${day.date}T12:00:00`);
      const existing =
        this.workLogManager.getDailyLog(logDate) ||
        ({
          date: day.date,
          completed: [],
          plan: [],
          blockers: [],
          notes: '',
          gitlog: [],
          ailog: [],
          gitCommit: [],
          origin_url: [],
        } as DailyLog);

      if (mode === 'git') {
        this.workLogManager.saveDailyLog(logDate, {
          ...existing,
          date: day.date,
          completed: existing.completed,
          plan: existing.plan,
          blockers: existing.blockers,
          notes: existing.notes,
          ailog: existing.ailog,
          gitlog: day.gitlog,
          gitCommit: day.gitCommit,
          origin_url: day.originUrl,
        });
        day.appliedGit = true;
      } else {
        this.workLogManager.saveDailyLog(logDate, {
          ...existing,
          date: day.date,
          completed: existing.completed,
          plan: existing.plan,
          blockers: existing.blockers,
          notes: existing.notes,
          gitlog: existing.gitlog,
          gitCommit: existing.gitCommit,
          origin_url: existing.origin_url,
          ailog: day.ailogDraft,
        });
        day.appliedAi = true;
      }
      applied += 1;
    }

    const settings = await this._loadPluginSettings();
    const cacheSearchConfig = buildFillCacheSearchConfig(settings);
    this.fillCacheService.save(monthKey, preview, cacheSearchConfig);

    this._view?.webview.postMessage({
      command: 'fillApplied',
      message: `✅ 已写入 ${applied} 天（${mode === 'git' ? 'Git 字段' : 'AILog'}）`,
      mode,
    });
    this._updateWebview();
  }

  private async _loadLogsForDates(
    dates: string[],
  ): Promise<Record<string, DailyLog | null>> {
    const map: Record<string, DailyLog | null> = {};
    for (const date of dates) {
      map[date] = this.workLogManager.getDailyLog(new Date(`${date}T12:00:00`));
    }
    return map;
  }

  private async _getDisplayName(): Promise<string> {
    const fromState = this._context.globalState.get<string>('pluginSettings.displayName');
    if (fromState?.trim()) {
      return fromState.trim();
    }
    const fromConfig = vscode.workspace
      .getConfiguration('dailyWorkLog')
      .get<string>('displayName');
    return fromConfig?.trim() || '彭聪';
  }

  private _renderHtml(webview: vscode.Webview): string {
    const styleUri = getUri(webview, this._extensionUri, [
      'web',
      'dist',
      'assets',
      'index.css',
    ]);
    const scriptUri = getUri(webview, this._extensionUri, [
      'web',
      'dist',
      'assets',
      'index.js',
    ]);
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>Daily Work Log</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}
