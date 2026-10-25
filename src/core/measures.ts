/**
 * Measuring learning: what the app computes for the tutor, as pure functions over rows.
 * Computed on read, never stored.
 *
 * The number that matters is retention: whether the learner can still answer about an
 * idea days after meeting it — first try, no hint, not guessing. Same-day accuracy is the
 * difficulty dial. The rest tell the tutor what works for this person; they report n and
 * never declare a winner.
 *
 * New measures are added beside these, never in place of them, so before-and-after
 * comparisons survive (tests/guard/measures.test.ts pins them).
 */

/** One attempt, with what the measures need joined in. */
export interface AttemptFact {
  id: string;
  question_id: string;
  question_type: string;
  aim: string;
  /** The question's concepts, as concept ids. */
  concepts: string[];
  /** `exam`: a checkup answer (M12), only ever in the checkup measure. */
  context: 'lesson' | 'quiz' | 'practice' | 'exam';
  role: string | null;
  attempt_no: number;
  score: number | null;
  confidence: 'sure' | 'think' | 'guess';
  hints_used: number;
  seconds: number;
  misconception: string | null;
  gap_hours: number | null;
  counts_for_memory: boolean;
  void: boolean;
  /** The local day it happened on. */
  day: string;
  at: string;
  answer: unknown;
}

/** A first try that measures something: not void, not a placement probe. */
const firstTry = (a: AttemptFact) => a.attempt_no === 1 && !a.void && a.role !== 'probe' && a.score !== null;

/** "Right, and knew it": score 1, without a hint, not guessing. */
export const retained = (a: AttemptFact) => a.score === 1 && a.confidence !== 'guess' && a.hints_used === 0;

export interface Rate {
  n: number;
  /** null when n is 0. */
  rate: number | null;
}

const rate = (hits: number, n: number): Rate => ({n, rate: n === 0 ? null : Math.round((hits / n) * 1000) / 1000});

