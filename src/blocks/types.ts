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
  /** Mermaid sources the server checked: source → mermaid's error, or null when it parses. */
  diagrams: ReadonlyMap<string, string | null>;
  limits: {widget_max_bytes: number};
}

/** What a block's time estimate may depend on beyond its body. */
export interface EstimateCtx {
  /** Asset id → its labels (an SVG's text elements). An asset not here has none. */
  assetLabels: ReadonlyMap<string, number>;
}

export const NO_ESTIMATE_FACTS: EstimateCtx = {assetLabels: new Map()};

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
  /** For the lesson's time estimate, the budget check and evening up the arms of a two-arm lesson. */
  estimateSeconds(body: Body, ctx: EstimateCtx): number;
  /** One line for the contract: how the estimate is made. */
  timed: string;
  tracks: readonly Tracked[];
}

/** Reading speed for the time estimate: about 200 words a minute. */
export const SECONDS_PER_WORD = 0.3;

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(word => word.length > 0).length;
}

export const readingSeconds = (text: string) => Math.ceil(wordCount(text) * SECONDS_PER_WORD);

/** A picture's time: a look at the whole, then a second for each label to find and read it. */
export const SECONDS_TO_LOOK = 10;
export const SECONDS_PER_LABEL = 1;

/** The longest caption a picture takes; the contract says so, so it isn't found by a refusal. */
export const CAPTION_MAX = 500;
