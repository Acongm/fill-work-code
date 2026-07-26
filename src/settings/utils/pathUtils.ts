import * as path from 'path';
import { expandHome } from './expandHome';

export { expandHome } from './expandHome';

export interface RuntimePaths {
  root: string;
  database: string;
  runtime: string;
  month(year: number, month: number): string;
}

export function resolveRuntimePaths(storagePath: string): RuntimePaths {
  const root = expandHome(storagePath);
  return {
    root,
    database: path.join(root, 'work-log.sqlite'),
    runtime: path.join(root, '.runtime'),
    month: (year, month) =>
      path.join(root, `${year}-${String(month).padStart(2, '0')}`),
  };
}
