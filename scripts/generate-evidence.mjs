#!/usr/bin/env node

/**
 * generate-evidence.mjs
 *
 * 从本地 git 历史生成工作凭证文件。
 *
 * 流程:
 *   1. find-git-roots        → 候选仓库列表
 *   2. list-repo-origins      → 仓库 origin 信息
 *   3. filter-repos-by-origin → 按 origin host 过滤
 *   4. list-monthly-authors   → 月内提交作者
 *   5. list-monthly-repos     → 产物清单
 *   6. export-monthly-commits → 原始 commit 凭证
 *   7. TSV → DailyLog JSON    → 每日凭证文件
 *   8. 月度汇总 JSON           → 供 timesheet_generator.py 消费
 *
 * 用法:
 *   node scripts/generate-evidence.mjs
 *   node scripts/generate-evidence.mjs --config scripts/evidence-config.json
 */

import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function expandHome(p) {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

function loadConfig(configPath) {
  const raw = readFileSync(configPath, 'utf-8');
  return JSON.parse(raw);
}

function resolveBashExecutable() {
  if (process.platform === 'win32') {
    const candidates = [
      process.env.BASH_PATH,
      process.env.SHELL,
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    ].filter(Boolean);
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    console.log('      (Windows: 未找到 Git Bash，尝试 PATH 中的 bash)');
  }
  return 'bash';
}

function streamLine(line) {
  const trimmed = line.trim();
  if (trimmed) {
    console.log(`      ${trimmed}`);
  }
}

function runBash(scriptPath, args = []) {
  const scriptName = scriptPath.split(/[/\\]/).pop();
  const bash = resolveBashExecutable();
  console.log(
    `      → 执行 ${scriptName}${args.length ? ` (${args.slice(0, 4).join(' ')}${args.length > 4 ? '…' : ''})` : ''}`,
  );

  return new Promise((resolve, reject) => {
    const child = spawn(bash, [scriptPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    const flushChunk = (chunk, isErr) => {
      const text = chunk.toString('utf-8');
      if (!isErr) {
        stdout += text;
      }
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        streamLine(line);
      }
    };
    child.stdout.on('data', (c) => flushChunk(c, false));
    child.stderr.on('data', (c) => flushChunk(c, true));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`${scriptName} 退出码 ${code ?? 'unknown'}`));
      }
    });
  });
}

function writeTmp(name, content) {
  const tmpDir = join(__dirname, '.tmp');
  mkdirSync(tmpDir, { recursive: true });
  const p = join(tmpDir, name);
  writeFileSync(p, content, 'utf-8');
  return p;
}

function monthToSinceDate(month) {
  const [y, m] = month.split('/');
  return `${y}-${m}-01`;
}

/** Git 对裸 YYYY-MM-DD 的 --since/--until 在部分环境同日会漏 commit，需带日界时刻 */
function gitDayStart(dateStr) {
  return `${dateStr} 00:00:00`;
}

