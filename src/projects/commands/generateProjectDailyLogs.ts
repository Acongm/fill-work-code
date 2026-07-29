import type { HostPanelDeps } from '../../app/types/hostDependencies';
import type { WorkLogManager } from '../../daily/utils/workLogManager';
import { loadDailyLog } from '../../daily/commands/loadDailyLog';
import { ProjectRepository } from '../../database/commands/projectRepository';
import type { Database } from '../../database/types/database';
import type { FillPreviewDay } from '../../shared/types/fillPreview';
import type { PluginSettings } from '../../settings/types/pluginSettings';
import { loadPluginSettings } from '../../settings/commands/settingsMessages';
import { appendUniqueCompleted } from '../../shared/utils/completedSync';
import { normalizeCommitDay } from '../../shared/utils/dateFormat';
import { setProjectLink } from '../../shared/utils/projectLinks';
import {
  buildProjectDailyEntries,
  isDailyLogDate,
} from '../utils/buildProjectDailyEntries';

export interface ProjectDailyLogFailure {
  date: string;
  message: string;
}

export interface GenerateProjectDailyLogsResult {
  generatedDates: string[];
  failures: ProjectDailyLogFailure[];
}

export interface ProjectDailyLogAiContext {
  apiKey: string;
  settings: PluginSettings;
  polishDay: (
    day: FillPreviewDay,
    settings: PluginSettings,
    apiKey: string,
    onLog?: (line: string) => void,
  ) => Promise<FillPreviewDay>;
  onLog?: (line: string) => void;
}

function resolveAiFailureMessage(day: FillPreviewDay): string {
  const blocked = day.warnings.find(
    (warning) =>
      warning.includes('未配置 AI API Key') ||
      warning.includes('AI 润色失败') ||
      warning.includes('AI 未返回可写入'),
  );
  return blocked ?? 'AI 未返回可写入的工作日志';
}

function hasAiFailure(day: FillPreviewDay): boolean {
  return (
    day.warnings.some(
      (warning) =>
        warning.includes('未配置 AI API Key') ||
        warning.includes('AI 润色失败'),
    ) || day.ailogDraft.length === 0
  );
}

export async function generateProjectDailyLogs(
  database: Database,
  workLogManager: WorkLogManager,
  originUrl: string,
  requestedDates: string[],
  ai: ProjectDailyLogAiContext,
): Promise<GenerateProjectDailyLogsResult> {
  const projectRepository = new ProjectRepository(database);
  const project = projectRepository.getByOrigin(originUrl);
  if (!project) {
    throw new Error('项目不存在');
  }

  if (!ai.apiKey.trim()) {
    throw new Error('未配置 AI API Key');
  }

  const history = await projectRepository.getHistory(project.id);
  const days = new Map(
    history.days.map((day) => [normalizeCommitDay(day.date), day]),
  );
  const generatedDates: string[] = [];
  const failures: ProjectDailyLogFailure[] = [];

  for (const requestedDate of [...new Set(requestedDates)]) {
    const date = normalizeCommitDay(requestedDate);
    if (!isDailyLogDate(date)) {
      failures.push({ date: requestedDate, message: '日期格式无效' });
      continue;
    }
    const day = days.get(date);
    if (!day || day.commits.length === 0) {
      failures.push({ date, message: '该日期没有可用 Commit' });
      continue;
    }

    try {
      const entries = buildProjectDailyEntries(day);
      if (entries.length === 0) {
        failures.push({ date, message: '该日期没有可生成的工作日志内容' });
        continue;
      }

      const fillDay: FillPreviewDay = {
        date,
        completed: [],
        gitlog: entries,
        gitCommit: day.commits.map((commit) => commit.subject),
        originUrl: [originUrl],
        ailogDraft: [],
        warnings: [],
      };
      const polished = await ai.polishDay(
        fillDay,
        ai.settings,
        ai.apiKey,
        ai.onLog,
      );
      if (hasAiFailure(polished)) {
        failures.push({ date, message: resolveAiFailureMessage(polished) });
        continue;
      }

      const entriesToWrite = polished.ailogDraft;
      const current = loadDailyLog(workLogManager, date);
      const completed = appendUniqueCompleted(current.completed, entriesToWrite);
      let projectLinks = current.projectLinks || [];
      for (const content of entriesToWrite) {
        projectLinks = setProjectLink(
          projectLinks,
          'completed',
          content,
          originUrl,
        );
      }
      await workLogManager.saveUserFields(date, {
        ...current,
        completed,
        projectLinks,
      });
      generatedDates.push(date);
    } catch (error) {
      failures.push({
        date,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { generatedDates, failures };
}

export async function handleGenerateProjectDailyLogs(
  deps: HostPanelDeps,
  originUrl: string,
  dates: string[],
): Promise<void> {
  try {
    const settings = await loadPluginSettings(deps);
    const apiKey =
      (await deps.context.secrets.get('dailyWorkLog.ai.apiKey')) || '';
    const result = await generateProjectDailyLogs(
      deps.database,
      deps.workLogManager,
      originUrl,
      dates,
      {
        apiKey,
        settings,
        polishDay: (day, polishSettings, key, onLog) =>
          deps.aiPolishService.polishDay(day, polishSettings, key, onLog),
        onLog: (line) => deps.outputChannel.appendLine(line),
      },
    );
    for (const failure of result.failures) {
      deps.outputChannel.appendLine(
        `[项目工作日志] ${originUrl} ${failure.date}：${failure.message}`,
      );
    }
    deps.postToWebview({
      command: 'projectDailyLogsGenerated',
      originUrl,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.outputChannel.appendLine(
      `[项目工作日志] ${originUrl} 生成失败：${message}`,
    );
    deps.postToWebview({
      command: 'projectDailyLogsGenerated',
      originUrl,
      generatedDates: [],
      failures: [
        {
          date: dates.join(','),
          message,
        },
      ],
    });
  }
}
