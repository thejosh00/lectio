/**
 * Multiple choice and multi-select: choices with ids, wrong ones tagged with the
 * misconception they encode and why they're wrong.
 */
import {Node, SLUG, result, type Issue} from '../core/validate.ts';
import {graded, PART_ID, PART_ID_MESSAGE, type QuestionType} from './types.ts';

export interface Choice {
  id: string;
  md: string;
  why: string | null;
  misconception: string | null;
}

export interface MultipleChoiceBody {
  choices: Choice[];
  answer: string;
  shuffle: boolean;
}

export interface MultiSelectBody {
  choices: Choice[];
  answer: string[];
  shuffle: boolean;
}

function readChoices(node: Node, correct: (id: string) => boolean): Choice[] | undefined {
  const items = node.array({min: 2, max: 10});
  if (items === undefined) return undefined;
  const seen = new Set<string>();
  const choices: Choice[] = [];
  for (const item of items) {
    item.object(['id', 'md', 'why', 'misconception']);
    const id = item.get('id').string({max: 24, pattern: PART_ID, patternMessage: PART_ID_MESSAGE});
    const md = item.get('md').string();
    const why = item.get('why').optionalString({max: 1000});
    const misconception = item.get('misconception').optionalString({max: 48, pattern: SLUG, patternMessage: 'must be a lowercase slug like move-is-deep-copy'});
    if (id !== undefined) {
      if (seen.has(id)) item.get('id').fail(`"${id}" is used by more than one choice`);
      seen.add(id);
      if (correct(id) && misconception !== undefined) item.get('misconception').fail('is for wrong choices; this one is an answer');
    }
    if (id !== undefined && md !== undefined) choices.push({id, md, why: why ?? null, misconception: misconception ?? null});
  }
  return choices.length === items.length ? choices : undefined;
}

const learnerChoices = (choices: Choice[]) => choices.map(c => ({id: c.id, md: c.md}));

const choiceLines = (choices: Choice[]) => choices.map((c, i) => `  ${i + 1}. ${c.md}`).join('\n');

export const multipleChoice: QuestionType<MultipleChoiceBody, string> = {
  type: 'multiple_choice',
  milestone: 'M2',
  gradedBy: 'app',
  disputable: false,
  shape: '{choices: [{id, md, why?, misconception?}], answer: <choice id>, shuffle?: true}',
  answerShape: '"<choice id>"',
  validate(body, path) {
    const node = Node.root(body, path);
    const o = node.object(['choices', 'answer', 'shuffle']);
    const answer = node.get('answer').string({max: 24});
    const choices = readChoices(node.get('choices'), id => id === answer);
    const shuffle = node.get('shuffle').optionalBoolean() ?? true;
    if (answer !== undefined && choices !== undefined && !choices.some(c => c.id === answer)) node.get('answer').fail(`"${answer}" is not one of the choice ids`);
    return result(node.issues, o && choices && answer !== undefined ? {choices, answer, shuffle} : undefined);
  },
  learnerBody: body => ({choices: learnerChoices(body.choices), shuffle: body.shuffle}),
  reveal: body => ({answer: body.answer, choices: body.choices}),
  orderIds: body => (body.shuffle ? body.choices.map(c => c.id) : null),
  readAnswer(answer, body, path) {
    const node = Node.root(answer, path);
    const id = node.string({max: 24});
    if (id !== undefined && !body.choices.some(c => c.id === id)) node.fail(`"${id}" is not one of this question's choices`);
    return result(node.issues, id);
  },
  grade(body, answer) {
    const chosen = body.choices.find(c => c.id === answer);
    if (answer === body.answer) return graded(1);
    return graded(0, {misconception: chosen?.misconception ?? null, why: chosen?.why ?? null});
  },
  plainText: body => choiceLines(body.choices),
  answerText: body => body.choices.find(c => c.id === body.answer)?.md ?? body.answer,
};

export const multiSelect: QuestionType<MultiSelectBody, string[]> = {
  type: 'multi_select',
  milestone: 'M2',
  gradedBy: 'app',
  disputable: false,
  shape: '{choices: [{id, md, why?, misconception?}], answer: [<choice ids>], shuffle?: true}',
  answerShape: '["<choice id>", …]',
  validate(body, path) {
    const node = Node.root(body, path);
    const o = node.object(['choices', 'answer', 'shuffle']);
    const answer = node.get('answer').stringArray({min: 1, max: 10});
    const choices = readChoices(node.get('choices'), id => answer?.includes(id) ?? false);
    const shuffle = node.get('shuffle').optionalBoolean() ?? true;
    if (answer !== undefined && choices !== undefined) {
      for (const id of answer) if (!choices.some(c => c.id === id)) node.get('answer').fail(`"${id}" is not one of the choice ids`);
      if (new Set(answer).size !== answer.length) node.get('answer').fail('lists a choice twice');
    }
    return result(node.issues, o && choices && answer ? {choices, answer, shuffle} : undefined);
  },
  learnerBody: body => ({choices: learnerChoices(body.choices), shuffle: body.shuffle}),
  reveal: body => ({answer: body.answer, choices: body.choices}),
  orderIds: body => (body.shuffle ? body.choices.map(c => c.id) : null),
  readAnswer(answer, body, path) {
    const node = Node.root(answer, path);
    const ids = node.array({max: body.choices.length});
    const out: string[] = [];
    const issues: Issue[] = node.issues;
    for (const item of ids ?? []) {
      const id = item.string({max: 24});
      if (id === undefined) continue;
      if (!body.choices.some(c => c.id === id)) item.fail(`"${id}" is not one of this question's choices`);
      else if (out.includes(id)) item.fail('is picked twice');
      else out.push(id);
    }
    return result(issues, ids === undefined ? undefined : out);
  },
  grade(body, answer) {
    const right = answer.filter(id => body.answer.includes(id)).length;
    const wrong = answer.filter(id => !body.answer.includes(id));
    const score = Math.max(0, (right - wrong.length) / body.answer.length);
    const firstWrong = body.choices.find(c => c.id === wrong[0]);
    return graded(score, {
      misconception: firstWrong?.misconception ?? null,
      why: firstWrong?.why ?? null,
      detail: Object.fromEntries(body.choices.map(c => [c.id, body.answer.includes(c.id) === answer.includes(c.id)])),
    });
  },
  plainText: body => `${choiceLines(body.choices)}\n  (pick all that apply)`,
  answerText: body => body.answer.map(id => body.choices.find(c => c.id === id)?.md ?? id).join('; '),
};
