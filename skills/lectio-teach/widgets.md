# Widgets

How to make an animation or an interactive that teaches. Your playbook says when: motion that is
itself the idea, or something learnt by acting on it. A step-through first, when frames would do.

## The box

- **It runs sandboxed**: no network, no cookie, no storage, no `/api`. Everything comes from the page
  itself: data written inline, pictures as data URIs.
- **Libraries**: `libs: ["d3"]` (d3 7, global `d3`) or `["p5"]` (p5 1.11, global mode: `setup` and
  `draw`). Nothing else loads.
- **On the paper**, like every picture: draw with `lectio.theme` (`ink`, `muted`, `focus`, `c1`–`c4`,
  `paper`, and `focus_fill` and the like) or the CSS variables `--lectio-focus`, `--lectio-focus-fill`, ….
  The same colour means the same thing as in the subject's pictures.
- **About 358 px wide on a phone.** Lay out to `lectio.width` (a `lectio:resize` event says when it
  changes); text 14 px or more; anything to tap 40 px or more. Set the block's `height`; ask for
  another with `lectio.resize(px)`.

## Animations

- **Draw a moment**: `lectio.animate(draw, {duration})`, where `draw(t)` draws the picture at `t`
  seconds. The same `t` gives the same picture — no unseeded `Math.random`, no `Date.now` — so the
  scrubber and `widget check` show exactly that moment.
- **The page paces it**: play, pause, Step, scrub and replay are the page's, and it never autoplays.
  Don't build controls of your own.
- **Give it `steps`**: the moments that matter (`{at, caption}`), each caption saying what is happening
  then. Step jumps to the next; the caption shows as each is reached. Keep to a few, under ten.
- 5–30 seconds; one thing moving at a time, in `focus`.

## Interactives and simulations

- **One goal**, in `goal`: "Set the threshold so only the edges are left." An interactive without a
  goal teaches little.
- Show the result of each change at once, labelled. Call `lectio.event(name)` for each thing the
  learner does and `lectio.done()` when the goal is reached.
- **`predict`** has them guess before it starts ("What happens to the edges as the threshold
  rises?"): the guess is what makes the result mean something.
- One idea per widget. If it needs instructions longer than its goal, it is two widgets.

## Widget questions

A `widget` question is answered by doing: set the threshold, route the request, place the kernel. The
widget scores it and calls `lectio.answer({value, score})` when the learner commits — `value` says
what they did ("threshold 120"), `score` is 0–1 — and their confidence submits it.

- Give it a "That's it" button that answers; don't answer on every change.
- Score what the goal asks, generously at the edges: a range, not one exact value.
- Partial credit only where there are parts (three of four requests routed right is 0.75).
- `widget check` it like any widget: a frame, and nothing it throws.
- The terminal quiz can't show one, so keep a quiz from being only widgets.

## Look before you submit

```bash
lectio widget check widget.html --kind animation --frames 0,2,5 --height 260
```

It draws the widget as lectio serves it, under the same sandbox, at phone width, once per moment, and
lists anything it throws or anything the sandbox blocks: **look at every PNG**, and fix what you see.
Errors on the learner's phone reach you as `widget_errors`, with the line. The first lessons with a
widget are two-arm lessons against a step-through of the same idea.

## A start

```html
<canvas id="c" width="340" height="220" style="width:100%"></canvas>
<script>
  const g = document.getElementById('c').getContext('2d');
  const T = lectio.theme;
  lectio.animate(t => {
    g.fillStyle = T.paper;
    g.fillRect(0, 0, 340, 220);
    // … draw the moment t
  }, {duration: 8});
</script>
```
