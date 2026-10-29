/**
 * M20: an experiment that counts every concept its lessons teach, so "keep the picture or fade
 * it" on ideas already met can be measured. Each lesson's concept counts the delayed reviews
 * after that lesson and before the experiment's next lesson on it: no review counts twice.
 */
import {expect, test} from 'bun:test';
import {experimentOutcomes, type AttemptFact, type ArmGroup} from '../../src/core/measures.ts';

let n = 0;
const review = (concept: string, at: string, score = 1): AttemptFact => ({
  id: `a${++n}`,
  question_id: 'q1',
  question_type: 'multiple_choice',
  aim: 'recall',
  concepts: [concept],
  context: 'quiz',
  role: 'review',
  attempt_no: 1,
  score,
  confidence: 'sure',
  hints_used: 0,
  seconds: 20,
  misconception: null,
  gap_hours: 48,
  counts_for_memory: true,
  void: false,
  day: at.slice(0, 10),
  at,
  answer: 'b',
});
const arm = (over: Partial<ArmGroup>): ArmGroup => ({lessons: 1, introduced: [], same_day: [], ...over});

test('without taught windows an arm counts what it introduced, as before', () => {
  const [r] = experimentOutcomes([{name: 'x', arms: {a: 'a', b: 'b'}, status: 'open', verdict: null, a: arm({introduced: ['c1']}), b: arm({})}], [review('c1', '2026-09-20T10:00:00Z')], 20);
  expect(r).toMatchObject({counts: 'new', a: {concepts: 1, retention: {n: 1}}, b: {concepts: 0, retention: {n: 0}}});
});

test('a taught concept counts the reviews after its lesson and before the next lesson on it', () => {
  const attempts = [
    review('c1', '2026-09-10T10:00:00Z'), // before either lesson: neither arm's
    review('c1', '2026-09-13T10:00:00Z'), // after a's lesson, before b's: a's
    review('c1', '2026-09-14T10:00:00Z', 0), // a's
    review('c1', '2026-09-20T10:00:00Z'), // after b's lesson: b's
    review('c2', '2026-09-13T10:00:00Z'), // a concept neither taught
  ];
  const [r] = experimentOutcomes(
    [
      {
        name: 'keep_vs_fade',
        arms: {a: 'the diagram again', b: 'no diagram'},
        status: 'open',
        verdict: null,
        a: arm({taught: [{concept: 'c1', after: '2026-09-12T12:00:00Z', before: '2026-09-18T12:00:00Z'}]}),
        b: arm({taught: [{concept: 'c1', after: '2026-09-18T12:00:00Z', before: null}]}),
      },
    ],
    attempts,
    20,
  );
  expect(r).toMatchObject({counts: 'taught', a: {concepts: 1, retention: {n: 2, rate: 0.5}}, b: {concepts: 1, retention: {n: 1, rate: 1}}});
});
