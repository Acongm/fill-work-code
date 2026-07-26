import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { CodexConversationCollector } from '../src/collection/utils/codexConversationCollector';
import { CursorConversationCollector } from '../src/collection/utils/cursorConversationCollector';
import { QoderConversationCollector } from '../src/collection/utils/qoderConversationCollector';

const fixtures = path.join(__dirname, '../../test/fixtures/ai');

suite('AI collectors', () => {
  test('normalize complete sessions and messages', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-collectors-'));
    const codexPath = path.join(root, 'rollout-fixture.jsonl');
    const cursorPath = path.join(root, 'conversation-search.db');
    const qoderPath = path.join(root, 'qoder-state.json');
    fs.copyFileSync(path.join(fixtures, 'codex-session.jsonl'), codexPath);
    fs.copyFileSync(path.join(fixtures, 'qoder-state.json'), qoderPath);
    execFileSync('/usr/bin/sqlite3', [
      cursorPath,
      `.read ${path.join(fixtures, 'cursor-schema.sql')}`,
    ]);

    try {
      const collected = await Promise.all([
        new CodexConversationCollector([root]).collect({
          provider: 'codex',
          path: codexPath,
        }),
        new CursorConversationCollector([root]).collect({
          provider: 'cursor',
          path: cursorPath,
        }),
        new QoderConversationCollector([root]).collect({
          provider: 'qoder',
          path: qoderPath,
        }),
      ]);
      assert.deepStrictEqual(
        collected.map((item) => item.provider),
        ['codex', 'cursor', 'qoder'],
      );
      assert.ok(collected.every((item) => item.messages.length === 2));
      assert.ok(
        collected.every((item) =>
          item.messages.every((message) => message.content.includes('complete')),
        ),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('collector diagnostics never require message content', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-malformed-'));
    const source = path.join(root, 'malformed.jsonl');
    fs.writeFileSync(source, 'PRIVATE MESSAGE\n{broken', 'utf-8');
    try {
      const result = await new CodexConversationCollector([root]).collect({
        provider: 'codex',
        path: source,
      });
      assert.strictEqual(result.messages.length, 0);
      assert.ok(!JSON.stringify(result.messages).includes('PRIVATE MESSAGE'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
