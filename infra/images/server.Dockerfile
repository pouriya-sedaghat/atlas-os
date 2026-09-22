ARG NODE_IMAGE=node:22.14.0-alpine3.21@sha256:9bef0ef1e268f60627da9ba7d7605e8831d5b56ad07487d24d1aa386336d1944

FROM ${NODE_IMAGE} AS toolchain
RUN corepack enable && corepack prepare pnpm@10.17.1 --activate
WORKDIR /workspace

FROM toolchain AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm exec tsc -b packages/atlas-os packages/core apps/api apps/updater --pretty false

FROM build AS api-deploy
RUN pnpm --filter @atlas-os/api deploy --prod --legacy /prod/api

FROM build AS updater-deploy
RUN pnpm --filter @atlas-os/updater deploy --prod --legacy /prod/updater

FROM ${NODE_IMAGE} AS api-runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=api-deploy --chown=node:node /prod/api/ ./
USER node
CMD ["node", "dist/index.js"]

FROM ${NODE_IMAGE} AS updater-runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=updater-deploy --chown=node:node /prod/updater/ ./
USER node
CMD ["node", "dist/index.js"]
