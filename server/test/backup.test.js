import { test } from 'vitest';
import assert from 'node:assert/strict';
import { expiredBackups } from '../src/backup/backup.js';

test('expiredBackups: apaga só backups com mais de N dias', () => {
  const files = [
    'goals-2026-11-18.db',
    'goals-2026-11-05.db',
    'goals-2026-11-04.db',
    'goals-2026-10-01.db',
    'goals-2026-11-18.db.tmp',
    'outro-arquivo.txt',
  ];
  assert.deepEqual(expiredBackups(files, '2026-11-18', 14), [
    'goals-2026-11-04.db',
    'goals-2026-10-01.db',
  ]);
});
