/**
 * Media types and what it takes to make them (M16). lectio can show a media type only once
 * it is built (a block type), and the tutor can make one only when the tools it needs are on
 * the machine it runs on. The tutor climbs this ladder one rung at a time, asking for the
 * next type when the evidence says the ones it has leave a gap, and judging each by whether
 * it helps the learner. Pure: the tool check itself is in `src/local/tools.ts`.
 */
import {BLOCK_TYPES, PLANNED_BLOCK_TYPES} from '../blocks/index.ts';

export interface Tool {
  name: string;
  what: string;
}

export const TOOLS: readonly Tool[] = [
  {name: 'chrome', what: "headless screenshots: look at an animation's frames, render HTML or SVG to an image"},
  {name: 'ffmpeg', what: 'encode frames and sound into a video or audio file'},
  {name: 'manim', what: 'render math and diagram animations to video'},
  {name: 'say', what: 'speak text into an audio file (macOS)'},
  {name: 'python3', what: 'run code examples; draw plots and charts as images'},
  {name: 'magick', what: 'convert, crop and resize images (ImageMagick)'},
];

/** The media ladder, cheapest first: what each type needs beyond writing it. Each inner list is alternatives; every group is needed. */
export const MEDIA_LADDER: ReadonlyArray<{type: string; needs: string[][]; note: string}> = [
  {type: 'image', needs: [], note: 'an SVG you write, or a picture made with any of the tools'},
  {type: 'diagram', needs: [], note: 'mermaid source; lectio draws it'},
  {type: 'steps', needs: [], note: 'frames you write, stepped through by the learner'},
  {type: 'widget', needs: [['chrome']], note: 'an animation or interactive in a sandbox; you look at its frames before submitting'},
  {type: 'audio', needs: [['say', 'ffmpeg']], note: 'spoken drills and explanations'},
  {type: 'video', needs: [['ffmpeg'], ['manim', 'chrome']], note: 'rendered animation; the most expensive rung'},
];

export interface MediaStatus {
  type: string;
  /** Whether lectio can show it yet: built, planned (with its milestone), or neither (propose it). */
  lectio: 'available' | 'planned' | 'not_planned';
  milestone: string | null;
  needs: string[][];
  /** The groups of tools still missing on this machine. */
  missing: string[][];
  /** Built, and makeable here. */
  ready: boolean;
  note: string;
}

export function mediaStatus(found: ReadonlySet<string>): MediaStatus[] {
  return MEDIA_LADDER.map(rung => {
    const built = BLOCK_TYPES.some(t => t.type === rung.type);
    const milestone = PLANNED_BLOCK_TYPES[rung.type] ?? null;
    const missing = rung.needs.filter(group => !group.some(tool => found.has(tool)));
    return {
      type: rung.type,
      lectio: built ? 'available' : milestone !== null ? 'planned' : 'not_planned',
      milestone: built ? null : milestone,
      needs: rung.needs,
      missing,
      ready: built && missing.length === 0,
      note: rung.note,
    };
  });
}
