import * as assert from 'assert';
import type { ProjectHistoryCommit } from '../src/database/commands/projectRepository';
import { buildProjectDailyEntries } from '../src/projects/utils/buildProjectDailyEntries';
import { remainingSelectedDates } from '../src/shared/utils/projectDateSelection';

function commit(id: string, subject: string): ProjectHistoryCommit {
  return {
    id,
    cloneId: 'clone-a',
    sha: `${id}123456`,
    subject,
    author: null,
    committedAt: '2026-07-27T10:00:00.000Z',
  };
}

suite('Project daily logs', () => {
  test('uses deduplicated structured GitLog before commit subjects', () => {
    assert.deepStrictEqual(
      buildProjectDailyEntries({
        gitlog: [
          { id: 'g1', cloneId: 'clone-a', content: '完成仓库详情调整' },
          { id: 'g2', cloneId: 'clone-a', content: ' 完成仓库详情调整 ' },
        ],
        commits: [commit('a', 'raw commit')],
      }),
      ['完成仓库详情调整'],
    );
  });

  test('falls back to deduplicated commit subjects without GitLog', () => {
    assert.deepStrictEqual(
      buildProjectDailyEntries({
        gitlog: [],
        commits: [
          commit('a', '修复日报闪烁'),
          commit('b', ' 修复日报闪烁 '),
        ],
      }),
      ['修复日报闪烁'],
    );
  });

  test('keeps failed selected dates and removes successful dates', () => {
    assert.deepStrictEqual(
      remainingSelectedDates(
        ['2026-07-25', '2026-07-26', '2026-07-27'],
        ['2026-07-25', '2026-07-27'],
      ),
      ['2026-07-26'],
    );
  });
});
