/**
 * The shapes the app stores and the JSON it speaks.
 *
 * Field names are snake_case everywhere — in the database, in JSON, and here — so the
 * contract an agent reads is the schema it is stored in. Unset optional fields are
 * `null` in JSON, never absent, so an agent can rely on every key being there.
 */

import type {Figure} from '../blocks/picture.ts';

// --- actors ------------------------------------------------------------------------

/** `you`, or `agent:<name>`. */
export type Actor = string;
export const USER_ACTOR = 'you';
export const TUTOR_ACTOR = 'agent:tutor';
export const BUILDER_ACTOR = 'agent:builder';
export const EXAMINER_ACTOR = 'agent:examiner';
const ACTOR_PATTERN = /^(you|agent:[a-z0-9][a-z0-9_-]{0,39})$/;
export const isActor = (value: string): boolean => ACTOR_PATTERN.test(value);
export const isAgent = (actor: Actor): boolean => actor.startsWith('agent:');

// --- enums -------------------------------------------------------------------------

const oneOf =
  <T extends string>(values: readonly T[]) =>
  (value: unknown): value is T =>
    values.includes(value as T);

export const LEVELS = ['new', 'some', 'solid'] as const;
export type Level = (typeof LEVELS)[number];
export const isLevel = oneOf(LEVELS);

export const SUBJECT_STATUSES = ['active', 'paused', 'archived'] as const;
export type SubjectStatus = (typeof SUBJECT_STATUSES)[number];

export const CONCEPT_STATUSES = ['planned', 'introduced', 'known', 'retired'] as const;
export type ConceptStatus = (typeof CONCEPT_STATUSES)[number];
export const isConceptStatus = oneOf(CONCEPT_STATUSES);

export const LESSON_STATES = ['ready', 'open', 'finished', 'skipped'] as const;
export type LessonState = (typeof LESSON_STATES)[number];
export const isLessonState = oneOf(LESSON_STATES);

export const CONCEPT_ROLES = ['new', 'review', 'deepen'] as const;
export type ConceptRole = (typeof CONCEPT_ROLES)[number];
export const isConceptRole = oneOf(CONCEPT_ROLES);

/** `exam`: a checkup written by the examiner, not the tutor (M12). */
export const QUIZ_KINDS = ['daily', 'placement', 'practice', 'exam'] as const;
export type QuizKind = (typeof QUIZ_KINDS)[number];
export const isQuizKind = oneOf(QUIZ_KINDS);

export const QUIZ_STATES = ['ready', 'open', 'finished', 'superseded', 'skipped'] as const;
export type QuizState = (typeof QUIZ_STATES)[number];

export const ITEM_ROLES = ['new', 'review', 'retry', 'probe', 'exam'] as const;
/** The roles the tutor gives items in a daily quiz. */
export const DAILY_ROLES = ['new', 'review', 'retry'] as const;
export type ItemRole = (typeof ITEM_ROLES)[number];
export const isItemRole = oneOf(ITEM_ROLES);

export const AIMS = ['recall', 'understand', 'apply', 'analyze', 'transfer', 'misconception'] as const;
export type Aim = (typeof AIMS)[number];
export const isAim = oneOf(AIMS);

export const CONFIDENCES = ['sure', 'think', 'guess'] as const;
export type Confidence = (typeof CONFIDENCES)[number];
export const isConfidence = oneOf(CONFIDENCES);

export const ATTEMPT_CONTEXTS = ['lesson', 'quiz', 'practice', 'exam'] as const;
export type AttemptContext = (typeof ATTEMPT_CONTEXTS)[number];
export const isAttemptContext = oneOf(ATTEMPT_CONTEXTS);

export const GRADED_BY = ['app', 'self', 'widget', 'disputed'] as const;
export type GradedBy = (typeof GRADED_BY)[number];

export const RUN_OUTCOMES = ['ok', 'partial', 'failed'] as const;
export type RunOutcome = (typeof RUN_OUTCOMES)[number];
export const isRunOutcome = oneOf(RUN_OUTCOMES);

