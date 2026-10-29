/**
 * The `diagram` block. Mermaid is large, so it is imported here, on demand, by URL from
 * the server (`/mermaid/`, the installed package's browser build; see `src/server/static.ts`)
 * — never bundled into the page, so only a lesson with a diagram fetches it. It runs with
 * `securityLevel: 'strict'` and plain SVG labels, and the SVG it draws is shown through an
 * `<img>`, where no script in it can run. If mermaid can't draw it, the learner reads the alt.
 *
 * Diagrams are drawn light, on the figure paper, in both themes (M17), with the palette's
 * classes defined (`class a focus`), so a colour means the same in a diagram as in an SVG.
 */
import {useEffect, useState} from 'react';
import {MERMAID_CONFIG, naturalSize, withPalette} from '../../core/palette.ts';
import type {BlockView} from '../api.ts';
import {Figure} from './Figure.tsx';

type Mermaid = (typeof import('mermaid'))['default'];
/** A variable, so the bundler leaves the import alone. */
const MERMAID_URL = '/mermaid/mermaid.esm.min.mjs';
let loading: Promise<Mermaid> | undefined;
let counter = 0;

function mermaid(): Promise<Mermaid> {
  loading ??= (import(MERMAID_URL) as Promise<typeof import('mermaid')>).then(m => {
    m.default.initialize({...MERMAID_CONFIG, flowchart: {...MERMAID_CONFIG.flowchart}});
    return m.default;
  });
  return loading;
}

/** Draws one source to an SVG data URL; mermaid renders one diagram at a time. */
let queue: Promise<unknown> = Promise.resolve();
export function drawDiagram(source: string): Promise<string> {
  const run = queue.then(async () => {
    const {svg} = await (await mermaid()).render(`lectio-diagram-${++counter}`, withPalette(source));
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(naturalSize(svg))}`;
  });
  queue = run.catch(() => undefined);
  return run;
}

/** A mermaid source drawn as a figure; the alt stands in while it draws and if it can't be drawn. */
export function MermaidFigure({source, alt, caption, className}: {source: string; alt: string; caption?: string | null; className?: string}) {
  const [state, setState] = useState<{src: string} | 'loading' | 'failed'>('loading');

  useEffect(() => {
    let live = true;
    drawDiagram(source).then(
      src => live && setState({src}),
      () => live && setState('failed'),
    );
    return () => {
      live = false;
    };
  }, [source]);

  return (
    <Figure src={typeof state === 'object' ? state.src : null} alt={alt} caption={caption ?? null} className={`diagram-block ${className ?? ''}`}>
      {state === 'failed' ? (
        <p className="diagram-alt" role="img" aria-label={alt}>
          {alt}
        </p>
      ) : (
        <div className="diagram-loading muted" aria-busy="true">
          Drawing the diagram…
        </div>
      )}
    </Figure>
  );
}

export function DiagramBlock({block}: {block: BlockView}) {
  const caption = block.body['caption'];
  return <MermaidFigure source={String(block.body['mermaid'] ?? '')} alt={String(block.body['alt'] ?? '')} caption={typeof caption === 'string' ? caption : null} />;
}
