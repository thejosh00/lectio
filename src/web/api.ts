/**
 * The web app's view of the server: the same JSON API the CLI uses, signed in by a
 * session cookie.
 */
import type {Concept, Feedback, Lesson, NoteVersion, Quiz, Run, Subject} from '../core/types.ts';

export type {Concept, Feedback, Lesson, NoteVersion, Quiz, Run, Subject};

export interface WhoAmI {
  actor: string;
  role: string;
  version: string;
  today: string;
  timezone: string;
}

export interface LearnerQuestion {
  id: string;
  type: string;
  prompt: string;
  body: Record<string, unknown>;
  hints: string[];
  graded_by: 'app' | 'self' | 'widget';
  disputable: boolean;
  version: number;
  concepts: string[];
}

export interface Outcome {
  attempt_id: string;
  question_id: string;
  score: number | null;
  graded_by: string | null;
  confidence: string;
  answer: unknown;
  hints_used: number;
  at: string;
  needs_self_grade: boolean;
  disputable: boolean;
  misconception: string | null;
  why: string | null;
  detail: Record<string, boolean> | null;
  key: Record<string, unknown>;
  answer_text: string;
  explanation: string;
  agent_score: number | null;
  agent_note: string | null;
}

export interface QuizProgress {
  total: number;
  answered: number;
  graded: number;
  score: number | null;
  by_role: Record<string, {total: number; answered: number; right: number}>;
}

export interface BlockView {
  id: string;
  lesson_id: string;
  position: number;
  type: string;
  approach: string;
  concepts: string[];
  body: Record<string, unknown>;
  version: number;
  question?: LearnerQuestion;
  answered?: Outcome | null;
}

export interface LessonDetail extends Lesson {
  subject: {id: string; title: string};
  concepts: Array<{key: string; title: string; role: string; status: string}>;
  blocks: BlockView[];
  quiz: {id: string; state: string; kind: string} | null;
  estimate_minutes: number;
  feedback: Feedback[];
}

export interface QuizDetail extends Quiz {
  subject: {id: string; title: string};
  lesson: {id: string; title: string; state: string} | null;
  items: Array<{position: number; role: string; question: LearnerQuestion; answered: Outcome | null}>;
  progress: QuizProgress;
  blocked: string | null;
  estimate_minutes: number;
  concepts: Array<{key: string; title: string}>;
}

export interface TodayQuiz {
  id: string;
  kind: string;
  state: string;
  day: string;
  counts: Record<string, number>;
  estimate_minutes: number;
  progress: QuizProgress;
  blocked: string | null;
}

export interface TodayView {
  day: string;
  subjects: Array<{
    subject: Subject;
    lesson: (Pick<Lesson, 'id' | 'title' | 'day' | 'state' | 'estimated_minutes' | 'objectives'> & {is_today: boolean}) | null;
    quizzes: TodayQuiz[];
    waiting: {why: string; message: string} | null;
    practice_due: number;
  }>;
  replies: Feedback[];
  practice_due: number;
  improvements?: number;
}

export interface Memory {
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  last_review: string;
  due: string;
  recall_now: number;
  is_due: boolean;
}

export interface NoteView {
  scope: string;
  body: string;
  version: number;
  actor: string | null;
  note: string;
  at: string | null;
  learner_lines: string[];
}

export interface Rate {
  n: number;
  rate: number | null;
}

export interface Progress {
  subject: {id: string; title: string} | null;
  retention: Rate;
  retention_by_week: Array<{week: string} & Rate>;
  same_day_accuracy: Rate;
  same_day_accuracy_by_week: Array<{week: string} & Rate>;
  target_accuracy: number;
  calibration: {by_confidence: Record<'sure' | 'think' | 'guess', Rate>; sure_but_wrong: Array<{key: string; count: number}>};
  misconceptions: Array<{tag: string; count: number; last_seen: string; concept_keys: string[]}>;
  approaches: Array<{approach: string; with: {concepts: number} & Rate; without: {concepts: number} & Rate; blocks: number; median_seen_seconds: number | null; completion: Rate | null; helpful: number; confusing: number}>;
  question_types: Array<{group: string; retention: Rate; same_day_accuracy: Rate}>;
  aims: Array<{group: string; retention: Rate; same_day_accuracy: Rate}>;
  load: {budget_minutes: number; days: Array<{day: string; minutes: number}>; median_minutes: number | null; over_budget_days: number; lessons_finished: number; lessons_skipped: number; skip_reasons: Record<string, number>} | null;
  hypotheses: Array<{id: string; day: string; title: string; hypothesis: string; ready_for_verdict: boolean}>;
  concepts: {total: number; introduced: number; known: number; solid: number; due: number};
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function api<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : {'content-type': 'application/json'},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  let parsed: Record<string, unknown>;
  try {
    parsed = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new ApiError(`the server answered ${response.status}`, 1, response.status, {});
  }
  if (parsed['ok'] !== true) throw new ApiError(String(parsed['error'] ?? 'something went wrong'), Number(parsed['code'] ?? 1), response.status, parsed);
  return parsed as T;
}

export const get = <T,>(path: string) => api<T>('GET', path);
export const post = <T,>(path: string, body?: unknown) => api<T>('POST', path, body ?? {});

export const enc = encodeURIComponent;
