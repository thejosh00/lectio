# Figures

How to make a picture that teaches. Your playbook says when a picture is worth it; this says how to
make one that works at phone width. Read it before you make one.

## The paper and the palette

Every picture sits on light paper (`#fdfcf9`) in both themes, so the same colours work everywhere.
Use these, and only these, so a colour means the same thing in every lesson:

| name | stroke / text | fill | for |
|---|---|---|---|
| ink | `#1a1a18` | `#ffffff` | lines, labels and text |
| muted | `#8a857b` | `#f2f0eb` | context the reader should look past |
| focus | `#d55e00` | `#fbe3d3` | the one part this picture is about |
| c1 | `#0072b2` | `#dcebf5` | a first kind of thing |
| c2 | `#007a5a` | `#d9efe7` | a second kind |
| c3 | `#b07800` | `#f8ecd2` | a third kind |
| c4 | `#b0558b` | `#f5e1ec` | a fourth kind |

- In mermaid **flowcharts and state diagrams** these are already classes: `class a focus` or
  `a:::focus`. Don't redefine them. Other diagram kinds have none.
- **One `focus` per picture**, and never by colour alone: a thicker stroke (the class has one), an
  arrow, or a label that says it. The other colours sort things into kinds; keep the same kind the same
  colour across a subject's lessons, and write down which is which in the subject plan.

## Labels

- **Name the parts on the picture, next to what they name.** No legend, and no "A, B, C — see the
  caption" unless the letters are the question.
- **One idea per picture.** Past about 25 things to read, it is two pictures.
- **Text you can read on a phone**: at least 12 px as shown. A drawing W wide is shown about 340 px
  wide, so its labels need `font-size` ≥ 12 × W / 340: 14 in a 340-wide drawing, 24 in a 680-wide
  one. `figure check` measures it.

## At phone width

The learner reads on a phone: about 340 px for the picture.

- **SVG**: draw it 340–680 wide, with a `viewBox`, and either no `width` or one equal to the
  viewBox's. Plain `font-family="sans-serif"`; nothing outside the file (no fonts, images or CSS from
  elsewhere: an `<img>` loads none of it).
- **Mermaid**: top-down (`flowchart TD`), at most 5 nodes side by side. Short node text; the words go
  in the lesson.
- Tapping a picture enlarges it, but write it to be read without that.

## Alt text, caption, credit

- **`alt`** is the picture in words for someone who can't see it: the mechanism, not the looks —
  "the borrow points at s1's buffer; s1 still owns it", not "a diagram of a borrow".
- **`caption`** is one sentence on what to look at, under 40 words, and not the alt again.
- **`credit`** (images): the maker and licence of a picture from elsewhere.

## Real things

- **A photo of the real thing** makes it concrete: the actual brake caliper, the actual breaker panel.
  Wikimedia Commons has many under CC0, CC BY or CC BY-SA: download it, `lectio asset put` it, and
  credit it ("Photo: <author>, CC BY-SA 4.0, Wikimedia Commons"). Never use a picture whose licence you
  can't name.
- **To label a photo**, make an SVG with the photo inside it as a data URI
  (`<image href="data:image/jpeg;base64,…" width=… height=…/>`) and the labels on top. Shrink the photo
  first (on macOS `sips -Z 1000 photo.jpg`), so the SVG stays small.
- **Plots**: `python3` (with matplotlib, when it's installed) can save an SVG; set its font sizes for
  340 px.

## Look before you submit

```bash
lectio figure check drawing.svg          # or diagram.mmd, or photo.jpg
```

It draws the picture as a phone shows it, on the paper, and saves a PNG: **look at it**, and fix what
you see. It also prints what a reader would notice — labels too small, a diagram too wide, a missing
`viewBox`. Lesson submit, block fix and asset put say the same things as `warnings`: fix them, or say
in your run summary why not.
