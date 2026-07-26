import type * as vscode from 'vscode';
import type { WorkLogManager } from '../../daily/utils/workLogManager';
import type { AiReportGenerator } from '../../summary/utils/aiReportGenerator';
import type { GitEvidenceService } from '../../collection/utils/gitEvidenceService';
import type { AiPolishService } from '../../collection/utils/aiPolishService';
import type { TimesheetRunner } from '../../summary/utils/timesheetRunner';
import type { FillCacheService } from '../../collection/utils/fillCacheService';
import type { Database } from '../../database/types/database';

export type PostToWebview = (message: Record<string, unknown>) => void;

export interface HostPanelState {
  summaryPreviewPanel?: vscode.WebviewPanel;
  dailyPreviewPanel?: vscode.WebviewPanel;
  summaryPreviewTimer?: NodeJS.Timeout;
  dailyPreviewTimer?: NodeJS.Timeout;
  collectRunId: number;
  activeDate?: string;
}

export interface HostPanelDeps {
  view?: vscode.WebviewView;
  extensionUri: vscode.Uri;
  context: vscode.ExtensionContext;
  database: Database;
  workLogManager: WorkLogManager;
  gitEvidenceService: GitEvidenceService;
  aiPolishService: AiPolishService;
  timesheetRunner: TimesheetRunner;
  fillCacheService: FillCacheService;
  aiReportGenerator: AiReportGenerator;
  outputChannel: vscode.OutputChannel;
  postToWebview: PostToWebview;
  state: HostPanelState;
  updateWebview: () => Promise<void>;
}
