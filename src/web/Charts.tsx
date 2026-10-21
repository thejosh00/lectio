/**
 * Small, quiet charts in plain SVG: one series each, so the title names it and no
 * legend is needed. Thin marks, hairline grid, a reference line where there is a target,
 * and a hover (or tap) readout. Every number is also in the tables beside them.
 */
import {useEffect, useRef, useState, type PointerEvent} from 'react';

const H = 180;
const PAD = {top: 16, right: 14, bottom: 26, left: 38};

/** The container's width, so the drawing is made at its real size and text stays 11px. */
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(340);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(260, Math.round(entries[0]!.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

export interface Point {
  /** The x label, e.g. a week's Monday. */
  x: string;
  /** null where there is nothing to plot. */
  y: number | null;
  /** What the readout says about it, beyond the value. */
  note?: string;
}

interface Props {
  points: Point[];
  /** The y range; values are drawn against it. */
  max: number;
  format: (y: number) => string;
  formatX?: (x: string) => string;
  /** A target or budget, drawn as a labelled line. */
  reference?: {y: number; label: string};
  /** Moments to mark along x (when changes shipped), by x label. */
  marks?: Array<{x: string; label: string}>;
  kind?: 'line' | 'columns';
  ariaLabel: string;
}

const shortDate = (x: string) => new Date(`${x}T12:00:00Z`).toLocaleDateString(undefined, {month: 'short', day: 'numeric', timeZone: 'UTC'});

export function Chart({points, max, format, formatX = shortDate, reference, marks = [], kind = 'line', ariaLabel}: Props) {
  const [active, setActive] = useState<number | null>(null);
  const box = useRef<SVGSVGElement>(null);
  const [wrap, W] = useWidth();
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const n = points.length;
  const band = n === 0 ? plotW : plotW / n;
  const xAt = (i: number) => PAD.left + band * i + band / 2;
  const yAt = (y: number) => PAD.top + plotH - (Math.min(y, max) / max) * plotH;
  const ticks = [0, max / 2, max];

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = box.current?.getBoundingClientRect();
    if (rect === undefined || n === 0) return;
    const x = ((e.clientX - rect.left) / rect.width) * W;
    setActive(Math.max(0, Math.min(n - 1, Math.floor((x - PAD.left) / band))));
  };

  const defined = points.map((p, i) => ({...p, i})).filter((p): p is Point & {y: number; i: number} => p.y !== null);
  const path = defined.map((p, k) => `${k === 0 ? 'M' : 'L'}${xAt(p.i).toFixed(1)},${yAt(p.y).toFixed(1)}`).join(' ');
  const area = defined.length > 1 ? `${path} L${xAt(defined.at(-1)!.i).toFixed(1)},${yAt(0)} L${xAt(defined[0]!.i).toFixed(1)},${yAt(0)} Z` : '';
  const colW = Math.min(24, band * 0.6);
  const last = defined.at(-1);
  const hovered = active === null ? undefined : points[active];

  return (
    <div ref={wrap} style={{position: 'relative'}}>
      <svg
        ref={box}
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={ariaLabel}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setActive(null)}
      >
        {ticks.map(t => (
          <g key={t}>
            <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={yAt(t)} y2={yAt(t)} />
            <text x={PAD.left - 6} y={yAt(t) + 4} textAnchor="end">
              {format(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          n <= Math.floor(W / 64) || i % Math.ceil(n / Math.floor(W / 64)) === 0 ? (
            <text key={p.x} x={xAt(i)} y={H - 8} textAnchor="middle">
              {formatX(p.x)}
            </text>
          ) : null,
        )}
        {marks.map(m => {
          const i = points.findIndex(p => p.x >= m.x);
          if (i === -1) return null;
          return <line key={m.x + m.label} className="ship" x1={xAt(i) - band / 2} x2={xAt(i) - band / 2} y1={PAD.top} y2={PAD.top + plotH} />;
        })}
        {reference !== undefined && (
          <g>
            <line className="ref" x1={PAD.left} x2={W - PAD.right} y1={yAt(reference.y)} y2={yAt(reference.y)} />
            <text x={W - PAD.right} y={yAt(reference.y) - 5} textAnchor="end">
              {reference.label}
            </text>
          </g>
        )}
        {kind === 'line' && (
          <>
            {area !== '' && <path className="area" d={area} />}
            <path className="series" d={path} />
            {defined.map(p => (
              <circle key={p.x} className={`dot ${active === p.i ? 'active' : ''}`} cx={xAt(p.i)} cy={yAt(p.y)} r={active === p.i ? 5.5 : 4} />
            ))}
            {last !== undefined && (
              <text className="label" x={Math.min(xAt(last.i) + 8, W - PAD.right)} y={yAt(last.y) - 8} textAnchor={xAt(last.i) + 40 > W ? 'end' : 'start'}>
                {format(last.y)}
              </text>
            )}
          </>
        )}
        {kind === 'columns' &&
          defined.map(p => {
            const top = yAt(p.y);
            const height = Math.max(0, yAt(0) - top);
            const r = Math.min(4, height / 2);
            const x = xAt(p.i) - colW / 2;
            const over = reference !== undefined && p.y > reference.y;
            return (
              <path
                key={p.x}
                className={`col ${over ? 'over' : ''} ${active === p.i ? 'active' : ''}`}
                d={`M${x},${yAt(0)} V${top + r} Q${x},${top} ${x + r},${top} H${x + colW - r} Q${x + colW},${top} ${x + colW},${top + r} V${yAt(0)} Z`}
              />
            );
          })}
        {kind === 'line' && active !== null && <line className="crosshair" x1={xAt(active)} x2={xAt(active)} y1={PAD.top} y2={PAD.top + plotH} />}
      </svg>
      {hovered !== undefined && active !== null && (
        <div className="tooltip" style={{left: `${Math.min(80, Math.max(2, (xAt(active) / W) * 100))}%`, top: 0}}>
          <strong>{hovered.y === null ? '—' : format(hovered.y)}</strong> <span className="muted">{formatX(hovered.x)}</span>
          {hovered.note !== undefined && <div className="muted">{hovered.note}</div>}
        </div>
      )}
    </div>
  );
}

/** Horizontal bars for a few labelled shares (calibration). */
export function ShareBars({rows}: {rows: Array<{label: string; rate: number | null; n: number}>}) {
  return (
    <div>
      {rows.map(r => (
        <div key={r.label} className="hbar">
          <span>{r.label}</span>
          <div className="track" role="img" aria-label={`${r.label}: ${r.rate === null ? 'no answers yet' : `${Math.round(r.rate * 100)}% right of ${r.n}`}`}>
            <span style={{width: `${Math.round((r.rate ?? 0) * 100)}%`}} />
          </div>
          <span className="value">
            {r.rate === null ? '—' : `${Math.round(r.rate * 100)}%`} <span className="muted small-text">n={r.n}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
