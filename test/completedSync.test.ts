import * as assert from 'assert';
import { appendUniqueCompleted } from '../src/shared/utils/completedSync';

suite('Completed synchronization', () => {
  test('appends selected generated items without duplicates or blanks', () => {
    assert.deepStrictEqual(
      appendUniqueCompleted(
        ['existing', 'same'],
        [' same ', '', 'new item', 'new item'],
      ),
      ['existing', 'same', 'new item'],
    );
  });
});
