/**
 * The learner's reactions. Structured, because the tutor learns from them: each is one
 * tap, with an optional note. Agents can't create these — that would be the tutor
 * grading itself — but the tutor writes the reply.
 */

export const FEEDBACK_TARGETS = ['lesson', 'block', 'question', 'attempt', 'quiz', 'subject'] as const;
export type FeedbackTarget = (typeof FEEDBACK_TARGETS)[number];

export const LESSON_RATINGS = ['clear', 'confusing', 'too_easy', 'too_hard', 'too_long', 'too_short', 'loved', 'boring'] as const;
export const SKIP_REASONS = ['know_it', 'not_now', 'not_interested'] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export const FEEDBACK_KINDS: Readonly<Record<FeedbackTarget, readonly string[]>> = {
  lesson: [...LESSON_RATINGS, ...SKIP_REASONS.map(r => `skip_${r}`)],
  block: ['helpful', 'confusing', 'wrong', 'broken', 'ask'],
  question: ['ambiguous', 'wrong_key', 'not_taught', 'too_easy', 'too_hard', 'trick', 'great', 'ask'],
  attempt: ['dispute'],
  quiz: ['too_easy', 'too_hard', 'too_long', 'too_short', 'great', 'comment'],
  subject: ['slower', 'faster', 'more_practice', 'more_depth', 'more_examples', 'more_visuals', 'comment'],
};

/** What a person sees on the chip. */
export const FEEDBACK_LABELS: Readonly<Record<string, string>> = {
  clear: 'Clear',
  confusing: 'Confusing',
  too_easy: 'Too easy',
  too_hard: 'Too hard',
  too_long: 'Too long',
  too_short: 'Too short',
  loved: 'Loved it',
  boring: 'Boring',
  skip_know_it: 'I know this',
  skip_not_now: 'Not now',
  skip_not_interested: 'Not interested',
  helpful: 'Helpful',
  wrong: 'Wrong',
  broken: 'Broken',
  ask: 'Ask the tutor',
  ambiguous: 'Ambiguous',
  wrong_key: 'Wrong answer key',
  not_taught: 'Not taught',
  trick: 'Trick question',
  great: 'Great',
  dispute: 'I was right',
  comment: 'Comment',
  slower: 'Slower',
  faster: 'Faster',
  more_practice: 'More practice',
  more_depth: 'More depth',
  more_examples: 'More examples',
  more_visuals: 'More visuals',
};

/** Kinds that are a question to answer, so a note is required. */
export const NEEDS_NOTE = new Set(['ask', 'comment']);

/** Flags the tutor must deal with before writing anything new ("wrong is worse than nothing"). */
export const FIX_FLAGS = new Set(['wrong', 'broken', 'wrong_key', 'ambiguous', 'dispute']);

export const isFeedbackTarget = (value: unknown): value is FeedbackTarget => FEEDBACK_TARGETS.includes(value as FeedbackTarget);

export function feedbackProblem(target: FeedbackTarget, kind: string, note: string): string | undefined {
  const kinds = FEEDBACK_KINDS[target];
  if (!kinds.includes(kind)) return `"${kind}" isn't a reaction to a ${target}; one of ${kinds.join(', ')}`;
  if (NEEDS_NOTE.has(kind) && note.trim() === '') return kind === 'ask' ? 'an ask needs the question: --note "…"' : 'a comment needs a note';
  return undefined;
}
