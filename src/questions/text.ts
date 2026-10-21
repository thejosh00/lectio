/**
 * Typed answers: numbers, short text, and fill-in-the-blanks. Each can be disputed ("I
 * was right"), because a key written in advance can't foresee every right phrasing.
 */
import {normalizeAnswer, parseNumber, patternProblem, textMatches} from '../core/normalize.ts';
import {Node, result} from '../core/validate.ts';
import {graded, PART_ID, PART_ID_MESSAGE, type QuestionType} from './types.ts';

export interface NumericBody {
  answer: number;
  tolerance: number;
  relative: boolean;
  unit: string | null;
}

export interface Accepting {
  accept: string[];
  regex: string[];
  case_sensitive: boolean;
}

export type ShortTextBody = Accepting;

export interface ClozeBody {
  text: string;
  blanks: Record<string, Accepting>;
}

function readAccepting(node: Node, allowed: readonly string[]): Accepting | undefined {
  const o = node.object(allowed);
  const accept = node.get('accept').stringArray({min: 1, max: 30, item: {max: 200}});
  const patterns = node.get('regex').optionalArray({max: 10});
  const regex: string[] = [];
  for (const p of patterns) {
    const pattern = p.string({max: 200});
    if (pattern === undefined) continue;
    const problem = patternProblem(pattern);
    if (problem !== undefined) p.fail(`is not a valid pattern: ${problem}`);
    else regex.push(pattern);
  }
  const caseSensitive = node.get('case_sensitive').optionalBoolean() ?? false;
  if (accept !== undefined) {
    for (const [i, a] of accept.entries()) if (normalizeAnswer(a, caseSensitive) === '') node.get('accept').get(String(i)).fail('is empty once normalised');
  }
  return o && accept ? {accept, regex, case_sensitive: caseSensitive} : undefined;
}

const readText = (answer: unknown, _body: unknown, path: string) => {
  const node = Node.root(answer, path);
  if (typeof node.value === 'number') return result(node.issues, String(node.value));
  return result(node.issues, node.string({min: 0, max: 2000}));
};

export const numeric: QuestionType<NumericBody, number> = {
  type: 'numeric',
  milestone: 'M2',
  gradedBy: 'app',
  disputable: true,
  shape: '{answer: <number>, tolerance: <number ≥ 0>, relative?: false, unit?: "ms"}',
  answerShape: '<number> (or a string like "1,024" or "12 ms")',
  validate(body, path) {
    const node = Node.root(body, path);
    const o = node.object(['answer', 'tolerance', 'relative', 'unit']);
    const answer = node.get('answer').number();
    const tolerance = node.get('tolerance').number({min: 0});
    const relative = node.get('relative').optionalBoolean() ?? false;
    const unit = node.get('unit').optionalString({max: 24});
    if (relative && tolerance !== undefined && tolerance >= 1) node.get('tolerance').fail('a relative tolerance is a fraction: 0.05 means within 5%');
    return result(node.issues, o && answer !== undefined && tolerance !== undefined ? {answer, tolerance, relative, unit: unit?.trim() || null} : undefined);
  },
  learnerBody: body => ({unit: body.unit}),
  reveal: body => ({answer: body.answer, tolerance: body.tolerance, relative: body.relative, unit: body.unit}),
  orderIds: () => null,
  readAnswer(answer, body, path) {
    const node = Node.root(answer, path);
    if (typeof answer === 'number' && Number.isFinite(answer)) return result(node.issues, answer);
    if (typeof answer === 'string') {
      const n = parseNumber(answer, body.unit);
      if (n !== undefined) return result(node.issues, n);
      return result<number>([{path, message: `"${answer}" is not a number`}], undefined);
    }
    return result<number>([{path, message: 'must be a number'}], undefined);
  },
  grade(body, answer) {
    const allowed = body.relative ? body.tolerance * Math.abs(body.answer) : body.tolerance;
    // A hair of slack, so 0.1 + 0.2 within 0 of 0.3 is right.
    return graded(Math.abs(answer - body.answer) <= allowed + 1e-9 * Math.max(1, Math.abs(body.answer)) ? 1 : 0);
  },
  plainText: body => (body.unit === null ? '  (a number)' : `  (a number, in ${body.unit})`),
  answerText: body => {
    const within = body.tolerance === 0 ? '' : body.relative ? ` (±${body.tolerance * 100}%)` : ` (±${body.tolerance})`;
    return `${body.answer}${body.unit === null ? '' : ` ${body.unit}`}${within}`;
  },
};

