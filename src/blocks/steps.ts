import {Node, result} from '../core/validate.ts';
import {diagramElements} from './diagram.ts';
import {readAsset, readMermaid} from './picture.ts';
import {readingSeconds, SECONDS_PER_LABEL, SECONDS_TO_LOOK, type BlockType, type EstimateCtx} from './types.ts';

/**
 * One frame of a step-through: a picture (an asset, or a mermaid source) or a few lines of
 * text, and a caption saying what changed. `ask` is a prediction prompt for the next frame:
 * the learner guesses before tapping to see it.
 */
export type StepFrame = ({asset: string} | {mermaid: string} | {md: string}) & {caption: string; ask: string | null};

export interface StepsBody {
  frames: StepFrame[];
  alt: string;
  /** Play on its own, a frame every this many ms, when the learner presses play; never past an `ask`. */
  autoplay_ms: number | null;
}

/** A process past this many frames is two step-throughs. */
export const STEPS_MAX_FRAMES = 16;
export const STEP_CAPTION_MAX = 200;
export const STEP_MD_MAX = 1500;
/** A later frame changes one thing: a few seconds to find it. */
export const SECONDS_PER_STEP = 3;
/** A guess before the next frame. */
export const SECONDS_PER_ASK = 5;

const CONTENT = ['asset', 'mermaid', 'md'] as const;

function frameSeconds(frame: StepFrame, first: boolean, ctx: EstimateCtx): number {
  let look: number;
  if ('md' in frame) look = readingSeconds(frame.md);
  else if (!first) look = SECONDS_PER_STEP;
  else look = SECONDS_TO_LOOK + ('asset' in frame ? (ctx.assetLabels.get(frame.asset) ?? 0) : diagramElements(frame.mermaid)) * SECONDS_PER_LABEL;
  return look + readingSeconds(frame.caption) + (frame.ask === null ? 0 : SECONDS_PER_ASK);
}

/**
 * A step-through (M18): a process in frames the learner moves through at their own pace, each
 * changing one thing. The cheapest kind of animation — no code, nothing to run — and the one the
 * evidence favours for a process: the learner controls the pace, and nothing disappears before
 * they have read it.
 */
export const stepsBlock: BlockType<StepsBody> = {
  type: 'steps',
  milestone: 'M18',
  shape: `{frames: [{asset | mermaid | md, caption, ask?}] (2–${STEPS_MAX_FRAMES}), alt, autoplay_ms?}: each frame one picture (an asset id, or mermaid source) or a few lines of markdown, its caption saying what changed; \`ask\` a guess to make before the next frame`,
  renders: 'one frame at a time on the figure paper, with back and next, dots to jump, and the caption under it; next reads "Show me" after an ask; plays on its own only when the learner presses play, and never under reduced motion',
  validate(body, ctx) {
    const node = Node.root(body, ctx.path);
    const o = node.object(['frames', 'alt', 'autoplay_ms']);
    const frameNodes = node.get('frames').array({min: 2, max: STEPS_MAX_FRAMES}) ?? [];
    const frames: StepFrame[] = [];
    frameNodes.forEach((frameNode, i) => {
      if (frameNode.object(['asset', 'mermaid', 'md', 'caption', 'ask']) === undefined) return;
      const given = CONTENT.filter(key => frameNode.get(key).present);
      if (given.length !== 1) {
        frameNode.fail(given.length === 0 ? 'needs a picture or text: one of asset, mermaid or md' : `has ${given.join(' and ')}; a frame shows one thing: one of asset, mermaid or md`);
        return;
      }
      const key = given[0]!;
      const content = key === 'asset' ? readAsset(frameNode.get('asset'), ctx) : key === 'mermaid' ? readMermaid(frameNode.get('mermaid'), ctx) : frameNode.get('md').string({max: STEP_MD_MAX});
      const caption = frameNode.get('caption').string({max: STEP_CAPTION_MAX});
      const askNode = frameNode.get('ask');
      const ask = askNode.optionalString({max: STEP_CAPTION_MAX});
      if (ask !== undefined && i === frameNodes.length - 1) askNode.fail('the last frame has no next frame to guess');
      if (content !== undefined && caption !== undefined) frames.push({[key]: content, caption, ask: ask === undefined || ask.trim() === '' ? null : ask} as StepFrame);
    });
    const alt = node.get('alt').string({max: 2000});
    const autoplay = node.get('autoplay_ms').optionalNumber({min: 1500, max: 10_000, integer: true});
    return result(node.issues, o && alt !== undefined && frames.length === frameNodes.length && frames.length > 0 ? {frames, alt, autoplay_ms: autoplay ?? null} : undefined);
  },
  plainText: body =>
    [`[Step-through: ${body.alt}]`, ...body.frames.map((frame, i) => `${i + 1}. ${'md' in frame ? `${frame.md.replace(/\s+/g, ' ').trim()} — ` : ''}${frame.caption}${frame.ask === null ? '' : ` (guess: ${frame.ask})`}`)].join('\n'),
  estimateSeconds: (body, ctx) => body.frames.reduce((total, frame, i) => total + frameSeconds(frame, i === 0, ctx), 0),
  timed: `the first frame as a picture (${SECONDS_TO_LOOK} s and ${SECONDS_PER_LABEL} s a label or element) or its words; each later picture ${SECONDS_PER_STEP} s, a text frame its words; every caption's words; ${SECONDS_PER_ASK} s per ask`,
  tracks: ['seen', 'interactions', 'completed'],
};
