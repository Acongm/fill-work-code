import * as vscode from 'vscode';
import { WorkLogManager } from '../../daily/utils/workLogManager';
import { AiReportGenerator } from '../../summary/utils/aiReportGenerator';
import { TimesheetRunner } from '../../summary/utils/timesheetRunner';
import { getNonce } from '../../shared/utils/getNonce';
import { getUri } from '../../shared/utils/getUri';
import { GitEvidenceService } from '../../collection/utils/gitEvidenceService';
import { AiPolishService } from '../../collection/utils/aiPolishService';
import { FillCacheService } from '../../collection/utils/fillCacheService';
import type { HostPanelDeps, HostPanelState } from '../types/hostDependencies';
import { sendFullConfig, updateWebview } from '../commands/buildWebviewConfig';
import {
  sendPluginSettings,
  savePluginSettings,
  revealPluginSecret,
} from '../../settings/commands/settingsMessages';
import {
  collectGitFill,
  cancelCollect,
  aiPolishFill,
  applyFillPreview,
  discardFillPreview,
  collectAndPolish,
  parseCollectRequest,
} from '../../collection/commands/collectMessages';
import {
  handleListRepos,
  handleGetRepoDetail,
  handleOpenRepo,
  handleUpdateRepo,
} from '../../projects/commands/projectMessages';
import { handleGenerateProjectDailyLogs } from '../../projects/commands/generateProjectDailyLogs';
import {
  generateTimesheet,
  sendMaterialsEmail,
  generateAiAll,
  listMaterials,
  openMaterial,
  deleteMaterial,
} from '../../summary/commands/summaryMessages';
import {
  openSummaryPreview,
  handleUpdateSummaryPreview,
  closeSummaryPreview,
  openDailyPreview,
  handleUpdateDailyPreview,
  closeDailyPreview,
} from '../../preview/commands/previewMessages';
import {
  handleSave,
  handleLoadDate,
  handleLoadMonthLogs,
  handleLoadRepositoryOptions,
  handleClearSummaryCache,
  handleSyncGeneratedJson,
} from '../../daily/commands/dailyMessages';
import type { Database } from '../../database/types/database';
import {
  createWebviewStartupGate,
  type WebviewStartupGate,
} from '../../shared/utils/webviewMessages';
import { retryPendingProjections } from '../../daily/commands/syncGeneratedJson';
import type { ProjectionGroup } from '../../database/commands/projectionRepository';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'daily-work-log.chatView';

  private _view?: vscode.WebviewView;
  private workLogManager: WorkLogManager;
  private aiReportGenerator: AiReportGenerator;
  private gitEvidenceService: GitEvidenceService;
  private aiPolishService: AiPolishService;
  private timesheetRunner: TimesheetRunner;
  private fillCacheService: FillCacheService;
  private outputChannel: vscode.OutputChannel;
  private startupGate?: WebviewStartupGate;
  private _panelState: HostPanelState = {
    collectRunId: 0,
  };

  constructor(
    private readonly _extensionUri: vscode.Uri,
    workLogManager: WorkLogManager,
    private readonly _context: vscode.ExtensionContext,
    private readonly databaseReady: Promise<Database>,
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
    this.databaseReady
      .then(
        async database => {
          this.logStartup('SQLite 初始化完成');
          const retried = await retryPendingProjections(
            database,
            this.workLogManager,
            message => this.logStartup(message),
          );
          if (retried > 0) {
            this.logStartup(`已重试 ${retried} 个待处理 JSON 投影`);
          }
        },
        error =>
          this.logStartup(
            `SQLite 初始化失败: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
      )
      .catch(error => {
        this.logStartup(
          `待处理 JSON 投影重试失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }

  public postToWebview(message: Record<string, unknown>): void {
    this._view?.webview.postMessage(message);
  }

  public showOutput(): void {
    this.outputChannel.show(true);
  }

  private logStartup(message: string): void {
    this.outputChannel.appendLine(`[启动] ${message}`);
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;
    this.startupGate = createWebviewStartupGate(message =>
      this.logStartup(message),
    );

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, 'web', 'dist'),
        vscode.Uri.joinPath(this._extensionUri, 'dist'),
      ],
    };

    webviewView.webview.html = this._renderHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      data => this._handleMessage(data),
      undefined,
    );

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible && this.startupGate?.isReady()) {
        this.logStartup('Webview 恢复可见，刷新当前日期');
        void this._updateWebview();
      }
    });
  }

  private async _buildDeps(): Promise<HostPanelDeps> {
    return {
      view: this._view,
      extensionUri: this._extensionUri,
      context: this._context,
      database: await this.databaseReady,
      workLogManager: this.workLogManager,
      gitEvidenceService: this.gitEvidenceService,
      aiPolishService: this.aiPolishService,
      timesheetRunner: this.timesheetRunner,
      fillCacheService: this.fillCacheService,
      aiReportGenerator: this.aiReportGenerator,
      outputChannel: this.outputChannel,
      postToWebview: (message) => this.postToWebview(message),
      state: this._panelState,
      updateWebview: () => this._updateWebview(),
    };
  }

  private async _updateWebview(): Promise<void> {
    try {
      await updateWebview(await this._buildDeps());
    } catch (error) {
      this.postToWebview({
        command: 'initializationError',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async _handleMessage(data: any) {
    let deps: HostPanelDeps;
    try {
      deps = await this._buildDeps();
    } catch (error) {
      this.postToWebview({
        command: 'initializationError',
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    switch (data.command) {
      case 'ready':
        {
          const activeDate =
            typeof data.activeDate === 'string' && data.activeDate
              ? data.activeDate
              : new Date().toLocaleDateString('en-CA');
          if (!this.startupGate?.acceptReady(activeDate)) {
            return;
          }
          deps.state.activeDate = activeDate;
          await this._updateWebview();
        }
        break;

      case 'save':
        await handleSave(deps, data.log, data.items);
        break;

      case 'loadDate':
        await handleLoadDate(deps, data.date);
        break;

      case 'syncGeneratedJson': {
        const groups = Array.isArray(data.groups)
          ? data.groups.filter(
              (group: unknown): group is ProjectionGroup =>
                group === 'git' || group === 'ai',
            )
          : [];
        await handleSyncGeneratedJson(deps, data.date, groups);
        break;
      }

      case 'loadMonthLogs':
        await handleLoadMonthLogs(deps, data.year, data.month);
        break;

      case 'generateTimesheet':
        await generateTimesheet(deps, data.year, data.month, false, false);
        break;

      case 'generateTimesheetFull':
        await generateTimesheet(deps, data.year, data.month, false, true);
        break;

      case 'openSettings':
      case 'openPanelSettings':
        this._view?.webview.postMessage({ command: 'openPanelSettings' });
        break;

      case 'getPluginSettings':
        await sendPluginSettings(deps);
        break;

      case 'savePluginSettings':
        await savePluginSettings(
          deps,
          data.settings,
          data.apiKey,
          data.emailPassword,
        );
        break;

      case 'collectGitFill':
        await collectGitFill(deps, parseCollectRequest(data));
        break;

      case 'collectAndPolish':
        await collectAndPolish(deps, parseCollectRequest(data));
        break;

      case 'cancelCollect':
        cancelCollect(deps);
        break;

      case 'aiPolishFill':
        await aiPolishFill(deps, parseCollectRequest(data), data.preview);
        break;

      case 'applyFillPreview':
        try {
          await applyFillPreview(deps, data.preview, data.mode);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          deps.outputChannel.appendLine(`[应用采集结果] 失败：${message}`);
          deps.postToWebview({
            command: 'notify',
            message: `❌ 应用失败：${message}`,
          });
        }
        break;

      case 'discardFillPreview':
        discardFillPreview(deps);
        break;

      case 'revealPluginSecret':
        await revealPluginSecret(deps, data.field as 'apiKey' | 'emailPassword');
        break;

      case 'refresh':
        await this._updateWebview();
        break;

      case 'openProfile':
        this._view?.webview.postMessage({ command: 'openProfile' });
        break;

      case 'openSummaryPreview':
        openSummaryPreview(deps, data.year, data.month);
        break;

      case 'updateSummaryPreview':
        handleUpdateSummaryPreview(deps, data.year, data.month);
        break;

      case 'closeSummaryPreview':
        closeSummaryPreview(deps);
        break;

      case 'openDailyPreview':
        openDailyPreview(deps, data.date);
        break;

      case 'updateDailyPreview':
        handleUpdateDailyPreview(deps, data.date);
        break;

      case 'closeDailyPreview':
        closeDailyPreview(deps);
        break;

      case 'clearSummaryCache':
        handleClearSummaryCache(deps, data.year, data.month);
        break;

      case 'aiGenerateAll':
        await generateAiAll(deps, data.year, data.month);
        break;

      case 'listMaterials':
        listMaterials(deps);
        break;

      case 'loadRepositoryOptions':
        handleLoadRepositoryOptions(deps, data.month, data.date);
        break;

      case 'openMaterial':
        openMaterial(data.path);
        break;

      case 'deleteMaterial':
        await deleteMaterial(deps, data.path);
        break;

      case 'sendEmailWithAttachments':
        await sendMaterialsEmail(deps, {
          subject: data.subject,
          body: data.body,
          attachments: data.attachments || [],
        });
        break;

      case 'getFullConfig':
        await sendFullConfig(deps);
        break;

      case 'listRepos':
        await handleListRepos(deps, data.search);
        break;

      case 'getRepoDetail':
        await handleGetRepoDetail(deps, data.originUrl, data.cloneId, data.month);
        break;

      case 'generateProjectDailyLogs':
        await handleGenerateProjectDailyLogs(
          deps,
          String(data.originUrl || ''),
          Array.isArray(data.dates)
            ? data.dates.filter(
                (date: unknown): date is string => typeof date === 'string',
              )
            : [],
        );
        break;

      case 'openRepoInVscode':
        await handleOpenRepo(deps, data.repoId);
        break;

      case 'updateRepo':
        await handleUpdateRepo(deps, data.repoId, {
          pinned: data.pinned,
          hidden: data.hidden,
        });
        break;
    }
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
