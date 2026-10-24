/**
 * The §7 measures on a fixed history. These definitions are fixed: if one of these
 * numbers changes, a measure has changed meaning, and the before-and-after comparisons
 * the learner relies on are broken.
 */
import {describe, expect, test} from 'bun:test';
import {approachOutcomes, calibration, experimentOutcomes, misconceptions, observedDifficulty, playbookOutcomes, predictions, questionStats, throughput, retention, retentionByWeek, sameDayAccuracy, weekOf, type AttemptFact, type PredictionFact} from '../../src/core/measures.ts';

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

describe('predictions', () => {
  let k = 0;
  const p = (over: Partial<PredictionFact>): PredictionFact => ({attempt_id: `p${++k}`, question_id: 'q1', role: 'review', concepts: ['c1'], day: '2026-09-14', predicted: 0.8, formula: 0.9, score: 1, ...over});

  test('Brier scores for tutor and formula on the same items, and the skill between them', () => {
    const r = predictions([p({predicted: 0.9, formula: 0.5, score: 1}), p({predicted: 0.2, formula: 0.5, score: 0}), p({predicted: 0.6, formula: 0.5, score: 0.5, role: 'new'})]);
    expect(r.n).toBe(3);
    expect(r.tutor.brier).toBe(0.02); // (0.01 + 0.04 + 0.01) / 3
    expect(r.formula.brier).toBe(0.167); // (0.25 + 0.25 + 0) / 3
    expect(r.skill).toBe(0.88);
    expect(r.by_role).toEqual([
      {role: 'new', n: 1, tutor_brier: 0.01, formula_brier: 0},
      {role: 'review', n: 2, tutor_brier: 0.025, formula_brier: 0.25},
    ]);
  });

  test('calibration bins in fifths, the top one closed at 1', () => {
    const r = predictions([p({predicted: 1, score: 1}), p({predicted: 0.8, score: 0}), p({predicted: 0.1, score: 0})]);
    expect(r.tutor.bins[4]).toEqual({from: 0.8, to: 1, n: 2, predicted: 0.9, actual: 0.5});
    expect(r.tutor.bins[0]).toEqual({from: 0, to: 0.2, n: 1, predicted: 0.1, actual: 0});
    expect(r.tutor.bins.slice(1, 4).every(b => b.n === 0 && b.predicted === null)).toBe(true);
  });

  test('surprises: sure of a right answer that missed, or of a miss that was right, most recent first', () => {
    const old = p({predicted: 0.95, score: 0, day: '2026-09-10'});
    const recent = p({predicted: 0.1, score: 1, day: '2026-09-20'});
    const r = predictions([old, p({predicted: 0.7, score: 0}), p({predicted: 0.3, score: 0.5}), recent]);
    expect(r.surprises).toEqual([recent, old]);
  });

  test('nothing predicted, nothing to say', () => {
    expect(predictions([])).toMatchObject({n: 0, tutor: {brier: null}, formula: {brier: null}, skill: null, surprises: [], by_week: []});
  });
});

describe('playbook versions', () => {
  test('per version: concepts introduced, their delayed retention, and same-day accuracy on its lessons\' new items', () => {
    const later = [fact({concepts: ['c1'], score: 1}), fact({concepts: ['c1'], score: 0}), fact({concepts: ['c2'], score: 1}), fact({concepts: ['c2'], gap_hours: 2})];
    const outcomes = playbookOutcomes(
      [
        {version: 2, lessons: 1, introduced: ['c2'], same_day: [fact({role: 'new', gap_hours: 0.1, score: 1})]},
        {version: null, lessons: 3, introduced: ['c1'], same_day: [fact({role: 'new', gap_hours: 0.1, score: 0}), fact({role: 'new', gap_hours: 0.1, score: 1})]},
      ],
      later,
      20,
    );
    expect(outcomes).toEqual([
      {version: null, lessons: 3, concepts: 1, retention: {n: 2, rate: 0.5}, same_day_accuracy: {n: 2, rate: 0.5}},
      {version: 2, lessons: 1, concepts: 1, retention: {n: 1, rate: 1}, same_day_accuracy: {n: 1, rate: 1}},
    ]);
  });
});

describe('two-arm experiments', () => {
  const reviews = (concept: string, right: number, wrong: number) => [
    ...Array.from({length: right}, () => fact({concepts: [concept], score: 1})),
    ...Array.from({length: wrong}, () => fact({concepts: [concept], score: 0})),
  ];
  const group = (aConcepts: string[], bConcepts: string[]) => ({
    name: 'worked_vs_problem_first',
    arms: {a: 'worked first', b: 'problem first'},
    status: 'open',
    verdict: null,
    a: {lessons: aConcepts.length, introduced: aConcepts, same_day: [fact({role: 'new', gap_hours: 0.1})]},
    b: {lessons: bConcepts.length, introduced: bConcepts, same_day: []},
  });

  test('per arm: retention of what it introduced; the difference with a 90% interval once both have reviews', () => {
    const [r] = experimentOutcomes([group(['c1'], ['c2'])], [...reviews('c1', 8, 2), ...reviews('c2', 5, 5)], 20);
    expect(r!.a).toMatchObject({description: 'worked first', lessons: 1, concepts: 1, retention: {n: 10, rate: 0.8}, same_day_accuracy: {n: 1, rate: 1}});
    expect(r!.b.retention).toEqual({n: 10, rate: 0.5});
    // 0.3 ± 1.645 × √(0.8·0.2/10 + 0.5·0.5/10)
    expect(r!.difference).toEqual({retention: 0.3, low: -0.033, high: 0.633});
    expect(r!.enough).toBe(true);
  });

  test('too few reviews to say, or none in an arm', () => {
    const [few] = experimentOutcomes([group(['c1'], ['c2'])], [...reviews('c1', 3, 0), ...reviews('c2', 1, 1)], 20);
    expect(few!.enough).toBe(false);
    const [none] = experimentOutcomes([group(['c1'], [])], reviews('c1', 3, 0), 20);
    expect(none!.difference).toBeNull();
  });
});

describe('throughput', () => {
  test('per week: concepts introduced, minutes, their later retention, and retained concepts per hour', () => {
    const weeks = throughput({
      introductions: [
        {concept_id: 'c1', day: '2026-09-14'},
        {concept_id: 'c2', day: '2026-09-15'},
        {concept_id: 'c3', day: '2026-09-22'},
      ],
      minutes: [
        {day: '2026-09-14', minutes: 20},
        {day: '2026-09-16', minutes: 10},
        {day: '2026-09-22', minutes: 15},
      ],
      attempts: [fact({concepts: ['c1'], score: 1, day: '2026-09-18'}), fact({concepts: ['c2'], score: 0, day: '2026-09-18'}), fact({concepts: ['c2'], score: 1, gap_hours: 2})],
      gapHours: 20,
    });
    // Week of the 14th: 2 concepts, 30 minutes, 1 of 2 delayed reviews retained → 2 × 0.5 ÷ 0.5 h.
    expect(weeks).toEqual([
      {week: '2026-09-14', introduced: 2, minutes: 30, retention: {n: 2, rate: 0.5}, retained_per_hour: 2},
      {week: '2026-09-21', introduced: 1, minutes: 15, retention: {n: 0, rate: null}, retained_per_hour: null},
    ]);
  });
});