export const shortText: QuestionType<ShortTextBody, string> = {
  type: 'short_text',
  milestone: 'M2',
  gradedBy: 'app',
  disputable: true,
  shape: '{accept: ["answers"], regex?: ["whole-answer patterns"], case_sensitive?: false}',
  answerShape: '"<text>"',
  validate(body, path) {
    const node = Node.root(body, path);
    return result(node.issues, readAccepting(node, ['accept', 'regex', 'case_sensitive']));
  },
  learnerBody: () => ({}),
  reveal: body => ({accept: body.accept}),
  orderIds: () => null,
  readAnswer: readText,
  grade: (body, answer) => graded(textMatches(answer, body.accept, body.regex, body.case_sensitive) ? 1 : 0),
  plainText: () => '  (type your answer)',
  answerText: body => body.accept.join(' / '),
};

const BLANK = /\{\{([A-Za-z0-9_-]{1,24})\}\}/g;

export const blanksIn = (text: string) => [...text.matchAll(BLANK)].map(m => m[1]!);

export const cloze: QuestionType<ClozeBody, Record<string, string>> = {
  type: 'cloze',
  milestone: 'M2',
  gradedBy: 'app',
  disputable: true,
  shape: '{text: "The {{1}} owns it until it is {{2}}.", blanks: {"1": {accept, regex?, case_sensitive?}, "2": {…}}}',
  answerShape: '{"1": "<text>", "2": "<text>"}',
  validate(body, path) {
    const node = Node.root(body, path);
    const o = node.object(['text', 'blanks']);
    const text = node.get('text').string({max: 4000});
    const blanksNode = node.get('blanks');
    const blanksObject = blanksNode.object();
    const named = text === undefined ? [] : blanksIn(text);
    if (text !== undefined && named.length === 0) node.get('text').fail('has no blanks: mark each with {{1}}, {{2}}…');
    if (new Set(named).size !== named.length) node.get('text').fail('uses a blank twice');
    const blanks: Record<string, Accepting> = {};
    for (const key of Object.keys(blanksObject ?? {})) {
      if (!PART_ID.test(key)) blanksNode.get(key).fail(PART_ID_MESSAGE);
      if (!named.includes(key)) blanksNode.get(key).fail(`is not a blank in the text ({{${key}}})`);
      const accepting = readAccepting(blanksNode.get(key), ['accept', 'regex', 'case_sensitive']);
      if (accepting !== undefined) blanks[key] = accepting;
    }
    for (const key of named) if (blanksObject !== undefined && !Object.hasOwn(blanksObject, key)) blanksNode.fail(`has nothing for {{${key}}}`);
    return result(node.issues, o && text !== undefined && blanksObject !== undefined ? {text, blanks} : undefined);
  },
  learnerBody: body => ({text: body.text, blanks: blanksIn(body.text)}),
  reveal: body => ({blanks: Object.fromEntries(Object.entries(body.blanks).map(([k, b]) => [k, b.accept]))}),
  orderIds: () => null,
  readAnswer(answer, body, path) {
    const node = Node.root(answer, path);
    const o = node.object(blanksIn(body.text));
    const out: Record<string, string> = {};
    for (const key of blanksIn(body.text)) {
      const value = node.get(key).value;
      out[key] = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
      if (value !== undefined && value !== null && typeof value !== 'string' && typeof value !== 'number') node.get(key).fail('must be a string');
    }
    return result(node.issues, o === undefined ? undefined : out);
  },
  grade(body, answer) {
    const keys = blanksIn(body.text);
    const detail = Object.fromEntries(keys.map(k => [k, textMatches(answer[k] ?? '', body.blanks[k]!.accept, body.blanks[k]!.regex, body.blanks[k]!.case_sensitive)]));
    return graded(keys.filter(k => detail[k]).length / keys.length, {detail});
  },
  plainText: body => `  ${body.text.replace(BLANK, (_, k: string) => `[${k}: ____]`)}`,
  answerText: body => body.text.replace(BLANK, (_, k: string) => `[${body.blanks[k]?.accept[0] ?? '?'}]`),
};
