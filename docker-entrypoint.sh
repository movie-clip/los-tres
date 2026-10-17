#!/bin/sh
# Verb dispatcher for the app image.
#   server       migrate, seed when SEED_DEMO_DATA=true, then serve (default)
#   migrate      apply pending migrations
#   seed         load the demo data (always; `seed --if-enabled` honours the flag)
#   import-feeds import the approved feeds; `--feed <id>` imports one
# The CLI is compiled to dist/ and runs with the react-server condition so the
# `server-only` marker resolves to an empty module.
set -eu

verb="${1:-server}"

case "$verb" in
  server)
    # A failing migration ends the container (set -e): the restart policy
    # retries and the healthcheck never goes green, so a broken schema is loud.
    node --conditions=react-server dist/cli/migrate.js
    node --conditions=react-server dist/cli/seed.js --if-enabled
    exec node server.js
    ;;
  migrate|seed|import-feeds)
    shift
    exec node --conditions=react-server "dist/cli/$verb.js" "$@"
    ;;
  *)
    echo "usage: docker-entrypoint.sh server|migrate|seed|import-feeds" >&2
    echo "unknown command: $verb" >&2
    exit 64
    ;;
esac
