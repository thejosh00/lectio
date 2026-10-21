/**
 * The block interface. A lesson is an ordered list of typed blocks, and every kind of
 * content — text, a diagram, a step-through, an animation — is one more type behind this
 * interface, never a special case. Each type is one module in this directory; its web
 * renderer is a React component registered in `src/web/blocks/`.
 *
 * Everything here is pure.
 */
import type {Result} from '../core/validate.ts';

export interface ValidateCtx {
  /** Where the body sits in the submission, for error paths: `blocks[3].body`. */
  path: string;
  /** The subject's concept keys. */
  conceptKeys: ReadonlySet<string>;
  /** Asset ids that exist. */
  assets: ReadonlySet<string>;
  /** Question refs defined in the same submission. */
  questionRefs: ReadonlySet<string>;
  limits: {widget_max_bytes: number};
}

export type Tracked = 'seen' | 'interactions' | 'completed' | 'errors';

export interface BlockType<Body> {
  type: string;
  /** Documentation only: when it ships. */
  milestone: string;
  /** One line for the contract: the body's shape. */
  shape: string;
  /** One line for the contract: how it renders. */
  renders: string;
  /** Errors name a JSON path: "blocks[3].body.alt". */
  validate(body: unknown, ctx: ValidateCtx): Result<Body>;
  /** The terminal rendering, and what the tutor's context shows. */
  plainText(body: Body): string;
  /** For the lesson's time estimate and the budget check. */
  estimateSeconds(body: Body): number;
  tracks: readonly Tracked[];
}

/** Reading speed for the time estimate: about 200 words a minute. */
export const SECONDS_PER_WORD = 0.3;

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(word => word.length > 0).length;
}

export const readingSeconds = (text: string) => Math.ceil(wordCount(text) * SECONDS_PER_WORD);
