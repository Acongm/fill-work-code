import { ProjectRepository } from '../../database/commands/projectRepository';
import type { Database } from '../../database/types/database';

export function getProjectHistory(
  database: Database,
  projectId: string,
  cloneId?: string,
) {
  return new ProjectRepository(database).getHistory(projectId, { cloneId });
}
