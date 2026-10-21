/**
 * The learner's commands: subjects, today's lesson, reactions, progress, notes, settings.
 */
import {flagValue, hasFlag, type ParsedArgs} from '../core/args.ts';
import type {Feedback, Lesson, NoteVersion, Run, Subject} from '../core/types.ts';
import type {SettingJson} from '../db/settings.ts';
import {conceptLine, lessonLine, lessonText, percent, subjectLine, table} from './render.ts';
import {CommandUsage, type CommandDef, type CommandIO} from './types.ts';

const enc = encodeURIComponent;

function need(value: string | undefined, usage: string): string {
  if (value === undefined || value.trim() === '') throw new CommandUsage(`usage: ${usage}`);
  return value;
}

const subjectFields = (args: ParsedArgs) => ({
  title: flagValue(args, 'title'),
  goal: flagValue(args, 'goal'),
  level: flagValue(args, 'level'),
  minutes_per_day: flagValue(args, 'minutes'),
  days: flagValue(args, 'days'),
  note: flagValue(args, 'note'),
});

const SUBJECT_FLAGS = ['goal', 'level', 'minutes', 'days', 'note'] as const;

function statusCommand(name: 'pause' | 'resume' | 'archive', status: string, verb: string): CommandDef {
  return {
    name: `subject ${name}`,
    audience: 'learner',
    summary: `${name} a subject`,
    usage: `lectio subject ${name} <subject>`,
    build: args => ({method: 'POST', path: `/api/subjects/${enc(need(args.positional.join(' '), `lectio subject ${name} <subject>`))}/status`, body: {status}}),
    human: body => `${verb}: ${subjectLine(body['subject'] as Subject)}`,
  };
}

interface TodayBody {
  day: string;
  subjects: Array<{
    subject: Subject;
    lesson: (Pick<Lesson, 'id' | 'title' | 'state' | 'estimated_minutes' | 'objectives'> & {is_today: boolean}) | null;
    quizzes: Array<{id: string; kind: string; state: string; counts: Record<string, number>; estimate_minutes: number; blocked: string | null; progress: {answered: number; total: number}}>;
    waiting: {message: string} | null;
    practice_due: number;
  }>;
  replies: Feedback[];
  practice_due: number;
}

function todayLines(body: TodayBody): string[] {
  const out: string[] = [];
  if (body.subjects.length === 0) return ['No subjects yet. Add one: lectio subject add "Rust" --goal "read and change our Rust services"'];
  for (const s of body.subjects) {
    out.push(`${s.subject.title}`);
    if (s.lesson !== null) {
      out.push(`  lesson: ${s.lesson.title} — ${s.lesson.estimated_minutes} min [${s.lesson.state}]${s.lesson.is_today ? '' : ' (from an earlier day)'}  ${s.lesson.id}`);
    }
    if (s.waiting !== null) out.push(`  ${s.waiting.message}`);
    for (const q of s.quizzes) {
      const parts = Object.entries(q.counts).map(([role, n]) => `${n} ${role}`).join(', ');
      const where = q.state === 'finished' ? 'finished' : q.blocked !== null ? q.blocked : `${q.progress.answered}/${q.progress.total} answered`;
      out.push(`  ${q.kind} quiz: ${parts} — ~${q.estimate_minutes} min (${where})  ${q.id}`);
    }
    if (s.practice_due > 0) out.push(`  practice: ${s.practice_due} review${s.practice_due === 1 ? '' : 's'} due — lectio practice --subject ${s.subject.id}`);
    out.push('');
  }
  if (body.replies.length > 0) {
    out.push('From your tutor:');
    for (const r of body.replies) out.push(`  re your ${r.kind} on ${r.target} ${r.target_id}${r.note ? ` (“${r.note}”)` : ''}:`, `    ${r.reply ?? ''}`);
  }
  return out;
}

