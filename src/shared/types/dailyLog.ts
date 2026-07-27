export interface DailyProjectLink {
  field: 'completed' | 'plan' | 'blockers' | 'notes';
  content: string;
  assignment: 'project' | 'unassigned';
  projectOriginUrl: string | null;
}

export interface DailyLog {
  date: string;
  completed: string[];
  plan: string[];
  blockers: string[];
  notes: string;
  gitlog?: string[];
  ailog?: string[];
  gitCommit?: string[];
  origin_url?: string[];
  projectLinks?: DailyProjectLink[];
}

export interface MonthlyLog {
  year: number;
  month: number;
  logs: DailyLog[];
}

export function emptyDailyLog(date: string): DailyLog {
  return {
    date,
    completed: [],
    plan: [],
    blockers: [],
    notes: '',
    gitlog: [],
    ailog: [],
    gitCommit: [],
    origin_url: [],
    projectLinks: [],
  };
}
