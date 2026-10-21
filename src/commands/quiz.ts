/**
 * `lectio quiz` and `lectio practice`: taking a quiz in the terminal.
 *
 * Choices are numbered and text answers are typed. Confidence is s/t/g after the
 * answer, before anything is revealed, and `h` asks for a hint. The reveal prints the
 * explanation. Good enough to learn from — and it makes grading testable through piped
 * stdin before the web app exists.
 */
import {flagValue, type ParsedArgs} from '../core/args.ts';
import {EXIT_ERROR, EXIT_OK, EXIT_USAGE} from '../core/errors.ts';
import {percent, questionText} from './render.ts';
import {CommandUsage, type CommandDef, type CommandIO} from './types.ts';

interface LearnerQ {
  id: string;
  type: string;
  prompt: string;
  body: Record<string, unknown>;
  hints: string[];
  graded_by: string;
}

interface Outcome {
  attempt_id: string;
  score: number | null;
  needs_self_grade: boolean;
  disputable: boolean;
  why: string | null;
  key: Record<string, unknown>;
  answer_text: string;
  explanation: string;
}

interface QuizView {
  id: string;
  kind: string;
  state: string;
  subject: {title: string};
  items: Array<{position: number; role: string; question: LearnerQ; answered: Outcome | null}>;
  progress: {total: number; graded: number; score: number | null; by_role: Record<string, {total: number; right: number}>};
  concepts: Array<{key: string; title: string}>;
  blocked: string | null;
}

class Stopped extends Error {}

type Part = {id: string; md: string};

const CONFIDENCE: Record<string, 'sure' | 'think' | 'guess'> = {s: 'sure', sure: 'sure', t: 'think', think: 'think', g: 'guess', guess: 'guess', guessing: 'guess'};

async function ask(io: CommandIO, prompt: string): Promise<string> {
  const line = await io.readLine(prompt);
  if (line === undefined) throw new Stopped();
  return line.trim();
}

/** The order parts are shown in, when the type shuffles. */
function shownOrder(io: CommandIO, q: LearnerQ): string[] | undefined {
  const ids = (key: string) => (q.body[key] as Part[]).map(p => p.id);
  switch (q.type) {
    case 'multiple_choice':
    case 'multi_select':
      return q.body['shuffle'] === false ? ids('choices') : io.shuffle(ids('choices'));
    case 'ordering':
      return io.shuffle(ids('items'));
    case 'matching':
      return io.shuffle(ids('right'));
    default:
      return undefined;
  }
}

const pickNumbers = (text: string, count: number): number[] | undefined => {
  const parts = text.split(/[\s,]+/).filter(Boolean);
  const numbers = parts.map(Number);
  return numbers.every(n => Number.isInteger(n) && n >= 1 && n <= count) ? numbers : undefined;
};

/** Read an answer in the question's own terms. `h` reveals a hint; undefined asks again. */
async function readAnswer(io: CommandIO, q: LearnerQ, order: string[] | undefined, hints: {used: number}): Promise<unknown> {
  const hint = (): boolean => {
    if (hints.used >= q.hints.length) {
      io.out('  (no more hints)');
      return true;
    }
    io.out(`  hint: ${q.hints[hints.used]}`);
    hints.used++;
    return true;
  };
  const hintNote = q.hints.length > hints.used ? ', h for a hint' : '';
  for (;;) {
    switch (q.type) {
      case 'multiple_choice': {
        const text = await ask(io, `answer (a number${hintNote}): `);
        if (text === 'h' && hint()) continue;
        const n = pickNumbers(text, order!.length);
        if (n?.length === 1) return order![n[0]! - 1];
        break;
      }
      case 'multi_select': {
        const text = await ask(io, `answer (numbers like 1,3${hintNote}): `);
        if (text === 'h' && hint()) continue;
        const n = pickNumbers(text, order!.length);
        if (n !== undefined && new Set(n).size === n.length) return n.map(i => order![i - 1]);
        if (text === '' || text === '-') return [];
        break;
      }
      case 'ordering': {
        const text = await ask(io, `order (all the numbers, first to last${hintNote}): `);
        if (text === 'h' && hint()) continue;
        const n = pickNumbers(text, order!.length);
        if (n !== undefined && n.length === order!.length && new Set(n).size === n.length) return n.map(i => order![i - 1]);
        break;
      }
      case 'matching': {
        const left = q.body['left'] as Part[];
        const out: Record<string, string> = {};
        for (const [i, item] of left.entries()) {
          let picked: string | undefined;
          while (picked === undefined) {
            const text = (await ask(io, `  ${i + 1}. ${item.md} → letter${hintNote}: `)).toLowerCase();
            if (text === 'h') {
              hint();
              continue;
            }
            const index = text.length === 1 ? text.charCodeAt(0) - 97 : -1;
            if (index >= 0 && index < order!.length) picked = order![index];
            else io.out(`  a letter from a to ${String.fromCharCode(96 + order!.length)}`);
          }
          out[item.id] = picked;
        }
        return out;
      }
      case 'cloze': {
        const blanks = q.body['blanks'] as string[];
        const out: Record<string, string> = {};
        for (const k of blanks) {
          let text = await ask(io, `  [${k}]${hintNote}: `);
          while (text === 'h') {
            hint();
            text = await ask(io, `  [${k}]: `);
          }
          out[k] = text;
        }
        return out;
      }
      default: {
        const text = await ask(io, `answer${hintNote}: `);
        if (text === 'h' && hint()) continue;
        if (text !== '') return text;
      }
    }
    io.out('  ?');
  }
}

