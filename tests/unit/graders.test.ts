/**
 * Every grader's edges. Grading is pure and on the server, so the CLI and the web grade
 * identically; these are the cases that decide whether the learner is told the truth.
 */
import {describe, expect, test} from 'bun:test';
import {normalizeAnswer, parseNumber, textMatches} from '../../src/core/normalize.ts';
import {questionType} from '../../src/questions/index.ts';
import type {GradeResult} from '../../src/questions/types.ts';

function check(type: string, body: unknown, answer: unknown): Partial<GradeResult> & {error?: unknown} {
  const t = questionType(type)!;
  const valid = t.validate(body, 'body');
  if (!valid.ok) throw new Error(JSON.stringify(valid.issues));
  const read = t.readAnswer(answer, valid.value, 'answer');
  if (!read.ok) return {error: read.issues};
  return t.grade(valid.value, read.value);
}

const issues = (type: string, body: unknown) => {
  const result = questionType(type)!.validate(body, 'body');
  return result.ok ? [] : result.issues.map(i => `${i.path}: ${i.message}`);
};

describe('normalisation', () => {
  test('NFKC, trim, collapse whitespace, strip surrounding punctuation, lowercase', () => {
    expect(normalizeAnswer('  The   Owner. ')).toBe('the owner');
    expect(normalizeAnswer('“moved”')).toBe('moved');
    expect(normalizeAnswer('ＡＢＣ')).toBe('abc');
    expect(normalizeAnswer('C++')).toBe('c++');
    expect(normalizeAnswer('e.g.')).toBe('e.g');
    expect(normalizeAnswer('Rust', true)).toBe('Rust');
    expect(normalizeAnswer('...')).toBe('');
  });

  test('accepted answers are normalised too; patterns match the whole answer', () => {
    expect(textMatches('the OWNER', ['The owner.'], [])).toBe(true);
    expect(textMatches('', [''], [])).toBe(false);
    expect(textMatches('dropped', [], ['drop(ped)?'])).toBe(true);
    expect(textMatches('not dropped', [], ['drop(ped)?'])).toBe(false);
    expect(textMatches('Rust', ['rust'], [], true)).toBe(false);
  });

  test('numbers as people type them', () => {
    expect(parseNumber('3.5')).toBe(3.5);
    expect(parseNumber('1,000')).toBe(1000);
    expect(parseNumber('−2')).toBe(-2);
    expect(parseNumber('12 ms', 'ms')).toBe(12);
    expect(parseNumber('1e3')).toBe(1000);
    expect(parseNumber('.5')).toBe(0.5);
    expect(parseNumber('twelve')).toBeUndefined();
    expect(parseNumber('1,00')).toBeUndefined();
  });
});

describe('multiple choice', () => {
  const body = {
    choices: [
      {id: 'a', md: 'shallow', misconception: 'move-is-shallow-copy', why: 'two owners'},
      {id: 'b', md: 'moved'},
      {id: 'c', md: 'deep'},
    ],
    answer: 'b',
  };
  test('right, wrong with its tag and why, wrong without', () => {
    expect(check('multiple_choice', body, 'b')).toMatchObject({score: 1, misconception: null});
    expect(check('multiple_choice', body, 'a')).toMatchObject({score: 0, misconception: 'move-is-shallow-copy', why: 'two owners'});
    expect(check('multiple_choice', body, 'c')).toMatchObject({score: 0, misconception: null, why: null});
  });
  test('answers are choice ids, not positions', () => {
    expect(check('multiple_choice', body, '2')).toHaveProperty('error');
  });
  test('the key must be a choice; a right answer has no misconception; ids are unique', () => {
    expect(issues('multiple_choice', {...body, answer: 'z'})).toEqual(['body.answer: "z" is not one of the choice ids']);
    expect(issues('multiple_choice', {choices: [{id: 'a', md: 'x', misconception: 'oops'}, {id: 'a', md: 'y'}], answer: 'a'})).toEqual([
      'body.choices[0].misconception: is for wrong choices; this one is an answer',
      'body.choices[1].id: "a" is used by more than one choice',
    ]);
  });
  test('the learner view carries no key, tags or whys; the reveal does', () => {
    const t = questionType('multiple_choice')!;
    const parsed = t.validate(body, 'body');
    if (!parsed.ok) throw new Error();
    expect(JSON.stringify(t.learnerBody(parsed.value))).not.toMatch(/answer|misconception|why/);
    expect(t.orderIds(parsed.value)).toEqual(['a', 'b', 'c']);
    expect(t.orderIds({...parsed.value, shuffle: false})).toBeNull();
  });
});

