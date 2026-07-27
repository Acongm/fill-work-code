export interface ProjectHistoryCommit {
  id: string;
  cloneId: string;
  committedAt: string;
  sha: string;
  subject: string;
  author?: string | null;
}

export interface ProjectHistoryItem {
  id: string;
  kind: 'completed' | 'ailog' | 'todo' | 'blocker' | 'note';
  content: string;
  assignment: 'project' | 'unassigned';
}

export interface ProjectHistoryDay {
  date: string;
  commits: ProjectHistoryCommit[];
  gitlog: Array<{ id: string; content: string }>;
  items: ProjectHistoryItem[];
}

export interface ProjectHistory {
  days: ProjectHistoryDay[];
}

export interface ProjectDailyLogsGeneratedMessage {
  command: 'projectDailyLogsGenerated';
  originUrl: string;
  generatedDates: string[];
  failures: Array<{ date: string; message: string }>;
}
