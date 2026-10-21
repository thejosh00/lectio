/**
 * The question interface. Each question type is one module in this directory with a
 * pure `validate` and a pure `grade`. Grading happens on the server, so the CLI and the
 * web grade identically; the learner's view of a question never carries its key.
 */
import type {Result} from '../core/validate.ts';

export interface GradeResult {
  /** 0–1; null while a free response waits to be self-graded. */
  score: number | null;
  /** The tag on the wrong choice they picked, if it had one. */
  misconception: string | null;
  /** Why the choice they picked is wrong, when the question says. */
  why: string | null;
  /** Per-part results where a question has parts (cloze blanks, matches), for the reveal. */
  detail: Record<string, boolean> | null;
}

export interface QuestionType<Body, Answer> {
  type: string;
  /** Documentation only: when it ships. */
  milestone: string;
  gradedBy: 'app' | 'self' | 'widget';
  /** A miss offers "I was right": typed answers, where the key may be too narrow. */
  disputable: boolean;
  /** One line for the contract: the body's shape. */
  shape: string;
  /** One line for the contract: what an answer looks like. */
  answerShape: string;
  validate(body: unknown, path: string): Result<Body>;
  /** The body as the learner sees it before answering: no key, no tags, no whys. */
  learnerBody(body: Body): Record<string, unknown>;
  /** The key, shown after answering. */
  reveal(body: Body): Record<string, unknown>;
  /** The ids a `shown_order` must be a permutation of; null when nothing is shuffled. */
  orderIds(body: Body): string[] | null;
  readAnswer(answer: unknown, body: Body, path: string): Result<Answer>;
  grade(body: Body, answer: Answer): GradeResult;
  /** The question in the terminal, without the key. */
  plainText(body: Body): string;
  /** The right answer, as text. */
  answerText(body: Body): string;
}

export const graded = (score: number | null, extra: Partial<GradeResult> = {}): GradeResult => ({
  score,
  misconception: extra.misconception ?? null,
  why: extra.why ?? null,
  detail: extra.detail ?? null,
});

/** Ids of choices, items and blanks: short, so the tutor can write them by hand. */
export const PART_ID = /^[A-Za-z0-9_-]{1,24}$/;
export const PART_ID_MESSAGE = 'must be a short id: letters, digits, - and _';
