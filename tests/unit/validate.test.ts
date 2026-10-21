import {expect, test} from 'bun:test';
import {findCycle} from '../../src/core/submission.ts';
import {joinPath, Node} from '../../src/core/validate.ts';

test('paths read like the JSON they point into', () => {
  expect(joinPath('', 'blocks')).toBe('blocks');
  expect(joinPath('blocks', 3)).toBe('blocks[3]');
  expect(joinPath('blocks[3]', 'body')).toBe('blocks[3].body');
  expect(joinPath('answer', 'left id')).toBe('answer["left id"]');
});

test('a node collects every problem, not just the first', () => {
  const node = Node.root({title: '', count: 'x', extra: true});
  node.object(['title', 'count']);
  node.get('title').string();
  node.get('count').number();
  node.get('missing').string();
  expect(node.issues).toEqual([
    {path: 'extra', message: 'is not a field here; expected title, count'},
    {path: 'title', message: 'must not be empty'},
    {path: 'count', message: 'must be a number'},
    {path: 'missing', message: 'is required'},
  ]);
});

test('prerequisite cycles are found', () => {
  expect(findCycle(new Map([['a', ['b']], ['b', ['c']], ['c', []]]))).toBeUndefined();
  expect(findCycle(new Map([['a', ['b']], ['b', ['c']], ['c', ['a']]]))).toEqual(['a', 'b', 'c', 'a']);
});
