import type { DailyItemInput } from '../../database/commands/dailyItemRepository';

export function createAiDailyItem(
  input: Omit<DailyItemInput, 'source'>,
): DailyItemInput {
  return { ...input, source: 'ai' };
}
