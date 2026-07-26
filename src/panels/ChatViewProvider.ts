import * as vscode from 'vscode';
import { WorkLogManager } from '../lib/workLogManager';
import { AiReportGenerator } from '../lib/aiReportGenerator';
import { TimesheetRunner } from '../services/timesheetRunner';
import { getNonce } from '../utilities/getNonce';
import { getUri } from '../utilities/getUri';
import { GitEvidenceService } from '../services/gitEvidenceService';
import { AiPolishService } from '../services/aiPolishService';
import { FillCacheService } from '../services/fillCacheService';
import type { HostPanelDeps, HostPanelState } from './handlers/types';
import { sendFullConfig, updateWebview } from './webviewConfigBuilder';
import {
  sendPluginSettings,
  savePluginSettings,
  revealPluginSecret,
} from './handlers/settingsHandler';
import {
  collectGitFill,
  cancelCollect,
  aiPolishFill,
  applyFillPreview,
  discardFillPreview,
  collectAndPolish,
  parseCollectRequest,
} from './handlers/collectHandler';
import {
  handleListRepos,
  handleGetRepoDetail,
  handleOpenRepo,
  handleUpdateRepo,
} from './handlers/repoHandler';
import {
  generateTimesheet,
  sendMaterialsEmail,
  generateAiAll,
  listMaterials,
  openMaterial,
  deleteMaterial,
} from './handlers/timesheetHandler';
import {
  openSummaryPreview,
  handleUpdateSummaryPreview,
  closeSummaryPreview,
  openDailyPreview,
  handleUpdateDailyPreview,
  closeDailyPreview,
} from './handlers/previewHandler';
import {
  handleSave,
  handleLoadDate,
  handleLoadMonthLogs,
  handleLoadRepositoryOptions,
  handleClearSummaryCache,
} from './handlers/dailyLogHandler';

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
  private _panelState: HostPanelState = {
    collectRunId: 0,
  };

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
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
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

    webviewView.webview.onDidReceiveMessage(
      data => this._handleMessage(data),
      undefined,
    );

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        void this._updateWebview();
      }
    });

    setTimeout(() => void this._updateWebview(), 100);
  }

  private _buildDeps(): HostPanelDeps {
    return {
      view: this._view,
      extensionUri: this._extensionUri,
      context: this._context,
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
    await updateWebview(this._buildDeps());
  }

  private async _handleMessage(data: any) {
    const deps = this._buildDeps();

    switch (data.command) {
      case 'ready':
        if (typeof data.activeDate === 'string' && data.activeDate) {
          deps.state.activeDate = data.activeDate;
        }
        await this._updateWebview();
        break;

      case 'save':
        await handleSave(deps, data.log);
        break;

      case 'loadDate':
        await handleLoadDate(deps, data.date);
        break;

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
        await applyFillPreview(deps, data.preview, data.mode);
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
