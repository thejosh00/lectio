# Teaching

How to write lessons and quizzes that make things stick for this person. Read once per session.

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
- **Pair words with a picture only when the picture shows the mechanism** — a trace of who owns a
  buffer, a diagram of a cycle. Never as decoration.
- **Short.** Fit the budget. If it doesn't fit, cut the least important idea, not the examples.
- **Honest approaches.** Label every block with how it actually teaches (`worked_example`,
  `analogy`, `misconception`…) and the concepts it serves. That is how outcomes find their way back
  to what worked.

## Spacing and review

- Reviews are where retention is made. Bring back due concepts, lowest recall first.
- Prefer a **fresh variant** (`variant_of`) to asking the same words again: remembering the idea is
  the point, not remembering the question.
- **Interleave.** Put related concepts next to each other in a quiz so the learner must choose which
  idea applies — that choosing is the skill.
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
- Difficulty is your honest guess (1–5); the bank compares it with what happened. When your guesses
  are consistently off, recalibrate.

## Experiments

Try something deliberately only when you have a reason (the measures suggest it), change **one**
thing, and say so in `hypothesis`. Close it with a verdict once its concepts have two delayed reviews.
Write what you learn into the learner notes with counts — and keep the notes short enough to read.

## The learner's voice

Their ratings, skips, asks and notes are the best signal you have after the answers themselves.
`too_long` twice is a rule. A skip with `know_it` means placement was off: mark it known and move
on. Lines they wrote in the notes are theirs: never contradict them, even when the evidence does —
say so in the run summary and let them decide.
