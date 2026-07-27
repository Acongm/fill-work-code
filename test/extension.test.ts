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
import * as extensionEntry from '../src/app/commands/extension';
import * as webviewMessages from '../src/shared/utils/webviewMessages';
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

	test('routes project daily log generation through the host', () => {
		const projectRoot = path.resolve(__dirname, '../..');
		const provider = fs.readFileSync(
			path.join(projectRoot, 'src/app/views/ChatViewProvider.ts'),
			'utf8',
		);

		assert.match(provider, /case 'generateProjectDailyLogs'/);
		assert.match(provider, /handleGenerateProjectDailyLogs/);
	});

	test('all runtime paths share the configured storage root', () => {
		const paths = resolveRuntimePaths('/tmp/work-logs');

		assert.strictEqual(paths.database, '/tmp/work-logs/work-log.sqlite');
		assert.strictEqual(paths.runtime, '/tmp/work-logs/.runtime');
		assert.strictEqual(paths.month(2026, 7), '/tmp/work-logs/2026-07');
	});

	test('registers the Webview before database initialization completes', async () => {
		type StartDatabaseBackedView = <T>(
			initializeDatabase: () => Promise<T>,
			registerView: (databaseReady: Promise<T>) => void,
		) => Promise<T>;
		const startDatabaseBackedView = (
			extensionEntry as unknown as {
				startDatabaseBackedView?: StartDatabaseBackedView;
			}
		).startDatabaseBackedView;

		assert.strictEqual(typeof startDatabaseBackedView, 'function');

		let completeInitialization!: (value: string) => void;
		const initialization = new Promise<string>(resolve => {
			completeInitialization = resolve;
		});
		let registeredDatabase: Promise<string> | undefined;

		const databaseReady = startDatabaseBackedView!(
			() => initialization,
			ready => {
				registeredDatabase = ready;
			},
		);

		assert.strictEqual(registeredDatabase, databaseReady);
		completeInitialization('ready');
		assert.strictEqual(await databaseReady, 'ready');
	});

	test('accepts one ready date before allowing startup refreshes', () => {
		type StartupGate = {
			isReady: () => boolean;
			acceptReady: (activeDate: string) => boolean;
		};
		const createWebviewStartupGate = (
			webviewMessages as unknown as {
				createWebviewStartupGate?: (
					log: (message: string) => void,
				) => StartupGate;
			}
		).createWebviewStartupGate;

		assert.strictEqual(typeof createWebviewStartupGate, 'function');

		const logs: string[] = [];
		const gate = createWebviewStartupGate!(message => logs.push(message));

		assert.strictEqual(gate.isReady(), false);
		assert.strictEqual(gate.acceptReady('2026-07-17'), true);
		assert.strictEqual(gate.isReady(), true);
		assert.strictEqual(gate.acceptReady('2026-07-26'), false);
		assert.deepStrictEqual(logs, [
			'等待 Webview ready',
			'Webview ready: 2026-07-17',
			'忽略重复 Webview ready: 2026-07-26',
		]);
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
