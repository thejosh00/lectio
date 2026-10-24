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

/** Each source → mermaid's complaint, or null when it parses. */
export async function checkMermaid(sources: Iterable<string>): Promise<Map<string, string | null>> {
  const verdicts = new Map<string, string | null>();
  for (const source of sources) {
    if (verdicts.has(source) || source.trim() === '' || source.length > DIAGRAM_MAX_SOURCE) continue;
    parser ??= loadParser();
    try {
      await (await parser)(source);
      verdicts.set(source, null);
    } catch (error) {
      verdicts.set(source, firstLine(error) || 'mermaid refused it');
    }
  }
  return verdicts;
}

/** The mermaid sources of the diagram blocks in a lesson (`{blocks: […]}`) or a single block. */
export function diagramSources(value: unknown): string[] {
  const record = (v: unknown) => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
  const root = record(value);
  if (root === undefined) return [];
  const blocks = Array.isArray(root['blocks']) ? root['blocks'] : [root];
  return blocks.flatMap(block => {
    const b = record(block);
    const body = record(b?.['body']);
    return b?.['type'] === 'diagram' && typeof body?.['mermaid'] === 'string' ? [body['mermaid']] : [];
  });
}

/** What the validator needs to know about a submission's diagrams. */
export const diagramVerdicts = (value: unknown) => checkMermaid(diagramSources(value));
