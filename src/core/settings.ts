/**
 * Every setting an instance has, its default, and how to check a new value.
 *
 * Settings live in the instance's database. Only the learner changes them; the caps
 * here are what keep the tutor from piling up work.
 */
import {allowedHostsProblem} from '../server/hostCheck.ts';
import {isTimeZone} from './time.ts';

export interface SettingSpec {
  default: string | undefined;
  summary: string;
  /** An error message, or undefined if the value is fine. Values arrive trimmed. */
  validate?: (value: string) => string | undefined;
}

const integer = (min: number, max = Number.MAX_SAFE_INTEGER) => (value: string) =>
  /^\d+$/.test(value) && Number(value) >= min && Number(value) <= max ? undefined : `must be a whole number from ${min}${max === Number.MAX_SAFE_INTEGER ? ' up' : ` to ${max}`}`;
const fraction = (value: string) => (/^(0(\.\d+)?|1(\.0+)?)$/.test(value) && Number(value) > 0 ? undefined : 'must be a number between 0 and 1');

export const SETTINGS: Record<string, SettingSpec> = {
  listen_host: {
    default: '127.0.0.1',
    summary: 'where `lectio serve` listens: 127.0.0.1 (this machine only) or 0.0.0.0 (your network too; add names to allowed_hosts)',
  },
  allowed_hosts: {
    default: undefined,
    summary: "comma-separated host names the server answers to besides localhost, e.g. your Mac's name.local for the phone",
    validate: allowedHostsProblem,
  },
  timezone: {
    default: undefined,
    summary: 'the time zone "today" is in (default: the system\'s), e.g. Europe/London',
    validate: value => (isTimeZone(value) ? undefined : 'must be an IANA time zone, e.g. America/Chicago'),
  },
  lesson_ready_hour: {default: '5', summary: "local hour from which today's lessons may be written", validate: integer(0, 23)},
  quiz_max_questions: {default: '12', summary: 'questions in one quiz', validate: integer(1)},
  lesson_max_blocks: {default: '40', summary: 'blocks in one lesson', validate: integer(1)},
  lesson_max_bytes: {default: '1000000', summary: 'a whole lesson submission, in bytes', validate: integer(1000)},
  widget_max_bytes: {default: '300000', summary: "one widget's HTML, in bytes", validate: integer(1000)},
  asset_max_bytes: {default: '25000000', summary: 'one uploaded asset, in bytes', validate: integer(1000)},
  notes_max_bytes: {default: '8192', summary: 'the learner notes, and each subject plan, in bytes', validate: integer(256)},
  practice_max: {default: '10', summary: 'questions in a practice quiz', validate: integer(1)},
  target_accuracy: {default: '0.85', summary: 'same-day first-try accuracy the tutor aims for', validate: fraction},
  desired_retention: {default: '0.9', summary: 'the recall probability reviews are scheduled for (FSRS)', validate: fraction},
  memory_gap_hours: {default: '20', summary: 'hours since last meeting a concept for a review to count as delayed', validate: integer(1)},
  context_days: {default: '30', summary: "how far back the tutor's context has detail; older is aggregates only", validate: integer(1)},
  chrome_path: {default: undefined, summary: 'Chrome, for `widget check --frames` (default: the standard macOS location)'},
  proposals_per_run: {default: '2', summary: 'new proposals one tutor run may file (support does not count)', validate: integer(0)},
  proposals_open_max: {default: '8', summary: 'open, deferred or needs-info proposals from one agent at once', validate: integer(1)},
  build_wip_max: {default: '1', summary: 'proposals building or in review at once', validate: integer(1)},
  retro_days: {default: '7', summary: "days between the tutor's retrospectives", validate: integer(1)},
  outcome_days: {default: '14', summary: 'days after shipping before a proposal without an outcome is overdue for one', validate: integer(1)},
  exam_days: {default: '7', summary: "days between a subject's checkups from the examiner", validate: integer(1)},
  exam_max_questions: {default: '8', summary: 'questions (and concepts) in one checkup', validate: integer(1)},
  exam_min_age_days: {default: '3', summary: 'days since a concept was introduced before a checkup may ask about it', validate: integer(0)},
  exam_expire_days: {default: '3', summary: "days a checkup waits to be finished before it's skipped", validate: integer(1)},
};

export function settingSpec(key: string): SettingSpec | undefined {
  return Object.hasOwn(SETTINGS, key) ? SETTINGS[key] : undefined;
}
