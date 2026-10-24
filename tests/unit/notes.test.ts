/** Who owns which line of a versioned document: the notes, the plans and the playbook. */
import {expect, test} from 'bun:test';
import {learnerLines} from '../../src/db/notes.ts';

const v = (version: number, actor: string, body: string, restored_from: number | null = null) => ({version, actor, body, restored_from});

test('a line belongs to whoever wrote it first in the run of versions that kept it', () => {
  expect(learnerLines([v(1, 'agent:tutor', 'a\nb'), v(2, 'you', 'a\nb\nmine'), v(3, 'agent:tutor', 'a\nmine\nc')])).toEqual(['mine']);
  // Dropped and written again by the tutor, it is the tutor's.
  expect(learnerLines([v(1, 'you', 'mine'), v(2, 'agent:tutor', 'other'), v(3, 'agent:tutor', 'mine')])).toEqual([]);
});

test("restoring a version gives its lines back the owners they had: the tutor's words don't become the learner's", () => {
  const history = [v(1, 'agent:tutor', 'old rule\nshared'), v(2, 'you', 'my rule\nshared'), v(3, 'agent:tutor', 'new rule\nshared\nmy rule'), v(4, 'you', 'old rule\nshared', 1)];
  expect(learnerLines(history)).toEqual([]);
  // And restoring the learner's own version gives them their lines back.
  expect(learnerLines([...history, v(5, 'you', 'my rule\nshared', 2)])).toEqual(['my rule']);
});
