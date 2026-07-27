import * as assert from 'assert';
import {
  reconcileProjectLinks,
  setProjectLink,
} from '../src/shared/utils/projectLinks';

suite('Daily project links', () => {
  test('preserves existing assignments and makes new items explicitly unassigned', () => {
    const links = reconcileProjectLinks(
      'completed',
      ['existing'],
      ['existing', 'new'],
      [
        {
          field: 'completed',
          content: 'existing',
          assignment: 'project',
          projectOriginUrl: 'https://example.com/a.git',
        },
      ],
    );
    assert.deepStrictEqual(links, [
      {
        field: 'completed',
        content: 'existing',
        assignment: 'project',
        projectOriginUrl: 'https://example.com/a.git',
      },
      {
        field: 'completed',
        content: 'new',
        assignment: 'unassigned',
        projectOriginUrl: null,
      },
    ]);
    assert.strictEqual(
      setProjectLink(
        links,
        'completed',
        'new',
        'https://example.com/b.git',
      )[1].assignment,
      'project',
    );
  });
});
