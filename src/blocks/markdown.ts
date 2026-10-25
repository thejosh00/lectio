import {Node, result} from '../core/validate.ts';
import {readingSeconds, type BlockType} from './types.ts';

export interface MarkdownBody {
  md: string;
}

export const markdownBlock: BlockType<MarkdownBody> = {
  type: 'markdown',
  milestone: 'M1',
  shape: '{md}: markdown, with $…$ and $$…$$ math and fenced code',
  renders: 'text',
  validate(body, ctx) {
    const node = Node.root(body, ctx.path);
    const o = node.object(['md']);
    const md = node.get('md').string();
    return result(node.issues, o && md !== undefined ? {md} : undefined);
  },
  plainText: body => body.md,
  estimateSeconds: body => readingSeconds(body.md),
  timed: 'its words, at 200 a minute',
  tracks: ['seen'],
};
