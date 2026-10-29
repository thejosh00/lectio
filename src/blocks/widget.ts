import {WIDGET_LIB_NAMES, type WidgetLib} from '../core/widget.ts';
import {byteLength, Node, result} from '../core/validate.ts';
import {CAPTION_MAX, readingSeconds, SECONDS_TO_LOOK, type BlockType} from './types.ts';

export const WIDGET_KINDS = ['animation', 'interactive', 'simulation'] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

export interface WidgetStep {
  /** Seconds into the animation. */
  at: number;
  caption: string;
}

export interface WidgetBody {
  kind: WidgetKind;
  html: string;
  libs: WidgetLib[];
  /** The frame's height in CSS pixels; the widget can ask for another with `lectio.resize`. */
  height: number;
  alt: string;
  caption: string | null;
  /** An animation's length in seconds: its drawing is `draw(t)` for t from 0 to this. */
  duration: number | null;
  /** An animation's moments, each with what is happening then: Step jumps between them. */
  steps: WidgetStep[];
  /** What the learner is to make happen, for an interactive or a simulation. */
  goal: string | null;
  /** A guess to make before it starts. */
  predict: string | null;
}

export const WIDGET_MAX_STEPS = 12;
export const WIDGET_MAX_SECONDS = 120;
export const WIDGET_TEXT_MAX = 300;
/** An interactive is used, not watched: about a minute with its goal. */
export const SECONDS_PER_INTERACTIVE = 60;
/** A guess before it starts. */
export const SECONDS_TO_PREDICT = 5;

const words = (...texts: Array<string | null>) => readingSeconds(texts.filter((t): t is string => t !== null).join(' '));

/**
 * An animation, an interactive or a simulation (M21): HTML the tutor writes, run in a sandbox
 * (src/core/widget.ts). An animation draws a moment, `lectio.animate(draw, {duration})`, and the
 * page paces it: play, pause, step and scrub, each step's caption beside it. An interactive or a
 * simulation has a goal, said above it, and calls `lectio.done()` when the learner reaches it.
 */
export const widgetBlock: BlockType<WidgetBody> = {
  type: 'widget',
  milestone: 'M21',
  shape: `{kind: animation|interactive|simulation, html, libs?: [${WIDGET_LIB_NAMES.join('|')}], height (120–900), alt, caption?, duration (animation, s), steps? (animation: [{at, caption}]), goal (interactive, simulation), predict?}`,
  renders: 'a sandboxed frame on the figure paper; an animation with play, pause, step, a scrubber and the caption of the step it is in; an interactive or simulation under its goal; a guess first when it has `predict`',
  validate(body, ctx) {
    const node = Node.root(body, ctx.path);
    const o = node.object(['kind', 'html', 'libs', 'height', 'alt', 'caption', 'duration', 'steps', 'goal', 'predict']);
    const kind = node.get('kind').oneOf(WIDGET_KINDS);
    const htmlNode = node.get('html');
    const html = htmlNode.string();
    if (html !== undefined && byteLength(html) > ctx.limits.widget_max_bytes) htmlNode.fail(`is ${byteLength(html)} bytes; the most is ${ctx.limits.widget_max_bytes} (widget_max_bytes)`);
    const libs: WidgetLib[] = [];
    for (const lib of node.get('libs').optionalArray({max: WIDGET_LIB_NAMES.length})) {
      const name = lib.oneOf(WIDGET_LIB_NAMES);
      if (name !== undefined && !libs.includes(name)) libs.push(name);
    }
    const height = node.get('height').number({integer: true, min: 120, max: 900});
    const alt = node.get('alt').string({max: 2000});
    const caption = node.get('caption').optionalString({max: CAPTION_MAX});
    const predict = node.get('predict').optionalString({max: WIDGET_TEXT_MAX});
    const durationNode = node.get('duration');
    const stepsNode = node.get('steps');
    const goalNode = node.get('goal');
    let duration: number | undefined;
    let goal: string | undefined;
    const steps: WidgetStep[] = [];
    if (kind === 'animation') {
      duration = durationNode.number({min: 1, max: WIDGET_MAX_SECONDS});
      let previous = -1;
      for (const step of stepsNode.optionalArray({max: WIDGET_MAX_STEPS})) {
        if (step.object(['at', 'caption']) === undefined) continue;
        const at = step.get('at').number({min: 0, max: duration ?? WIDGET_MAX_SECONDS});
        const text = step.get('caption').string({max: 200});
        if (at !== undefined && at <= previous) step.get('at').fail('steps go in order of time, each later than the one before');
        if (at !== undefined && text !== undefined) steps.push({at, caption: text});
        previous = at ?? previous;
      }
      if (goalNode.present) goalNode.fail('an animation is watched, not worked: give it steps; a goal is for an interactive or a simulation');
    } else if (kind !== undefined) {
      if (goalNode.present) goal = goalNode.string({max: WIDGET_TEXT_MAX});
      else goalNode.fail('is required: what the learner is to make happen (an interactive without a goal teaches little)');
      if (durationNode.present) durationNode.fail('is for an animation: an interactive runs as long as the learner uses it');
      if (stepsNode.present) stepsNode.fail('are for an animation');
    }
    const ok = o && kind !== undefined && html !== undefined && height !== undefined && alt !== undefined && (kind === 'animation' ? duration !== undefined : goal !== undefined);
    return result(
      node.issues,
      ok ? {kind, html, libs, height, alt, caption: caption ?? null, duration: duration ?? null, steps, goal: goal ?? null, predict: predict === undefined || predict.trim() === '' ? null : predict} : undefined,
    );
  },
  plainText: body =>
    [
      `[${body.kind === 'animation' ? 'Animation' : body.kind === 'simulation' ? 'Simulation' : 'Interactive'}: ${body.alt}]`,
      ...(body.caption === null ? [] : [body.caption]),
      ...(body.goal === null ? [] : [`Goal: ${body.goal}`]),
      ...(body.predict === null ? [] : [`(guess first: ${body.predict})`]),
      ...body.steps.map(step => `at ${step.at} s: ${step.caption}`),
    ].join('\n'),
  estimateSeconds: body =>
    (body.kind === 'animation' ? SECONDS_TO_LOOK + (body.duration ?? 0) : SECONDS_PER_INTERACTIVE) + words(body.caption, body.goal, ...body.steps.map(s => s.caption)) + (body.predict === null ? 0 : SECONDS_TO_PREDICT),
  timed: `an animation ${SECONDS_TO_LOOK} s and its duration, an interactive or simulation ${SECONDS_PER_INTERACTIVE} s; the words of its caption, goal and steps; ${SECONDS_TO_PREDICT} s for a guess`,
  tracks: ['seen', 'interactions', 'completed', 'errors'],
};
