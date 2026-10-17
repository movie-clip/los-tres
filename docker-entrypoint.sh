#!/bin/sh
# Verb dispatcher for the app image. Slice A knows one verb: `server`.
# Later slices add verbs (migrate, seed, import-feeds) here.
set -eu

verb="${1:-server}"

case "$verb" in
  server)
    exec node server.js
    ;;
  *)
    echo "usage: docker-entrypoint.sh server" >&2
    echo "unknown command: $verb" >&2
    exit 64
    ;;
esac
