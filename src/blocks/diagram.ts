import {Node, result} from '../core/validate.ts';
import {CAPTION_MAX, readingSeconds, SECONDS_PER_LABEL, SECONDS_TO_LOOK, type BlockType} from './types.ts';

export interface DiagramBody {
  mermaid: string;
  alt: string;
  caption: string | null;
}

/** Mermaid source is small by nature; a page-long one would not read at phone width either. */
export const DIAGRAM_MAX_SOURCE = 4000;

/** Lines that arrange or style a diagram, or open a section of one, and give the reader nothing to read. */
const ARRANGES = /^(end|style|classDef|class|linkStyle|click|direction|accTitle|accDescr|autonumber|activate|deactivate|loop|alt|else|opt|par|and|rect|critical|break|option|dateFormat|axisFormat|excludes|todayMarker|tickInterval)\b/;
/** Lines that are a label of their own. */
const LABEL_LINE = /^(subgraph|title|section|note)\b/i;
/** A link or a message between two elements: `-->`, `-.->`, `==>`, `---`, `->>`, `--x`, `<|--`, `||--o{`… */
const LINK = /\s*[<>|}*o]{0,2}(?:-{2,}|-(?=[>x)])|={2,}|-?\.+-|~{3})[-.=]*[>|{*ox)]{0,2}\s*/;
/** A link with its text written inline: `-- text -->`, `-. text .->`, `== text ==>`. */
const TEXT_LINK = /(?<![-=.])(?:--|==|-\.)\s+[^->=.\s][^>]*?\s*(?:-->|==>|\.->|---|===|--x|--o)/g;
const ID = /^[\p{L}_][\p{L}\p{N}_-]*/u;

/**
 * Roughly how many things a diagram gives the reader to take in: its distinct nodes, and its
 * links, messages and notes that carry text. Read from the source, not from mermaid, so the
 * estimate stays pure; exact for flowcharts and sequence diagrams, near enough for the rest.
 */
export function diagramElements(source: string): number {
  const parts = diagramParts(source);
  return parts.nodes + parts.labels;
}

/** A diagram's distinct nodes, and the other things in it with text to read. */
export function diagramParts(source: string): {nodes: number; labels: number} {
  const lines = source
    .split('\n')
    .map(line => line.replace(/%%.*$/, '').trim())
    .filter(line => line !== '');
  const nodes = new Set<string>();
  let labels = 0;
  // The first line names the diagram's type.
  for (const raw of lines.slice(1)) {
    if (ARRANGES.test(raw)) continue;
    if (LABEL_LINE.test(raw)) {
      labels++;
      continue;
    }
    const labelsBefore = labels;
    let named = false;
    // Quoted text can hold anything, and a node's text sits in its shape: neither is structure.
    let line = raw.replace(/"[^"]*"/g, '""').replace(/[[({]+[^\])}]*[\])}]+/g, '[]');
    const colon = /(?<!:):(?!:)\s*\S/.exec(line);
    if (colon !== null) {
      labels++;
      line = line.slice(0, colon.index);
    }
    line = line.replace(/\|[^|]+\|/g, () => (labels++, ' ')).replace(TEXT_LINK, () => (labels++, ' --> '));
    for (const piece of line.split(LINK).flatMap(part => part.split('&'))) {
      const text = piece.trim().replace(/^(participant|actor|state)\s+/, '');
      // `participant C as Client` is C; `state "Waiting a while" as wait` is wait.
      const id = ID.exec(text)?.[0] ?? /\bas\s+(\S+)/.exec(text)?.[1];
      if (id === undefined) continue;
      nodes.add(id);
      named = true;
    }
    // A line with nothing recognisable on it is still one thing to read: a member, an item.
    if (!named && labels === labelsBefore) labels++;
  }
  return {nodes: nodes.size, labels};
}

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
  renders: 'a mermaid diagram on the figure paper, scaled to the page, tap to enlarge; the palette classes `focus`, `muted`, `c1`–`c4` are defined in flowcharts and state diagrams; alt if it fails',
  validate(body, ctx) {
    const node = Node.root(body, ctx.path);
    const o = node.object(['mermaid', 'alt', 'caption']);
    const sourceNode = node.get('mermaid');
    const source = sourceNode.string({max: DIAGRAM_MAX_SOURCE});
    const alt = node.get('alt').string({max: 2000});
    const caption = node.get('caption').optionalString({max: CAPTION_MAX});
    if (source !== undefined) {
      const verdict = ctx.diagrams.get(source);
      if (verdict === undefined) sourceNode.fail("couldn't be checked against mermaid; try again");
      else if (verdict !== null) sourceNode.fail(`doesn't parse as mermaid: ${verdict}`);
    }
    return result(node.issues, o && source !== undefined && alt !== undefined ? {mermaid: source, alt, caption: caption ?? null} : undefined);
  },
  plainText: body => `[Diagram${body.caption === null ? '' : `: ${body.caption}`}] ${body.alt}`,
  estimateSeconds: body => SECONDS_TO_LOOK + diagramElements(body.mermaid) * SECONDS_PER_LABEL + readingSeconds(body.caption ?? ''),
  timed: `${SECONDS_TO_LOOK} s to look, ${SECONDS_PER_LABEL} s per element (each node, and each link, message or note with text), and the caption's words`,
  tracks: ['seen'],
};