async function editNotes(args: ParsedArgs, io: CommandIO) {
  const subject = flagValue(args, 'subject');
  let body: string;
  if (hasFlag(args, 'stdin')) body = await io.readStdin();
  else {
    const current = await io.call({method: 'GET', path: '/api/notes', query: {subject}});
    const notes = current.body['notes'] as {body: string} | undefined;
    body = await io.edit(notes?.body ?? '');
  }
  return {method: 'PUT' as const, path: '/api/notes', body: {subject, body, note: flagValue(args, 'note') ?? 'edited by the learner'}};
}

export const learnerCommands: CommandDef[] = [
  {
    name: 'today',
    audience: 'learner',
    summary: "what is waiting today: lessons, quizzes, reviews, the tutor's replies",
    usage: 'lectio today',
    build: () => ({method: 'GET', path: '/api/today'}),
    human: body => todayLines(body as unknown as TodayBody),
  },
  {
    name: 'subjects',
    audience: 'learner',
    summary: 'your subjects',
    usage: 'lectio subjects [--all]',
    booleans: ['all'],
    build: args => ({method: 'GET', path: '/api/subjects', query: {all: hasFlag(args, 'all') ? 'true' : undefined}}),
    human: body => {
      const subjects = body['subjects'] as Subject[];
      return subjects.length === 0 ? 'no subjects yet: lectio subject add "<title>" --goal "…"' : subjects.map(subjectLine);
    },
  },
  {
    name: 'subject add',
    audience: 'learner',
    summary: 'add something to learn, and what you want from it',
    usage: 'lectio subject add "<title>" --goal "…" [--level new|some|solid] [--minutes 15] [--days daily|weekdays|mon,wed,fri] [--note "…"]',
    values: SUBJECT_FLAGS,
    build: args => {
      const title = need(args.positional.join(' '), 'lectio subject add "<title>" --goal "…"');
      return {method: 'POST', path: '/api/subjects', body: {...subjectFields(args), title}};
    },
    human: body => [`added: ${subjectLine(body['subject'] as Subject)}`, 'Your tutor plans it on its next run, then writes an orientation lesson and a placement quiz.'],
  },
  {
    name: 'subject edit',
    audience: 'learner',
    summary: "change a subject's title, goal, level, time or days",
    usage: 'lectio subject edit <subject> [--title "…"] [--goal "…"] [--level …] [--minutes N] [--days …] [--note "…"]',
    values: ['title', ...SUBJECT_FLAGS],
    build: args => ({method: 'PATCH', path: `/api/subjects/${enc(need(args.positional.join(' '), 'lectio subject edit <subject> --goal "…"'))}`, body: subjectFields(args)}),
    human: body => {
      const changed = body['changed'] as string[];
      return changed.length === 0 ? 'nothing changed' : `changed ${changed.join(', ')}: ${subjectLine(body['subject'] as Subject)}`;
    },
  },
  statusCommand('pause', 'paused', 'paused'),
  statusCommand('resume', 'active', 'resumed'),
  statusCommand('archive', 'archived', 'archived'),
  {
    name: 'subject show',
    audience: 'anyone',
    summary: "a subject's syllabus, memory, and the tutor's plan for it",
    usage: 'lectio subject show <subject>',
    build: args => ({method: 'GET', path: `/api/subjects/${enc(need(args.positional.join(' '), 'lectio subject show <subject>'))}`}),
    human: body => {
      const concepts = body['concepts'] as Array<Parameters<typeof conceptLine>[0]>;
      const plan = body['plan'] as {body: string; version: number};
      return [
        subjectLine(body['subject'] as Subject),
        '',
        concepts.length === 0 ? 'No syllabus yet: the tutor writes one on its next run.' : 'Syllabus:',
        ...concepts.map(conceptLine),
        '',
        plan.version === 0 ? 'No plan yet.' : `The tutor's plan (v${plan.version}):`,
        ...(plan.version === 0 ? [] : plan.body.split('\n').map(l => `  ${l}`)),
      ];
    },
  },
  {
    name: 'lesson',
    audience: 'learner',
    summary: "read today's lesson (or any lesson) in the terminal",
    usage: 'lectio lesson [today|<lesson>] [--subject …]',
    values: ['subject'],
    build: args => {
      const ref = args.positional[0];
      if (ref === undefined || ref === 'today') return {method: 'GET', path: '/api/lessons/current', query: {subject: flagValue(args, 'subject')}};
      return {method: 'GET', path: `/api/lessons/${enc(ref)}`};
    },
    human: body => {
      const lessons = (body['lessons'] as Array<Parameters<typeof lessonText>[0]> | undefined) ?? [body['lesson'] as Parameters<typeof lessonText>[0]];
      if (lessons.length === 0) return 'No lesson is waiting. "lectio today" says when the next one arrives.';
      return lessons.flatMap((lesson, i) => [...(i === 0 ? [] : ['', '']), ...lessonText(lesson)]);
    },
  },
  {
    name: 'lessons',
    audience: 'anyone',
    summary: 'past lessons, to re-read',
    usage: 'lectio lessons [--subject …] [--state ready|open|finished|skipped] [--limit N]',
    values: ['subject', 'state', 'limit'],
    build: args => ({method: 'GET', path: '/api/lessons', query: {subject: flagValue(args, 'subject'), state: flagValue(args, 'state'), limit: flagValue(args, 'limit')}}),
    human: body => {
      const lessons = body['lessons'] as Lesson[];
      return lessons.length === 0 ? 'no lessons yet' : lessons.map(lessonLine);
    },
  },
  {
    name: 'finish',
    audience: 'learner',
    summary: "mark a lesson read, with a one-word rating; its quiz opens",
    usage: 'lectio finish <lesson> [--rate clear|confusing|too_easy|too_hard|too_long|too_short|loved|boring] [--note "…"]',
    values: ['rate', 'note'],
    alias: {r: 'rate', n: 'note'},
    build: args => ({method: 'POST', path: `/api/lessons/${enc(need(args.positional[0], 'lectio finish <lesson>'))}/finish`, body: {rate: flagValue(args, 'rate'), note: flagValue(args, 'note')}}),
    human: body => {
      const lesson = body['lesson'] as Lesson;
      const introduced = body['introduced'] as string[];
      return [
        body['already'] === true ? `already finished: ${lesson.title}` : `finished: ${lesson.title}`,
        ...(introduced.length > 0 ? [`  new: ${introduced.join(', ')}`] : []),
        '  next: lectio quiz',
      ];
    },
  },
  {
    name: 'skip',
    audience: 'learner',
    summary: 'skip a lesson, and say why (its quiz is skipped too)',
    usage: 'lectio skip <lesson> --reason know_it|not_now|not_interested [--note "…"]',
    values: ['reason', 'note'],
    alias: {r: 'reason', n: 'note'},
    build: args => ({method: 'POST', path: `/api/lessons/${enc(need(args.positional[0], 'lectio skip <lesson> --reason …'))}/skip`, body: {reason: flagValue(args, 'reason'), note: flagValue(args, 'note')}}),
    human: body => `skipped: ${(body['lesson'] as Lesson).title}`,
  },
  {
    name: 'rate',
    audience: 'learner',
    summary: 'react to a lesson, block, question, quiz or subject in one word',
    usage: 'lectio rate lesson|block|question|quiz|subject <id> <kind> [--note "…"]',
    values: ['note'],
    alias: {n: 'note'},
    build: args => {
      const [target, id, kind] = args.positional;
      if (target === undefined || id === undefined || kind === undefined) throw new CommandUsage('usage: lectio rate lesson|block|question|quiz|subject <id> <kind> [--note "…"]');
      return {method: 'POST', path: '/api/feedback', body: {target, target_id: id, kind, note: flagValue(args, 'note')}};
    },
    human: body => {
      const f = body['feedback'] as Feedback;
      return `noted ${f.kind} on ${f.target} ${f.target_id}${f.note ? ` — ${f.note}` : ''}`;
    },
  },
  {
    name: 'ask',
    audience: 'learner',
    summary: 'ask the tutor about a block or question; it answers on its next run',
    usage: 'lectio ask <block|question> "<your question>"',
    build: args => {
      const [ref, ...words] = args.positional;
      return {method: 'POST', path: '/api/ask', body: {ref: need(ref, 'lectio ask <block|question> "…"'), note: need(words.join(' '), 'lectio ask <block|question> "<your question>"')}};
    },
    human: () => 'asked; the tutor answers on its next run (within the hour)',
  },
  {
    name: 'dispute',
    audience: 'learner',
    summary: '"I was right": a typed answer marked wrong becomes right, and the tutor widens the key',
    usage: 'lectio dispute <attempt> [--note "…"]',
    values: ['note'],
    build: args => ({method: 'POST', path: `/api/attempts/${enc(need(args.positional[0], 'lectio dispute <attempt>'))}/dispute`, body: {note: flagValue(args, 'note')}}),
    human: () => 'disputed: counted as right, and flagged for the tutor',
  },
  {
    name: 'progress',
    audience: 'anyone',
    summary: 'retention, accuracy, calibration and what works for you',
    usage: 'lectio progress [--subject …]',
    values: ['subject'],
    build: args => ({method: 'GET', path: '/api/progress', query: {subject: flagValue(args, 'subject')}}),
    human: body => {
      const p = body['progress'] as {
        subject: {title: string} | null;
        retention: {rate: number | null; n: number};
        same_day_accuracy: {rate: number | null; n: number};
        target_accuracy: number;
        calibration: {by_confidence: Record<string, {rate: number | null; n: number}>};
        concepts: {introduced: number; known: number; solid: number; due: number; total: number};
        misconceptions: Array<{tag: string; count: number}>;
        approaches: Array<{approach: string; with: {concepts: number; rate: number | null; n: number}}>;
      };
      return [
        p.subject === null ? 'All subjects' : p.subject.title,
        `  retention (delayed reviews, first try, no hint, not guessing): ${percent(p.retention.rate)} of ${p.retention.n}`,
        `  same-day accuracy on new material: ${percent(p.same_day_accuracy.rate)} of ${p.same_day_accuracy.n} (target ${percent(p.target_accuracy)})`,
        `  calibration: sure ${percent(p.calibration.by_confidence['sure']?.rate)} · think ${percent(p.calibration.by_confidence['think']?.rate)} · guess ${percent(p.calibration.by_confidence['guess']?.rate)}`,
        `  concepts: ${p.concepts.introduced} introduced, ${p.concepts.solid} solid, ${p.concepts.due} due, ${p.concepts.known} already known, of ${p.concepts.total}`,
        ...(p.misconceptions.length === 0 ? [] : [`  misconceptions: ${p.misconceptions.slice(0, 5).map(m => `${m.tag} ×${m.count}`).join(', ')}`]),
        ...(p.approaches.every(a => a.with.concepts === 0) ? [] : ['  what works (concepts introduced with it → later retention):', ...p.approaches.filter(a => a.with.concepts > 0).map(a => `    ${a.approach.padEnd(16)} ${a.with.concepts} concept${a.with.concepts === 1 ? '' : 's'}, ${percent(a.with.rate)} of ${a.with.n} reviews`)]),
      ];
    },
  },
  {
    name: 'notes',
    audience: 'anyone',
    summary: "the tutor's notes on how you learn (or its plan for a subject)",
    usage: 'lectio notes [--subject …] [--history]',
    values: ['subject'],
    booleans: ['history'],
    build: args => ({method: 'GET', path: '/api/notes', query: {subject: flagValue(args, 'subject'), history: hasFlag(args, 'history') ? 'true' : undefined}}),
    human: body => {
      const notes = body['notes'] as {body: string; version: number; actor: string | null; at: string | null};
      const history = body['history'] as NoteVersion[] | undefined;
      if (history !== undefined) return history.map(v => `v${v.version}  ${v.at}  ${v.actor}${v.note ? `  — ${v.note}` : ''}`);
      return notes.version === 0 ? 'nothing written yet' : [`v${notes.version} by ${notes.actor} at ${notes.at}`, '', notes.body];
    },
  },
  {
    name: 'notes edit',
    audience: 'learner',
    summary: 'correct the notes in your editor (your lines stay yours: the tutor never contradicts them)',
    usage: 'lectio notes edit [--subject …] [--stdin] [--note "why"]',
    values: ['subject', 'note'],
    booleans: ['stdin'],
    build: editNotes,
    human: body => (body['changed'] === true ? `saved v${(body['notes'] as {version: number}).version}` : 'no change'),
  },
  {
    name: 'runs',
    audience: 'anyone',
    summary: 'what the tutor did, and why',
    usage: 'lectio runs [--limit N]',
    values: ['limit'],
    build: args => ({method: 'GET', path: '/api/runs', query: {limit: flagValue(args, 'limit')}}),
    human: body => {
      const runs = body['runs'] as Run[];
      if (runs.length === 0) return 'the tutor has not run yet';
      return runs.map(r => {
        const made = Object.entries(r.made).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', ');
        return `${r.id}  ${r.started}  ${r.outcome ?? 'running'}${r.retro ? ' (retro)' : ''}${made ? `  [${made}]` : ''}${r.summary ? `\n    ${r.summary}` : ''}`;
      });
    },
  },
  {
    name: 'settings',
    audience: 'anyone',
    summary: "this instance's settings",
    usage: 'lectio settings',
    build: () => ({method: 'GET', path: '/api/settings'}),
    human: body => table((body['settings'] as SettingJson[]).map(s => [s.key, s.value ?? '(unset)', s.is_set ? '' : '(default)', s.summary])),
  },
  {
    name: 'settings get',
    audience: 'anyone',
    summary: 'one setting',
    usage: 'lectio settings get <key>',
    build: args => ({method: 'GET', path: `/api/settings/${enc(need(args.positional[0], 'lectio settings get <key>'))}`}),
    human: body => (body['setting'] as SettingJson).value ?? '(unset)',
  },
  {
    name: 'settings set',
    audience: 'learner',
    summary: 'change a setting',
    usage: 'lectio settings set <key> <value>',
    build: args => {
      const [key, ...value] = args.positional;
      if (key === undefined || value.length === 0) throw new CommandUsage('usage: lectio settings set <key> <value>  (lectio settings unset <key> to clear)');
      return {method: 'PUT', path: `/api/settings/${enc(key)}`, body: {value: value.join(' ')}};
    },
    human: body => {
      const s = body['setting'] as SettingJson;
      return `${s.key} = ${s.value ?? '(unset)'}`;
    },
  },
  {
    name: 'settings unset',
    audience: 'learner',
    summary: 'clear a setting back to its default',
    usage: 'lectio settings unset <key>',
    build: args => ({method: 'PUT', path: `/api/settings/${enc(need(args.positional[0], 'lectio settings unset <key>'))}`, body: {value: null}}),
    human: body => {
      const s = body['setting'] as SettingJson;
      return `${s.key} = ${s.value ?? '(unset)'} (default)`;
    },
  },
  {
    name: 'agents',
    audience: 'anyone',
    summary: 'the contract an AI agent follows, for this instance',
    usage: 'lectio agents',
    build: () => ({method: 'GET', path: '/api/agents'}),
    human: body => String(body['document']).trimEnd(),
  },
];
