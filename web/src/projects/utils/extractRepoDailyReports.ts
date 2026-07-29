import type { ProjectHistory } from '../types/projectHistory';

export interface RepoDailyReportDay {
  date: string;
  logs: string[];
}

export function extractRepoDailyReports(
  history: ProjectHistory | null,
): RepoDailyReportDay[] {
  if (!history) {
    return [];
  }
  return history.days
    .map((day) => ({
      date: day.date,
      logs: day.items
        .filter((item) => item.kind === 'completed')
        .map((item) => item.content),
    }))
    .filter((day) => day.logs.length > 0);
}
