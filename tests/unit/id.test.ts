import {expect, test} from 'bun:test';
import {mintId, resolveIdPrefix} from '../../src/core/id.ts';

test('ids are 12 characters and sort by time', () => {
  const a = mintId(Date.parse('2026-01-01T00:00:00Z'), new Uint8Array([255, 255, 255, 255]));
  const b = mintId(Date.parse('2026-01-01T00:00:01Z'), new Uint8Array([0, 0, 0, 0]));
  expect(a).toHaveLength(12);
  expect(a < b).toBe(true);
});

test('prefixes resolve like git', () => {
  const ids = ['0abc00000001', '0abc00000002', '0xyz00000003'];
  expect(resolveIdPrefix(ids, '0x')).toEqual({kind: 'ok', id: '0xyz00000003'});
  expect(resolveIdPrefix(ids, '0abc').kind).toBe('ambiguous');
  expect(resolveIdPrefix(ids, 'zz')).toEqual({kind: 'none'});
  expect(resolveIdPrefix(ids, '0XYZ')).toEqual({kind: 'ok', id: '0xyz00000003'});
});
