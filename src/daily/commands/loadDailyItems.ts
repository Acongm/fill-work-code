import { DailyItemRepository } from '../../database/commands/dailyItemRepository';
import type { Database } from '../../database/types/database';

export function loadDailyItems(database: Database, date: string) {
  return new DailyItemRepository(database).listByDate(date);
}