/** The ISO week a local day is in, as its Monday: `2026-09-07`. */
export function weekOf(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

// --- retention ---------------------------------------------------------------------

/** Delayed reviews: counted attempts at least `gapHours` after last meeting the idea. */
export const isDelayedReview = (a: AttemptFact, gapHours: number) => a.counts_for_memory && !a.void && a.gap_hours !== null && a.gap_hours >= gapHours && a.score !== null;

export function retention(attempts: readonly AttemptFact[], gapHours: number): Rate {
  const reviews = attempts.filter(a => isDelayedReview(a, gapHours));
  return rate(reviews.filter(retained).length, reviews.length);
}

export function retentionByWeek(attempts: readonly AttemptFact[], gapHours: number): Array<{week: string} & Rate> {
  const weeks = new Map<string, AttemptFact[]>();
  for (const a of attempts) {
    if (!isDelayedReview(a, gapHours)) continue;
    const week = weekOf(a.day);
    (weeks.get(week) ?? weeks.set(week, []).get(week)!).push(a);
  }
  return [...weeks].sort(([a], [b]) => a.localeCompare(b)).map(([week, list]) => ({week, ...rate(list.filter(retained).length, list.length)}));
}

// --- same-day accuracy -------------------------------------------------------------

/** First tries on `new` items (today's lesson): the share with score 1. */
export function sameDayAccuracy(attempts: readonly AttemptFact[]): Rate {
  const tries = attempts.filter(a => firstTry(a) && a.role === 'new');
  return rate(tries.filter(a => a.score === 1).length, tries.length);
}

export function sameDayAccuracyByWeek(attempts: readonly AttemptFact[]): Array<{week: string} & Rate> {
  const weeks = new Map<string, AttemptFact[]>();
  for (const a of attempts) {
    if (!(firstTry(a) && a.role === 'new')) continue;
    const week = weekOf(a.day);
    (weeks.get(week) ?? weeks.set(week, []).get(week)!).push(a);
  }
  return [...weeks].sort(([a], [b]) => a.localeCompare(b)).map(([week, list]) => ({week, ...rate(list.filter(a => a.score === 1).length, list.length)}));
}

// --- calibration -------------------------------------------------------------------

export interface Calibration {
  by_confidence: Record<'sure' | 'think' | 'guess', Rate>;
  /** Sure, and wrong: a misconception, not a slip. Counted by concept id. */
  sure_but_wrong: Array<{concept_id: string; count: number}>;
}

export function calibration(attempts: readonly AttemptFact[]): Calibration {
  const tries = attempts.filter(firstTry);
  const by = (c: 'sure' | 'think' | 'guess') => {
    const list = tries.filter(a => a.confidence === c);
    return rate(list.filter(a => a.score === 1).length, list.length);
  };
  const sureWrong = new Map<string, number>();
  for (const a of tries) {
    if (a.confidence !== 'sure' || (a.score ?? 0) >= 0.5) continue;
    for (const c of a.concepts) sureWrong.set(c, (sureWrong.get(c) ?? 0) + 1);
  }
  return {
    by_confidence: {sure: by('sure'), think: by('think'), guess: by('guess')},
    sure_but_wrong: [...sureWrong].map(([concept_id, count]) => ({concept_id, count})).sort((a, b) => b.count - a.count),
  };
}

// --- misconceptions ----------------------------------------------------------------

export interface MisconceptionCount {
  tag: string;
  count: number;
  last_seen: string;
  concepts: string[];
}

/** Tag → count, last seen, concepts, over the attempts given (the caller picks the window). */
export function misconceptions(attempts: readonly AttemptFact[]): MisconceptionCount[] {
  const tags = new Map<string, MisconceptionCount>();
  for (const a of attempts) {
    if (a.misconception === null || a.void) continue;
    const entry = tags.get(a.misconception) ?? {tag: a.misconception, count: 0, last_seen: a.at, concepts: []};
    entry.count++;
    if (a.at > entry.last_seen) entry.last_seen = a.at;
    for (const c of a.concepts) if (!entry.concepts.includes(c)) entry.concepts.push(c);
    tags.set(a.misconception, entry);
  }
  return [...tags.values()].sort((a, b) => b.count - a.count || b.last_seen.localeCompare(a.last_seen));
}

// --- approach outcomes -------------------------------------------------------------

/** A concept introduced by a lesson, and the approaches its blocks used on that concept. */
export interface Introduction {
  concept_id: string;
  approaches: string[];
}

export interface BlockFact {
  approach: string;
  type: string;
  seen_seconds: number;
  completed: boolean;
  /** Steps and widgets can be completed; text can't. */
  completable: boolean;
  helpful: number;
  confusing: number;
}

export interface ApproachOutcome {
  approach: string;
  /** Concepts introduced by a lesson that used it on them, and their later retention. */
  with: {concepts: number} & Rate;
  /** Concepts introduced without it. */
  without: {concepts: number} & Rate;
  blocks: number;
  median_seen_seconds: number | null;
  completion: Rate | null;
  helpful: number;
  confusing: number;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function approachOutcomes(intros: readonly Introduction[], blocks: readonly BlockFact[], attempts: readonly AttemptFact[], gapHours: number): ApproachOutcome[] {
  const reviewsOf = new Map<string, AttemptFact[]>();
  for (const a of attempts) {
    if (!isDelayedReview(a, gapHours)) continue;
    for (const c of a.concepts) (reviewsOf.get(c) ?? reviewsOf.set(c, []).get(c)!).push(a);
  }
  const approaches = new Set<string>([...intros.flatMap(i => i.approaches), ...blocks.map(b => b.approach)]);
  const outcome = (concepts: readonly Introduction[]) => {
    const reviews = concepts.flatMap(i => reviewsOf.get(i.concept_id) ?? []);
    return {concepts: concepts.length, ...rate(reviews.filter(retained).length, reviews.length)};
  };
  return [...approaches].sort().map(approach => {
    const used = blocks.filter(b => b.approach === approach);
    const completable = used.filter(b => b.completable);
    return {
      approach,
      with: outcome(intros.filter(i => i.approaches.includes(approach))),
      without: outcome(intros.filter(i => !i.approaches.includes(approach))),
      blocks: used.length,
      median_seen_seconds: median(used.map(b => b.seen_seconds)),
      completion: completable.length === 0 ? null : rate(completable.filter(b => b.completed).length, completable.length),
      helpful: used.reduce((sum, b) => sum + b.helpful, 0),
      confusing: used.reduce((sum, b) => sum + b.confusing, 0),
    };
  });
}

// --- question types and aims -------------------------------------------------------

export interface GroupOutcome {
  group: string;
  retention: Rate;
  same_day_accuracy: Rate;
}

export function outcomesBy(attempts: readonly AttemptFact[], key: (a: AttemptFact) => string, gapHours: number): GroupOutcome[] {
  const groups = new Map<string, AttemptFact[]>();
  for (const a of attempts) (groups.get(key(a)) ?? groups.set(key(a), []).get(key(a))!).push(a);
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, list]) => ({group, retention: retention(list, gapHours), same_day_accuracy: sameDayAccuracy(list)}));
}

