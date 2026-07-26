import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export function hashFile(filePath: string): string {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

export function stableConversationId(prefix: string, value: string): string {
  return `${prefix}:${crypto
    .createHash('sha256')
    .update(value)
    .digest('hex')
    .slice(0, 24)}`;
}

export function walkFiles(
  roots: string[],
  accepts: (filePath: string) => boolean,
): string[] {
  const found: string[] = [];
  const visit = (candidate: string) => {
    if (!fs.existsSync(candidate)) {
      return;
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(candidate);
    } catch {
      return;
    }
    if (stat.isFile()) {
      if (accepts(candidate)) {
        found.push(path.resolve(candidate));
      }
      return;
    }
    if (!stat.isDirectory()) {
      return;
    }
    for (const name of fs.readdirSync(candidate)) {
      visit(path.join(candidate, name));
    }
  };
  roots.forEach(visit);
  return [...new Set(found)].sort();
}

export function textFromContent(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (!Array.isArray(value)) {
    return '';
  }
  return value
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }
      if (!part || typeof part !== 'object') {
        return '';
      }
      const record = part as Record<string, unknown>;
      return typeof record.text === 'string'
        ? record.text
        : typeof record.content === 'string'
          ? record.content
          : '';
    })
    .filter(Boolean)
    .join('\n');
}