describe('multi-select', () => {
  const body = {choices: [{id: 'a', md: '1'}, {id: 'b', md: '2'}, {id: 'c', md: '3', misconception: 'x-tag'}, {id: 'd', md: '4'}], answer: ['a', 'b']};
  test('(right picks − wrong picks) / right answers, floor 0', () => {
    expect(check('multi_select', body, ['a', 'b'])).toMatchObject({score: 1});
    expect(check('multi_select', body, ['a'])).toMatchObject({score: 0.5});
    expect(check('multi_select', body, ['a', 'b', 'c'])).toMatchObject({score: 0.5, misconception: 'x-tag'});
    expect(check('multi_select', body, ['a', 'c', 'd'])).toMatchObject({score: 0});
    expect(check('multi_select', body, [])).toMatchObject({score: 0});
  });
  test('a pick twice or an unknown id is refused', () => {
    expect(check('multi_select', body, ['a', 'a'])).toHaveProperty('error');
    expect(check('multi_select', body, ['z'])).toHaveProperty('error');
  });
});

describe('numeric', () => {
  test('absolute tolerance, inclusive', () => {
    const body = {answer: 10, tolerance: 0.5};
    expect(check('numeric', body, 10.5)).toMatchObject({score: 1});
    expect(check('numeric', body, 10.51)).toMatchObject({score: 0});
    expect(check('numeric', body, '9.5')).toMatchObject({score: 1});
  });
  test('relative tolerance, and floating point slack', () => {
    expect(check('numeric', {answer: 200, tolerance: 0.05, relative: true}, 210)).toMatchObject({score: 1});
    expect(check('numeric', {answer: 200, tolerance: 0.05, relative: true}, 211)).toMatchObject({score: 0});
    expect(check('numeric', {answer: 0.3, tolerance: 0}, 0.1 + 0.2)).toMatchObject({score: 1});
    expect(check('numeric', {answer: -4, tolerance: 0}, '−4')).toMatchObject({score: 1});
  });
  test('units may be typed; words are not numbers', () => {
    expect(check('numeric', {answer: 12, tolerance: 0, unit: 'ms'}, '12 ms')).toMatchObject({score: 1});
    expect(check('numeric', {answer: 12, tolerance: 0}, 'twelve')).toHaveProperty('error');
  });
  test('a relative tolerance is a fraction', () => {
    expect(issues('numeric', {answer: 1, tolerance: 5, relative: true})).toHaveLength(1);
  });
});

describe('short text', () => {
  test('accepted answers and patterns, case-insensitive by default', () => {
    const body = {accept: ['the owner', 'owner'], regex: ['(its )?owning (variable|binding)']};
    expect(check('short_text', body, 'The Owner!')).toMatchObject({score: 1});
    expect(check('short_text', body, 'its owning binding')).toMatchObject({score: 1});
    expect(check('short_text', body, 'the borrower')).toMatchObject({score: 0});
    expect(check('short_text', body, '')).toMatchObject({score: 0});
  });
  test('case-sensitive when asked', () => {
    expect(check('short_text', {accept: ['Vec'], case_sensitive: true}, 'vec')).toMatchObject({score: 0});
    expect(check('short_text', {accept: ['Vec'], case_sensitive: true}, 'Vec')).toMatchObject({score: 1});
  });
  test('a pattern that does not compile is refused at submission', () => {
    expect(issues('short_text', {accept: ['x'], regex: ['(unclosed']})[0]).toContain('body.regex[0]: is not a valid pattern');
  });
  test('it can be disputed', () => {
    expect(questionType('short_text')!.disputable).toBe(true);
    expect(questionType('multiple_choice')!.disputable).toBe(false);
  });
});

