import type { Database, SqlValue } from '../types/database';
import type { DailyItem } from './dailyItemRepository';

export interface ProjectInput {
  id: string;
  originUrl: string;
  name: string;
  pinned?: boolean;
  hidden?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Project {
  id: string;
  originUrl: string;
  name: string;
  pinned: boolean;
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectCloneInput {
  id: string;
  projectId: string;
  repoRoot: string;
  cloneLabel: string;
  firstSeenAt?: string;
  lastScannedAt?: string | null;
  lastCommitAt?: string | null;
}

export interface ProjectClone {
  id: string;
  projectId: string;
  repoRoot: string;
  cloneLabel: string;
  firstSeenAt: string;
  lastScannedAt: string | null;
  lastCommitAt: string | null;
}

export interface ProjectHistoryCommit {
  id: string;
  cloneId: string;
  sha: string;
  subject: string;
  author: string | null;
  committedAt: string;
}

export interface ProjectHistoryGitlog {
  id: string;
  cloneId: string | null;
  content: string;
}

export interface ProjectHistoryDay {
  date: string;
  commits: ProjectHistoryCommit[];
  gitlog: ProjectHistoryGitlog[];
  items: DailyItem[];
}

export interface ProjectHistory {
  project: Project;
  clones: ProjectClone[];
  days: ProjectHistoryDay[];
}

interface ProjectRow {
  id: string;
  origin_url: string;
  name: string;
  pinned: number;
  hidden: number;
  created_at: string;
  updated_at: string;
}

interface CloneRow {
  id: string;
  project_id: string;
  repo_root: string;
  clone_label: string;
  first_seen_at: string;
  last_scanned_at: string | null;
  last_commit_at: string | null;
}

interface CommitRow {
  id: string;
  clone_id: string;
  sha: string;
  subject: string;
  author: string | null;
  committed_at: string;
}

interface GitlogRow {
  id: string;
  date: string;
  clone_id: string | null;
  content: string;
}

interface DailyItemRow {
  id: string;
  date: string;
  kind: DailyItem['kind'];
  content: string;
  assignment: DailyItem['assignment'];
  project_id: string | null;
  source: DailyItem['source'];
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    originUrl: row.origin_url,
    name: row.name,
    pinned: Boolean(row.pinned),
    hidden: Boolean(row.hidden),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapClone(row: CloneRow): ProjectClone {
  return {
    id: row.id,
    projectId: row.project_id,
    repoRoot: row.repo_root,
    cloneLabel: row.clone_label,
    firstSeenAt: row.first_seen_at,
    lastScannedAt: row.last_scanned_at,
    lastCommitAt: row.last_commit_at,
  };
}

export class ProjectRepository {
  constructor(private readonly database: Database) {}

  async upsertProject(input: ProjectInput): Promise<Project> {
    const now = new Date().toISOString();
    const project: Project = {
      id: input.id,
      originUrl: input.originUrl,
      name: input.name,
      pinned: input.pinned ?? false,
      hidden: input.hidden ?? false,
      createdAt: input.createdAt || now,
      updatedAt: input.updatedAt || now,
    };
    this.database.transaction(() => {
      this.database.execute(
        `INSERT INTO projects(
          id, origin_url, name, pinned, hidden, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          origin_url = excluded.origin_url,
          name = excluded.name,
          pinned = excluded.pinned,
          hidden = excluded.hidden,
          updated_at = excluded.updated_at`,
        [
          project.id,
          project.originUrl,
          project.name,
          project.pinned ? 1 : 0,
          project.hidden ? 1 : 0,
          project.createdAt,
          project.updatedAt,
        ],
      );
    });
    await this.database.flush();
    return project;
  }

  async upsertClone(input: ProjectCloneInput): Promise<ProjectClone> {
    const clone: ProjectClone = {
      id: input.id,
      projectId: input.projectId,
      repoRoot: input.repoRoot,
      cloneLabel: input.cloneLabel,
      firstSeenAt: input.firstSeenAt || new Date().toISOString(),
      lastScannedAt: input.lastScannedAt ?? null,
      lastCommitAt: input.lastCommitAt ?? null,
    };
    this.database.transaction(() => {
      this.database.execute(
        `INSERT INTO project_clones(
          id, project_id, repo_root, clone_label, first_seen_at,
          last_scanned_at, last_commit_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          project_id = excluded.project_id,
          repo_root = excluded.repo_root,
          clone_label = excluded.clone_label,
          last_scanned_at = excluded.last_scanned_at,
          last_commit_at = excluded.last_commit_at`,
        [
          clone.id,
          clone.projectId,
          clone.repoRoot,
          clone.cloneLabel,
          clone.firstSeenAt,
          clone.lastScannedAt,
          clone.lastCommitAt,
        ],
      );
    });
    await this.database.flush();
    return clone;
  }

  get(id: string): Project | undefined {
    const row = this.database.get<ProjectRow>(
      'SELECT * FROM projects WHERE id = ?',
      [id],
    );
    return row ? mapProject(row) : undefined;
  }

  getByOrigin(originUrl: string): Project | undefined {
    const row = this.database.get<ProjectRow>(
      'SELECT * FROM projects WHERE origin_url = ?',
      [originUrl],
    );
    return row ? mapProject(row) : undefined;
  }

  list(search = '', includeHidden = false): Project[] {
    const conditions: string[] = [];
    const params: SqlValue[] = [];
    if (!includeHidden) {
      conditions.push('hidden = 0');
    }
    if (search.trim()) {
      conditions.push('(name LIKE ? OR origin_url LIKE ?)');
      const pattern = `%${search.trim()}%`;
      params.push(pattern, pattern);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return this.database
      .all<ProjectRow>(
        `SELECT * FROM projects ${where}
         ORDER BY pinned DESC, updated_at DESC, name`,
        params,
      )
      .map(mapProject);
  }

  listClones(projectId: string): ProjectClone[] {
    return this.database
      .all<CloneRow>(
        `SELECT * FROM project_clones
         WHERE project_id = ?
         ORDER BY clone_label, repo_root`,
        [projectId],
      )
      .map(mapClone);
  }

  async updateFlags(
    id: string,
    flags: { pinned?: boolean; hidden?: boolean },
  ): Promise<void> {
    const current = this.get(id);
    if (!current) {
      throw new Error(`Project not found: ${id}`);
    }
    await this.upsertProject({
      ...current,
      pinned: flags.pinned ?? current.pinned,
      hidden: flags.hidden ?? current.hidden,
      updatedAt: new Date().toISOString(),
    });
  }

  async getHistory(
    projectId: string,
    options: { cloneId?: string } = {},
  ): Promise<ProjectHistory> {
    const project = this.get(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const factParams: SqlValue[] = [projectId];
    const cloneClause = options.cloneId ? ' AND clone_id = ?' : '';
    if (options.cloneId) {
      factParams.push(options.cloneId);
    }
    const commits = this.database.all<CommitRow>(
      `SELECT id, clone_id, sha, subject, author, committed_at
       FROM commits
       WHERE project_id = ?${cloneClause}
       ORDER BY committed_at DESC, id`,
      factParams,
    );
    const gitlog = this.database.all<GitlogRow>(
      `SELECT id, date, clone_id, content
       FROM gitlog_entries
       WHERE project_id = ?${cloneClause}
       ORDER BY date DESC, id`,
      factParams,
    );
    const items = this.database.all<DailyItemRow>(
      `SELECT * FROM daily_items
       WHERE project_id = ? AND source = 'ai'
       ORDER BY date DESC, sort_order, created_at, id`,
      [projectId],
    );

    const days = new Map<string, ProjectHistoryDay>();
    const ensureDay = (date: string): ProjectHistoryDay => {
      const current = days.get(date);
      if (current) {
        return current;
      }
      const day: ProjectHistoryDay = {
        date,
        commits: [],
        gitlog: [],
        items: [],
      };
      days.set(date, day);
      return day;
    };

    for (const row of commits) {
      ensureDay(row.committed_at.slice(0, 10)).commits.push({
        id: row.id,
        cloneId: row.clone_id,
        sha: row.sha,
        subject: row.subject,
        author: row.author,
        committedAt: row.committed_at,
      });
    }
    for (const row of gitlog) {
      ensureDay(row.date).gitlog.push({
        id: row.id,
        cloneId: row.clone_id,
        content: row.content,
      });
    }
    for (const row of items) {
      ensureDay(row.date).items.push({
        id: row.id,
        date: row.date,
        kind: row.kind,
        content: row.content,
        assignment: row.assignment,
        projectId: row.project_id,
        source: row.source,
        sortOrder: row.sort_order,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    }

    return {
      project,
      clones: this.listClones(projectId),
      days: [...days.values()].sort((a, b) => b.date.localeCompare(a.date)),
    };
  }
}
