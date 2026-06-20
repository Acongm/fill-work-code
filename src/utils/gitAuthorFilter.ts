import { execFileSync } from 'node:child_process';

function readGitConfigValue(key: string): string {
  for (const scope of ['--global', '--local'] as const) {
    try {
      const value = execFileSync('git', ['config', scope, key], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      if (value) {
        return value;
      }
    } catch {
      // unset
    }
  }
  return '';
}

function dedupeAliases(aliases: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of aliases) {
    const trimmed = raw.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export function resolveAuthorAliasesForCollect(input: {
  authorAliases?: string[];
  displayName?: string;
}): string[] {
  const configured = (input.authorAliases ?? []).map((a) => a.trim()).filter(Boolean);
  if (configured.length > 0) {
    return dedupeAliases(configured);
  }

  const aliases: string[] = [];
  const gitName = readGitConfigValue('user.name');
  const gitEmail = readGitConfigValue('user.email');
  if (gitName) {
    aliases.push(gitName);
  }
  if (gitEmail) {
    aliases.push(gitEmail);
  }
  const displayName = input.displayName?.trim();
  if (displayName && displayName !== gitName) {
    aliases.push(displayName);
  }
  return dedupeAliases(aliases);
}

export function parseAuthorAliases(aliases: string[]): { emails: string[]; names: string[] } {
  const emails: string[] = [];
  const names: string[] = [];
  for (const alias of aliases) {
    if (alias.includes('@')) {
      emails.push(alias.toLowerCase());
    } else {
      names.push(alias.toLowerCase());
    }
  }
  return { emails, names };
}

function normalizeIdentity(name: string, email: string): string {
  return `${name}${email}`.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** 严格匹配：仅本账户 commit */
export function commitMatchesAuthor(
  authorName: string,
  authorEmail: string,
  aliases: string[],
): boolean {
  if (aliases.length === 0) {
    return false;
  }

  const name = authorName.trim();
  const email = authorEmail.trim().toLowerCase();
  const nameLower = name.toLowerCase();
  const identity = normalizeIdentity(name, email);
  const { emails, names } = parseAuthorAliases(aliases);

  for (const aliasEmail of emails) {
    if (email === aliasEmail) {
      return true;
    }
    const at = aliasEmail.indexOf('@');
    if (at > 0) {
      const local = aliasEmail.slice(0, at);
      if (local.length >= 3 && email.startsWith(`${local}@`)) {
        return true;
      }
    }
  }

  for (const aliasName of names) {
    if (nameLower === aliasName) {
      return true;
    }
    const normAlias = aliasName.replace(/[^a-z0-9]/g, '');
    if (normAlias.length >= 2 && identity === normAlias) {
      return true;
    }
  }

  return false;
}

export function formatAuthorFilterLog(aliases: string[]): string {
  const { emails, names } = parseAuthorAliases(aliases);
  const primaryEmail = emails[0] ?? '';
  const primaryName = names[0] ?? aliases[0] ?? '未知';
  const extra = Math.max(0, aliases.length - 1);
  const suffix = extra > 0 ? ` (+${extra}个别名)` : '';
  if (primaryEmail) {
    return `使用作者过滤: ${primaryName} <${primaryEmail}>${suffix}`;
  }
  return `使用作者过滤: ${primaryName}${suffix}`;
}
