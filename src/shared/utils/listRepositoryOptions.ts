import type { Database } from '../../database/types/database';
import { ProjectRepository } from '../../database/commands/projectRepository';
import type { RepositoryOption } from '../types/repositoryOption';
import {
  deriveRepositoryName,
  toRepositoryOptions,
} from '../types/repositoryOption';

const REPOSITORY_OPTIONS_TTL_MS = 30_000;

interface RepositoryOptionsCache {
  expiresAt: number;
  options: RepositoryOption[];
}

let cachedProjects: RepositoryOptionsCache | undefined;

function loadProjects(database: Database): RepositoryOption[] {
  const now = Date.now();
  if (cachedProjects && cachedProjects.expiresAt > now) {
    return cachedProjects.options;
  }
  const options = new ProjectRepository(database)
    .list('', false)
    .map((project) => ({
      originUrl: project.originUrl,
      name: project.name,
    }));
  cachedProjects = {
    expiresAt: now + REPOSITORY_OPTIONS_TTL_MS,
    options,
  };
  return options;
}

export function invalidateRepositoryOptionsCache(): void {
  cachedProjects = undefined;
}

export function listRepositoryOptions(database: Database): RepositoryOption[] {
  return loadProjects(database);
}

export function mergeRepositoryOptions(
  database: Database,
  originUrls: string[],
): RepositoryOption[] {
  const nameByUrl = new Map(
    loadProjects(database).map((project) => [project.originUrl, project.name]),
  );
  return toRepositoryOptions(originUrls, nameByUrl).map((option) => ({
    originUrl: option.originUrl,
    name: nameByUrl.get(option.originUrl) ?? deriveRepositoryName(option.originUrl),
  }));
}
