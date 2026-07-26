import { ProjectRepository } from '../../database/commands/projectRepository';
import type { Database } from '../../database/types/database';

export function listProjects(database: Database, search = '') {
  return new ProjectRepository(database).list(search, false);
}
