/**
 * The examiner's commands (M12): which subjects are due a checkup, drawing one, and
 * writing it. Run with `--as agent:examiner`.
 */
import {flagValue} from '../core/args.ts';
import type {Quiz} from '../core/types.ts';
import {jsonInput} from './tutor.ts';
import {CommandUsage, type CommandDef} from './types.ts';

const enc = encodeURIComponent;

function need(value: string | undefined, usage: string): string {
  if (value === undefined || value.trim() === '') throw new CommandUsage(`usage: ${usage}`);
  return value;
}

export const examCommands: CommandDef[] = [
  {
    name: 'exam due',
    audience: 'examiner',
    summary: 'which subjects are due a checkup, and flags on your checkup questions to fix first',
    usage: 'lectio exam due',
    build: () => ({method: 'GET', path: '/api/exams/due'}),
    human: body => {
      const subjects = body['subjects'] as Array<{title: string; why: string}>;
      const waiting = body['waiting'] as Array<{title: string; message: string}>;
      const flags = body['flags'] as Array<{id: string; kind: string; note: string; question: {prompt: string} | null}>;
      return [
        body['due'] === true ? 'due:' : 'nothing due',
        ...subjects.map(s => `  ${s.title}: ${s.why === 'unwritten' ? "today's draw is waiting to be written" : 'a checkup'}`),
        ...flags.map(f => `  flag ${f.id} (${f.kind})${f.question === null ? '' : `: ${f.question.prompt.slice(0, 80)}`}${f.note ? ` — ${f.note}` : ''}`),
        ...waiting.map(w => `  ${w.title}: ${w.message}`),
      ];
    },
  },
  {
    name: 'exam start',
    audience: 'examiner',
    summary: "draw today's checkup for a subject (the app picks the concepts) and read what you may know about them",
    usage: 'lectio exam start <subject> --run <run>',
    values: ['run'],
    build: args => ({method: 'POST', path: '/api/exams/start', body: {subject: need(args.positional.join(' '), 'lectio exam start <subject> --run <run>'), run: flagValue(args, 'run')}}),
    human: body => {
      const context = body['context'] as {subject: {title: string}; concepts: Array<{key: string; title: string; objectives: string[]}>};
      return [
        `${body['existing'] === true ? 'already drawn' : 'drawn'}: ${context.subject.title}, ${context.concepts.length} concepts`,
        ...context.concepts.map(c => `  ${c.key}: ${c.title}${c.objectives.length > 0 ? ` (${c.objectives.join('; ')})` : ''}`),
      ];
    },
  },
  {
    name: 'exam submit',
    audience: 'examiner',
    summary: "write today's checkup: a question or more on every drawn concept, none on any other (idempotent by day)",
    usage: 'lectio exam submit <subject> --run <run> --file exam.json | --stdin',
    values: ['run', 'file'],
    booleans: ['stdin'],
    build: async (args, io) => ({
      method: 'POST',
      path: `/api/subjects/${enc(need(args.positional.join(' '), 'lectio exam submit <subject> --run <run> --file exam.json'))}/exams`,
      body: {run: flagValue(args, 'run'), exam: await jsonInput(args, io, 'checkup')},
    }),
    human: body => `${body['existing'] === true ? 'already written' : 'submitted'}: checkup ${(body['quiz'] as Quiz).id} (${(body['question_ids'] as string[]).length} questions)`,
  },
];
