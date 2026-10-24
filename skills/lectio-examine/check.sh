#!/bin/sh
# The otto check script for lectio-examine: wake the examiner only when a subject is due a
# checkup, a draw is waiting to be written, or a flag on a checkup question waits.
#
#   exit 0  nothing due, or the server is down
#   exit 1  something is due
#   exit 2  anything else: otto fails open and wakes
LECTIO="${LECTIO_BIN:-$HOME/.bun/bin/lectio}"
out="$("$LECTIO" exam due --as agent:examiner --json 2>/dev/null)"
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