export const RESOLUTIONS = ['fixed', 'answered', 'noted', 'disagreed'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];
export const isResolution = oneOf(RESOLUTIONS);

// --- rows as JSON ------------------------------------------------------------------

export interface Subject {
  id: string;
  title: string;
  goal: string;
  level: Level;
  minutes_per_day: number;
  days: string;
  note: string;
  status: SubjectStatus;
  added: string;
  changed: string;
}

export interface Concept {
  id: string;
  subject_id: string;
  key: string;
  title: string;
  summary: string;
  prereqs: string[];
  position: number;
  status: ConceptStatus;
  introduced: string | null;
  added: string;
  changed: string;
}

export interface Memory {
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  last_review: string;
  due: string;
}

export interface Block {
  id: string;
  lesson_id: string;
  position: number;
  type: string;
  approach: string;
  concepts: string[];
  body: Record<string, unknown>;
  version: number;
  seen_seconds: number;
  interactions: number;
  completed: boolean;
  errors: number;
  last_error: string | null;
  /** In a two-arm lesson (M14): the arm it belongs to, or null when every learner sees it. */
  arm: 'a' | 'b' | null;
}

export interface Source {
  title: string;
  url: string;
}

export interface Lesson {
  id: string;
  subject_id: string;
  day: string;
  title: string;
  objectives: string[];
  estimated_minutes: number;
  rationale: string;
  hypothesis: string | null;
  verdict: string | null;
  sources: Source[];
  run_id: string | null;
  added_by: Actor;
  state: LessonState;
  added: string;
  opened: string | null;
  finished: string | null;
  active_seconds: number;
  version: number;
  /** The playbook version it was written under (M13); null before the playbook. */
  playbook_version: number | null;
  /** The experiment it is part of (M14), by name; null for most lessons. */
  experiment: string | null;
}

export interface Question {
  id: string;
  subject_id: string;
  lesson_id: string | null;
  type: string;
  aim: Aim;
  prompt: string;
  body: Record<string, unknown>;
  explanation: string;
  hints: string[];
  difficulty: number;
  variant_of: string | null;
  run_id: string | null;
  added_by: Actor;
  /** `exam`: written by the examiner for a checkup; never reused, and hidden from the tutor. */
  status: 'active' | 'retired' | 'exam';
  version: number;
  added: string;
  changed: string;
  concepts: string[];
  /** A picture asked about, shown with the prompt (M19); null for none. */
  figure: Figure | null;
  /** A picture shown with the answer; null for none. */
  answer_figure: Figure | null;
}

export interface Quiz {
  id: string;
  subject_id: string;
  day: string;
  kind: QuizKind;
  lesson_id: string | null;
  rationale: string;
  run_id: string | null;
  added_by: Actor;
  state: QuizState;
  added: string;
  opened: string | null;
  finished: string | null;
}

export interface Attempt {
  id: string;
  question_id: string;
  question_version: number;
  context: AttemptContext;
  lesson_id: string | null;
  quiz_id: string | null;
  role: ItemRole | null;
  attempt_no: number;
  answer: unknown;
  shown_order: string[] | null;
  score: number | null;
  graded_by: GradedBy | null;
  confidence: Confidence;
  hints_used: number;
  seconds: number;
  misconception: string | null;
  gap_hours: number | null;
  counts_for_memory: boolean;
  agent_score: number | null;
  agent_note: string | null;
  void: boolean;
  at: string;
}

export interface Feedback {
  id: string;
  target: string;
  target_id: string;
  kind: string;
  note: string;
  actor: Actor;
  at: string;
  reply: string | null;
  resolved: Resolution | null;
  replied_at: string | null;
}

export interface Run {
  id: string;
  actor: Actor;
  started: string;
  finished: string | null;
  outcome: RunOutcome | null;
  made: Record<string, number>;
  retro: boolean;
  summary: string;
  contract_version: string | null;
}

export interface NoteVersion {
  scope: string;
  version: number;
  body: string;
  actor: Actor;
  note: string;
  at: string;
  /** The version this one restored (a revert), or null. */
  restored_from: number | null;
}
