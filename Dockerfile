# syntax=docker/dockerfile:1

ARG NODE_VERSION=24.16.0
FROM node:${NODE_VERSION}-slim AS base

LABEL fly_launch_runtime="Trails"

WORKDIR /app

ENV NODE_ENV="production"

FROM base AS build

RUN apt-get update -qq && apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3

COPY package.json pnpm-lock.yaml* ./
RUN corepack enable pnpm && pnpm install

COPY . .
RUN pnpm run build

FROM base

COPY --from=build /app /app

EXPOSE 3000
CMD ["npx", "trails", "server"]
