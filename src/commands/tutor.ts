/**
 * The tutor's commands. Everything takes `--json`; the human text is for trying them by
 * hand.
 */
import {flagList, flagValue, hasFlag, type ParsedArgs} from '../core/args.ts';
import type {Concept, Lesson, Quiz, Run} from '../core/types.ts';
import {conceptLine, lessonText, percent} from './render.ts';
import {CommandUsage, type CommandDef, type CommandIO} from './types.ts';

const enc = encodeURIComponent;

function need(value: string | undefined, usage: string): string {
  if (value === undefined || value.trim() === '') throw new CommandUsage(`usage: ${usage}`);
  return value;
}

/** The JSON a command was given with `--file <path>` or `--stdin`. */
export async function jsonInput(args: ParsedArgs, io: CommandIO, what: string): Promise<unknown> {
  const file = flagValue(args, 'file');
  if (file === undefined && !hasFlag(args, 'stdin')) throw new CommandUsage(`give the ${what} JSON with --file <path> or --stdin`);
  let text: string;
  try {
    text = file === undefined ? await io.readStdin() : await io.readFile(file);
  } catch (error) {
    throw new CommandUsage(`can't read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CommandUsage(`the ${what} isn't valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function textInput(args: ParsedArgs, io: CommandIO): Promise<string> {
  if (!hasFlag(args, 'stdin')) throw new CommandUsage('send the text on stdin: --stdin');
  return io.readStdin();
}

const warnings = (body: Record<string, unknown>) => ((body['warnings'] as string[] | undefined) ?? []).map(w => `  warning: ${w}`);

export const tutorCommands: CommandDef[] = [
  {
    name: 'due',
    audience: 'tutor',
    summary: 'whether the tutor has anything to do, and why (the otto check script runs this)',
    usage: 'lectio due --json',
    build: () => ({method: 'GET', path: '/api/due'}),
    human: body => {
      const subjects = body['subjects'] as Array<{title: string; reasons: string[]}>;
      const waiting = body['waiting'] as Array<{title: string; message: string}>;
      const reviews = (body['reviews'] as Array<{number: number; title: string; status: string}> | undefined) ?? [];
      return [
        body['due'] === true ? 'due:' : 'nothing due',
        ...subjects.map(s => `  ${s.title}: ${s.reasons.join(', ')}`),
        ...reviews.map(r => `  #${r.number} ${r.title}: built${r.status === 'shipped' ? ' and shipped' : ''}, waiting for your review`),
        ...(waiting.length === 0 ? [] : ['waiting:', ...waiting.map(w => `  ${w.title}: ${w.message}`)]),
      ];
    },
  },
  {
    name: 'context',
    audience: 'tutor',
    summary: 'everything a tutor run needs, in one call',
    usage: 'lectio context [--subject …] --json',
    values: ['subject'],
    build: args => ({method: 'GET', path: '/api/context', query: {subject: flagValue(args, 'subject')}}),
    human: body => {
      const subjects = body['subjects'] as Array<{subject: {title: string}; concepts: unknown[]; measures: {retention: {rate: number | null; n: number}}}>;
      return [
        `today: ${String(body['today'])}  since last run: ${String(body['since_last_run'])}`,
        ...subjects.map(s => `  ${s.subject.title}: ${s.concepts.length} concepts, retention ${percent(s.measures.retention.rate)} of ${s.measures.retention.n}`),
        `flags: ${(body['unresolved_flags'] as unknown[]).length}, asks: ${(body['unanswered_asks'] as unknown[]).length}, re-grades: ${(body['regrade'] as unknown[]).length}`,
        'use --json for the whole context',
      ];
    },
  },
  {
    name: 'run start',
    audience: 'tutor',
    summary: 'start a tutor run (one open run at a time; a recent one is resumed)',
    usage: 'lectio run start --json',
    build: () => ({method: 'POST', path: '/api/runs'}),
    human: body => `${body['resumed'] === true ? 'resumed' : 'started'} run ${(body['run'] as Run).id}`,
  },
  {
    name: 'run finish',
    audience: 'tutor',
    summary: 'finish a run: its outcome, what it made, and a 2–3 sentence summary',
    usage: 'lectio run finish <run> --outcome ok|partial|failed --made \'{"lessons":1,…}\' --summary "…" [--retro]',
    values: ['outcome', 'made', 'summary'],
    booleans: ['retro'],
    build: args => {
      const made = flagValue(args, 'made');
      let parsed: unknown;
      try {
        parsed = made === undefined ? undefined : JSON.parse(made);
      } catch {
        throw new CommandUsage('--made must be a JSON object of counts');
      }
      return {
        method: 'POST',
        path: `/api/runs/${enc(need(args.positional[0], 'lectio run finish <run> --outcome …'))}/finish`,
        body: {outcome: flagValue(args, 'outcome'), made: parsed, summary: flagValue(args, 'summary'), retro: hasFlag(args, 'retro')},
      };
    },
    human: body => `finished run ${(body['run'] as Run).id}: ${(body['run'] as Run).outcome}`,
  },
  {
    name: 'concepts',
    audience: 'anyone',
    summary: "a subject's syllabus, with memory",
    usage: 'lectio concepts <subject>',
    build: args => ({method: 'GET', path: `/api/subjects/${enc(need(args.positional.join(' '), 'lectio concepts <subject>'))}/concepts`}),
    human: body => (body['concepts'] as Array<Parameters<typeof conceptLine>[0]>).map(conceptLine),
  },
  {
    name: 'concepts upsert',
    audience: 'tutor',
    summary: 'add, reorder, retire or mark known the concepts of a subject (idempotent by key; never deletes)',
    usage: 'lectio concepts upsert <subject> --file concepts.json | --stdin',
    values: ['file'],
    booleans: ['stdin'],
    build: async (args, io) => ({
      method: 'POST',
      path: `/api/subjects/${enc(need(args.positional.join(' '), 'lectio concepts upsert <subject> --file concepts.json'))}/concepts`,
      body: {concepts: await jsonInput(args, io, 'concepts')},
    }),
    human: body => {
      const concepts = body['concepts'] as Concept[];
      const n = (key: string) => (body[key] as string[]).length;
      return [`${n('created')} added, ${n('updated')} changed, ${n('unchanged')} unchanged`, ...concepts.map(c => conceptLine(c))];
    },
  },
  {
    name: 'plan set',
    audience: 'tutor',
    summary: "rewrite the plan for a subject (a new version; the learner's lines stay)",
    usage: 'lectio plan set <subject> --stdin --note "<what changed and why>"',
    values: ['note'],
    booleans: ['stdin'],
    build: async (args, io) => ({method: 'PUT', path: '/api/notes', body: {subject: need(args.positional.join(' '), 'lectio plan set <subject> --stdin --note "…"'), body: await textInput(args, io), note: flagValue(args, 'note')}}),
    human: body => (body['changed'] === true ? `saved plan v${(body['notes'] as {version: number}).version}` : 'no change'),
  },
  {
    name: 'notes set',
    audience: 'tutor',
    summary: 'rewrite the notes on how the learner learns (a new version)',
    usage: 'lectio notes set --stdin --note "<what changed and why>"',
    values: ['note'],
    booleans: ['stdin'],
    build: async (args, io) => ({method: 'PUT', path: '/api/notes', body: {body: await textInput(args, io), note: flagValue(args, 'note')}}),
    human: body => (body['changed'] === true ? `saved notes v${(body['notes'] as {version: number}).version}` : 'no change'),
  },
  {
    name: 'lesson submit',
    audience: 'tutor',
    summary: "write today's lesson for a subject (refused unless the subject is ready; idempotent by day)",
    usage: 'lectio lesson submit <subject> --day <date> --run <run> --file lesson.json | --stdin',
    values: ['day', 'run', 'file'],
    booleans: ['stdin'],
    build: async (args, io) => ({
      method: 'POST',
      path: `/api/subjects/${enc(need(args.positional.join(' '), 'lectio lesson submit <subject> --day <date> --run <run> --file lesson.json'))}/lessons`,
      body: {day: flagValue(args, 'day'), run: flagValue(args, 'run'), lesson: await jsonInput(args, io, 'lesson')},
    }),
    human: body => {
      const lesson = body['lesson'] as Lesson;
      return [`${body['existing'] === true ? 'already written' : 'submitted'}: ${lesson.title} (${lesson.id}, ${lesson.day})`, ...warnings(body)];
    },
  },
  {
    name: 'asset put',
    audience: 'tutor',
    summary: 'store an image (SVG, PNG, JPEG, GIF, WebP) for an image block; prints its id (idempotent by content)',
    usage: 'lectio asset put <file>',
    build: async (args, io) => {
      const file = need(args.positional[0], 'lectio asset put <file>');
      let data: Uint8Array;
      try {
        data = await io.readBytes(file);
      } catch (error) {
        throw new CommandUsage(`can't read ${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
      return {method: 'POST', path: '/api/assets', body: {data_base64: Buffer.from(data).toString('base64')}};
    },
    human: body => {
      const asset = body['asset'] as {id: string; mime: string; bytes: number};
      return [`${body['existing'] === true ? 'already stored' : 'stored'}: ${asset.id} (${asset.mime}, ${asset.bytes} bytes)`];
    },
  },
  {
    name: 'lesson revise',
    audience: 'tutor',
    summary: "replace a lesson's content while it hasn't been opened",
    usage: 'lectio lesson revise <lesson> --file lesson.json | --stdin',
    values: ['file'],
    booleans: ['stdin'],
    build: async (args, io) => ({method: 'PUT', path: `/api/lessons/${enc(need(args.positional[0], 'lectio lesson revise <lesson> --file lesson.json'))}`, body: {lesson: await jsonInput(args, io, 'lesson')}}),
    human: body => [`revised: ${(body['lesson'] as Lesson).title} (v${(body['lesson'] as Lesson).version})`, ...warnings(body)],
  },
  {
    name: 'lesson show',
    audience: 'anyone',
    summary: 'one lesson, whole (agents see question keys)',
    usage: 'lectio lesson show <lesson>',
    build: args => ({method: 'GET', path: `/api/lessons/${enc(need(args.positional[0], 'lectio lesson show <lesson>'))}`}),
    human: body => lessonText(body['lesson'] as Parameters<typeof lessonText>[0]),
  },
  {
    name: 'lesson verdict',
    audience: 'tutor',
    summary: "record what a lesson's hypothesis turned out to be",
    usage: 'lectio lesson verdict <lesson> --note "<what happened>"',
    values: ['note'],
    build: args => ({method: 'POST', path: `/api/lessons/${enc(need(args.positional[0], 'lectio lesson verdict <lesson> --note "…"'))}/verdict`, body: {note: flagValue(args, 'note')}}),
    human: body => `verdict recorded on ${(body['lesson'] as Lesson).title}`,
  },
  {
    name: 'block fix',
    audience: 'tutor',
    summary: 'replace one block of any lesson, resolving the flags it answers',
    usage: 'lectio block fix <block> --file block.json [--resolve <feedback-id…>] --reply "<what changed>"',
    values: ['file', 'resolve', 'reply'],
    booleans: ['stdin'],
    build: async (args, io) => ({
      method: 'POST',
      path: `/api/blocks/${enc(need(args.positional[0], 'lectio block fix <block> --file block.json'))}/fix`,
      body: {block: await jsonInput(args, io, 'block'), resolve: flagList(args, 'resolve'), reply: flagValue(args, 'reply')},
    }),
    human: body => `fixed block ${(body['block'] as {id: string; version: number}).id} (v${(body['block'] as {version: number}).version}); resolved ${(body['resolved'] as string[]).length}`,
  },
  {
    name: 'quiz submit',
    audience: 'tutor',
    summary: "write today's quiz for a subject: new questions and reviews (idempotent by day)",
    usage: 'lectio quiz submit <subject> --day <date> --run <run> [--kind daily|placement] --file quiz.json | --stdin',
    values: ['day', 'run', 'kind', 'file'],
    booleans: ['stdin'],
    build: async (args, io) => ({
      method: 'POST',
      path: `/api/subjects/${enc(need(args.positional.join(' '), 'lectio quiz submit <subject> --day <date> --run <run> --file quiz.json'))}/quizzes`,
      body: {day: flagValue(args, 'day'), run: flagValue(args, 'run'), kind: flagValue(args, 'kind'), quiz: await jsonInput(args, io, 'quiz')},
    }),
    human: body => {
      const quiz = body['quiz'] as Quiz;
      const superseded = body['superseded'] as string[];
      return [`${body['existing'] === true ? 'already written' : 'submitted'}: ${quiz.kind} quiz ${quiz.id} (${(body['question_ids'] as string[]).length} questions)`, ...(superseded.length > 0 ? [`  superseded ${superseded.join(', ')}`] : [])];
    },
  },
  {
    name: 'quiz show',
    audience: 'anyone',
    summary: 'one quiz, with its items and how they went (agents see question keys)',
    usage: 'lectio quiz show <quiz>',
    build: args => ({method: 'GET', path: `/api/quizzes/${enc(need(args.positional[0], 'lectio quiz show <quiz>'))}`}),
    human: body => {
      const quiz = body['quiz'] as Quiz & {items: Array<{position: number; role: string; question: {prompt: string}; answered: {score: number | null} | null}>; blocked: string | null};
      return [
        `${quiz.kind} quiz ${quiz.id} (${quiz.day}) [${quiz.state}]${quiz.blocked === null ? '' : ` — ${quiz.blocked}`}`,
        ...quiz.items.map(i => `  ${i.position + 1}. (${i.role}) ${i.question.prompt.split('\n')[0]!.slice(0, 70)}${i.answered === null ? '' : `  → ${percent(i.answered.score)}`}`),
      ];
    },
  },
  {
    name: 'questions',
    audience: 'anyone',
    summary: 'the question bank, with each question’s record',
    usage: 'lectio questions [--subject …] [--concept <key>] [--status active|retired|all]',
    values: ['subject', 'concept', 'status'],
    build: args => ({method: 'GET', path: '/api/questions', query: {subject: flagValue(args, 'subject'), concept: flagValue(args, 'concept'), status: flagValue(args, 'status')}}),
    human: body =>
      (body['questions'] as Array<{id: string; type: string; prompt: string; status: string; stats: {first_try: {rate: number | null; n: number}}}>).map(
        q => `${q.id}  ${q.type.padEnd(15)} ${percent(q.stats.first_try.rate)} of ${q.stats.first_try.n}  ${q.prompt.split('\n')[0]!.slice(0, 70)}${q.status === 'retired' ? ' [retired]' : ''}`,
      ),
  },
  {
    name: 'question show',
    audience: 'anyone',
    summary: 'one question, with its record',
    usage: 'lectio question show <question>',
    build: args => ({method: 'GET', path: `/api/questions/${enc(need(args.positional[0], 'lectio question show <question>'))}`}),
    human: body => JSON.stringify(body['question'], null, 2),
  },
  {
    name: 'question fix',
    audience: 'tutor',
    summary: 'rewrite a question in place; --void-attempts when its key was wrong',
    usage: 'lectio question fix <question> --file q.json [--void-attempts] [--resolve <feedback-id…>] --reply "<what changed>"',
    values: ['file', 'resolve', 'reply'],
    booleans: ['void-attempts', 'stdin'],
    build: async (args, io) => ({
      method: 'POST',
      path: `/api/questions/${enc(need(args.positional[0], 'lectio question fix <question> --file q.json'))}/fix`,
      body: {question: await jsonInput(args, io, 'question'), void_attempts: hasFlag(args, 'void-attempts'), resolve: flagList(args, 'resolve'), reply: flagValue(args, 'reply')},
    }),
    human: body => `fixed question ${(body['question'] as {id: string}).id}${body['changed'] === true ? '' : ' (no change)'}; voided ${String(body['voided'])} attempts; resolved ${(body['resolved'] as string[]).length}`,
  },
  {
    name: 'question retire',
    audience: 'tutor',
    summary: "stop asking a question (it stays, with its record)",
    usage: 'lectio question retire <question>',
    build: args => ({method: 'POST', path: `/api/questions/${enc(need(args.positional[0], 'lectio question retire <question>'))}/retire`}),
    human: body => `retired ${(body['question'] as {id: string}).id}`,
  },
  {
    name: 'grade',
    audience: 'tutor',
    summary: "re-grade a free response (the learner's own grade is kept too)",
    usage: 'lectio grade <attempt> --score 0..1 --note "<what they got or missed>"',
    values: ['score', 'note'],
    build: args => ({method: 'POST', path: `/api/attempts/${enc(need(args.positional[0], 'lectio grade <attempt> --score …'))}/grade`, body: {score: flagValue(args, 'score'), note: flagValue(args, 'note')}}),
    human: body => `graded ${(body['attempt'] as {id: string}).id}`,
  },
  {
    name: 'reply',
    audience: 'tutor',
    summary: 'answer an ask, or respond to a flag',
    usage: 'lectio reply <feedback> --body "<markdown>" [--resolved answered|noted|disagreed|fixed]',
    values: ['body', 'resolved'],
    build: args => ({method: 'POST', path: `/api/feedback/${enc(need(args.positional[0], 'lectio reply <feedback> --body "…"'))}/reply`, body: {body: flagValue(args, 'body'), resolved: flagValue(args, 'resolved')}}),
    human: body => `replied (${(body['feedback'] as {resolved: string}).resolved})`,
  },
];
