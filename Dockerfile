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
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

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
