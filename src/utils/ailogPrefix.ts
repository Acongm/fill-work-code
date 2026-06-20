/** AILog 前缀：英文简写 / 项目简写 / 项目-模块简写 */

export const AILOG_MODULE_SEP = ' - ';

const EN_PREFIX_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/i;

export function isEnglishAilogPrefix(prefix: string): boolean {
  const p = prefix.trim();
  if (!p || p.length > 24) {
    return false;
  }
  return EN_PREFIX_RE.test(p);
}

/** 仓库目录名 / origin 路径 → 英文项目简写 */
export function repoNameToAbbrev(repoName: string): string {
  const raw = repoName
    .trim()
    .replace(/\.git$/i, '')
    .split('/')
    .pop()!
    .replace(/\.git$/i, '');
  if (!raw) {
    return 'misc';
  }

  let base = raw
    .replace(/-(frontend|backend|web|app|service|api|client|server)$/i, '')
    .replace(/^(devportal-|idp-|scm-)/i, '');

  const parts = base.split(/[-_]/).filter(Boolean);
  if (parts.length === 0) {
    return raw.slice(0, 8).toLowerCase();
  }
  if (parts.length === 1) {
    const single = parts[0].toLowerCase();
    return single.length <= 10 ? single : single.slice(0, 10);
  }

  const skipLead = new Set(['dev', 'devportal', 'starbucks', 'scm']);
  const meaningful =
    parts.length > 2 && skipLead.has(parts[0].toLowerCase())
      ? parts.slice(1)
      : parts;

  if (meaningful.length === 1) {
    return meaningful[0].slice(0, 10).toLowerCase();
  }

  if (meaningful.length === 2) {
    const a = meaningful[0].toLowerCase();
    const b = meaningful[1].toLowerCase();
    if (a.length <= 6 && b.length <= 6) {
      return `${a}-${b}`;
    }
    return `${a.slice(0, 4)}-${b.slice(0, 4)}`.replace(/-$/, '');
  }

  const acronym = meaningful
    .slice(0, 3)
    .map((p) => p[0])
    .join('')
    .toLowerCase();
  const tail = meaningful[meaningful.length - 1].toLowerCase();
  if (acronym.length >= 2 && tail.length <= 6) {
    return `${acronym}-${tail}`;
  }
  return meaningful.slice(0, 2).join('-').toLowerCase().slice(0, 12);
}

export function originUrlToRepoName(originUrl: string): string {
  const trimmed = originUrl.trim();
  if (!trimmed) {
    return '';
  }
  const withoutGit = trimmed.replace(/\.git$/i, '');
  const segment = withoutGit.split('/').filter(Boolean).pop() || '';
  return segment.replace(/\.git$/i, '');
}

export interface RepoPrefixHint {
  repo: string;
  abbrev: string;
  origin?: string;
}

export function buildRepoPrefixHints(
  gitlog: string[],
  originUrls: string[] = [],
): RepoPrefixHint[] {
  const map = new Map<string, RepoPrefixHint>();

  for (const line of gitlog) {
    const m = line.match(/^\[([^\]]+)\]/);
    if (!m) {
      continue;
    }
    const repo = m[1].trim();
    if (!repo || map.has(repo)) {
      continue;
    }
    map.set(repo, { repo, abbrev: repoNameToAbbrev(repo) });
  }

  for (const url of originUrls) {
    const repo = originUrlToRepoName(url);
    if (!repo) {
      continue;
    }
    const existing = map.get(repo);
    if (existing) {
      existing.origin = url;
      continue;
    }
    map.set(repo, { repo, abbrev: repoNameToAbbrev(repo), origin: url });
  }

  return [...map.values()].sort((a, b) => a.repo.localeCompare(b.repo));
}

export function parseAilogItem(item: string): { prefix: string; content: string } {
  const trimmed = item.trim();
  if (!trimmed) {
    return { prefix: 'misc', content: '' };
  }

  const bracket = trimmed.match(/^\[([^\]]+)\]\s*(.+)$/);
  if (bracket) {
    return {
      prefix: bracket[1].trim(),
      content: bracket[2].trim(),
    };
  }

  const idx = trimmed.indexOf(AILOG_MODULE_SEP);
  if (idx === -1) {
    return { prefix: 'misc', content: trimmed };
  }

  return {
    prefix: trimmed.slice(0, idx).trim() || 'misc',
    content: trimmed.slice(idx + AILOG_MODULE_SEP.length).trim(),
  };
}

export function formatAilogItem(prefix: string, content: string): string {
  const p = prefix.trim().toLowerCase() || 'misc';
  const c = content.trim();
  if (!c) {
    return '';
  }
  return `${p}${AILOG_MODULE_SEP}${c}`;
}

const CN_MODULE_TO_EN: Record<string, string> = {
  其他: 'misc',
  工单: 'wo',
  漏洞: 'vuln',
  文档: 'docs',
  目录: 'catalog',
  集成: 'intg',
  前端: 'fe',
  后端: 'be',
};

function chineseModuleToEn(module: string, hints: RepoPrefixHint[]): string | null {
  const trimmed = module.trim();
  if (isEnglishAilogPrefix(trimmed)) {
    return trimmed.toLowerCase();
  }

  const direct = CN_MODULE_TO_EN[trimmed];
  if (direct) {
    return direct;
  }

  for (const hint of hints) {
    if (trimmed.includes(hint.repo) || hint.repo.includes(trimmed)) {
      return hint.abbrev;
    }
    const repoLower = hint.repo.toLowerCase();
    if (trimmed.toLowerCase().includes(repoLower)) {
      return hint.abbrev;
    }
  }

  const idp = trimmed.match(/^IDP[-·]?(.+)$/i);
  if (idp) {
    const mod = idp[1].replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '');
    const modEn =
      CN_MODULE_TO_EN[mod] ||
      (mod.length <= 4 && /^[a-zA-Z]+$/.test(mod) ? mod.toLowerCase() : null);
    return modEn ? `idp-${modEn}` : 'idp';
  }

  if (/^DOCS?$/i.test(trimmed) || trimmed.includes('文档')) {
    return 'docs';
  }

  if (hints.length === 1) {
    return hints[0].abbrev;
  }

  return null;
}

/** 将 AI 返回条目规范为英文前缀格式 */
export function normalizeAilogPrefixes(
  items: string[],
  hints: RepoPrefixHint[],
): string[] {
  const defaultAbbrev = hints[0]?.abbrev || 'misc';

  return items
    .map((raw) => {
      const { prefix, content } = parseAilogItem(raw);
      if (!content) {
        return '';
      }

      let enPrefix = prefix;
      if (!isEnglishAilogPrefix(enPrefix)) {
        const mapped =
          chineseModuleToEn(enPrefix, hints) ||
          (enPrefix.includes('-')
            ? enPrefix
                .split('-')
                .map((part) => chineseModuleToEn(part, hints) || part)
                .filter(Boolean)
                .join('-')
            : null);
        enPrefix = mapped || defaultAbbrev;
      }

      enPrefix = enPrefix.toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (!isEnglishAilogPrefix(enPrefix)) {
        enPrefix = defaultAbbrev;
      }

      return formatAilogItem(enPrefix, content);
    })
    .filter(Boolean);
}