function addDaysIso(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function isScopedCollect(config) {
  return Boolean(
    config.dateRangeStart &&
      config.dateRangeEnd &&
      (config.fillScope === 'day' ||
        config.fillScope === 'workWeek' ||
        config.fillScope === 'custom'),
  );
}

function commitDayToIso(commitDay) {
  return commitDay.replace(/\//g, '-').slice(0, 10);
}

function resolveOriginFilters(config) {
  const fromFilters = (config.originFilters || [])
    .map((s) => String(s).trim())
    .filter(Boolean);
  if (fromFilters.length > 0) {
    return fromFilters;
  }
  return (config.originHosts || []).map((s) => String(s).trim()).filter(Boolean);
}

function passThroughReposFromOrigins(originsFile) {
  const lines = readFileSync(originsFile, 'utf-8').trim().split('\n').filter(Boolean);
  const paths = [];
  for (const line of lines) {
    const cols = parseTsvLine(line);
    if (cols[0]) {
      paths.push(cols[0]);
    }
  }
  const unique = [...new Set(paths)];
  return writeTmp('repos-filtered.txt', unique.join('\n') + '\n');
}

function buildTargetDateSet(config) {
  const set = new Set();
  if (Array.isArray(config.targetDates)) {
    for (const d of config.targetDates) {
      if (d) {
        set.add(d);
      }
    }
  }
  if (set.size === 0 && config.dateRangeStart && config.dateRangeEnd) {
    let cursor = config.dateRangeStart;
    while (cursor <= config.dateRangeEnd) {
      set.add(cursor);
      cursor = addDaysIso(cursor, 1);
    }
  }
  return set;
}

function unescapeTsvField(value) {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\\\/g, '\\');
}

function parseTsvLine(line) {
  return line.split('\t').map(unescapeTsvField);
}

function readGitConfigValue(key) {
  for (const scope of ['--global', '--local']) {
    try {
      const value = execFileSync('git', ['config', scope, key], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      if (value) return value;
    } catch {
      /* unset */
    }
  }
  return '';
}

function dedupeAliases(aliases) {
  const seen = new Set();
  const out = [];
  for (const raw of aliases) {
    const trimmed = String(raw).trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function parseAuthorAliases(aliases) {
  const emails = [];
  const names = [];
  for (const alias of aliases) {
    if (alias.includes('@')) emails.push(alias.toLowerCase());
    else names.push(alias.toLowerCase());
  }
  return { emails, names };
}

function normalizeIdentity(name, email) {
  return `${name}${email}`.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function commitMatchesAuthor(authorName, authorEmail, aliases) {
  if (!aliases.length) return false;
  const name = authorName.trim();
  const email = authorEmail.trim().toLowerCase();
  const nameLower = name.toLowerCase();
  const identity = normalizeIdentity(name, email);
  const { emails, names } = parseAuthorAliases(aliases);

  for (const aliasEmail of emails) {
    if (email === aliasEmail) return true;
    const at = aliasEmail.indexOf('@');
    if (at > 0) {
      const local = aliasEmail.slice(0, at);
      if (local.length >= 3 && email.startsWith(`${local}@`)) return true;
    }
  }
  for (const aliasName of names) {
    if (nameLower === aliasName) return true;
    const normAlias = aliasName.replace(/[^a-z0-9]/g, '');
    if (normAlias.length >= 2 && identity === normAlias) return true;
  }
  return false;
}

function resolveAuthorAliases(config) {
  const configured = (config.authorAliases || []).map((a) => String(a).trim()).filter(Boolean);
  if (configured.length) return dedupeAliases(configured);

  const aliases = [];
  const gitName = readGitConfigValue('user.name');
  const gitEmail = readGitConfigValue('user.email');
  if (gitName) aliases.push(gitName);
  if (gitEmail) aliases.push(gitEmail);
  const displayName = (config.displayName || '').trim();
  if (displayName && displayName !== gitName) aliases.push(displayName);

  const resolved = dedupeAliases(aliases);
  if (!resolved.length) {
    console.error('未配置 authorAliases，且无法读取 git user.name / user.email');
    process.exit(1);
  }
  return resolved;
}

function formatAuthorFilterLog(aliases) {
  const { emails, names } = parseAuthorAliases(aliases);
  const primaryEmail = emails[0] || '';
  const primaryName = names[0] || aliases[0] || '未知';
  const extra = Math.max(0, aliases.length - 1);
  const suffix = extra > 0 ? ` (+${extra}个别名)` : '';
  if (primaryEmail) return `使用作者过滤: ${primaryName} <${primaryEmail}>${suffix}`;
  return `使用作者过滤: ${primaryName}${suffix}`;
}

/** 诊断：范围内所有作者（不用于 commit 过滤） */
function discoverAuthorsInRange(config, reposFile) {
  const since = config.dateRangeStart;
  const before = addDaysIso(config.dateRangeEnd, 1);
  const repos = readFileSync(reposFile, 'utf-8').trim().split('\n').filter(Boolean);
  const seen = new Set();
  const aliases = [];

  for (const repoRoot of repos) {
    let logOutput;
    try {
      logOutput = execFileSync(
        'git',
        [
          '-C',
          repoRoot,
          'log',
          '--all',
          '--no-merges',
          '--format=%an%x09%ae',
          `--since=${gitDayStart(since)}`,
          `--until=${gitDayStart(before)}`,
        ],
        { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] },
      );
    } catch {
      continue;
    }

    for (const line of logOutput.trim().split('\n').filter(Boolean)) {
      const tab = line.indexOf('\t');
      if (tab === -1) {
        continue;
      }
      const name = line.slice(0, tab);
      const email = line.slice(tab + 1);
      const key = `${name}\t${email}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      aliases.push(name, email);
    }
  }

  return aliases;
}

// ---------------------------------------------------------------------------
// Pipeline steps
// ---------------------------------------------------------------------------

async function stepFindGitRoots(skillDir, config) {
  const script = join(skillDir, 'find-git-roots.sh');
  const scoped = isScopedCollect(config);
  const sinceDate = scoped ? config.dateRangeStart : monthToSinceDate(config.month);
  const monthLabel = config.month.replace('/', '-');

  const args = ['--since', sinceDate];
  if (scoped && config.dateRangeEnd) {
    args.push('--until', addDaysIso(config.dateRangeEnd, 1));
  }
  for (const root of config.searchRoots) {
    args.push('--search-root', expandHome(root));
  }

  if (scoped) {
    console.log(
      `[1/8] 查找 Git 仓库（commit 窗口 ${config.dateRangeStart} ~ ${config.dateRangeEnd}，until=${addDaysIso(config.dateRangeEnd, 1)}）...`,
    );
  } else {
    console.log(`[1/8] 查找 Git 仓库（证据月 ${monthLabel}，活动起点 ${sinceDate}）...`);
  }
  const output = await runBash(script, args);
  const discovered = output.trim().split('\n').filter(Boolean);
  const known = Array.isArray(config.knownRepoRoots) ? config.knownRepoRoots : [];
  const merged = [...new Set([...known, ...discovered])];
  console.log(`      共 ${merged.length} 个候选仓库（registry ${known.length} + discover ${discovered.length}）。`);

  return writeTmp('repos.txt', merged.join('\n') + '\n');
}

async function stepListRepoOrigins(skillDir, reposFile) {
  const script = join(skillDir, 'list-repo-origins.sh');

  console.log('[2/8] Listing repository origins...');
  const output = await runBash(script, ['--repos-file', reposFile]);
  const originsFile = writeTmp('origins.tsv', output);

  // Extract distinct hosts for display
  const hosts = new Set();
  for (const line of output.trim().split('\n').filter(Boolean)) {
    const cols = parseTsvLine(line);
    if (cols[3]) hosts.add(cols[3]);
  }
  console.log(`      Distinct origin hosts: ${[...hosts].join(', ')}`);

  return { originsFile, distinctHosts: [...hosts] };
}

async function stepFilterReposByOrigin(skillDir, originsFile, originFilters) {
  const script = join(skillDir, 'filter-repos-by-origin.sh');

  const args = ['--origins-file', originsFile];
  for (const filter of originFilters) {
    args.push('--origin-filter', filter);
  }

  console.log(`[3/8] 按 Git 远程地址过滤: ${originFilters.join(', ')}...`);
  const output = await runBash(script, args);
  const repos = output.trim().split('\n').filter(Boolean);
  console.log(`      ${repos.length} repositories after filtering.`);

  return writeTmp('repos-filtered.txt', repos.join('\n') + '\n');
}

async function stepListMonthlyAuthors(skillDir, month, reposFile) {
  const script = join(skillDir, 'list-monthly-authors.sh');

  console.log(`[4/8] Listing monthly authors for ${month}...`);
  const output = await runBash(script, ['--month', month, '--repos-file', reposFile]);

  const authors = [];
  for (const line of output.trim().split('\n').filter(Boolean)) {
    const [name, email] = parseTsvLine(line);
    authors.push({ name, email });
  }
  console.log(`      Found ${authors.length} distinct authors:`);
  for (const a of authors) {
    console.log(`        - ${a.name} <${a.email}>`);
  }

  return authors;
}

async function stepListMonthlyRepos(skillDir, month, reposFile, authorAliases) {
  const script = join(skillDir, 'list-monthly-repos.sh');

  const args = ['--month', month, '--repos-file', reposFile];
  for (const alias of authorAliases) {
    args.push('--author-alias', alias);
  }

  console.log('[5/8] Generating artifact list...');
  const output = await runBash(script, args);
  const artifactsFile = writeTmp('artifacts.tsv', output);

  const lines = output.trim().split('\n').filter(Boolean);
  console.log(`      ${lines.length} repositories with commits this month.`);

  // Extract repo paths from artifacts TSV (col 0) to create a narrowed repos file
  // This avoids scanning all filtered repos in the export step
  const activeRepoPaths = new Set();
  for (const line of lines) {
    const cols = parseTsvLine(line);
    if (cols[0]) activeRepoPaths.add(cols[0]);
  }
  const activeReposFile = writeTmp('repos-active.txt', [...activeRepoPaths].join('\n') + '\n');
  console.log(`      (Narrowed export scope to ${activeRepoPaths.size} active repositories)`);

  return { artifactsFile, activeReposFile };
}

/**
 * Fast Node.js implementation of commit export.
 * Uses a single `git log` call per repo with --name-only to get changed files
 * in one pass, avoiding per-commit `git diff-tree` calls.
 */
function ensureRepoRefsFetched(repoRoot) {
  const fetchArgs = (extra) =>
    ['-C', repoRoot, 'fetch', 'origin', ...extra, '--depth=64', '--quiet'];
  try {
    execFileSync('git', fetchArgs([]), {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120_000,
    });
  } catch {
    // 离线或无权 fetch 时继续用本地已有分支
  }
  for (const branch of ['main', 'master', 'develop']) {
    try {
      execFileSync(
        'git',
        fetchArgs([`${branch}:refs/remotes/origin/${branch}`]),
        {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 120_000,
        },
      );
    } catch {
      // 分支不存在时忽略
    }
  }
}

function dedupeTsvLines(lines) {
  const byKey = new Map();
  for (const line of lines) {
    const cols = parseTsvLine(line);
    if (cols.length < 4) {
      continue;
    }
    const origin = cols[2] || cols[0];
    const sha = cols[3];
    if (!sha) {
      continue;
    }
    byKey.set(`${origin}\0${sha}`, line);
  }
  return [...byKey.values()];
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index;
      index += 1;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Math.min(Math.max(1, concurrency), items.length || 1);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

function exportRepoCommits(repoRoot, config, authorAliases, since, before, targetDates) {
  ensureRepoRefsFetched(repoRoot);
  const repoName = repoRoot.split('/').pop();
  let originUrl = '';
  try {
    originUrl = execFileSync('git', ['-C', repoRoot, 'config', '--get', 'remote.origin.url'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    // no origin
  }

  let logOutput;
  try {
    logOutput = execFileSync(
      'git',
      [
        '-C', repoRoot,
        'log', '--all', '--reverse', '--date-order', '--no-merges',
        '--format=COMMIT_SEP%n%H%x09%ct%x09%cI%x09%an%x09%ae%x09%s',
        '--name-only',
        `--since=${gitDayStart(since)}`,
        `--until=${gitDayStart(before)}`,
      ],
      { encoding: 'utf-8', maxBuffer: 100 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] },
    );
  } catch {
    return { lines: [], skippedByAuthor: 0 };
  }

  const tsvLines = [];
  let skippedByAuthor = 0;
  const commitBlocks = logOutput.split('COMMIT_SEP\n').filter(Boolean);

  for (const block of commitBlocks) {
    const lines = block.split('\n');
    if (lines.length === 0) continue;

    const headerLine = lines[0];
    const headerParts = headerLine.split('\t');
    if (headerParts.length < 6) continue;

    const [commitSha, , commitAt, authorName, authorEmail, subject] = headerParts;

    if (subject.startsWith('Revert ')) continue;

    if (!commitMatchesAuthor(authorName, authorEmail, authorAliases)) {
      skippedByAuthor += 1;
      continue;
    }

    const changedFiles = lines.slice(1).filter((l) => l.trim() !== '');
    const topDirSet = new Set();
    for (const f of changedFiles) {
      const slashIdx = f.indexOf('/');
      topDirSet.add(slashIdx === -1 ? '(root)' : f.substring(0, slashIdx));
    }
    const topDirs = [...topDirSet].sort().join(',');
    const filesStr = changedFiles.join(',');

    const commitDay = commitAt.split('T')[0].replace(/-/g, '/');
    const commitIso = commitDayToIso(commitDay);
    if (targetDates && !targetDates.has(commitIso)) {
      continue;
    }

    tsvLines.push(
      [repoRoot, repoName, originUrl, commitSha, commitAt, commitDay, authorName, authorEmail, subject, topDirs, filesStr]
        .map((v) => v.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r'))
        .join('\t'),
    );
  }

  return { lines: tsvLines, skippedByAuthor };
}

async function stepExportCommitsInRange(config, reposFile, authorAliases) {
  const scoped = isScopedCollect(config);
  const [y, m] = config.month.split('/');
  const since = scoped ? config.dateRangeStart : `${y}-${m}-01`;
  const before = scoped
    ? addDaysIso(config.dateRangeEnd, 1)
    : Number(m) === 12
      ? `${Number(y) + 1}-01-01`
      : `${y}-${String(Number(m) + 1).padStart(2, '0')}-01`;
  const targetDates = scoped ? buildTargetDateSet(config) : null;

  if (scoped) {
    console.log(
      `[6/8] 导出 commit（范围 ${config.dateRangeStart} ~ ${config.dateRangeEnd}）...`,
    );
  } else {
    console.log('[6/8] Exporting raw commit evidence (fast mode)...');
  }

  const repos = readFileSync(reposFile, 'utf-8').trim().split('\n').filter(Boolean);
  const concurrency = Number(config.gitLogConcurrency) > 0 ? Number(config.gitLogConcurrency) : 4;
  let skippedByAuthor = 0;

  if (!authorAliases.length) {
    console.log('      未配置作者别名，跳过 commit 导出');
    const commitsFile = writeTmp('commits.tsv', '');
    return { commitsFile, rawOutput: '' };
  }

  console.log(`      并行扫描 ${repos.length} 个仓库（concurrency=${concurrency}）…`);

  const chunks = await mapPool(repos, concurrency, async (repoRoot) => {
    const result = exportRepoCommits(
      repoRoot,
      config,
      authorAliases,
      since,
      before,
      targetDates,
    );
    return result;
  });

  const tsvLines = dedupeTsvLines(chunks.flatMap((chunk) => chunk.lines));
  skippedByAuthor = chunks.reduce((sum, chunk) => sum + chunk.skippedByAuthor, 0);

  const output = tsvLines.join('\n') + (tsvLines.length > 0 ? '\n' : '');
  const commitsFile = writeTmp('commits.tsv', output);
  if (scoped) {
    console.log(
      `      Git 时间过滤: --since="${gitDayStart(since)}" --until="${gitDayStart(before)}"（作者日再筛 targetDates）`,
    );
  }
  console.log(
    `      Exported ${tsvLines.length} commits（跳过非本账户 ${skippedByAuthor} 条）.`,
  );

  return { commitsFile, rawOutput: output };
}

// ---------------------------------------------------------------------------
// TSV → DailyLog JSON conversion
// ---------------------------------------------------------------------------

function stepConvertToDailyLogs(rawCommitsTsv, outputDir) {
  console.log('[7/8] Converting commits to daily evidence files...');

  const lines = rawCommitsTsv.trim().split('\n').filter(Boolean);

  // TSV columns:
  // 0:repo_root  1:repo_name  2:origin_url  3:commit_sha  4:commit_at
  // 5:commit_day  6:author_name  7:author_email  8:subject
  // 9:top_dirs  10:changed_files

  // Group by commit_day
  const dayMap = new Map();

  for (const line of lines) {
    const cols = parseTsvLine(line);
    if (cols.length < 9) continue;

    const repoName = cols[1];
    const commitSha = cols[3];
    const commitDay = cols[5]; // "2026/04/15"
    const subject = cols[8];
    const topDirs = cols[9] || '';

    if (!dayMap.has(commitDay)) {
      dayMap.set(commitDay, []);
    }

    dayMap.get(commitDay).push({
      repoName,
      commitSha,
      subject,
      topDirs,
    });
  }

  // Generate DailyLog JSON for each day
  const sortedDays = [...dayMap.keys()].sort();
  mkdirSync(outputDir, { recursive: true });

  for (const day of sortedDays) {
    const commits = dayMap.get(day);
    // day format: "2026/04/15" → "2026-04-15"
    const dateStr = day.replace(/\//g, '-');

    // Group commits by repo, then merge subjects into task descriptions
    const repoGroups = new Map();
    for (const c of commits) {
      if (!repoGroups.has(c.repoName)) {
        repoGroups.set(c.repoName, []);
      }
      repoGroups.get(c.repoName).push(c);
    }

    const completed = [];
    for (const [repo, repoCommits] of repoGroups) {
      // Deduplicate subjects within same repo
      const subjects = [...new Set(repoCommits.map((c) => c.subject))];
      if (subjects.length === 1) {
        completed.push(`[${repo}] ${subjects[0]}`);
      } else {
        // Multiple commits in same repo → combine
        for (const s of subjects) {
          completed.push(`[${repo}] ${s}`);
        }
      }
    }

    // Build evidence metadata
    const evidence = commits.map((c) => ({
      repo: c.repoName,
      sha: c.commitSha.substring(0, 8),
      subject: c.subject,
    }));

    const dailyLog = {
      date: dateStr,
      completed,
      plan: [],
      blockers: [],
      notes: '',
      gitlog: completed,
      ailog: [],
      origin_url: [],
      _evidence: evidence,
    };

    const filePath = join(outputDir, `${dateStr}.json`);
    writeFileSync(filePath, JSON.stringify(dailyLog, null, 2), 'utf-8');
  }

  console.log(`      Generated ${sortedDays.length} daily evidence files.`);
  return sortedDays;
}

// ---------------------------------------------------------------------------
// Monthly summary JSON (for timesheet_generator.py)
// ---------------------------------------------------------------------------

function stepGenerateMonthlySummary(outputDir, sortedDays) {
  console.log('[8/8] Generating monthly summary JSON...');

  const summary = {};

  for (const day of sortedDays) {
    const dateStr = day.replace(/\//g, '-');
    const filePath = join(outputDir, `${dateStr}.json`);

    if (!existsSync(filePath)) continue;

    const log = JSON.parse(readFileSync(filePath, 'utf-8'));
    // dateKey format: "20260415"
    const dateKey = dateStr.replace(/-/g, '');
    // Join completed tasks with " & "
    summary[dateKey] = (log.completed || [])
      .map((t) => t.replace(/^\[.*?\]\s*/, '')) // strip [repo] prefix for timesheet
      .join(' & ');
  }

  const [y, m] = Object.keys(summary)[0]
    ? [Object.keys(summary)[0].substring(0, 4), Object.keys(summary)[0].substring(4, 6)]
    : ['0000', '00'];

  const summaryFile = join(outputDir, `${y}-${m}.json`);
  writeFileSync(summaryFile, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`      Monthly summary: ${summaryFile} (${Object.keys(summary).length} days)`);

  return summaryFile;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Parse CLI arguments
  let configPath = join(__dirname, 'evidence-config.json');
  let monthOverride = null;
  let evidenceOnly = false;

  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--config' && process.argv[i + 1]) {
      configPath = resolve(process.argv[++i]);
    } else if (process.argv[i] === '--month' && process.argv[i + 1]) {
      monthOverride = process.argv[++i];
    } else if (process.argv[i] === '--evidence-only') {
      evidenceOnly = true;
    }
  }

  if (!existsSync(configPath)) {
    console.error(`Config file not found: ${configPath}`);
    console.error('Create one based on evidence-config.json template.');
    process.exit(1);
  }

  const config = loadConfig(configPath);
  if (monthOverride) {
    config.month = monthOverride;
  }
  const skillDir = expandHome(config.skillScriptsDir);

  if (!existsSync(skillDir)) {
    console.error(`Skill scripts directory not found: ${skillDir}`);
    process.exit(1);
  }

  const monthLabel = config.month.replace('/', '-');
  console.log('='.repeat(60));
  console.log('  Work Evidence Generator');
  console.log(`  证据月份: ${monthLabel} (config.month=${config.month})`);
  if (isScopedCollect(config)) {
    console.log(
      `  扫描窗口: ${config.dateRangeStart} ~ ${config.dateRangeEnd} (${config.fillScope === 'workWeek' ? '本周' : config.fillScope === 'custom' ? '自定义' : '单日'})`,
    );
    console.log(`  目标日期: ${(config.targetDates || []).join(', ')}`);
  } else if (config.anchorDate) {
    console.log(`  采集锚点: ${config.anchorDate}`);
  }
  console.log(`  Config: ${configPath}`);
  console.log('='.repeat(60));
  console.log();

  const reposFile = await stepFindGitRoots(skillDir, config);
  const { originsFile, distinctHosts } = await stepListRepoOrigins(skillDir, reposFile);

  const originFilters = resolveOriginFilters(config);
  let filteredReposFile;
  if (!originFilters.length) {
    console.log('[3/8] 未配置 Git 远程地址过滤，保留全部仓库…');
    if (distinctHosts.length) {
      console.log(`      （扫描到的 origin host: ${distinctHosts.join(', ')}）`);
    }
    filteredReposFile = passThroughReposFromOrigins(originsFile);
    const passCount = readFileSync(filteredReposFile, 'utf-8').trim().split('\n').filter(Boolean).length;
    console.log(`      ${passCount} repositories（未过滤）.`);
  } else {
    filteredReposFile = await stepFilterReposByOrigin(skillDir, originsFile, originFilters);
  }

  const scoped = isScopedCollect(config);
  const authorAliases = resolveAuthorAliases(config);
  console.log(`      ${formatAuthorFilterLog(authorAliases)}`);
  let exportReposFile = filteredReposFile;
  let artifactsFile;

  if (scoped) {
    console.log('[4/8] 跳过按月作者扫描（范围采集）');
    const diagnostic = discoverAuthorsInRange(config, filteredReposFile);
    if (diagnostic.length) {
      console.log(
        `      （诊断）范围内 ${Math.floor(diagnostic.length / 2)} 位作者，不用于过滤`,
      );
    }
    console.log('[5/8] 跳过按月产物清单（范围采集，直接导出 commit）');
    artifactsFile = writeTmp('artifacts.tsv', '');
  } else {
    const authors = await stepListMonthlyAuthors(skillDir, config.month, filteredReposFile);
    console.log(`      （仅日志）本月共 ${authors.length} 位作者，不用于 commit 过滤`);
    const listed = await stepListMonthlyRepos(
      skillDir,
      config.month,
      filteredReposFile,
      authorAliases,
    );
    artifactsFile = listed.artifactsFile;
    exportReposFile = listed.activeReposFile;
  }

  const { commitsFile, rawOutput } = await stepExportCommitsInRange(
    config,
    exportReposFile,
    authorAliases,
  );

  const [y, m] = config.month.split('/');
  const monthDir = join(resolve(config.storageRoot), `${y}-${m}`);
  mkdirSync(monthDir, { recursive: true });

  let sortedDays = [];
  let summaryFile = null;

  if (evidenceOnly) {
    console.log('[7/8] Skipped daily JSON write (--evidence-only)');
    console.log('[8/8] Skipped monthly summary (--evidence-only)');
  } else {
    sortedDays = stepConvertToDailyLogs(rawOutput, monthDir);
    summaryFile = stepGenerateMonthlySummary(monthDir, sortedDays);
  }

  const artifactsDest = join(monthDir, '_artifacts.tsv');
  const commitsDest = join(monthDir, '_commits.tsv');
  writeFileSync(artifactsDest, readFileSync(artifactsFile, 'utf-8'), 'utf-8');
  writeFileSync(commitsDest, readFileSync(commitsFile, 'utf-8'), 'utf-8');

  console.log();
  console.log('='.repeat(60));
  console.log('  Done!');
  console.log(`  Output: ${monthDir}`);
  console.log();
  console.log('  Files:');
  if (evidenceOnly) {
    console.log(`    - (no daily JSON — evidence-only mode)`);
  } else {
    console.log(`    - Daily evidence:  ${monthDir}/YYYY-MM-DD.json`);
    console.log(`    - Monthly summary: ${summaryFile}`);
  }
  console.log(`    - Artifacts TSV:   ${artifactsDest}`);
  console.log(`    - Raw commits TSV: ${commitsDest}`);
  console.log('='.repeat(60));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
