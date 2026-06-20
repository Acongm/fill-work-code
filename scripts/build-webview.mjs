#!/usr/bin/env node
/** 在 web/ 目录用 npm 构建，避免 Yarn PnP 注入导致 vite 找不到 rollup */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