// --- question stats ----------------------------------------------------------------

export interface QuestionStats {
  attempts: number;
  first_try: Rate;
  median_seconds: number | null;
  /** For choice questions: how often each choice was picked on a first try. */
  picks: Record<string, number> | null;
  /** The tutor's guess (1–5), and what happened, on the same scale. */
  difficulty_guessed: number;
  difficulty_observed: number | null;
}

/** First-try share right → 1 (easy) … 5 (hard). */
export function observedDifficulty(shareRight: number): number {
  if (shareRight >= 0.9) return 1;
  if (shareRight >= 0.75) return 2;
  if (shareRight >= 0.55) return 3;
  if (shareRight >= 0.35) return 4;
  return 5;
}

export function questionStats(attempts: readonly AttemptFact[], difficulty: number, choiceIds: readonly string[] | null): QuestionStats {
  const firsts = attempts.filter(firstTry);
  const right = firsts.filter(a => a.score === 1).length;
  let picks: Record<string, number> | null = null;
  if (choiceIds !== null) {
    picks = Object.fromEntries(choiceIds.map(id => [id, 0]));
    for (const a of firsts) {
      const chosen = Array.isArray(a.answer) ? a.answer : [a.answer];
      for (const id of chosen) if (typeof id === 'string' && Object.hasOwn(picks, id)) picks[id]!++;
    }
  }
  return {
    attempts: attempts.filter(a => !a.void).length,
    first_try: rate(right, firsts.length),
    median_seconds: median(firsts.map(a => a.seconds)),
    picks,
    difficulty_guessed: difficulty,
    difficulty_observed: firsts.length < 3 ? null : observedDifficulty(right / firsts.length),
  };
}

// --- predictions -------------------------------------------------------------------

/** A first try at a quiz item the tutor gave a prediction for. */
export interface PredictionFact {
  attempt_id: string;
  question_id: string;
  role: string;
  concepts: string[];
  day: string;
  /** The tutor's probability that the first try scores 1. */
  predicted: number;
  /**
   * What the formula expected, knowing only what the tutor knew when it wrote the quiz:
   * for an idea with a memory, FSRS recall that day (the lowest over its concepts); for a
   * new one, the subject's recent same-day accuracy. Worked out by the loader.
   */
  formula: number;
  /** The first try's score, 0–1: what both are scored against. */
  score: number;
}

export interface CalibrationBin {
  from: number;
  to: number;
  n: number;
  /** The mean prediction in the bin, and the mean score; null when n is 0. */
  predicted: number | null;
  actual: number | null;
}

export interface Forecast {
  /** The mean squared gap between prediction and score: 0 is perfect, 0.25 is a coin. */
  brier: number | null;
  bins: CalibrationBin[];
}

