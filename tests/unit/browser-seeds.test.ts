/** A new block or question type has to reach a browser, or nothing tests that it draws at all. */
import {expect, test} from 'bun:test';
import {blockTypeNames} from '../../src/blocks/index.ts';
import {questionTypeNames} from '../../src/questions/index.ts';
import {everyBlock, everyQuestion} from '../browser/seeds.ts';
import {startInstance} from '../helpers/instance.ts';

test('the browser tests see a question of every type', () => {
  expect(new Set(everyQuestion.map(q => q.type))).toEqual(new Set(questionTypeNames()));
});

test('the browser tests see a block of every type', async () => {
  const lc = await startInstance();
  try {
    expect(new Set((await everyBlock(lc)).map(b => b.type))).toEqual(new Set(blockTypeNames()));
  } finally {
    await lc.stop();
  }
});