async function askConfidence(io: CommandIO): Promise<'sure' | 'think' | 'guess'> {
  for (;;) {
    const text = (await ask(io, 'how sure? s(ure) t(hink so) g(uessing): ')).toLowerCase();
    const confidence = CONFIDENCE[text];
    if (confidence !== undefined) return confidence;
  }
}

function showOutcome(io: CommandIO, outcome: Outcome): void {
  if (outcome.score === null) return;
  if (outcome.score >= 1) io.out('  ✓ right');
  else if (outcome.score > 0) io.out(`  ~ partly right (${percent(outcome.score)}). The answer: ${outcome.answer_text}`);
  else io.out(`  ✗ not quite. The answer: ${outcome.answer_text}`);
  if (outcome.why !== null) io.out(`  why not that one: ${outcome.why}`);
  io.out(`  ${outcome.explanation.split('\n').join('\n  ')}`);
}

async function call<T>(io: CommandIO, request: Parameters<CommandIO['call']>[0]): Promise<T> {
  const result = await io.call(request);
  if (result.body['ok'] !== true) throw new QuizError(String(result.body['error']), Number(result.body['code'] ?? EXIT_ERROR));
  return result.body as T;
}

class QuizError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

async function takeQuiz(io: CommandIO, id: string): Promise<void> {
  const quiz = (await call<{quiz: QuizView}>(io, {method: 'POST', path: `/api/quizzes/${encodeURIComponent(id)}/open`})).quiz;
  const pending = quiz.items.filter(i => i.answered === null || i.answered.needs_self_grade);
  io.out(`── ${quiz.subject.title}: ${quiz.kind} quiz, ${quiz.items.length} question${quiz.items.length === 1 ? '' : 's'} ──`);
  for (const item of pending) {
    const q = item.question;
    io.out('');
    io.out(`[${item.position + 1}/${quiz.items.length}]${item.role === 'new' ? '' : ` (${item.role})`}`);
    let outcome = item.answered;
    if (outcome === null) {
      const order = shownOrder(io, q);
      for (const line of questionText(q, order)) io.out(line);
      const hints = {used: 0};
      const started = io.clock();
      for (;;) {
        const answer = await readAnswer(io, q, order, hints);
        const confidence = await askConfidence(io);
        try {
          const result = await call<{outcome: Outcome}>(io, {
            method: 'POST',
            path: '/api/attempts',
            body: {question: q.id, quiz: quiz.id, answer, shown_order: order, confidence, hints_used: hints.used, seconds: Math.round((io.clock() - started) / 1000)},
          });
          outcome = result.outcome;
          break;
        } catch (error) {
          if (error instanceof QuizError && error.code === EXIT_USAGE) {
            io.out(`  ${error.message}`);
            continue;
          }
          throw error;
        }
      }
      showOutcome(io, outcome);
    }
    if (outcome.needs_self_grade) {
      io.out(`  model answer: ${String(outcome.key['model_answer'])}`);
      for (const point of (outcome.key['rubric'] as string[] | undefined) ?? []) io.out(`    • ${point}`);
      const grades: Record<string, string> = {g: 'got_it', p: 'partly', m: 'missed'};
      let grade: string | undefined;
      while (grade === undefined) grade = grades[(await ask(io, 'how did you do? g(ot it) p(artly) m(issed it): ')).toLowerCase()];
      outcome = (await call<{outcome: Outcome}>(io, {method: 'POST', path: `/api/attempts/${outcome.attempt_id}/self-grade`, body: {grade}})).outcome;
      io.out(`  ${outcome.explanation.split('\n').join('\n  ')}`);
    } else if (outcome.disputable) {
      const text = (await ask(io, '  enter to go on, or d if you were right: ')).toLowerCase();
      if (text === 'd') {
        await call(io, {method: 'POST', path: `/api/attempts/${outcome.attempt_id}/dispute`, body: {}});
        io.out('  counted as right, and flagged for your tutor');
      }
    }
  }
  const done = (await call<{quiz: QuizView}>(io, {method: 'GET', path: `/api/quizzes/${encodeURIComponent(quiz.id)}`})).quiz;
  io.out('');
  const roles = Object.entries(done.progress.by_role).map(([role, r]) => `${role} ${r.right}/${r.total}`).join(', ');
  io.out(`done: ${percent(done.progress.score)}${roles ? ` (${roles})` : ''}`);
  if (done.concepts.length > 0) io.out(`touched: ${done.concepts.map(c => c.title).join(', ')}`);
}

