/**
 * Guard (§11): the measures return known values on a fixed history. A change that moves
 * one of these numbers has changed what a measure means; new measures go beside the old.
 */
import {expect, test} from 'bun:test';
import {calibration, retention, sameDayAccuracy, type AttemptFact} from '../../src/core/measures.ts';
import {ratingFor, replay} from '../../src/core/memory.ts';

let n = 0;
const fact = (over: Partial<AttemptFact>): AttemptFact => ({
  id: `g${++n}`,
  question_id: 'q',
  question_type: 'short_text',
  aim: 'recall',
  concepts: ['c'],
  context: 'quiz',
  role: 'review',
  attempt_no: 1,
  score: 1,
  confidence: 'sure',
  hints_used: 0,
  seconds: 10,
  misconception: null,
  gap_hours: 72,
  counts_for_memory: true,
  void: false,
  day: '2026-01-05',
  at: '2026-01-05T12:00:00Z',
  answer: 'x',
  ...over,
});

const HISTORY = [
  fact({}),
  fact({score: 0}),
  fact({confidence: 'guess'}),
  fact({hints_used: 2}),
  fact({gap_hours: 3}),
  fact({void: true}),
  fact({role: 'probe', counts_for_memory: false}),
  fact({context: 'lesson', role: null, counts_for_memory: false}),
  fact({role: 'new', gap_hours: 0.1}),
  fact({role: 'new', gap_hours: 0.1, score: 0.5, confidence: 'think'}),
];

test('retention: delayed (≥ 20h), counted first tries; right, unhinted, not guessed', () => {
  expect(retention(HISTORY, 20)).toEqual({n: 4, rate: 0.25});
});

test('same-day accuracy: first tries on new items, score 1', () => {
  expect(sameDayAccuracy(HISTORY)).toEqual({n: 2, rate: 0.5});
});

test('calibration: share right per stated confidence', () => {
  expect(calibration(HISTORY).by_confidence).toEqual({sure: {n: 6, rate: 0.833}, think: {n: 1, rate: 0}, guess: {n: 1, rate: 1}});
});

test('memory ratings and the first FSRS step', () => {
  expect(HISTORY.slice(0, 4).map(a => ratingFor({score: a.score!, confidence: a.confidence, hints_used: a.hints_used}))).toEqual(['good', 'again', 'hard', 'hard']);
  expect(replay([{day: '2026-01-05', at: 'x', rating: 'good'}], 0.9)?.due).toBe('2026-01-08');
});
