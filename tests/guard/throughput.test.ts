/**
 * Guard (§17, M15): throughput returns known values on a fixed history. If these move, what
 * "retained concepts per hour" means has changed.
 */
import {expect, test} from 'bun:test';
import {throughput, type AttemptFact} from '../../src/core/measures.ts';

const review = (concept: string, score: number, over: Partial<AttemptFact> = {}): AttemptFact => ({
  id: `${concept}-${score}-${over.day ?? ''}`,
  question_id: 'q',
  question_type: 'short_text',
  aim: 'recall',
  concepts: [concept],
  context: 'quiz',
  role: 'review',
  attempt_no: 1,
  score,
  confidence: 'sure',
  hints_used: 0,
  seconds: 30,
  misconception: null,
  gap_hours: 48,
  counts_for_memory: true,
  void: false,
  day: '2026-01-09',
  at: '2026-01-09T12:00:00Z',
  answer: 'x',
  ...over,
});

test("introduced × the cohort's delayed retention ÷ hours spent, by ISO week", () => {
  const weeks = throughput({
    introductions: ['a', 'b', 'c', 'd'].map(concept_id => ({concept_id, day: '2026-01-06'})),
    minutes: [{day: '2026-01-06', minutes: 45}, {day: '2026-01-08', minutes: 15}],
    attempts: [review('a', 1), review('b', 1), review('c', 1), review('d', 0), review('a', 1, {confidence: 'guess', day: '2026-01-10'})],
    gapHours: 20,
  });
  // 4 concepts; 3 of 5 delayed reviews retained (a guess doesn't count as retained); 1 hour.
  expect(weeks).toEqual([{week: '2026-01-05', introduced: 4, minutes: 60, retention: {n: 5, rate: 0.6}, retained_per_hour: 2.4}]);
});
