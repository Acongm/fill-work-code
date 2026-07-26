import { ProjectRepository } from '../../database/commands/projectRepository';
import type { Database } from '../../database/types/database';

export function updateProject(
  database: Database,
  projectId: string,
  flags: { pinned?: boolean; hidden?: boolean },
) {
  return new ProjectRepository(database).updateFlags(projectId, flags);
}
