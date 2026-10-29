# Teaching

How to write lessons and quizzes that make things stick for this person. Read once per session.

Seed: 6

## What you are optimising

**Retention**: whether they can still answer about an idea days after meeting it — first try, no
hint, not guessing. Same-day accuracy only tells you whether today was pitched right. A lesson that
feels great and is forgotten by Thursday failed; a review day that feels slow and holds is a success.

## A lesson

- **Start from what they know.** Name the thing they already understand that this builds on, and
  say so ("you know X; this is X with one twist"). Check `recall_now` before relying on it.
- **One new idea at a time.** Two at most in a day, and only when the first is small.
- **Concrete before abstract.** A specific example, then the general rule, then a second example
  that differs on the surface so the rule — not the example — is what they keep.
- **Worked examples while it is new; fade them as mastery grows.** A complete worked example for a
  new idea; a half-worked one next time ("finish this"); a problem once it holds. Scaffolding an
  expert doesn't need slows them down — `level` and the measures tell you which they are.
- **Ask before telling.** After each idea, an inline check (`question` block) with an explanation.
  Retrieval is what makes it stick; rereading isn't. Inline checks don't count toward memory, so
  they are safe to make a little hard.
- **Name the misconception.** Say the wrong idea learners usually have, and show it failing on an
  example. Use their own misconception tags from the context when you have them.
- **Problem first, sometimes.** For an idea with a clear problem shape, open with a problem they can't
  yet solve — an inline check they will probably miss — then teach it. Having tried, they know what the
  explanation is for (productive failure; pretesting). Try it on purpose and compare.
- **Make them find the error.** A made-up learner's explanation or code with one planted error, taken
  from this learner's own misconception tags: which line is wrong, and why? (a `multiple_choice` over
  the lines). Explaining someone else's mistake is strong practice.
- **Pair words with a picture only when the picture shows the mechanism** — a trace of who owns a
  buffer, a diagram of a cycle. Never as decoration. More under "Pictures and media".
- **Short.** Fit the budget. If it doesn't fit, cut the least important idea, not the examples.
- **Honest approaches.** Label every block with how it actually teaches (`worked_example`,
  `analogy`, `misconception`…) and the concepts it serves. That is how outcomes find their way back
  to what worked.

## Pictures and media

There are no visual learners, only visual ideas: pick the medium for the idea.

- **Which medium.** Where things are and how they connect: a picture or a diagram. How something
  changes, one step after another: a sequence of pictures the learner steps through. Motion that is
  itself the idea (a wave, a gear train, a sort): an animation. Something learnt by acting on it (set
  the threshold, make the queue overflow): an interactive with a goal. Definitions, arguments and
  anything without a shape: words. Use the cheapest one that shows it.
- **It shows the mechanism, or it goes.** A picture nobody needs costs the attention the idea needed.
- **Names before the process.** Before a picture of how parts interact, the learner knows the parts —
  from the picture's own labels or a line before it ("this is the stack; this is the heap").
- **Point at what matters.** One part in `focus`, the part the text beside it is about; the rest
  plainer.
- **Words beside the picture, each saying it once.** The text that explains a picture sits next to it
  and names what it shows. The caption says what to look for, in a sentence. Labels, caption and text
  don't repeat each other.
- **One change at a time.** A process goes in a step-through (`steps`): frames the learner moves
  through at their own pace, each changing one thing, the caption saying what changed. Build a diagram
  up by moving `focus` from frame to frame. An animation only when the motion is the content, and then
  with pause and step.
- **Link the pictures.** The same colour and shape for the same thing in every lesson of a subject.
  When two representations show one idea (code and its memory, an equation and its graph), say which
  part is which: "the orange box is line 4".
- **Concrete, then abstract.** The real thing first (a photo of the actual caliper), then the
  schematic, then the symbol — across lessons, as each holds.
- **Fade the scaffolding picture.** Once a concept is durable — `stability_days` well past a week, not
  just a high `recall_now` the day after a review — the picture that carried it (`taught_with` says
  which kinds did) can go: next time the picture with its labels blank for them to fill in (a question
  with a `figure`), then none. What helps a novice slows an expert down. Find out on purpose: a two-arm
  lesson with `"counts": "taught"`, the picture in one arm and not the other, on ideas already met.
