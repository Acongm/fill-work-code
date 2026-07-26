import * as vscode from 'vscode';
import { WorkLogManager } from './lib/workLogManager';
import { ChatViewProvider } from './panels/ChatViewProvider';
import { loadRuntimeConfiguration } from './settings/commands/settingsStore';
import type { Database } from './database/types/database';
import { openSqlJsDatabase } from './database/utils/sqlJsDatabase';
import { migrateSchema } from './database/commands/migrateSchema';
import { migrateLegacyData } from './database/commands/legacyMigrator';
import { resolveRuntimePaths } from './settings/utils/pathUtils';
import { collectAiConversations } from './collection/commands/collectAiConversations';
import { CodexConversationCollector } from './collection/utils/codexConversationCollector';
import { CursorConversationCollector } from './collection/utils/cursorConversationCollector';
import { QoderConversationCollector } from './collection/utils/qoderConversationCollector';

let workLogManager: WorkLogManager;
let database: Database | undefined;

export async function activate(context: vscode.ExtensionContext) {
  console.log('Daily Work Log extension activated');

  const runtimeConfig = loadRuntimeConfiguration();
  const storageDir =
    process.env.DAILY_WORK_LOG_TEST_STORAGE ||
    runtimeConfig.storagePathResolved;

  workLogManager = new WorkLogManager(storageDir);
  console.log(`Work logs storage: ${storageDir}`);

  try {
    database = await openSqlJsDatabase(
      resolveRuntimePaths(storageDir).database,
    );
    await migrateSchema(database);
    const migration = await migrateLegacyData(database, storageDir);
    if (migration.errors.length > 0) {
      vscode.window.showWarningMessage(
        `SQLite 已启用，但 ${migration.errors.length} 个旧数据文件迁移失败，请查看扩展日志。`,
      );
      for (const error of migration.errors) {
        console.warn('Legacy migration failed:', error.path, error.message);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(
      `工作日志数据库初始化失败，已停止加载以保护数据: ${message}`,
    );
    throw error;
  }

  const chatViewProvider = new ChatViewProvider(
    context.extensionUri,
    workLogManager,
    context,
    database,
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
    vscode.commands.registerCommand(
      'daily-work-log.collectAiConversations',
      async () => {
        if (!database) {
          return;
        }
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: '正在采集 Codex、Cursor、Qoder 对话…',
          },
          () =>
            collectAiConversations(database!, [
              new CodexConversationCollector(),
              new CursorConversationCollector(),
              new QoderConversationCollector(),
            ]),
        );
        vscode.window.showInformationMessage(
          `AI 对话采集完成：${result.sessions} 个会话，${result.messages} 条消息，${result.diagnostics.length} 个跳过/警告。`,
        );
      },
    ),
    vscode.commands.registerCommand('daily-work-log.openPanelSettings', () => {
      post({ command: 'openPanelSettings' });
      vscode.commands.executeCommand('workbench.view.extension.daily-work-log');
    }),
  );
}

export async function deactivate() {
  await database?.close();
  database = undefined;
  console.log('Daily Work Log extension deactivated');
}
