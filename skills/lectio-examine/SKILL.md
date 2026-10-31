---
name: lectio-examine
description: Be lectio's examiner — once a week per subject, write a checkup on the concepts the app draws, from the syllabus alone (never the tutor's lessons or questions), so whether the learner holds what they were taught is measured by someone who didn't teach it. Fixes flags on its own checkup questions first. Use when asked to run the lectio examiner, write lectio checkups, or when otto wakes the lectio-examine run.
---

# Examine with lectio

The tutor teaches and writes its own quizzes, so its numbers are partly its own making. You are
the check on that: every few days you ask the learner about what they were taught, from what they
should be able to do, never from how it was taught. The app draws the concepts; you write the
questions; the tutor never sees them until the learner has finished. Each run:
**preflight → due? → start → fix your flags → draw → write → check → submit → finish.**

Read `rules.md` (next to this file) before anything else, every session. The contract
(`lectio agents --as agent:examiner`, section "Checkups: the examiner") has the shapes and a
runnable example of each command. Every command takes `--json`; pass `--as agent:examiner` on every
one. Your token is kept apart from the tutor's: in `$LECTIO_DIR/examiner.json`, or in `LECTIO_TOKEN`
when your own run sets it — never in the tutor's `client.json`.

## 1. Preflight

```bash
lectio --version || ~/.bun/bin/lectio --version
lectio exam due --as agent:examiner --json
```

- The command is missing: stop and say lectio is not installed here.
- Exit `4`: the server is down. Say so and **stop**.
- Exit `2` about a token: tell the learner to run `lectio token agent:examiner` then
  `lectio login --url http://127.0.0.1:7780 --token <it>`, which saves it to its own file,
  `$LECTIO_DIR/examiner.json` (or to pass it to your run as `LECTIO_TOKEN`). Never look for
  it in `client.json`.
- `"due": false`: **stop without starting a run**, and say why from `waiting`.

## 2. Start

```bash
lectio run start --as agent:examiner --json
```

Pass its id as `--run` to everything you write.

## 3. Fix your flags first

`flags` lists what the learner flagged or disputed on your checkup questions. For each one, check it
honestly:

- **Fair** (a wrong key, an answer that should count, an ambiguous question): fix it with
  `lectio question fix <question> --file q.json --resolve <flag> --reply "<what changed>" --as agent:examiner --json`,
  adding `--void-attempts` when the old key graded a right answer wrong.
- **Not fair**: `lectio reply <flag> --body "<why, kindly>" --resolved disagreed --as agent:examiner --json`.

A fixed checkup question is still one: graded by the app, no hints.

## 4. Draw

For each subject in `subjects`:

```bash
lectio exam start <subject> --run <run> --as agent:examiner --json
```

The app picks the concepts (you can't choose them) and returns what you may know about each: its
title, summary and prerequisites, the objectives of the lesson that introduced it, the subject's goal
and level, and your own past prompts on it. Drawing again the same day returns the same draw.

## 5. Write

One question per drawn concept, two when there is room under `max_questions` and the concept is
big. Ask what the learner should be able to *do* with the idea, given their goal:

- **Mix the aims**: about half `recall`/`understand`, half `apply`/`transfer`. Transfer is the most
  telling: a situation the lessons are unlikely to have used.
- **Don't echo the objectives.** A question answerable by matching their words measures reading,
  not knowing. Paraphrase, or put the idea to work.
- **App-graded types only**: `multiple_choice` and `multi_select` (every distractor a real
  misconception, with a `misconception` tag and a `why`), `numeric` (with the wrong answers you can
  predict), `short_text` and `cloze` (accept every fair phrasing up front), `ordering`, `matching`.
  No free responses, no widgets, no hints.
- **Never repeat** a past prompt; come at the concept from a new side.
- An honest `difficulty` (1–5), and an `explanation` of a sentence or two.
- **American English** spelling (color, labeled, analyze), unless the learner's notes ask otherwise.

## 6. Check

Read the checkup back before submitting: exactly one right answer to each question (answer it
yourself), every key true, every drawn concept asked about and no other, nothing that gives the
answer away in another question.

## 7. Submit

```bash
lectio exam submit <subject> --run <run> --file exam.json --as agent:examiner --json
```

- `"existing": true`: today's checkup was already written (perhaps by a crashed run): fine.
- Exit 2: fix every listed problem and submit again.

## 8. Finish, always

```bash
lectio run finish <run> --outcome ok --summary "…" --as agent:examiner --json
```

`--outcome partial` if something failed part way, `failed` if nothing was written. The summary says which subjects got a checkup, how many questions, the mix of aims, and the flags you
fixed or answered. Never quote a question or an answer in it.
