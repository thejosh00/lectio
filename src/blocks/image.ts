import {Node, result} from '../core/validate.ts';
import {CAPTION_MAX, readingSeconds, SECONDS_PER_LABEL, SECONDS_TO_LOOK, type BlockType} from './types.ts';

/** A picture: an asset stored with `lectio asset put`, named by the id that returned. */
export interface ImageBody {
  asset: string;
  alt: string;
  caption: string | null;
}

export const imageBlock: BlockType<ImageBody> = {
  type: 'image',
  milestone: 'M8',
  shape: '{asset, alt, caption?}: an asset id from `asset put` (SVG, PNG, JPEG, GIF or WebP)',
  renders: 'the image, scaled to the page width; an SVG only ever via `<img>`, never inlined',
  validate(body, ctx) {
    const node = Node.root(body, ctx.path);
    const o = node.object(['asset', 'alt', 'caption']);
    const asset = node.get('asset').string({max: 64});
    if (asset !== undefined && !ctx.assets.has(asset)) node.get('asset').fail(`no asset "${asset}"; store it first with "lectio asset put <file>" and use the id it returns`);
    const alt = node.get('alt').string({max: 1000});
    const caption = node.get('caption').optionalString({max: CAPTION_MAX});
    return result(node.issues, o && asset !== undefined && alt !== undefined ? {asset, alt, caption: caption ?? null} : undefined);
  },
  plainText: body => [`[Image: ${body.alt}]`, ...(body.caption === null ? [] : [body.caption])].join('\n'),
  estimateSeconds: (body, ctx) => SECONDS_TO_LOOK + (ctx.assetLabels.get(body.asset) ?? 0) * SECONDS_PER_LABEL + readingSeconds(body.caption ?? ''),
  timed: `${SECONDS_TO_LOOK} s to look, ${SECONDS_PER_LABEL} s per label (an SVG's \`<text>\` elements; PNG, JPEG, GIF and WebP count none), and the caption's words`,
  tracks: ['seen'],
};
