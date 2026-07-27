import type { MonthlyLog } from '../../shared/types/dailyLog';
import type { WorkLogManager } from '../../daily/utils/workLogManager';

export function loadTimesheetSource(
  workLogManager: WorkLogManager,
  year: number,
  month: number,
): MonthlyLog {
  return workLogManager.getMonthlyLogs(year, month);
}