export interface Predictions {
  n: number;
  tutor: Forecast;
  formula: Forecast;
  /** 1 − tutor Brier ÷ formula Brier: above 0, the tutor knows the learner better than the formula. */
  skill: number | null;
  by_role: Array<{role: string; n: number; tutor_brier: number | null; formula_brier: number | null}>;
  by_week: Array<{week: string; n: number; tutor_brier: number | null; formula_brier: number | null}>;
  /** Confident and wrong about the learner, most recent first: sure of a right answer that missed, or of a miss that was right. */
  surprises: PredictionFact[];
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

function brier(facts: readonly PredictionFact[], pick: (f: PredictionFact) => number): number | null {
  if (facts.length === 0) return null;
  return round3(facts.reduce((sum, f) => sum + (pick(f) - f.score) ** 2, 0) / facts.length);
}

function forecast(facts: readonly PredictionFact[], pick: (f: PredictionFact) => number): Forecast {
  const bins: CalibrationBin[] = [0, 0.2, 0.4, 0.6, 0.8].map(from => {
    const to = round3(from + 0.2);
    const inBin = facts.filter(f => pick(f) >= from && (pick(f) < to || (to === 1 && pick(f) <= 1)));
    const mean = (xs: number[]) => (xs.length === 0 ? null : round3(xs.reduce((a, b) => a + b, 0) / xs.length));
    return {from, to, n: inBin.length, predicted: mean(inBin.map(pick)), actual: mean(inBin.map(f => f.score))};
  });
  return {brier: brier(facts, pick), bins};
}

export const isSurprise = (f: PredictionFact) => (f.predicted >= 0.8 && f.score < 0.5) || (f.predicted <= 0.3 && f.score >= 1);

/** How well the tutor's predictions matched what happened, beside the formula's, on the same items. */
export function predictions(facts: readonly PredictionFact[]): Predictions {
  const tutor = (f: PredictionFact) => f.predicted;
  const formula = (f: PredictionFact) => f.formula;
  const tutorBrier = brier(facts, tutor);
  const formulaBrier = brier(facts, formula);
  const grouped = <K extends string>(key: (f: PredictionFact) => K) => {
    const groups = new Map<K, PredictionFact[]>();
    for (const f of facts) (groups.get(key(f)) ?? groups.set(key(f), []).get(key(f))!).push(f);
    return [...groups].sort(([a], [b]) => a.localeCompare(b));
  };
  return {
    n: facts.length,
    tutor: forecast(facts, tutor),
    formula: forecast(facts, formula),
    skill: tutorBrier === null || formulaBrier === null || formulaBrier === 0 ? null : round3(1 - tutorBrier / formulaBrier),
    by_role: grouped(f => f.role).map(([role, list]) => ({role, n: list.length, tutor_brier: brier(list, tutor), formula_brier: brier(list, formula)})),
    by_week: grouped(f => weekOf(f.day)).map(([week, list]) => ({week, n: list.length, tutor_brier: brier(list, tutor), formula_brier: brier(list, formula)})),
    surprises: facts
      .filter(isSurprise)
      .sort((a, b) => b.day.localeCompare(a.day) || Math.abs(b.predicted - b.score) - Math.abs(a.predicted - a.score))
      .slice(0, 10),
  };
}

// --- checkups (M12) ------------------------------------------------------------------

/** A checkup answer, with what the memory model expected for its concepts that day. */
export interface ExamFact extends AttemptFact {
  /** FSRS recall that day from the reviews counted before the checkup was written (the lowest over its concepts); null without a memory. */
  expected: number | null;
}

export interface ExamOutcomes {
  /** Delayed first tries (at least `gapHours` after last meeting the idea): the share right, unhinted, not guessing. */
  score: Rate;
  /** On the answers the memory model had a memory for: its mean expected recall, and the score on those same answers. */
  expected: number | null;
  score_where_expected: Rate;
  /** score_where_expected − expected. Well below 0: the learner holds less than the tutor's own reviews suggest. */
  gap: number | null;
  by_aim: Array<{aim: string} & Rate>;
  by_week: Array<{week: string; expected: number | null} & Rate>;
}

const mean = (xs: readonly number[]): number | null => (xs.length === 0 ? null : round3(xs.reduce((a, b) => a + b, 0) / xs.length));

/** How the learner did on checkups the tutor never saw, beside what the memory model expected. */
export function examOutcomes(facts: readonly ExamFact[], gapHours: number): ExamOutcomes {
  const counted = facts.filter(f => f.attempt_no === 1 && !f.void && f.score !== null && f.gap_hours !== null && f.gap_hours >= gapHours);
  const known = counted.filter(f => f.expected !== null);
  const score = rate(counted.filter(retained).length, counted.length);
  const scoreWhereExpected = rate(known.filter(retained).length, known.length);
  const expected = mean(known.map(f => f.expected!));
  const groups = <K extends string>(key: (f: ExamFact) => K) => {
    const out = new Map<K, ExamFact[]>();
    for (const f of counted) (out.get(key(f)) ?? out.set(key(f), []).get(key(f))!).push(f);
    return [...out].sort(([a], [b]) => a.localeCompare(b));
  };
  return {
    score,
    expected,
    score_where_expected: scoreWhereExpected,
    gap: expected === null || scoreWhereExpected.rate === null ? null : round3(scoreWhereExpected.rate - expected),
    by_aim: groups(f => f.aim).map(([aim, list]) => ({aim, ...rate(list.filter(retained).length, list.length)})),
    by_week: groups(f => weekOf(f.day)).map(([week, list]) => ({
      week,
      ...rate(list.filter(retained).length, list.length),
      expected: mean(list.filter(f => f.expected !== null).map(f => f.expected!)),
    })),
  };
}

// --- playbook versions (M13) ----------------------------------------------------------

/** The lessons written under one playbook version (null: before the playbook). */
export interface PlaybookGroup {
  version: number | null;
  lessons: number;
  /** Concepts those lessons introduced, as concept ids. */
  introduced: string[];
  /** First tries on the `new` items of their quizzes. */
  same_day: AttemptFact[];
}

export interface PlaybookOutcome {
  version: number | null;
  lessons: number;
  /** Concepts introduced under it, and their retention on later delayed reviews. */
  concepts: number;
  retention: Rate;
  same_day_accuracy: Rate;
}

/**
 * Outcomes by playbook version. Versions follow one another, so this compares before with
 * after — the learner and the subjects change too — and never says a version caused anything.
 */
export function playbookOutcomes(groups: readonly PlaybookGroup[], attempts: readonly AttemptFact[], gapHours: number): PlaybookOutcome[] {
  const reviewsOf = new Map<string, AttemptFact[]>();
  for (const a of attempts) {
    if (!isDelayedReview(a, gapHours)) continue;
    for (const c of a.concepts) (reviewsOf.get(c) ?? reviewsOf.set(c, []).get(c)!).push(a);
  }
  return [...groups]
    .sort((a, b) => (a.version ?? 0) - (b.version ?? 0))
    .map(g => {
      const reviews = g.introduced.flatMap(c => reviewsOf.get(c) ?? []);
      return {version: g.version, lessons: g.lessons, concepts: g.introduced.length, retention: rate(reviews.filter(retained).length, reviews.length), same_day_accuracy: sameDayAccuracy(g.same_day)};
    });
}

// --- two-arm experiments (M14) ---------------------------------------------------------

/** The finished lessons of one arm of an experiment. */
export interface ArmGroup {
  lessons: number;
  /** Concepts they introduced, as concept ids. */
  introduced: string[];
  /** First tries on the `new` items of their quizzes. */
  same_day: AttemptFact[];
}

export interface ExperimentGroup {
  name: string;
  arms: {a: string; b: string};
  status: string;
  verdict: string | null;
  a: ArmGroup;
  b: ArmGroup;
}

export interface ArmOutcome {
  /** How the arm teaches, as the tutor described it. */
  description: string;
  lessons: number;
  concepts: number;
  retention: Rate;
  same_day_accuracy: Rate;
}

export interface ExperimentOutcome {
  name: string;
  status: string;
  verdict: string | null;
  a: ArmOutcome;
  b: ArmOutcome;
  /** Retention of a minus b, with a 90% interval; null until both arms have delayed reviews. */
  difference: {retention: number; low: number; high: number} | null;
  /** Whether both arms have at least `minReviews` delayed reviews. Below that: too few to say. */
  enough: boolean;
}

/**
 * Two-arm experiments: per arm, the concepts its lessons introduced and their retention on
 * later delayed reviews, and same-day accuracy; then the difference with an interval. It
 * reports, and never declares a winner.
 */
export function experimentOutcomes(groups: readonly ExperimentGroup[], attempts: readonly AttemptFact[], gapHours: number, minReviews = 10): ExperimentOutcome[] {
  const reviewsOf = new Map<string, AttemptFact[]>();
  for (const a of attempts) {
    if (!isDelayedReview(a, gapHours)) continue;
    for (const c of a.concepts) (reviewsOf.get(c) ?? reviewsOf.set(c, []).get(c)!).push(a);
  }
  const arm = (g: ArmGroup, description: string): ArmOutcome => {
    const reviews = g.introduced.flatMap(c => reviewsOf.get(c) ?? []);
    return {description, lessons: g.lessons, concepts: g.introduced.length, retention: rate(reviews.filter(retained).length, reviews.length), same_day_accuracy: sameDayAccuracy(g.same_day)};
  };
  return groups.map(g => {
    const a = arm(g.a, g.arms.a);
    const b = arm(g.b, g.arms.b);
    let difference: ExperimentOutcome['difference'] = null;
    if (a.retention.rate !== null && b.retention.rate !== null) {
      const pa = a.retention.rate;
      const pb = b.retention.rate;
      const se = Math.sqrt((pa * (1 - pa)) / a.retention.n + (pb * (1 - pb)) / b.retention.n);
      const d = pa - pb;
      difference = {retention: round3(d), low: round3(d - 1.645 * se), high: round3(d + 1.645 * se)};
    }
    return {name: g.name, status: g.status, verdict: g.verdict, a, b, difference, enough: a.retention.n >= minReviews && b.retention.n >= minReviews};
  });
}

// --- throughput (M15) ------------------------------------------------------------------

export interface ThroughputWeek {
  week: string;
  /** Concepts introduced that week (by the day their lesson was finished). */
  introduced: number;
  /** Minutes spent that week: reading lessons and answering quizzes. */
  minutes: number;
  /** That week's concepts on their later delayed reviews: did they stick? */
  retention: Rate;
  /** Introduced × retention ÷ hours: how much is learned and kept per hour spent. Null until the cohort has reviews. */
  retained_per_hour: number | null;
}

/**
 * How much the learner takes on and keeps, week by week: the measure to push on. More new
 * concepts a week is only progress if they are retained; the floor on retention is the
 * playbook's, not this measure's.
 */
export function throughput(input: {introductions: ReadonlyArray<{concept_id: string; day: string}>; minutes: ReadonlyArray<{day: string; minutes: number}>; attempts: readonly AttemptFact[]; gapHours: number}): ThroughputWeek[] {
  const reviewsOf = new Map<string, AttemptFact[]>();
  for (const a of input.attempts) {
    if (!isDelayedReview(a, input.gapHours)) continue;
    for (const c of a.concepts) (reviewsOf.get(c) ?? reviewsOf.set(c, []).get(c)!).push(a);
  }
  const weeks = new Map<string, {concepts: string[]; minutes: number}>();
  const week = (day: string) => weeks.get(weekOf(day)) ?? weeks.set(weekOf(day), {concepts: [], minutes: 0}).get(weekOf(day))!;
  for (const i of input.introductions) week(i.day).concepts.push(i.concept_id);
  for (const m of input.minutes) week(m.day).minutes += m.minutes;
  return [...weeks]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([w, {concepts, minutes}]) => {
      const reviews = concepts.flatMap(c => reviewsOf.get(c) ?? []);
      const retention = rate(reviews.filter(retained).length, reviews.length);
      const hours = minutes / 60;
      return {
        week: w,
        introduced: concepts.length,
        minutes: Math.round(minutes * 10) / 10,
        retention,
        retained_per_hour: retention.rate === null || hours === 0 ? null : Math.round(((concepts.length * retention.rate) / hours) * 100) / 100,
      };
    });
}

