/** The line diff behind the playbook's history (M13). */
import {expect, test} from 'bun:test';
import {lineDiff} from '../../src/core/diff.ts';

test('kept lines, removed lines and added lines, in order', () => {
  expect(lineDiff('a\nb\nc', 'a\nc\nd')).toEqual([
    {op: 'same', line: 'a'},
    {op: 'del', line: 'b'},
    {op: 'same', line: 'c'},
    {op: 'add', line: 'd'},
  ]);
});

test('a rewritten line is a deletion and an addition; empty sides are all one or the other', () => {
  expect(lineDiff('- worked examples first', '- problems first')).toEqual([
    {op: 'del', line: '- worked examples first'},
    {op: 'add', line: '- problems first'},
  ]);
  expect(lineDiff('', 'x\ny').map(l => l.op)).toEqual(['add', 'add']);
  expect(lineDiff('x', '').map(l => l.op)).toEqual(['del']);
  expect(lineDiff('same', 'same')).toEqual([{op: 'same', line: 'same'}]);
});
