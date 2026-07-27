import { emptyDailyLog, type DailyLog, type MonthlyLog } from '../../shared/types/dailyLog';
import type { WorkLogManager } from '../utils/workLogManager';

function localDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

export function loadDailyLog(
  workLogManager: WorkLogManager,
  date: string,
): DailyLog {
  return workLogManager.getDailyLog(localDate(date)) ?? emptyDailyLog(date);
}

export function loadMonthlyLogs(
  workLogManager: WorkLogManager,
  year: number,
  month: number,
): MonthlyLog {
  return workLogManager.getMonthlyLogs(year, month);
}