// --- media types (M16) ----------------------------------------------------------------

/** A concept introduced by a lesson, and the block types that taught it there (the arm the learner saw). */
export interface MediaIntroduction {
  concept_id: string;
  types: string[];
}

/** A two-arm experiment, with the block types each arm used. */
export interface ExperimentMedia {
  outcome: ExperimentOutcome;
  a_types: string[];
  b_types: string[];
}

export interface MediaExperiment {
  name: string;
  status: string;
  verdict: string | null;
  /** Retention with the media type minus without it, with a 90% interval. */
  difference: {retention: number; low: number; high: number} | null;
  enough: boolean;
}

export interface MediaOutcome {
  type: string;
  blocks: number;
  /** Concepts introduced with it, and their later retention, against those introduced without it. Confounded: it is chosen for the ideas that need it. */
  with: {concepts: number} & Rate;
  without: {concepts: number} & Rate;
  median_seen_seconds: number | null;
  completion: Rate | null;
  helpful: number;
  confusing: number;
  /** Two-arm experiments where one arm used it and the other didn't: the causal evidence. */
  experiments: MediaExperiment[];
  /** Whether there is enough to judge it: an experiment with `enough`, or 10 delayed reviews each side. */
  ready: boolean;
}

/**
 * What each block type does for this learner: retention of what it taught against what was
 * taught without it, engagement, and — what settles it — the two-arm experiments that set
 * it against an alternative. It reports, and never declares a winner.
 */