async function runAll(io: CommandIO, ids: string[]): Promise<number> {
  try {
    for (const id of ids) await takeQuiz(io, id);
    return EXIT_OK;
  } catch (error) {
    if (error instanceof Stopped) {
      io.out('');
      io.out('stopped; your answers so far are saved. "lectio quiz" picks up where you left off.');
      return EXIT_OK;
    }
    if (error instanceof QuizError) {
      io.out(`lectio: ${error.message}`);
      return error.code;
    }
    throw error;
  }
}

interface TodayQuizzes {
  subjects: Array<{subject: {id: string; title: string}; quizzes: Array<{id: string; state: string; blocked: string | null}>}>;
}

const matchesSubject = (s: {id: string; title: string}, ref: string | undefined) => ref === undefined || s.id.startsWith(ref.toLowerCase()) || s.title.toLowerCase() === ref.toLowerCase();

async function quizCommand(args: ParsedArgs, io: CommandIO, json: boolean): Promise<number> {
  if (json) throw new CommandUsage('lectio quiz is interactive; there is no --json form');
  const ref = args.positional[0];
  if (ref !== undefined && ref !== 'today') return runAll(io, [ref]);
  const today = await call<TodayQuizzes>(io, {method: 'GET', path: '/api/today'});
  const subject = flagValue(args, 'subject');
  const ids: string[] = [];
  const blocked: string[] = [];
  for (const s of today.subjects.filter(s => matchesSubject(s.subject, subject))) {
    for (const q of s.quizzes) {
      if (q.state !== 'ready' && q.state !== 'open') continue;
      if (q.blocked !== null) blocked.push(`${s.subject.title}: ${q.blocked}`);
      else ids.push(q.id);
    }
  }
  if (ids.length === 0) {
    io.out(blocked.length > 0 ? blocked.join('\n') : 'No quiz is waiting. "lectio today" shows what is.');
    return EXIT_OK;
  }
  return runAll(io, ids);
}

async function practiceCommand(args: ParsedArgs, io: CommandIO, json: boolean): Promise<number> {
  if (json) throw new CommandUsage('lectio practice is interactive; there is no --json form');
  const result = await call<{practice: Array<{quiz: {id: string} | null; subject: {title: string}}>}>(io, {
    method: 'POST',
    path: '/api/practice',
    body: {subject: flagValue(args, 'subject'), max: flagValue(args, 'max')},
  });
  const ids = result.practice.flatMap(p => (p.quiz === null ? [] : [p.quiz.id]));
  if (ids.length === 0) {
    io.out('Nothing is due for review. Nice.');
    return EXIT_OK;
  }
  return runAll(io, ids);
}

const notDirect = () => {
  throw new CommandUsage('interactive');
};

export const quizCommands: CommandDef[] = [
  {
    name: 'quiz',
    audience: 'learner',
    summary: "take today's quiz (or any quiz) in the terminal",
    usage: 'lectio quiz [today|<quiz>] [--subject …]',
    values: ['subject'],
    build: notDirect,
    human: () => '',
    interactive: quizCommand,
  },
  {
    name: 'practice',
    audience: 'learner',
    summary: 'review what is due, now',
    usage: 'lectio practice [--subject …] [--max N]',
    values: ['subject', 'max'],
    build: notDirect,
    human: () => '',
    interactive: practiceCommand,
  },
];
