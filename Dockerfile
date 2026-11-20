# syntax=docker/dockerfile:1
# Node major matches .nvmrc and package.json engines.
ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Production dependencies only. The CLI verbs (migrate, seed, import-feeds) load
# drizzle's migrator and `pg` outside Next's standalone trace, so the runner
# carries the full production node_modules (TD-18).
#
# Dev tooling that npm marks non-dev is stripped after the install (run
# 2026-11-20-open-points-follow-ups): better-auth declares drizzle-kit and
# vitest, and next declares @playwright/test, as optional peers. Because the
# root also installs them, package-lock.json marks them and their trees non-dev,
# so `npm ci --omit=dev` installs them, esbuild and tsx included. Nothing at
# runtime loads them: the CLI verbs use drizzle-orm's migrator over dist/. The
# directories below are the lockfile packages no production dependency
# reaches once those three peers are excluded; platform binaries of other
# platforms are not installed, so each scope is removed whole. The last step
# fails the build if any of them is still present. If a bump adds a package to
# these closures, the assertion names the known roots, not the new leaf.
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && cd node_modules \
    && rm -rf \
        drizzle-kit @drizzle-team @esbuild-kit esbuild @esbuild tsx \
        get-tsconfig resolve-pkg-maps source-map-support buffer-from source-map \
        vitest @vitest vite rolldown @rolldown @oxc-project lightningcss lightningcss-* \
        @jridgewell magic-string estree-walker chai assertion-error \
        @types/chai @types/deep-eql @types/estree \
        es-module-lexer expect-type fdir obug std-env tinybench tinyexec tinyglobby \
        why-is-node-running \
        playwright playwright-core @playwright fsevents \
    && rm -f .bin/drizzle-kit .bin/esbuild .bin/tsx .bin/vite .bin/vitest \
        .bin/rolldown .bin/playwright .bin/playwright-core .bin/why-is-node-running \
    && for p in drizzle-kit esbuild @esbuild-kit tsx vitest playwright @playwright; do \
        if [ -e "$p" ] || [ -n "$(find . \( -path "*/node_modules/$p" -o -path "*/.bin/$p" \) -print)" ]; then \
            echo "prod-deps: $p is still in node_modules"; exit 1; \
        fi; \
    done

FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No database or environment is needed to build (TD-5).
RUN npm run build
# The CLI verbs are compiled by tsc into dist/ (TD-17).
RUN npm run cli:build

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# Full production node_modules first; the standalone output merges over it.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/src/db/migrations ./src/db/migrations
COPY --from=build --chown=node:node /app/demo ./demo
COPY --chown=node:node --chmod=755 docker-entrypoint.sh ./docker-entrypoint.sh
USER node
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["server"]