export function mediaOutcomes(intros: readonly MediaIntroduction[], blocks: readonly BlockFact[], attempts: readonly AttemptFact[], gapHours: number, experiments: readonly ExperimentMedia[]): MediaOutcome[] {
  const reviewsOf = new Map<string, AttemptFact[]>();
  for (const a of attempts) {
    if (!isDelayedReview(a, gapHours)) continue;
    for (const c of a.concepts) (reviewsOf.get(c) ?? reviewsOf.set(c, []).get(c)!).push(a);
  }
  const outcome = (concepts: readonly MediaIntroduction[]) => {
    const reviews = concepts.flatMap(i => reviewsOf.get(i.concept_id) ?? []);
    return {concepts: concepts.length, ...rate(reviews.filter(retained).length, reviews.length)};
  };
  const types = new Set<string>([...intros.flatMap(i => i.types), ...blocks.map(b => b.type)]);
  types.delete('question');
  return [...types].sort().map(type => {
    const used = blocks.filter(b => b.type === type);
    const completable = used.filter(b => b.completable);
    const tested = experiments.flatMap(e => {
      const inA = e.a_types.includes(type);
      const inB = e.b_types.includes(type);
      if (inA === inB) return [];
      const d = e.outcome.difference;
      const difference = d === null ? null : inA ? d : {retention: round3(-d.retention), low: round3(-d.high), high: round3(-d.low)};
      return [{name: e.outcome.name, status: e.outcome.status, verdict: e.outcome.verdict, difference, enough: e.outcome.enough}];
    });
    const withIt = outcome(intros.filter(i => i.types.includes(type)));
    const without = outcome(intros.filter(i => !i.types.includes(type)));
    return {
      type,
      blocks: used.length,
      with: withIt,
      without,
      median_seen_seconds: median(used.map(b => b.seen_seconds)),
      completion: completable.length === 0 ? null : rate(completable.filter(b => b.completed).length, completable.length),
      helpful: used.reduce((sum, b) => sum + b.helpful, 0),
      confusing: used.reduce((sum, b) => sum + b.confusing, 0),
      experiments: tested,
      ready: tested.some(e => e.enough) || (withIt.n >= 10 && without.n >= 10),
    };
  });
}

