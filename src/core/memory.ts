/**
 * How well an idea is remembered: an FSRS memory state per concept, not per question.
 * The tutor writes fresh variants for review, and remembering the idea is what matters,
 * not remembering one phrasing.
 *
 * Memory is a replay of a concept's counted attempts, in order, so voiding a question or
 * upholding a dispute changes it exactly as if the history had been right all along.
 * FSRS sees each review at noon UTC on its local day, which makes every interval a whole
 * number of days whatever the time zone. Pure: the scheduler is `ts-fsrs`, pinned, with
 * fuzz off so the same history always gives the same due date.
 */
import {createEmptyCard, default_w, forgetting_curve, fsrs, generatorParameters, Rating, type Card, type Grade} from 'ts-fsrs';
import {daysBetween} from './time.ts';
import type {Confidence} from './types.ts';

export type MemoryRating = 'again' | 'hard' | 'good' | 'easy';

const GRADES: Record<MemoryRating, Grade> = {again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy};

/**
 * The FSRS rating an attempt earns. Wrong is Again; partly right, right with a hint, or
 * right but guessing is Hard; right without help is Good. Easy is never inferred.
 */
export function ratingFor(attempt: {score: number; confidence: Confidence; hints_used: number}): MemoryRating {
  if (attempt.score < 0.5) return 'again';
  if (attempt.score < 1 || attempt.hints_used > 0 || attempt.confidence === 'guess') return 'hard';
  return 'good';
}

export interface Review {
  /** The local day it happened on. */
  day: string;
  /** The moment, kept as the memory's `last_review`. */
  at: string;
  rating: MemoryRating;
}

export interface MemoryState {
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  last_review: string;
  last_review_day: string;
  /** The local date of the next review. */
  due: string;
}

const noon = (day: string) => new Date(`${day}T12:00:00Z`);

/** Replay reviews (oldest first, at most one a day) into a memory state; null if none. */
export function replay(reviews: readonly Review[], desiredRetention: number): MemoryState | null {
  const first = reviews[0];
  if (first === undefined) return null;
  const scheduler = fsrs(generatorParameters({request_retention: desiredRetention, enable_fuzz: false, enable_short_term: false}));
  let card: Card = createEmptyCard(noon(first.day));
  for (const review of reviews) card = scheduler.next(card, noon(review.day), GRADES[review.rating]).card;
  const last = reviews[reviews.length - 1]!;
  return {
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    last_review: last.at,
    last_review_day: last.day,
    due: card.due.toISOString().slice(0, 10),
  };
}

/** The probability of recalling it on `day` (FSRS retrievability), 0–1. */
export function recallOn(memory: {stability: number; last_review_day: string}, day: string): number {
  const elapsed = Math.max(0, daysBetween(memory.last_review_day, day));
  return forgetting_curve(default_w, elapsed, memory.stability);
}
