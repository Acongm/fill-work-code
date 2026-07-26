import { defineConfig } from '@vscode/test-cli';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  files: 'out/test/**/*.test.js',
  launchArgs: [`--user-data-dir=${join(tmpdir(), 'daily-work-log-vscode-test')}`],
  env: {
    DAILY_WORK_LOG_TEST_STORAGE: join(
      tmpdir(),
      `daily-work-log-extension-test-${process.pid}`,
    ),
  },
});
