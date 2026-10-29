/**
 * A picture as the learner sees it (M17): on the figure paper — light in both themes, so the
 * tutor's colours and dark strokes read the same everywhere (src/core/palette.ts) — with its
 * caption tied to it, and a tap to see it larger. At phone width a picture is often smaller
 * than it was drawn; enlarged, it can be panned and pinched.
 *
 * Used by image and diagram blocks, step-through frames and question figures. The picture is
 * always an `<img>`, so no script in an SVG ever runs.
 */
import {useId, useRef, useState, type ReactNode} from 'react';

/** Where an asset's bytes are served, for an `<img>`. */
export const assetUrl = (id: unknown) => `/assets/${encodeURIComponent(String(id ?? ''))}`;

export function Figure({src, alt, caption, credit, className, children}: {src: string | null; alt: string; caption?: string | null; credit?: string | null; className?: string; children?: ReactNode}) {
  const captionId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const shown = useRef<HTMLImageElement>(null);
  const [open, setOpen] = useState(false);
  /** Enlarged: its own size when the column shrank it; twice the column when it didn't. null fits the screen. */
  const [zoom, setZoom] = useState<{width: number; on: boolean}>({width: 0, on: false});
  const enlarge = () => {
    const img = shown.current;
    const natural = img?.naturalWidth ?? 0;
    const column = img?.clientWidth ?? 0;
    setZoom({width: Math.max(natural, column * 2), on: natural > column * 1.1});
    setOpen(true);
    dialog.current?.showModal();
  };
  const described = caption !== null && caption !== undefined && caption !== '' ? captionId : undefined;
  return (
    <figure className={`figure ${className ?? ''}`}>
      {src === null ? (
        children
      ) : (
        <>
          <button type="button" className="figure-paper" onClick={enlarge} aria-label={`Enlarge: ${alt}`}>
            <img ref={shown} src={src} alt={alt} loading="lazy" aria-describedby={described} />
          </button>
          <dialog ref={dialog} className="figure-zoom" aria-label={alt} onClose={() => setOpen(false)} onClick={e => e.target === e.currentTarget && dialog.current?.close()}>
            <div className="figure-zoom-bar">
              <button type="button" onClick={() => setZoom({...zoom, on: !zoom.on})}>
                {zoom.on ? 'Fit' : 'Zoom'}
              </button>
              <button type="button" onClick={() => dialog.current?.close()}>
                Close
              </button>
            </div>
            {/* Only once opened, so a lesson's pictures load once. */}
            {open && (
              <>
                <div className="figure-zoom-paper">
                  <img src={src} alt={alt} className={zoom.on ? 'zoomed' : ''} style={zoom.on && zoom.width > 0 ? {width: zoom.width} : undefined} />
                </div>
                {described !== undefined && <p className="caption">{caption}</p>}
              </>
            )}
          </dialog>
        </>
      )}
      {(described !== undefined || (credit !== null && credit !== undefined)) && (
        <figcaption className="caption" id={captionId}>
          {caption}
          {credit !== null && credit !== undefined && <span className="credit">{credit}</span>}
        </figcaption>
      )}
    </figure>
  );
}
