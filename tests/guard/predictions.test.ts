/**
 * Guard (§11, §17): the predictions measure returns known values on a fixed set. If one of
 * these moves, what "how well the tutor knows the learner" means has changed.
 */
import {expect, test} from 'bun:test';
import {predictions, type PredictionFact} from '../../src/core/measures.ts';

let n = 0;
const fact = (predicted: number, formula: number, score: number, over: Partial<PredictionFact> = {}): PredictionFact => ({
  attempt_id: `g${++n}`,
  question_id: 'q',
  role: 'review',
  concepts: ['c'],
  day: '2026-01-05',
  predicted,
  formula,
  score,
  ...over,
});

const SET = [fact(0.9, 0.8, 1), fact(0.8, 0.9, 0), fact(0.4, 0.6, 1), fact(0.2, 0.85, 0, {role: 'new'}), fact(0.6, 0.85, 0.5, {role: 'new', day: '2026-01-13'})];

test('Brier: the mean squared gap between prediction and first-try score, for the tutor and the formula on the same items', () => {
  const r = predictions(SET);
  expect(r.n).toBe(5);
  expect(r.tutor.brier).toBe(0.212); // (0.01 + 0.64 + 0.36 + 0.04 + 0.01) / 5
  expect(r.formula.brier).toBe(0.371); // (0.04 + 0.81 + 0.16 + 0.7225 + 0.1225) / 5
  expect(r.skill).toBe(0.429); // 1 − 0.212 / 0.371
});

test('surprises: ≥ 0.8 and missed, or ≤ 0.3 and right', () => {
  expect(predictions(SET).surprises.map(s => s.predicted)).toEqual([0.8]);
});

test('by week, as Mondays', () => {
  expect(predictions(SET).by_week.map(w => [w.week, w.n])).toEqual([
    ['2026-01-05', 4],
    ['2026-01-12', 1],
  ]);
});
