import {Node, result} from '../core/validate.ts';
import {readingSeconds, type BlockType} from './types.ts';

export const CALLOUT_KINDS = ['key_idea', 'definition', 'pitfall', 'tip'] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

export const CALLOUT_LABELS: Record<CalloutKind, string> = {key_idea: 'Key idea', definition: 'Definition', pitfall: 'Pitfall', tip: 'Tip'};

export interface CalloutBody {
  kind: CalloutKind;
  md: string;
}

export const calloutBlock: BlockType<CalloutBody> = {
  type: 'callout',
  milestone: 'M1',
  shape: '{kind: key_idea|definition|pitfall|tip, md}',
  renders: 'a boxed aside',
  validate(body, ctx) {
    const node = Node.root(body, ctx.path);
    const o = node.object(['kind', 'md']);
    const kind = node.get('kind').oneOf(CALLOUT_KINDS);
    const md = node.get('md').string();
    return result(node.issues, o && kind && md !== undefined ? {kind, md} : undefined);
  },
  plainText: body => `[${CALLOUT_LABELS[body.kind]}] ${body.md}`,
  estimateSeconds: body => readingSeconds(body.md) + 2,
  timed: 'its words, plus 2 s',
  tracks: ['seen'],
};
