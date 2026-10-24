import {Node, result} from '../core/validate.ts';
import {readingSeconds, type BlockType} from './types.ts';

export interface DiagramBody {
  mermaid: string;
  alt: string;
  caption: string | null;
}

/** Mermaid source is small by nature; a page-long one would not read at phone width either. */
export const DIAGRAM_MAX_SOURCE = 4000;

/** About fifteen seconds to take a diagram in. */
const SECONDS_PER_DIAGRAM = 15;

/**
 * A mermaid diagram. Whether the source parses is a question for mermaid, which isn't pure,
 * so the server asks it before validating and hands the answers in as `ctx.diagrams`
 * (source → error, or null when it parses). A source nobody checked is refused: no
 * diagram reaches the learner broken.
 */
export const diagramBlock: BlockType<DiagramBody> = {
  type: 'diagram',
  milestone: 'M8',
  shape: '{mermaid, alt, caption?}',
  renders: 'a mermaid diagram, drawn as an image that scales to the page; alt if it fails',
  validate(body, ctx) {
    const node = Node.root(body, ctx.path);
    const o = node.object(['mermaid', 'alt', 'caption']);
    const sourceNode = node.get('mermaid');
    const source = sourceNode.string({max: DIAGRAM_MAX_SOURCE});
    const alt = node.get('alt').string({max: 2000});
    const caption = node.get('caption').optionalString({max: 500});
    if (source !== undefined) {
      const verdict = ctx.diagrams.get(source);
      if (verdict === undefined) sourceNode.fail("couldn't be checked against mermaid; try again");
      else if (verdict !== null) sourceNode.fail(`doesn't parse as mermaid: ${verdict}`);
    }
    return result(node.issues, o && source !== undefined && alt !== undefined ? {mermaid: source, alt, caption: caption ?? null} : undefined);
  },
  plainText: body => `[Diagram${body.caption === null ? '' : `: ${body.caption}`}] ${body.alt}`,
  estimateSeconds: body => SECONDS_PER_DIAGRAM + readingSeconds(body.caption ?? ''),
  tracks: ['seen'],
};
