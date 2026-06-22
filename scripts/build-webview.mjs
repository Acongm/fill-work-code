#!/usr/bin/env node
/** 在 web/ 目录用 npm 构建，避免 Yarn PnP 注入导致 vite 找不到 rollup */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIN_NODE_MAJOR = 18;

function assertNodeVersion() {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (major >= MIN_NODE_MAJOR) {
    return;
  }
  console.error(
    [
      `[daily-work-log] Webview 构建需要 Node >= ${MIN_NODE_MAJOR}（当前 ${process.version}）。`,
      'Vite 5 无法在旧版 Node 上运行（常见报错：Unexpected token \'??=\'）。',
      '',
      '修复方式：',
      '  nvm install 20 && nvm use 20',
      '  或在项目根目录执行：nvm use',
      '',
      '然后重新运行：npm run compile',
    ].join('\n'),
  );
  process.exit(1);
}

assertNodeVersion();

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');

function cleanEnv() {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.npm_config_user_agent;
  env.YARN_IGNORE_PATH = '1';
  return env;
}

execFileSync('npm', ['run', 'build'], {
  cwd: webDir,
  stdio: 'inherit',
  env: cleanEnv(),
});
