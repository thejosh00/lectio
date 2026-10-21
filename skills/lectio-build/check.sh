#!/bin/sh
# The otto check script for lectio-build: wake the builder only when there is a proposal
# to build, changes requested, or a question answered.
#
#   exit 0  nothing to build, or the server is down
#   exit 1  something to build
#   exit 2  anything else: otto fails open and wakes
LECTIO="${LECTIO_BIN:-$HOME/.bun/bin/lectio}"
out="$("$LECTIO" proposals due --as agent:builder --json 2>/dev/null)"
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
