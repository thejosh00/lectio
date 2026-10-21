/**
 * Guard (§11): the loop can't loosen its own checks without the learner saying so.
 */
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {PROTECTED_AREAS} from '../../src/core/proposals.ts';
import {protectedPatterns, touchedProtected} from '../../scripts/guard.ts';
import {startInstance, type Instance} from '../helpers/instance.ts';

let lc: Instance;
beforeEach(async () => {
  lc = await startInstance();
});
afterEach(async () => {
  await lc.stop();
});

const ROOT = resolve(import.meta.dir, '..', '..');

test('a protected proposal can\'t be approved without the acknowledgement', async () => {
  for (const area of PROTECTED_AREAS) {
    const filed = await lc.j(['proposal', 'add', '--open', '--file', lc.file('p.json', {title: `Loosen ${area}`, area, problem: 'p', change: 'c', success: 's'})]);
    const n = String(filed.json.proposal.number);
    expect(filed.json.proposal.protected).toBe(true);
    expect((await lc.j(['proposal', 'approve', n])).code).toBe(2);
    expect((await lc.j(['proposal', 'approve', n, '--protected'])).json.proposal).toMatchObject({status: 'approved', acknowledged: true});
  }
});

test('PROTECTED covers the measures, permissions, caps, the loop itself, and the tutor\'s rules', () => {
  const patterns = protectedPatterns(readFileSync(join(ROOT, 'PROTECTED'), 'utf8'));
  const must = [
    'src/core/measures.ts',
    'src/core/memory.ts',
    'src/core/permissions.ts',
    'src/server/api.ts',
    'src/core/settings.ts',
    'src/core/schedule.ts',
    'src/core/proposals.ts',
    'src/db/proposals.ts',
    'scripts/ship.sh',
    'scripts/guard.ts',
    'PROTECTED',
    'tests/guard/permissions.test.ts',
    'skills/lectio-build/SKILL.md',
    'skills/lectio-teach/rules.md',
  ];
  expect(touchedProtected(must, patterns)).toEqual(must);
  expect(touchedProtected(['src/blocks/markdown.ts', 'skills/lectio-teach/SKILL.md', 'src/web/Today.tsx'], patterns)).toEqual([]);
});
