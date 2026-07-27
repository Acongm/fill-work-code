import * as assert from 'assert';
import { mergeJsonProjectHistory } from '../src/projects/commands/mergeJsonProjectHistory';
import type { ProjectHistory } from '../src/database/commands/projectRepository';

suite('Project history', () => {
  test('merges project-linked user JSON records without unassigned items', () => {
    const history: ProjectHistory = {
      project: {
        id: 'project-a',
        originUrl: 'https://example.com/a.git',
        name: 'A',
        pinned: false,
        hidden: false,
        createdAt: '2026-07-27T00:00:00.000Z',
        updatedAt: '2026-07-27T00:00:00.000Z',
      },
      clones: [],
      days: [],
    };

    const merged = mergeJsonProjectHistory(
      history,
      [
        {
          date: '2026-07-27',
          completed: ['linked', 'unassigned'],
          plan: [],
          blockers: [],
          notes: '',
          projectLinks: [
            {
              field: 'completed',
              content: 'linked',
              assignment: 'project',
              projectOriginUrl: 'https://example.com/a.git',
            },
            {
              field: 'completed',
              content: 'unassigned',
              assignment: 'unassigned',
              projectOriginUrl: null,
            },
          ],
        },
      ],
      'https://example.com/a.git',
    );

    assert.deepStrictEqual(
      merged.days[0].items.map((item) => item.content),
      ['linked'],
    );
    assert.strictEqual(merged.days[0].items[0].source, 'manual');
  });
});
