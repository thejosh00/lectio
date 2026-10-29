/**
 * Checking mermaid sources when a lesson is written, so a broken diagram is refused rather
 * than shown broken. Runs mermaid's own parser (`mermaid.parse`) in the server, loaded on
 * the first diagram and never on a lesson without one. Nothing here touches the network.
 *
 * Mermaid sanitizes labels with DOMPurify, which needs a DOM the server doesn't have; without
 * one DOMPurify exports a stub with no methods. Parsing renders nothing and nothing it
 * produces is kept, so the stub gets no-op hooks and an identity `sanitize`. The page renders
 * with the real DOMPurify, under `securityLevel: 'strict'`.
 *
 * What this catches: unknown diagram types and every grammar error mermaid's parsers report.
 * What it can't: problems that only show up when laying out (rare); the page shows the alt then.
 */
import {DIAGRAM_MAX_SOURCE} from '../blocks/diagram.ts';
import {withPalette} from '../core/palette.ts';

type Parser = (source: string) => Promise<unknown>;
let parser: Promise<Parser> | undefined;

async function loadParser(): Promise<Parser> {
  const purify = (await import('dompurify')).default as unknown as Record<string, unknown>;
  const noop = () => {};
  for (const name of ['addHook', 'removeHook', 'removeHooks', 'removeAllHooks']) if (typeof purify[name] !== 'function') purify[name] = noop;
  if (typeof purify['sanitize'] !== 'function') purify['sanitize'] = (text: unknown) => text;
  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({startOnLoad: false, securityLevel: 'strict'});
  return source => mermaid.parse(source);
}

const firstLine = (error: unknown) =>
  String(error instanceof Error ? error.message : error)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);

/** Each source → mermaid's complaint, or null when it parses — as the page draws it, with the palette's classes. */
export async function checkMermaid(sources: Iterable<string>): Promise<Map<string, string | null>> {
  const verdicts = new Map<string, string | null>();
  for (const source of sources) {
    if (verdicts.has(source) || source.trim() === '' || source.length > DIAGRAM_MAX_SOURCE) continue;
    parser ??= loadParser();
    try {
      await (await parser)(withPalette(source));
      verdicts.set(source, null);
    } catch (error) {
      verdicts.set(source, firstLine(error) || 'mermaid refused it');
    }
  }
  return verdicts;
}

const record = (v: unknown) => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const mermaidOf = (v: unknown) => {
  const source = record(v)?.['mermaid'];
  return typeof source === 'string' ? [source] : [];
};

/** The mermaid sources in a lesson (`{blocks: […]}`) or a single block: diagram blocks and step-through frames. */
export function diagramSources(value: unknown): string[] {
  const root = record(value);
  if (root === undefined) return [];
  const blocks = Array.isArray(root['blocks']) ? root['blocks'] : [root];
  return blocks.flatMap(block => {
    const b = record(block);
    const body = record(b?.['body']);
    if (b?.['type'] === 'diagram') return mermaidOf(body);
    if (b?.['type'] === 'steps' && Array.isArray(body?.['frames'])) return body['frames'].flatMap(mermaidOf);
    return [];
  });
}

/** What the validator needs to know about a submission's diagrams. */
export const diagramVerdicts = (value: unknown) => checkMermaid(diagramSources(value));
