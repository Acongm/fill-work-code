import type { WorkLogManager } from '../../daily/utils/workLogManager';
import { loadDailyLog } from '../../daily/commands/loadDailyLog';
import { appendUniqueCompleted } from '../../shared/utils/completedSync';
import { setProjectLink } from '../../shared/utils/projectLinks';

export async function savePolishedCompleted(
  workLogManager: WorkLogManager,
  date: string,
  entries: string[],
  originUrls: string[],
  onLog?: (line: string) => void,
): Promise<void> {
  const normalized = [...new Set(entries.map((entry) => entry.trim()))].filter(
    Boolean,
  );
  if (normalized.length === 0) {
    return;
  }

  const current = loadDailyLog(workLogManager, date);
  const completed = appendUniqueCompleted(current.completed, normalized);
  let projectLinks = current.projectLinks || [];
  const primaryOrigin = originUrls.find((url) => url.trim())?.trim() ?? null;

  for (const content of normalized) {
    if (primaryOrigin) {
      projectLinks = setProjectLink(
        projectLinks,
        'completed',
        content,
        primaryOrigin,
      );
    }
  }

  await workLogManager.saveUserFields(date, {
    ...current,
    completed,
    projectLinks,
  });
  onLog?.(
    `[JSON] ${date} 写入 ${normalized.length} 条 AI 润色到今日完成${
      primaryOrigin ? `（归属 ${primaryOrigin}）` : ''
    }`,
  );
}
