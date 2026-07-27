import type { ProjectHistoryDay } from '../../database/commands/projectRepository';

function uniqueContent(values: string[]): string[] {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      return [];
    }
    seen.add(normalized);
    return [normalized];
  });
}

export function buildProjectDailyEntries(
  day: Pick<ProjectHistoryDay, 'gitlog' | 'commits'>,
): string[] {
  const gitlog = uniqueContent(day.gitlog.map((entry) => entry.content));
  return gitlog.length > 0
    ? gitlog
    : uniqueContent(day.commits.map((commit) => commit.subject));
}

export function isDailyLogDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
