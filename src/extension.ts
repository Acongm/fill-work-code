import * as vscode from 'vscode';
import { WorkLogManager } from './lib/workLogManager';
import { ChatViewProvider } from './panels/ChatViewProvider';
import { loadRuntimeConfiguration } from './settings/commands/settingsStore';

let workLogManager: WorkLogManager;

export function activate(context: vscode.ExtensionContext) {
  console.log('Daily Work Log extension activated');

  const storageDir = loadRuntimeConfiguration().storagePathResolved;

  workLogManager = new WorkLogManager(storageDir);
  console.log(`Work logs storage: ${storageDir}`);

  const chatViewProvider = new ChatViewProvider(
    context.extensionUri,
    workLogManager,
    context,
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ChatViewProvider.viewType,
      chatViewProvider,
    ),
  );

  const post = (msg: Record<string, unknown>) => chatViewProvider.postToWebview(msg);

  context.subscriptions.push(
    vscode.commands.registerCommand('daily-work-log.quickOpen', () => {
      vscode.commands.executeCommand('workbench.view.extension.daily-work-log');
    }),
    vscode.commands.registerCommand('daily-work-log.refresh', () => {
      post({ command: 'refresh' });
    }),
    vscode.commands.registerCommand('daily-work-log.openProfile', () => {
      post({ command: 'openProfile' });
    }),
    vscode.commands.registerCommand('daily-work-log.openOutput', () => {
      chatViewProvider.showOutput();
    }),
    vscode.commands.registerCommand('daily-work-log.openPanelSettings', () => {
      post({ command: 'openPanelSettings' });
      vscode.commands.executeCommand('workbench.view.extension.daily-work-log');
    }),
  );
}

export function deactivate() {
  console.log('Daily Work Log extension deactivated');
}
