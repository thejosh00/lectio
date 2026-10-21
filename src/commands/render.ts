/**
 * Text for a person reading the terminal. Agents use `--json` and never see this.
 */
import type {Concept, Lesson, Subject} from '../core/types.ts';

export function table(rows: string[][]): string[] {
  const widths: number[] = [];
  for (const row of rows) row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, cell.length)));
  return rows.map(row => row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i]!))).join('  ').trimEnd());
}

export function subjectLine(s: Subject): string {
  const status = s.status === 'active' ? '' : ` [${s.status}]`;
  return `${s.id}  ${s.title}  — ${s.minutes_per_day} min, ${s.days}, ${s.level}${status}${s.goal ? `\n    goal: ${s.goal}` : ''}`;
}

export const percent = (rate: number | null | undefined) => (rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`);

export function conceptLine(c: Concept & {memory?: {recall_now: number; due: string} | null}): string {
  const memory = c.memory === null || c.memory === undefined ? '' : `  recall ${percent(c.memory.recall_now)}, next ${c.memory.due}`;
  return `  ${String(c.position).padStart(3)}. ${c.key.padEnd(24)} ${c.status.padEnd(10)} ${c.title}${memory}`;
}

export function lessonLine(l: Pick<Lesson, 'id' | 'day' | 'title' | 'state' | 'estimated_minutes'>): string {
  return `${l.id}  ${l.day}  ${l.title}  — ${l.estimated_minutes} min [${l.state}]`;
}

interface LearnerQuestionLike {
  id: string;
  type: string;
  prompt: string;
  body: Record<string, unknown>;
}

type Part = {id: string; md: string};

/** A question as the learner sees it, from its learner view. `order` is the shown order of its parts. */
export function questionText(q: LearnerQuestionLike, order?: readonly string[]): string[] {
  const lines = [q.prompt];
  const ordered = (parts: Part[]) => (order === undefined ? parts : order.map(id => parts.find(p => p.id === id)!).filter(Boolean));
  switch (q.type) {
    case 'multiple_choice':
    case 'multi_select': {
      const choices = ordered(q.body['choices'] as Part[]);
      choices.forEach((c, i) => lines.push(`  ${i + 1}. ${c.md}`));
      if (q.type === 'multi_select') lines.push('  (pick all that apply)');
      break;
    }
    case 'numeric':
      lines.push(q.body['unit'] ? `  (a number, in ${String(q.body['unit'])})` : '  (a number)');
      break;
    case 'short_text':
      lines.push('  (type your answer)');
      break;
    case 'cloze':
      lines.push(`  ${String(q.body['text']).replace(/\{\{([A-Za-z0-9_-]+)\}\}/g, (_, k: string) => `[${k}: ____]`)}`);
      break;
    case 'ordering':
      ordered(q.body['items'] as Part[]).forEach((item, i) => lines.push(`  ${i + 1}. ${item.md}`));
      break;
    case 'matching': {
      (q.body['left'] as Part[]).forEach((item, i) => lines.push(`  ${i + 1}. ${item.md}`));
      lines.push('  match with:');
      ordered(q.body['right'] as Part[]).forEach((item, i) => lines.push(`  ${String.fromCharCode(97 + i)}. ${item.md}`));
      break;
    }
    case 'free_response':
      lines.push('  (write your answer, then compare it with the model answer)');
      break;
    default:
      lines.push(`  (a ${q.type} question: open it in the web app)`);
  }
  return lines;
}

interface BlockLike {
  id: string;
  type: string;
  approach: string;
  text: string;
  body: Record<string, unknown>;
  question?: LearnerQuestionLike;
  answered?: {score: number | null} | null;
}

interface LessonLike extends Lesson {
  subject: {id: string; title: string};
  concepts: Array<{key: string; title: string; role: string}>;
  blocks: BlockLike[];
  quiz: {id: string; state: string} | null;
}

const rule = (title: string) => `── ${title} ${'─'.repeat(Math.max(4, 66 - title.length))}`;

export function lessonText(lesson: LessonLike): string[] {
  const out: string[] = [
    rule(`${lesson.subject.title} · ${lesson.day}`),
    '',
    `# ${lesson.title}`,
    '',
    `${lesson.estimated_minutes} min · ${lesson.state} · ${lesson.id}`,
    '',
    'By the end you can:',
    ...lesson.objectives.map(o => `  • ${o}`),
    '',
    `Why this lesson: ${lesson.rationale}`,
  ];
  if (lesson.hypothesis !== null) out.push(`Trying: ${lesson.hypothesis}`);
  out.push('');
  for (const block of lesson.blocks) {
    if (block.type === 'question' && block.question !== undefined) {
      const answered = block.answered === null || block.answered === undefined ? '' : `  (answered: ${block.answered.score === null ? 'waiting for your grade' : `${Math.round(block.answered.score * 100)}%`})`;
      out.push(`  ? Check (${block.question.id})${answered}`, ...questionText(block.question).map(l => `    ${l}`), '');
      continue;
    }
    const alt = typeof block.body['alt'] === 'string' ? String(block.body['alt']) : undefined;
    if (alt !== undefined) {
      out.push(`  [${block.type}] ${alt}`, '    (open the lesson in the web app to see it)', '');
      continue;
    }
    out.push(block.text, '');
  }
  if (lesson.sources.length > 0) out.push('Sources:', ...lesson.sources.map(s => `  ${s.title} — ${s.url}`), '');
  if (lesson.state !== 'finished' && lesson.state !== 'skipped') out.push(`When you're done: lectio finish ${lesson.id} [--rate clear|confusing|too_easy|…]`);
  else if (lesson.quiz !== null && lesson.quiz.state !== 'finished') out.push(`Next: lectio quiz ${lesson.quiz.id}`);
  return out;
}
