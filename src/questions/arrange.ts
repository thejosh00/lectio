/**
 * Putting things in order, and matching pairs. Both are shown shuffled, and both give
 * partial credit.
 */
import {Node, result} from '../core/validate.ts';
import {graded, PART_ID, PART_ID_MESSAGE, type QuestionType} from './types.ts';

export interface Item {
  id: string;
  md: string;
}

export interface OrderingBody {
  items: Item[];
  answer: string[];
}

export interface MatchingBody {
  left: Item[];
  right: Item[];
  answer: Record<string, string>;
}

function readItems(node: Node, min: number, max: number): Item[] | undefined {
  const items = node.array({min, max});
  if (items === undefined) return undefined;
  const out: Item[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    item.object(['id', 'md']);
    const id = item.get('id').string({max: 24, pattern: PART_ID, patternMessage: PART_ID_MESSAGE});
    const md = item.get('md').string({max: 1000});
    if (id !== undefined && seen.has(id)) item.get('id').fail(`"${id}" is used twice`);
    if (id !== undefined) seen.add(id);
    if (id !== undefined && md !== undefined) out.push({id, md});
  }
  return out.length === items.length ? out : undefined;
}

const isPermutation = (ids: readonly string[], of: readonly string[]) => ids.length === of.length && new Set(ids).size === ids.length && ids.every(id => of.includes(id));

export const ordering: QuestionType<OrderingBody, string[]> = {
  type: 'ordering',
  milestone: 'M2',
  gradedBy: 'app',
  disputable: false,
  shape: '{items: [{id, md}], answer: [<item ids in order>]}',
  answerShape: '["<item id>", …] in the order given',
  validate(body, path) {
    const node = Node.root(body, path);
    const o = node.object(['items', 'answer']);
    const items = readItems(node.get('items'), 2, 12);
    const answer = node.get('answer').stringArray({min: 2, max: 12});
    if (items !== undefined && answer !== undefined && !isPermutation(answer, items.map(i => i.id))) node.get('answer').fail('must list every item id exactly once');
    return result(node.issues, o && items && answer ? {items, answer} : undefined);
  },
  learnerBody: body => ({items: body.items}),
  reveal: body => ({answer: body.answer, items: body.items}),
  orderIds: body => body.items.map(i => i.id),
  readAnswer(answer, body, path) {
    const node = Node.root(answer, path);
    const ids = node.stringArray({max: body.items.length});
    if (ids !== undefined && !isPermutation(ids, body.items.map(i => i.id))) node.fail('must list every item id exactly once');
    return result(node.issues, ids);
  },
  grade(body, answer) {
    // The share of pairs in the right relative order.
    const at = new Map(answer.map((id, i) => [id, i]));
    let right = 0;
    let pairs = 0;
    for (let i = 0; i < body.answer.length; i++) {
      for (let j = i + 1; j < body.answer.length; j++) {
        pairs++;
        if (at.get(body.answer[i]!)! < at.get(body.answer[j]!)!) right++;
      }
    }
    return graded(pairs === 0 ? 1 : right / pairs, {detail: Object.fromEntries(body.answer.map((id, i) => [id, answer[i] === id]))});
  },
  plainText: body => body.items.map((item, i) => `  ${i + 1}. ${item.md}`).join('\n'),
  answerText: body => body.answer.map(id => body.items.find(i => i.id === id)?.md ?? id).join(' → '),
};

export const matching: QuestionType<MatchingBody, Record<string, string>> = {
  type: 'matching',
  milestone: 'M2',
  gradedBy: 'app',
  disputable: false,
  shape: '{left: [{id, md}], right: [{id, md}], answer: {<left id>: <right id>}}',
  answerShape: '{"<left id>": "<right id>", …}',
  validate(body, path) {
    const node = Node.root(body, path);
    const o = node.object(['left', 'right', 'answer']);
    const left = readItems(node.get('left'), 2, 12);
    const right = readItems(node.get('right'), 2, 16);
    const answerNode = node.get('answer');
    const answerObject = answerNode.object();
    const answer: Record<string, string> = {};
    if (left !== undefined && right !== undefined && answerObject !== undefined) {
      for (const [l, r] of Object.entries(answerObject)) {
        if (!left.some(i => i.id === l)) answerNode.get(l).fail(`"${l}" is not a left id`);
        else if (typeof r !== 'string' || !right.some(i => i.id === r)) answerNode.get(l).fail('must be a right id');
        else answer[l] = r;
      }
      for (const l of left) if (!Object.hasOwn(answerObject, l.id)) answerNode.fail(`has no match for "${l.id}"`);
      if (left.some(l => right.some(r => r.id === l.id))) node.get('right').fail('reuses a left id; give each side its own ids');
    }
    return result(node.issues, o && left && right && answerObject ? {left, right, answer} : undefined);
  },
  learnerBody: body => ({left: body.left, right: body.right}),
  reveal: body => ({answer: body.answer, left: body.left, right: body.right}),
  orderIds: body => body.right.map(i => i.id),
  readAnswer(answer, body, path) {
    const node = Node.root(answer, path);
    const o = node.object(body.left.map(l => l.id));
    const out: Record<string, string> = {};
    for (const l of body.left) {
      const value = node.get(l.id).value;
      if (value === undefined || value === null) continue;
      if (typeof value !== 'string' || !body.right.some(r => r.id === value)) node.get(l.id).fail('must be a right id');
      else out[l.id] = value;
    }
    return result(node.issues, o === undefined ? undefined : out);
  },
  grade(body, answer) {
    const detail = Object.fromEntries(body.left.map(l => [l.id, answer[l.id] === body.answer[l.id]]));
    return graded(body.left.filter(l => detail[l.id]).length / body.left.length, {detail});
  },
  plainText: body =>
    [...body.left.map((item, i) => `  ${i + 1}. ${item.md}`), '  match with:', ...body.right.map((item, i) => `  ${String.fromCharCode(97 + i)}. ${item.md}`)].join('\n'),
  answerText: body => body.left.map(l => `${l.md} → ${body.right.find(r => r.id === body.answer[l.id])?.md ?? '?'}`).join('; '),
};
