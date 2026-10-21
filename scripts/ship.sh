#!/usr/bin/env bash
# scripts/ship.sh <branch>: put a reviewed build live, from the main checkout (§11).
#
#   1. Refuse a dirty checkout, or a branch whose proposal isn't in review.
#   2. Take a labelled backup (pre-p<n>).
#   3. Rebase the branch onto main if main has moved, and fast-forward main to it.
#   4. bun install if the lockfile changed; then the tests, and the guard: stop if the
#      branch touches protected paths the approval didn't acknowledge.
#   5. Restart the service (migrations run on start) and wait for /api/health to report
#      the new commit. The server marks the proposal shipped when it sees it running.
#   6. If 4 or 5 fails: reset main to where it was, restore the backup, restart, and say
#      what failed.
#
# Every outside command can be overridden for a dry run or a test:
#   LECTIO_REPO, LECTIO_CMD, LECTIO_AS, SHIP_TEST_CMD, SHIP_GUARD_CMD, SHIP_INSTALL_CMD,
#   SHIP_RESTART_CMD, SHIP_STOP_CMD, SHIP_START_CMD, SHIP_WAIT_SECONDS.
set -uo pipefail

REPO="${LECTIO_REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
LECTIO="${LECTIO_CMD:-bun $(printf '%q' "$SRC/src/cli.ts")}"
AS="${LECTIO_AS-you}"
TEST="${SHIP_TEST_CMD:-bun run test}"
GUARD="${SHIP_GUARD_CMD:-bun $(printf '%q' "$SRC/scripts/guard.ts")}"
INSTALL="${SHIP_INSTALL_CMD:-bun install}"
RESTART="${SHIP_RESTART_CMD:-$LECTIO service restart}"
STOP="${SHIP_STOP_CMD:-$LECTIO service stop}"
START="${SHIP_START_CMD:-$LECTIO service start}"
WAIT="${SHIP_WAIT_SECONDS:-60}"

say() { printf 'ship: %s\n' "$*"; }
die() { printf 'ship: %s\n' "$*" >&2; exit 1; }
# Commands are shell strings, so an override can be a pipeline.
x() { bash -c "$1"; }
lectio() { bash -c "$LECTIO$(printf ' %q' "$@")${AS:+ --as $AS}"; }
field() { bun -e "const b = JSON.parse(await Bun.stdin.text()); const v = $1; console.log(v === null || v === undefined ? '' : String(v))"; }

branch="${1:-}"
[ -n "$branch" ] || die "usage: scripts/ship.sh <branch>"
cd "$REPO" || die "no repository at $REPO"

# --- 1. a clean checkout, and a proposal in review -------------------------------------
[ -z "$(git status --porcelain)" ] || die "the checkout has uncommitted changes; commit or stash them first"
number="$(printf '%s' "$branch" | sed -nE 's#^lectio/p([0-9]+)-.*#\1#p')"
[ -n "$number" ] || die "$branch isn't a proposal branch (lectio/p<n>-<slug>)"
git rev-parse --verify --quiet "refs/heads/$branch" >/dev/null || die "no branch $branch"
proposal="$(lectio proposal show "$number" --json)" || die "can't read proposal #$number: $proposal"
status="$(printf '%s' "$proposal" | field 'b.proposal.status')"
acknowledged="$(printf '%s' "$proposal" | field 'b.proposal.acknowledged')"
[ "$status" = "in_review" ] || die "#$number is $status, not in review"
current="$(git rev-parse --abbrev-ref HEAD)"
[ "$current" = "main" ] || die "ship from main (the checkout is on $current)"

# --- 2. a backup to come back to ------------------------------------------------------
backup="$(lectio backup --label "pre-p$number" --json | field 'b.path')"
[ -n "$backup" ] || die "the backup failed; nothing was changed"
say "backed up to $backup"

# --- 3. rebase if main moved, fast-forward main ------------------------------------------
prev="$(git rev-parse main)"
if ! git merge-base --is-ancestor main "$branch"; then
  say "main has moved; rebasing $branch onto it"
  git checkout -q "$branch" || die "can't check out $branch"
  if ! git rebase -q main; then
    git rebase --abort
    git checkout -q main
    die "$branch doesn't rebase cleanly onto main; nothing was changed. Request changes so the builder rebases it."
  fi
  git checkout -q main
fi
git merge -q --ff-only "$branch" || die "can't fast-forward main to $branch; nothing was changed"
head="$(git rev-parse HEAD)"
say "main is now ${head:0:12} (was ${prev:0:12})"

rollback() {
  say "FAILED: $1"
  say "rolling back: main to ${prev:0:12}, the database from $backup"
  git reset -q --hard "$prev"
  if ! git diff --quiet "$head" "$prev" -- bun.lock 2>/dev/null; then x "$INSTALL" >/dev/null 2>&1; fi
  x "$STOP" >/dev/null 2>&1
  if lectio backup restore "$backup" >/dev/null; then say "restored $backup"; else say "COULD NOT RESTORE $backup: restore it by hand (lectio backup restore)"; fi
  x "$START" >/dev/null 2>&1
  die "$1 — rolled back; the branch is untouched"
}

# --- 4. install, test, guard -----------------------------------------------------------
if ! git diff --quiet "$prev" "$head" -- bun.lock 2>/dev/null; then
  say "the lockfile changed; installing"
  x "$INSTALL" || rollback "bun install failed"
fi
say "running the tests"
x "$TEST" || rollback "the tests failed"
guard_out="$(x "$GUARD $prev..$head" 2>&1)"
guard_code=$?
if [ "$guard_code" -eq 1 ]; then
  if [ "$acknowledged" = "true" ]; then
    say "touches protected paths, as the approval acknowledged:"
    printf '%s\n' "$guard_out"
  else
    rollback "it touches protected paths the approval didn't acknowledge: $(printf '%s' "$guard_out" | tail -n +2 | tr -s ' \n' ' ')(approve it with --protected to allow them)"
  fi
elif [ "$guard_code" -ne 0 ]; then
  rollback "the guard couldn't run: $guard_out"
fi

# --- 5. restart and wait for the new commit ------------------------------------------------
say "restarting"
x "$RESTART" >/dev/null 2>&1 || rollback "the service didn't restart"
url="${LECTIO_URL:-$(bun -e "const {clientConfig} = await import('$SRC/src/client.ts'); const {dataDirFrom} = await import('$SRC/src/config.ts'); console.log(clientConfig(process.env, dataDirFrom(process.env)).url)")}"
for _ in $(seq 1 "$WAIT"); do
  running="$(curl -fsS "$url/api/health" 2>/dev/null | field 'b.commit' 2>/dev/null)"
  if [ "$running" = "$head" ]; then
    # The server marks it shipped when it sees the submitted commit running. A rebase
    # gave the branch new commits, so say which one shipped.
    if [ "$(lectio proposal show "$number" --json | field 'b.proposal.status')" = "in_review" ]; then
      lectio proposal shipped "$number" --commit "$head" --json >/dev/null || say "couldn't mark #$number shipped; run: lectio proposal shipped $number --commit $head"
    fi
    say "shipped #$number: the server is running ${head:0:12}"
    exit 0
  fi
  sleep 1
done
rollback "the server didn't come up running ${head:0:12} within ${WAIT}s"
