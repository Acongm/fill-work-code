import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function getReleaseRoot(importMetaUrl) {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), '../..');
}

export function readReleaseManifest(rootDir) {
  const lernaPath = path.join(rootDir, 'lerna.json');
  const packagePath = path.join(rootDir, 'package.json');
  const lerna = JSON.parse(fs.readFileSync(lernaPath, 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

  if (!lerna.version) {
    throw new Error('lerna.json 缺少 version 字段。');
  }

  return {
    lernaPath,
    packagePath,
    lernaVersion: lerna.version,
    packageVersion: pkg.version,
    packageName: pkg.name,
  };
}

export function syncVersionFromLerna(rootDir) {
  const manifest = readReleaseManifest(rootDir);
  if (manifest.packageVersion === manifest.lernaVersion) {
    return manifest.lernaVersion;
  }

  const pkg = JSON.parse(fs.readFileSync(manifest.packagePath, 'utf8'));
  pkg.version = manifest.lernaVersion;
  fs.writeFileSync(
    manifest.packagePath,
    `${JSON.stringify(pkg, null, 2)}\n`,
    'utf8',
  );
  return manifest.lernaVersion;
}

export function getVsixPath(rootDir, packageName, version) {
  return path.join(rootDir, 'artifacts', `${packageName}-${version}.vsix`);
}

export function vsixExists(rootDir, packageName, version) {
  return fs.existsSync(getVsixPath(rootDir, packageName, version));
}

export function getCurrentBranch(rootDir) {
  return execSync('git rev-parse --abbrev-ref HEAD', {
    cwd: rootDir,
    encoding: 'utf8',
  }).trim();
}

export function assertReleaseBranch(rootDir, expectedBranch = 'main') {
  const branch = getCurrentBranch(rootDir);
  if (branch !== expectedBranch) {
    throw new Error(
      `当前分支为 ${branch}，请在 ${expectedBranch} 上执行 release。`,
    );
  }
}

export function getWorkingTreeStatus(rootDir) {
  return execSync('git status --porcelain', {
    cwd: rootDir,
    encoding: 'utf8',
  }).trim();
}

export function assertCleanWorkingTree(rootDir) {
  const status = getWorkingTreeStatus(rootDir);
  if (status) {
    throw new Error(
      '工作区有未提交改动，请先 commit 或 stash，再执行 release。',
    );
  }
}

export function formatReleaseHint(version, packageName) {
  return [
    '',
    '推荐命令：',
    '  npm run release:status',
    '  npm run release',
    '  npm run release:minor',
    '',
    `VSIX 输出：artifacts/${packageName}-<version>.vsix`,
    `当前版本：${version}`,
  ].join('\n');
}
