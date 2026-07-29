import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

suite('Daily date load performance', () => {
  test('loadDate sends only one host message', () => {
    const projectRoot = path.resolve(__dirname, '../..');
    const page = fs.readFileSync(
      path.join(projectRoot, 'web/src/app/pages/App.tsx'),
      'utf8',
    );

    const loadDateBlock = page.match(
      /const loadDate = useCallback\([\s\S]*?\}, \[\]\);/,
    );
    assert.ok(loadDateBlock, 'loadDate callback should exist');
    const block = loadDateBlock[0];
    assert.match(block, /command:\s*'loadDate'/);
    assert.doesNotMatch(block, /loadRepositoryOptions/);
    assert.doesNotMatch(block, /updateDailyPreview/);
  });

  test('handleLoadDate merges monthly repository options in one response', () => {
    const projectRoot = path.resolve(__dirname, '../..');
    const handler = fs.readFileSync(
      path.join(projectRoot, 'src/daily/commands/dailyMessages.ts'),
      'utf8',
    );

    assert.match(handler, /repositoryOptionsForDate/);
    assert.match(handler, /\[perf\] loadDate/);
  });

  test('refreshActiveDate avoids full init refresh on visibility', () => {
    const projectRoot = path.resolve(__dirname, '../..');
    const provider = fs.readFileSync(
      path.join(projectRoot, 'src/app/views/ChatViewProvider.ts'),
      'utf8',
    );

    const visibilityBlock = provider.match(
      /onDidChangeVisibility\([\s\S]*?\}\);/,
    );
    assert.ok(visibilityBlock, 'onDidChangeVisibility handler should exist');
    assert.match(visibilityBlock[0], /refreshActiveDate/);
    assert.doesNotMatch(visibilityBlock[0], /_updateWebview/);
  });
});