describe('cloze', () => {
  const body = {text: 'The {{1}} owns it until it is {{2}}.', blanks: {'1': {accept: ['owner']}, '2': {accept: ['dropped'], regex: ['freed']}}};
  test('the share of blanks right, with per-blank detail', () => {
    expect(check('cloze', body, {'1': 'Owner', '2': 'freed'})).toMatchObject({score: 1, detail: {'1': true, '2': true}});
    expect(check('cloze', body, {'1': 'owner', '2': 'moved'})).toMatchObject({score: 0.5, detail: {'1': true, '2': false}});
    expect(check('cloze', body, {'1': 'owner'})).toMatchObject({score: 0.5});
  });
  test('blanks and the text must agree', () => {
    expect(issues('cloze', {text: 'The {{1}} owns it.', blanks: {'1': {accept: ['owner']}, '2': {accept: ['x']}}})).toEqual(['body.blanks["2"]: is not a blank in the text ({{2}})']);
    expect(issues('cloze', {text: 'The {{1}} owns {{2}}.', blanks: {'1': {accept: ['owner']}}})).toEqual(['body.blanks: has nothing for {{2}}']);
    expect(issues('cloze', {text: 'No blanks.', blanks: {}})).toEqual(['body.text: has no blanks: mark each with {{1}}, {{2}}…']);
  });
});

describe('ordering', () => {
  const body = {items: [{id: 'parse', md: 'parse'}, {id: 'check', md: 'type-check'}, {id: 'borrow', md: 'borrow-check'}, {id: 'gen', md: 'codegen'}], answer: ['parse', 'check', 'borrow', 'gen']};
  test('the share of pairs in the right relative order', () => {
    expect(check('ordering', body, ['parse', 'check', 'borrow', 'gen'])).toMatchObject({score: 1});
    // One adjacent swap breaks one pair of six.
    expect(check('ordering', body, ['check', 'parse', 'borrow', 'gen'])?.score).toBeCloseTo(5 / 6);
    expect(check('ordering', body, ['gen', 'borrow', 'check', 'parse'])).toMatchObject({score: 0});
  });
  test('an answer must use every item once', () => {
    expect(check('ordering', body, ['parse', 'check', 'borrow'])).toHaveProperty('error');
    expect(check('ordering', body, ['parse', 'parse', 'borrow', 'gen'])).toHaveProperty('error');
  });
  test('the shown order is a permutation of item ids, independent of the answer', () => {
    const t = questionType('ordering')!;
    const parsed = t.validate(body, 'body');
    if (!parsed.ok) throw new Error();
    expect(t.orderIds(parsed.value)).toEqual(['parse', 'check', 'borrow', 'gen']);
    expect(JSON.stringify(t.learnerBody(parsed.value))).not.toContain('answer');
  });
});

describe('matching', () => {
  const body = {
    left: [{id: 'own', md: 'ownership'}, {id: 'bor', md: 'borrowing'}, {id: 'life', md: 'lifetimes'}],
    right: [{id: 'r1', md: 'who frees it'}, {id: 'r2', md: 'using without owning'}, {id: 'r3', md: 'how long a reference is valid'}, {id: 'r4', md: 'a distractor'}],
    answer: {own: 'r1', bor: 'r2', life: 'r3'},
  };
  test('the share matched', () => {
    expect(check('matching', body, {own: 'r1', bor: 'r2', life: 'r3'})).toMatchObject({score: 1});
    expect(check('matching', body, {own: 'r1', bor: 'r3', life: 'r2'})?.score).toBeCloseTo(1 / 3);
    expect(check('matching', body, {own: 'r4'})?.score).toBe(0);
  });
  test('every left item needs a match in the key', () => {
    expect(issues('matching', {...body, answer: {own: 'r1'}})).toEqual(['body.answer: has no match for "bor"', 'body.answer: has no match for "life"']);
  });
});

describe('free response', () => {
  test('waits for a self-grade', () => {
    expect(check('free_response', {model_answer: 'Because…', rubric: ['names the owner']}, 'my answer')).toMatchObject({score: null});
    expect(questionType('free_response')!.gradedBy).toBe('self');
  });
});
