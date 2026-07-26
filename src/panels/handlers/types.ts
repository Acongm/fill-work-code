import type * as vscode from 'vscode';
import type { WorkLogManager } from '../../lib/workLogManager';
import type { AiReportGenerator } from '../../lib/aiReportGenerator';
import type { GitEvidenceService } from '../../services/gitEvidenceService';
import type { AiPolishService } from '../../services/aiPolishService';
import type { TimesheetRunner } from '../../services/timesheetRunner';
import type { FillCacheService } from '../../services/fillCacheService';

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
