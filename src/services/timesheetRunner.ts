import { execFile } from 'node:child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'node:util';
import type { PluginSettings } from '../features/settings/pluginSettings';

const execFileAsync = promisify(execFile);

export interface TimesheetGenerateOptions {
  extensionPath: string;
  year: number;
  month: number;
  workLogDir: string;
  outputDir: string;
  settings: PluginSettings;
  includeLoggedNonWorkdays?: boolean;
}

export interface TimesheetGenerateResult {
  timesheetPath: string;
  artifactPath: string | null;
  stdout: string;
}

export class TimesheetRunner {
  async generate(options: TimesheetGenerateOptions): Promise<TimesheetGenerateResult> {
    const scriptPath = path.join(
      options.extensionPath,
      'scripts',
      'python',
      'timesheet_generator.py',
    );
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`未找到工时表脚本: ${scriptPath}`);
    }

    const monthKey = `${options.year}-${String(options.month).padStart(2, '0')}`;
    const outputDir =
      options.outputDir.trim() || path.join(options.workLogDir, monthKey);
    fs.mkdirSync(outputDir, { recursive: true });

    const displayName = options.settings.displayName.trim() || 'User';
    const company = options.settings.timesheet?.company?.trim() || '';
    const approver = options.settings.timesheet?.approver?.trim() || '';
    const yyyymm = `${options.year}${String(options.month).padStart(2, '0')}`;
    const timesheetPath = path.join(
      outputDir,
      `Timesheet-${displayName}_${yyyymm}.xlsx`,
    );
    const artifactPath = path.join(
      outputDir,
      `交付物_${displayName}_${yyyymm}.xlsx`,
    );

    const args = [
      scriptPath,
      '--year',
      String(options.year),
      '--month',
      String(options.month),
      '--work-log-dir',
      options.workLogDir,
      '--output-dir',
      outputDir,
      '--source-fields',
      options.settings.timesheetContentField || 'ailog',
      '--psp-name',
      displayName,
      '--psp-company',
      company,
      '--approver',
      approver,
      '--artifacts-source-template',
      path.join(
        options.workLogDir,
        monthKey,
        'gitlog',
        '产物清单.tsv',
      ),
    ];

    if (options.includeLoggedNonWorkdays) {
      args.push('--include-all-logged-days');
    }

    const { stdout, stderr } = await execFileAsync('python3', args, {
      cwd: options.extensionPath,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    const combined = `${stdout}\n${stderr}`.trim();
    if (!fs.existsSync(timesheetPath)) {
      throw new Error(
        `Python 脚本未生成工时表文件。\n${combined || '(无输出)'}`,
      );
    }

    return {
      timesheetPath,
      artifactPath: fs.existsSync(artifactPath) ? artifactPath : null,
      stdout: combined,
    };
  }
}
