#!/usr/bin/env node
/**
 * 一键发布 Daily Work Log 扩展（对齐 ai-innovation 的 yarn release:app）
 *
 * Usage:
 *   yarn release:app
 *   yarn release:app 0.1.1
 *   yarn release:app --version 0.1.1 --force
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getVsixPath,
  readReleaseManifest,
  vsixExists,
} from './release/version-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = resolve(__dirname, '..');

function gitRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: EXT_ROOT,
    encoding: 'utf8',
  }).trim();
}

function parseArgs(argv) {
  const args = {
    bump: 'patch',
    force: false,
    help: false,
    noBump: false,
    noTag: false,
    pushTag: true,
    skipBuild: false,
    version: '',
  };

  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--no-tag') {
      args.noTag = true;
      args.pushTag = false;
    } else if (arg === '--no-push-tag') {
      args.pushTag = false;
    } else if (arg === '--no-bump') {
      args.noBump = true;
    } else if (arg === '--skip-build') {
      args.skipBuild = true;
    } else if (arg === '--force') {
      args.force = true;
    } else if (arg === '--version') {
      args.version = argv[++i] ?? '';
    } else if (['patch', 'minor', 'major'].includes(arg)) {
      args.bump = arg;
    } else if (arg.startsWith('-')) {
      throw new Error(`未知参数: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (!args.version && positional[0]) {
    args.version = positional[0];
  }

  if (args.noTag) {
    args.pushTag = false;
  }

  return args;
}

function printHelp(packageName) {
  console.log(`一键发布 VS Code 扩展 ${packageName}。

用法（在 fill_work_code 目录）:
  yarn release:app [version|patch|minor|major] [options]
  npm run release:app -- [options]

示例:
  yarn release:app
  yarn release:app 0.1.2
  yarn release:app minor --force
  yarn release:app --no-bump --force

默认流程:
  1. 升版（默认 patch，写入 lerna.json + package.json）
  2. git commit 版本号
  3. npm run compile && 打包 VSIX → artifacts/${packageName}-<version>.vsix
  4. git tag v<version>（可选推送 origin）

选项:
  --version <semver>   指定版本（优先于 patch/minor/major）
  patch|minor|major  升版类型（默认 patch）
  --no-bump            不升版，使用当前版本
  --skip-build         跳过编译/打包（需已有 VSIX）
  --no-tag             不创建 tag、不推送
  --no-push-tag        本地打 tag，不 push
  --force              覆盖已存在的同版本 VSIX
  --help, -h           显示帮助
`);
}

function readVersions() {
  const manifest = readReleaseManifest(EXT_ROOT);
  return manifest.lernaVersion;
}

function writeVersions(version) {
  const manifest = readReleaseManifest(EXT_ROOT);
  const lerna = JSON.parse(readFileSync(manifest.lernaPath, 'utf8'));
  const pkg = JSON.parse(readFileSync(manifest.packagePath, 'utf8'));
  lerna.version = version;
  pkg.version = version;
  writeFileSync(manifest.lernaPath, `${JSON.stringify(lerna, null, 2)}\n`);
  writeFileSync(manifest.packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function bumpSemver(version, bump) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`无法解析版本号 "${version}"，需要形如 0.1.0`);
  }
  let major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);
  if (bump === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (bump === 'minor') {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

function tagExists(gitCwd, tagName) {
  try {
    execFileSync('git', ['rev-parse', tagName], { cwd: gitCwd, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function resolveReleaseVersion({ current, args }) {
  if (args.noBump) {
    return args.version || current;
  }
  if (args.version) {
    return args.version;
  }
  let next = bumpSemver(current, args.bump);
  const root = gitRoot();
  while (tagExists(root, `v${next}`)) {
    next = bumpSemver(next, 'patch');
  }
  return next;
}

function versionFilePaths() {
  const root = gitRoot();
  return [
    relative(root, join(EXT_ROOT, 'lerna.json')),
    relative(root, join(EXT_ROOT, 'package.json')),
  ];
}

function commitVersionFiles(packageName, version) {
  const root = gitRoot();
  const paths = versionFilePaths();
  const status = execFileSync('git', ['status', '--porcelain', '--', ...paths], {
    cwd: root,
    encoding: 'utf8',
  }).trim();

  if (!status) {
    console.log(`版本文件已是 ${version}，跳过 commit。`);
    return false;
  }

  execFileSync('git', ['add', ...paths], { cwd: root, stdio: 'inherit' });
  execFileSync(
    'git',
    ['commit', '-m', `chore(${packageName}): release v${version}`],
    { cwd: root, stdio: 'inherit' },
  );
  return true;
}

function runBuild(force) {
  console.log('编译并打包 VSIX…');
  const buildEnv = { ...process.env };
  delete buildEnv.NODE_OPTIONS;
  buildEnv.YARN_IGNORE_PATH = '1';
  execFileSync('npm', ['run', 'compile'], {
    cwd: EXT_ROOT,
    stdio: 'inherit',
    env: buildEnv,
  });
  const pkgArgs = ['scripts/release/package.mjs'];
  if (force) {
    pkgArgs.push('--force');
  }
  execFileSync('node', pkgArgs, { cwd: EXT_ROOT, stdio: 'inherit' });
}

function createTag(gitCwd, version) {
  const tagName = `v${version}`;
  if (tagExists(gitCwd, tagName)) {
    throw new Error(`Git tag 已存在: ${tagName}`);
  }
  execFileSync('git', ['tag', '-a', tagName, '-m', `release daily-work-log ${version}`], {
    cwd: gitCwd,
    stdio: 'inherit',
  });
  return tagName;
}

function pushRelease(gitCwd, { committed, tagName, pushTag }) {
  if (!pushTag) {
    return;
  }
  if (committed) {
    execFileSync('git', ['push', 'origin', 'HEAD'], { cwd: gitCwd, stdio: 'inherit' });
  }
  if (tagName) {
    execFileSync('git', ['push', 'origin', tagName], { cwd: gitCwd, stdio: 'inherit' });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = readReleaseManifest(EXT_ROOT);
  const packageName = manifest.packageName;

  if (args.help) {
    printHelp(packageName);
    return;
  }

  execFileSync('git', ['rev-parse', '--git-dir'], { cwd: EXT_ROOT, stdio: 'pipe' });

  const current = readVersions();
  const version = resolveReleaseVersion({ current, args });

  if (version !== current) {
    console.log(`升版: ${current} → ${version}`);
    writeVersions(version);
  } else {
    console.log(`发布版本: ${version}`);
  }

  const committed = commitVersionFiles(packageName, version);

  if (!args.skipBuild) {
    runBuild(args.force);
  } else {
    const vsixPath = getVsixPath(EXT_ROOT, packageName, version);
    if (!existsSync(vsixPath)) {
      throw new Error(`--skip-build 但 VSIX 不存在: ${vsixPath}`);
    }
  }

  const vsixPath = getVsixPath(EXT_ROOT, packageName, version);
  if (!vsixExists(EXT_ROOT, packageName, version)) {
    throw new Error(`打包后未找到 VSIX: ${vsixPath}`);
  }

  let tagName;
  if (!args.noTag) {
    tagName = createTag(gitRoot(), version);
  }

  pushRelease(gitRoot(), {
    committed,
    tagName,
    pushTag: args.pushTag,
  });

  console.log('');
  console.log('Release 完成。');
  console.log(`  扩展:    ${packageName}`);
  console.log(`  版本:    ${version}`);
  console.log(`  VSIX:    ${vsixPath}`);
  if (tagName) {
    console.log(`  tag:     ${tagName}`);
  }
  if (args.pushTag) {
    if (committed) {
      console.log('  pushed:  origin HEAD');
    }
    if (tagName) {
      console.log(`  pushed:  origin ${tagName}`);
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