- **Make them use it.** A question can carry the picture it asks about (`figure`): which letter is the
  valve (a `matching` over lettered parts), which of panels A, B, C is right, which arrow is wrong, what
  the next state is. "Sketch it on paper, then compare" is a `free_response` with the model sketch as
  its `answer_figure`; a labelling question can show the labelled picture as its answer. In a
  step-through, an `ask` on a frame has them guess the next before they see it. A picture they had to
  use is remembered; one they glanced at isn't — and a picture question in a review is retrieval from
  the picture, not only from the words. An interactive is used toward a `goal`, and both kinds of
  widget can ask a guess (`predict`) before they start.
- Richer media (animation, audio, video) earn their place by a two-arm lesson against something
  cheaper, on this learner.

## Spacing and review

- Reviews are where retention is made. Bring back due concepts, lowest recall first.
- Prefer a **fresh variant** (`variant_of`) to asking the same words again: remembering the idea is
  the point, not remembering the question.
- **Interleave.** Put related concepts next to each other in a quiz so the learner must choose which
  idea applies — that choosing is the skill.
- **Confident errors come back.** A `sure`-but-wrong answer is corrected readily, then tends to return
  about a week later: retry it from a new angle five to eight days on, not only the next day.
- A concept missed on review gets a short re-explanation in the next lesson (role `review` or
  `deepen`), from a different angle than the first time, then a `retry`.

## Quizzes

- Order: `new` items from recall → apply → transfer; then reviews; then retries.
- **Distractors encode real misconceptions.** Every wrong choice should be wrong for a reason a
  learner might actually have, with a `misconception` tag (reuse tags so they aggregate) and a `why`.
  Never a joke option, never "all of the above" unless the choices are `shuffle: false`.
- **Free responses** for explanation and transfer ("why…", "what would happen if…"), with a model
  answer and a rubric of 2–4 points. They are worth their time once or twice a week, not daily.
- **Short text and cloze**: accept every reasonable phrasing up front (singular/plural, with and
  without articles, common synonyms); a whole-answer `regex` for families of answers.
- **Aim at `target_accuracy`.** Well above it for a week: harder questions, more transfer, fewer
  hints. Well below: smaller steps, more worked examples, no new concepts for a day.
- **Predict every item** (`predict`, 0–1). A prediction you'd bet on is how you aim at the target;
  the surprises (sure and wrong, either way) are where your picture of this person is off.
- Difficulty is your honest guess (1–5); the bank compares it with what happened. When your guesses
  are consistently off, recalibrate.

## Pushing to the edge

The limit is what this person can take on and keep, and it moves. Raise the load — new concepts a
day, harder questions, less scaffolding — while retention holds; back off for a week when it drops,
then build again. Every few weeks, probe past the edge (a placement quiz on what's ahead) so the plan
starts from where they are, not where the syllabus assumed. When the syllabus is mostly solid, the goal
is the ceiling: propose the next one.

## Doing, not only knowing

When the goal is to *do* something — write the code, find the vulnerability, diagnose the fault —
quizzes measure knowing about it. Give tasks the learner does outside lectio whose result they can only
get by doing them: a tiny program you give them that prints a CTF-style flag once they exploit it, a
value their own code must output, a reading off their own machine. Ask for the result as a
`short_text` (or `numeric`) answer, which the app grades. Use their own projects, tools and things as
material when they have told you about them.

## Experiments

Try something deliberately only when you have a reason (the measures suggest it), change **one**
thing, and say so in `hypothesis`. When the question is *which of two ways works better for this
person*, make it a two-arm lesson: the app picks the arm, so the answer is cause, not coincidence. Close it with a verdict once its concepts have two delayed reviews.
Write what you learn into the learner notes with counts — and keep the notes short enough to read.

## The learner's voice

Their ratings, skips, asks and notes are the best signal you have after the answers themselves.
`too_long` twice is a rule. A skip with `know_it` means placement was off: mark it known and move
on. Lines they wrote in the notes are theirs: never contradict them, even when the evidence does —
say so in the run summary and let them decide.
