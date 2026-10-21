/**
 * The §7 measures on a fixed history. These definitions are protected: if one of these
 * numbers changes, a measure has changed meaning, and the before-and-after comparisons
 * the learner relies on are broken.
 */
import {describe, expect, test} from 'bun:test';
import {approachOutcomes, calibration, misconceptions, observedDifficulty, questionStats, retention, retentionByWeek, sameDayAccuracy, weekOf, type AttemptFact} from '../../src/core/measures.ts';

let n = 0;
function fact(over: Partial<AttemptFact>): AttemptFact {
  n++;
  return {
    id: `a${n}`,
    question_id: 'q1',
    question_type: 'multiple_choice',
    aim: 'recall',
    concepts: ['c1'],
    context: 'quiz',
    role: 'review',
    attempt_no: 1,
    score: 1,
    confidence: 'sure',
    hints_used: 0,
    seconds: 20,
    misconception: null,
    gap_hours: 48,
    counts_for_memory: true,
    void: false,
    day: '2026-09-14',
    at: '2026-09-14T15:00:00Z',
    answer: 'b',
    ...over,
  };
}

/** A history with one of everything retention must leave out. */
export const HISTORY: AttemptFact[] = [
  fact({}), // retained
  fact({score: 0}), // not retained
  fact({confidence: 'guess'}), // right, but guessed: counted, not retained
  fact({hints_used: 1}), // hinted: counted, not retained
  fact({gap_hours: 2, role: 'new'}), // same day: not a delayed review
  fact({void: true}), // void
  fact({role: 'probe', counts_for_memory: false}), // probe
  fact({context: 'lesson', counts_for_memory: false, role: null}), // inline check
  fact({counts_for_memory: false}), // a second attempt on the concept that day
  fact({role: 'new', gap_hours: 0.2, score: 1}),
  fact({role: 'new', gap_hours: 0.2, score: 0, confidence: 'sure', misconception: 'rust-has-gc', concepts: ['c2']}),
  fact({role: 'new', gap_hours: 0.2, score: 0.5, confidence: 'think'}),
  fact({role: 'new', attempt_no: 2, gap_hours: 0.2, score: 1}),
];

describe('retention', () => {
  test('delayed, counted reviews only; retained means right, no hint, not guessing', () => {
    expect(retention(HISTORY, 20)).toEqual({n: 4, rate: 0.25});
  });
  test('the gap threshold is the setting', () => {
    expect(retention(HISTORY, 1)).toEqual({n: 5, rate: 0.4});
  });
  test('by ISO week, starting Monday', () => {
    expect(weekOf('2026-09-13')).toBe('2026-09-07');
    expect(weekOf('2026-09-14')).toBe('2026-09-14');
    expect(retentionByWeek(HISTORY, 20)).toEqual([{week: '2026-09-14', n: 4, rate: 0.25}]);
  });
});

describe('same-day accuracy', () => {
  test('first tries on new items: the share with score 1', () => {
    expect(sameDayAccuracy(HISTORY)).toEqual({n: 4, rate: 0.5});
  });
});

describe('calibration', () => {
  test('share right per confidence, and sure-but-wrong by concept', () => {
    const cal = calibration(HISTORY);
    expect(cal.by_confidence.guess).toEqual({n: 1, rate: 1});
    expect(cal.by_confidence.think).toEqual({n: 1, rate: 0});
    expect(cal.sure_but_wrong).toEqual([
      {concept_id: 'c1', count: 1},
      {concept_id: 'c2', count: 1},
    ]);
  });
});

describe('misconceptions', () => {
  test('tag → count, last seen and concepts; void attempts are left out', () => {
    const list = misconceptions([...HISTORY, fact({misconception: 'rust-has-gc', at: '2026-09-15T15:00:00Z'}), fact({misconception: 'rust-has-gc', void: true})]);
    expect(list).toEqual([{tag: 'rust-has-gc', count: 2, last_seen: '2026-09-15T15:00:00Z', concepts: ['c2', 'c1']}]);
  });
});

describe('approach outcomes', () => {
  test('concepts introduced with an approach vs without, with n, and block engagement', () => {
    const history = [fact({concepts: ['c1']}), fact({concepts: ['c1'], score: 0}), fact({concepts: ['c2']})];
    const outcomes = approachOutcomes(
      [
        {concept_id: 'c1', approaches: ['analogy', 'explanation']},
        {concept_id: 'c2', approaches: ['explanation']},
      ],
      [
        {approach: 'analogy', type: 'markdown', seen_seconds: 30, completed: false, completable: false, helpful: 1, confusing: 0},
        {approach: 'step_through', type: 'steps', seen_seconds: 60, completed: true, completable: true, helpful: 0, confusing: 1},
      ],
      history,
      20,
    );
    const analogy = outcomes.find(o => o.approach === 'analogy')!;
    expect(analogy.with).toEqual({concepts: 1, n: 2, rate: 0.5});
    expect(analogy.without).toEqual({concepts: 1, n: 1, rate: 1});
    expect(analogy).toMatchObject({blocks: 1, median_seen_seconds: 30, completion: null, helpful: 1});
    expect(outcomes.find(o => o.approach === 'step_through')).toMatchObject({completion: {n: 1, rate: 1}, confusing: 1});
  });
});

describe('question stats', () => {
  test('first tries, picks per choice, and difficulty guessed vs observed', () => {
    const stats = questionStats([fact({answer: 'b'}), fact({answer: 'a', score: 0}), fact({answer: 'b'}), fact({answer: 'b', attempt_no: 2})], 2, ['a', 'b', 'c']);
    expect(stats).toMatchObject({attempts: 4, first_try: {n: 3, rate: 0.667}, picks: {a: 1, b: 2, c: 0}, difficulty_guessed: 2, difficulty_observed: 3});
    expect(observedDifficulty(0.95)).toBe(1);
    expect(observedDifficulty(0.1)).toBe(5);
  });
});
