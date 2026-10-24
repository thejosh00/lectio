/**
 * The `diagram` block. Mermaid is large, so it is imported here, on demand, by URL from
 * the server (`/mermaid/`, the installed package's browser build; see `src/server/static.ts`)
 * — never bundled into the page, so only a lesson with a diagram fetches it. It runs with
 * `securityLevel: 'strict'` and plain SVG labels, and the SVG it draws is shown through an
 * `<img>`, where no script in it can run. If mermaid can't draw it, the learner reads the alt.
 */
import {useEffect, useState} from 'react';
import type {BlockView} from '../api.ts';

type Mermaid = (typeof import('mermaid'))['default'];
/** A variable, so the bundler leaves the import alone. */
const MERMAID_URL = '/mermaid/mermaid.esm.min.mjs';
let loading: Promise<Mermaid> | undefined;
let theme: string | undefined;
let counter = 0;

async function mermaidFor(dark: boolean): Promise<Mermaid> {
  loading ??= (import(MERMAID_URL) as Promise<typeof import('mermaid')>).then(m => m.default);
  const mermaid = await loading;
  const wanted = dark ? 'dark' : 'neutral';
  if (theme !== wanted) {
    mermaid.initialize({startOnLoad: false, securityLevel: 'strict', theme: wanted, htmlLabels: false, flowchart: {htmlLabels: false}});
    theme = wanted;
  }
  return mermaid;
}

/** Draws one source to an SVG data URL; mermaid renders one diagram at a time. */
let queue: Promise<unknown> = Promise.resolve();
function draw(source: string, dark: boolean): Promise<string> {
  const run = queue.then(async () => {
    const mermaid = await mermaidFor(dark);
    const {svg} = await mermaid.render(`lectio-diagram-${++counter}`, source);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  queue = run.catch(() => undefined);
  return run;
}

export function DiagramBlock({block}: {block: BlockView}) {
  const source = String(block.body['mermaid'] ?? '');
  const alt = String(block.body['alt'] ?? '');
  const caption = typeof block.body['caption'] === 'string' ? block.body['caption'] : null;
  const [state, setState] = useState<{src: string} | 'loading' | 'failed'>('loading');

  useEffect(() => {
    let live = true;
    const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    draw(source, dark).then(
      src => live && setState({src}),
      () => live && setState('failed'),
    );
    return () => {
      live = false;
    };
  }, [source]);

  return (
    <figure className="diagram-block">
      {state === 'failed' ? (
        <p className="diagram-alt" role="img" aria-label={alt}>
          {alt}
        </p>
      ) : state === 'loading' ? (
        <div className="diagram-loading muted" aria-busy="true">
          Drawing the diagram…
        </div>
      ) : (
        <img src={state.src} alt={alt} />
      )}
      {caption !== null && <figcaption className="caption">{caption}</figcaption>}
    </figure>
  );
}
