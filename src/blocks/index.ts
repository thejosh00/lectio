/**
 * The block registry: every block type lectio can render, by name.
 *
 * Adding a type is adding a module and a line here (and its renderer in
 * `src/web/blocks/`). The contract's block table is generated from this list, so the
 * tutor learns about a new type the day it ships.
 */
import {calloutBlock} from './callout.ts';
import {codeBlock} from './code.ts';
import {markdownBlock} from './markdown.ts';
import {questionBlock} from './question.ts';
import type {BlockType} from './types.ts';

export const BLOCK_TYPES: ReadonlyArray<BlockType<any>> = [markdownBlock, calloutBlock, codeBlock, questionBlock];

/** Types the plan names that haven't shipped yet, so a refusal can say when they will. */
export const PLANNED_BLOCK_TYPES: Readonly<Record<string, string>> = {
  image: 'M8',
  diagram: 'M8',
  steps: 'M8',
  widget: 'M9',
  video: 'M10',
};

export function blockType(type: string): BlockType<any> | undefined {
  return BLOCK_TYPES.find(t => t.type === type);
}

export const blockTypeNames = () => BLOCK_TYPES.map(t => t.type);

/** Approaches the contract recommends. The format is enforced; the value is not. */
export const APPROACHES = [
  'explanation',
  'analogy',
  'example',
  'non_example',
  'worked_example',
  'story',
  'derivation',
  'visual',
  'step_through',
  'animation',
  'interactive',
  'simulation',
  'video',
  'code',
  'misconception',
  'retrieval',
  'summary',
  'connection',
] as const;

export const APPROACH_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
