import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import {
	isRemovedWebviewCommand,
	type RemovedWebviewCommand,
} from '../src/shared/types/webviewMessages';
import { resolveRuntimePaths } from '../src/settings/utils/pathUtils';
import { aggregateRepoActivity } from '../src/shared/utils/repoRegistry';
import type { RepoGroup } from '../src/shared/types/repoRegistry';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('removed Webview commands stay unavailable', () => {
		const removed: RemovedWebviewCommand[] = [
			'selectXlsxImport',
			'confirmImport',
			'listMonthFiles',
			'sendEmail',
		];

		for (const command of removed) {
			assert.strictEqual(isRemovedWebviewCommand(command), true);
		}
	});

	test('all runtime paths share the configured storage root', () => {
		const paths = resolveRuntimePaths('/tmp/work-logs');

		assert.strictEqual(paths.database, '/tmp/work-logs/work-log.sqlite');
		assert.strictEqual(paths.runtime, '/tmp/work-logs/.runtime');
		assert.strictEqual(paths.month(2026, 7), '/tmp/work-logs/2026-07');
	});

	test('returns empty activity for a missing month directory', () => {
		const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-work-log-'));
		const group: RepoGroup = {
			originUrl: 'https://example.com/acme/repo.git',
			repoName: 'repo',
			clones: [],
			cloneCount: 0,
		};

		try {
			const activity = aggregateRepoActivity(storagePath, group, {
				month: '2026-07',
			});

			assert.deepStrictEqual(activity, {
				commits: [],
				gitlogLines: [],
				ailogLines: [],
			});
		} finally {
			fs.rmSync(storagePath, { recursive: true, force: true });
		}
	});
});
