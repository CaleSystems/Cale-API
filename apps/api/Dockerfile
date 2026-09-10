# Multi-stage, pnpm-workspace-aware build. apps/api imports @cale/contracts
# as a workspace dependency (PLATFORM_SETUP.md 1c), so the build context must
# be the repo root, not this directory — see docker-compose.prod.yml's
# `context: ../..` and ci.yml's `docker build -f apps/api/Dockerfile .`.
#
# Keep this pnpm version in sync with the root package.json's "packageManager".
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@12.3.4 --activate
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN pnpm run build
# Resolves cale-api's production deps for real (including the built
# @cale/contracts, copied in rather than left as a workspace symlink) into
# one self-contained folder — the pnpm-recommended pattern for a lean
# monorepo Docker image.
RUN pnpm --filter cale-api --prod deploy /deploy

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /deploy .
# Pre-existing gap closed alongside this rewrite: the image ran as root with
# no USER directive. node:22-alpine ships an unprivileged `node` user —
# use it instead of adding a custom one.
USER node

EXPOSE 3000
CMD ["node", "dist/main"]