// --- load --------------------------------------------------------------------------

export interface DayLoad {
  day: string;
  /** Lesson reading time plus quiz answering time, in minutes. */
  minutes: number;
}

export interface Load {
  budget_minutes: number;
  days: DayLoad[];
  median_minutes: number | null;
  over_budget_days: number;
  lessons_finished: number;
  lessons_skipped: number;
  skip_reasons: Record<string, number>;
}

export function load(input: {budget: number; lessonSeconds: ReadonlyArray<{day: string; seconds: number}>; attempts: readonly AttemptFact[]; finished: number; skipped: number; skipReasons: Record<string, number>}): Load {
  const byDay = new Map<string, number>();
  for (const l of input.lessonSeconds) byDay.set(l.day, (byDay.get(l.day) ?? 0) + l.seconds);
  for (const a of input.attempts) if (a.context !== 'lesson') byDay.set(a.day, (byDay.get(a.day) ?? 0) + a.seconds);
  const days = [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([day, seconds]) => ({day, minutes: Math.round((seconds / 60) * 10) / 10}));
  return {
    budget_minutes: input.budget,
    days,
    median_minutes: median(days.map(d => d.minutes)),
    over_budget_days: days.filter(d => d.minutes > input.budget * 1.25).length,
    lessons_finished: input.finished,
    lessons_skipped: input.skipped,
    skip_reasons: input.skipReasons,
  };
}
