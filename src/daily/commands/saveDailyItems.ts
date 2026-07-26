import {
  DailyItemRepository,
  type DailyItemInput,
} from '../../database/commands/dailyItemRepository';
import type { Database } from '../../database/types/database';
import { CompatibilityWriter } from '../../database/commands/compatibilityWriter';

export interface SaveDailyItemsRequest {
  date: string;
  items: Array<Omit<DailyItemInput, 'date'>>;
}

export async function saveDailyItems(
  database: Database,
  storageRoot: string,
  request: SaveDailyItemsRequest,
): Promise<{ warnings: string[] }> {
  for (const item of request.items) {
    const validProject =
      item.assignment === 'project' && Boolean(item.projectId);
    const validUnassigned =
      item.assignment === 'unassigned' && item.projectId === null;
    if (!validProject && !validUnassigned) {
      throw new Error('每条记录必须选择项目或明确选择“未归属”');
    }
  }

  await new DailyItemRepository(database).replaceDate(
    request.date,
    request.items.map((item) => ({ ...item, date: request.date })),
  );
  const compatibility = await new CompatibilityWriter(
    database,
    storageRoot,
  ).exportDaily(request.date);
  return { warnings: compatibility.warnings };
}
