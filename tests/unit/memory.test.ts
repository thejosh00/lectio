/**
 * The memory model against FSRS-6 reference values (ts-fsrs 5.4.2, pinned; default
 * parameters, fuzz off, no short-term steps). The first-review values follow directly
 * from the published formulas: S₀ = w[G−1], D₀ = w₄ − e^{w₅(G−1)} + 1, and at 90%
 * desired retention the interval is S, rounded, kept in again < hard < good < easy order.
 */
import {describe, expect, test} from 'bun:test';
import {default_w} from 'ts-fsrs';
import {ratingFor, recallOn, replay} from '../../src/core/memory.ts';

const day = (d: string, rating: 'again' | 'hard' | 'good' | 'easy') => ({day: d, at: `${d}T15:00:00Z`, rating});

describe('ratings from attempts', () => {
  test('wrong is Again; partly, hinted or guessed is Hard; clean is Good; Easy is never inferred', () => {
    expect(ratingFor({score: 0, confidence: 'sure', hints_used: 0})).toBe('again');
    expect(ratingFor({score: 0.49, confidence: 'sure', hints_used: 0})).toBe('again');
    expect(ratingFor({score: 0.5, confidence: 'sure', hints_used: 0})).toBe('hard');
    expect(ratingFor({score: 1, confidence: 'sure', hints_used: 1})).toBe('hard');
    expect(ratingFor({score: 1, confidence: 'guess', hints_used: 0})).toBe('hard');
    expect(ratingFor({score: 1, confidence: 'think', hints_used: 0})).toBe('good');
    expect(ratingFor({score: 1, confidence: 'sure', hints_used: 0})).toBe('good');
  });
});

describe('FSRS-6 reference vectors', () => {
  test('the default parameters are the published FSRS-6 ones', () => {
    expect(default_w.slice(0, 4)).toEqual([0.212, 1.2931, 2.3065, 8.2956]);
    expect(default_w[20]).toBe(0.1542);
  });

  test('a first review: stability, difficulty and due date per rating', () => {
    const d0 = (g: number) => default_w[4]! - Math.exp(default_w[5]! * (g - 1)) + 1;
    const cases = [
      ['again', 0.212, d0(1), '2026-09-13'],
      ['hard', 1.2931, d0(2), '2026-09-14'],
      ['good', 2.3065, d0(3), '2026-09-15'],
      ['easy', 8.2956, d0(4), '2026-09-20'],
    ] as const;
    for (const [rating, stability, difficulty, due] of cases) {
      const state = replay([day('2026-09-12', rating)], 0.9)!;
      expect(state.stability).toBeCloseTo(stability, 6);
      expect(state.difficulty).toBeCloseTo(Math.min(10, Math.max(1, difficulty)), 4);
      expect(state.due).toBe(due);
      expect(state).toMatchObject({reps: 1, lapses: 0, last_review_day: '2026-09-12'});
    }
  });

  test('a second review on time grows stability; a lapse shrinks it', () => {
    const grown = replay([day('2026-09-12', 'good'), day('2026-09-14', 'good')], 0.9)!;
    expect(grown.stability).toBeCloseTo(10.96433194, 6);
    expect(grown.difficulty).toBeCloseTo(2.11121424, 6);
    expect(grown.due).toBe('2026-09-25');
    const lapsed = replay([day('2026-09-12', 'good'), day('2026-09-14', 'again')], 0.9)!;
    expect(lapsed.stability).toBeCloseTo(0.6075801, 6);
    expect(lapsed).toMatchObject({reps: 2, lapses: 1, due: '2026-09-15'});
  });

  test('recall now is the forgetting curve: 100% on the day, 90% at t = S', () => {
    const state = replay([day('2026-09-12', 'good')], 0.9)!;
    expect(recallOn(state, '2026-09-12')).toBe(1);
    expect(recallOn(state, '2026-09-14')).toBeCloseTo(0.90949326, 6);
    const factor = 0.9 ** (-1 / 0.1542) - 1;
    expect(recallOn(state, '2026-09-20')).toBeCloseTo((1 + (factor * 8) / 2.3065) ** -0.1542, 6);
  });

  test('a lower desired retention spaces reviews further apart', () => {
    const strict = replay([day('2026-09-12', 'good'), day('2026-09-15', 'good')], 0.95)!;
    const loose = replay([day('2026-09-12', 'good'), day('2026-09-15', 'good')], 0.8)!;
    expect(loose.due > strict.due).toBe(true);
  });

  test('no reviews, no memory', () => {
    expect(replay([], 0.9)).toBeNull();
  });
});
