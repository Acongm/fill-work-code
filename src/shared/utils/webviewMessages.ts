/** Webview ↔ Extension Host postMessage commands */

export const MSG_READY = 'ready';
export const MSG_SAVE = 'save';
export const MSG_LOAD_DATE = 'loadDate';
export const MSG_LOAD_MONTH_LOGS = 'loadMonthLogs';
export const MSG_GENERATE_TIMESHEET = 'generateTimesheet';
export const MSG_GENERATE_TIMESHEET_FULL = 'generateTimesheetFull';
export const MSG_OPEN_SETTINGS = 'openSettings';
export const MSG_OPEN_PANEL_SETTINGS = 'openPanelSettings';
export const MSG_GET_PLUGIN_SETTINGS = 'getPluginSettings';
export const MSG_SAVE_PLUGIN_SETTINGS = 'savePluginSettings';
export const MSG_COLLECT_GIT_FILL = 'collectGitFill';
export const MSG_COLLECT_AND_POLISH = 'collectAndPolish';
export const MSG_CANCEL_COLLECT = 'cancelCollect';
export const MSG_AI_POLISH_FILL = 'aiPolishFill';
export const MSG_APPLY_FILL_PREVIEW = 'applyFillPreview';
export const MSG_DISCARD_FILL_PREVIEW = 'discardFillPreview';
export const MSG_REVEAL_PLUGIN_SECRET = 'revealPluginSecret';
export const MSG_REFRESH = 'refresh';
export const MSG_OPEN_PROFILE = 'openProfile';
export const MSG_OPEN_SUMMARY_PREVIEW = 'openSummaryPreview';
export const MSG_UPDATE_SUMMARY_PREVIEW = 'updateSummaryPreview';
export const MSG_CLOSE_SUMMARY_PREVIEW = 'closeSummaryPreview';
export const MSG_OPEN_DAILY_PREVIEW = 'openDailyPreview';
export const MSG_UPDATE_DAILY_PREVIEW = 'updateDailyPreview';
export const MSG_CLOSE_DAILY_PREVIEW = 'closeDailyPreview';
export const MSG_CLEAR_SUMMARY_CACHE = 'clearSummaryCache';
export const MSG_AI_GENERATE_ALL = 'aiGenerateAll';
export const MSG_LIST_MATERIALS = 'listMaterials';
export const MSG_LOAD_REPOSITORY_OPTIONS = 'loadRepositoryOptions';
export const MSG_OPEN_MATERIAL = 'openMaterial';
export const MSG_DELETE_MATERIAL = 'deleteMaterial';
export const MSG_SEND_EMAIL_WITH_ATTACHMENTS = 'sendEmailWithAttachments';
export const MSG_GET_FULL_CONFIG = 'getFullConfig';

export const MSG_LIST_REPOS = 'listRepos';
export const MSG_GET_REPO_DETAIL = 'getRepoDetail';
export const MSG_OPEN_REPO = 'openRepoInVscode';
export const MSG_UPDATE_REPO = 'updateRepo';

export interface WebviewStartupGate {
  isReady(): boolean;
  acceptReady(activeDate: string): boolean;
}

export function createWebviewStartupGate(
  log: (message: string) => void,
): WebviewStartupGate {
  let ready = false;
  log('等待 Webview ready');

  return {
    isReady: () => ready,
    acceptReady: (activeDate: string) => {
      if (ready) {
        log(`忽略重复 Webview ready: ${activeDate}`);
        return false;
      }
      ready = true;
      log(`Webview ready: ${activeDate}`);
      return true;
    },
  };
}

export interface ListReposPayload {
  search?: string;
}

export interface GetRepoDetailPayload {
  originUrl: string;
  cloneId?: string;
  month?: string;
}

export interface OpenRepoPayload {
  repoId: string;
}

export interface UpdateRepoPayload {
  repoId: string;
  pinned?: boolean;
  hidden?: boolean;
}
