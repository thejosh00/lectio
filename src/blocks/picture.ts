/**
 * The checks every picture shares, wherever it sits — an image or diagram block, a step-through's
 * frame, a question's figure: an asset that exists, and a mermaid source mermaid accepted.
 *
 * Pure.
 */
import type {Node} from '../core/validate.ts';
import type {ValidateCtx} from './types.ts';

/** Mermaid source is small by nature; a page-long one would not read at phone width either. */
export const DIAGRAM_MAX_SOURCE = 4000;

/** An asset id from `asset put` that is stored. */
export function readAsset(node: Node, ctx: Pick<ValidateCtx, 'assets'>): string | undefined {
  const asset = node.string({max: 64});
  if (asset !== undefined && !ctx.assets.has(asset)) return node.fail(`no asset "${asset}"; store it first with "lectio asset put <file>" and use the id it returns`);
  return asset;
}

/** A mermaid source the server checked (`ctx.diagrams`) and mermaid parsed. */
export function readMermaid(node: Node, ctx: Pick<ValidateCtx, 'diagrams'>): string | undefined {
  const source = node.string({max: DIAGRAM_MAX_SOURCE});
  if (source === undefined) return undefined;
  const verdict = ctx.diagrams.get(source);
  if (verdict === undefined) return node.fail("couldn't be checked against mermaid; try again");
  if (verdict !== null) return node.fail(`doesn't parse as mermaid: ${verdict}`);
  return source;
}

/** A picture a question carries: an asset or a mermaid source, and its alt (M19). */
export type Figure = ({asset: string} | {mermaid: string}) & {alt: string};

/** A question's `figure` or `answer_figure`: exactly one of asset or mermaid, and an alt. */
export function readFigure(node: Node, ctx: Pick<ValidateCtx, 'assets' | 'diagrams'>): Figure | undefined {
  if (node.object(['asset', 'mermaid', 'alt']) === undefined) return undefined;
  const given = (['asset', 'mermaid'] as const).filter(key => node.get(key).present);
  const alt = node.get('alt').string({max: 2000});
  if (given.length !== 1) return node.fail(given.length === 0 ? 'needs a picture: asset (an id from asset put) or mermaid' : 'has asset and mermaid; a figure is one picture');
  const key = given[0]!;
  const picture = key === 'asset' ? readAsset(node.get('asset'), ctx) : readMermaid(node.get('mermaid'), ctx);
  return picture === undefined || alt === undefined ? undefined : ({[key]: picture, alt} as Figure);
}
