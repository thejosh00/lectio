#!/bin/sh
# The otto check script for lectio-teach: wake the tutor only when there is something to do.
#
#   exit 0  nothing due (no wake is spent), or the server is down (a stopped server
#           shouldn't burn a wake every hour; otto's daily safety net still wakes once)
#   exit 1  something is due: a subject is ready, a new subject needs a plan, a flag or ask waits
#   exit 2  anything else: otto fails open and wakes
#
# launchd's PATH is minimal, so lectio is named by absolute path. For a non-default instance,
# set LECTIO_DIR in a copy of this script: otto launchers don't set environment variables.
LECTIO="${LECTIO_BIN:-$HOME/.bun/bin/lectio}"
out="$("$LECTIO" due --json 2>/dev/null)"
code=$?
case "$code" in
  0)
    case "$out" in
      *'"due": true'*) exit 1 ;;
      *'"due": false'*) exit 0 ;;
      *) exit 2 ;;
    esac
    ;;
  4) exit 0 ;;
  *) exit 2 ;;
esac
