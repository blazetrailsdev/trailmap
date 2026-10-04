# syntax=docker/dockerfile:1

# Node 24 or newer, always: @blazetrails/rack uses duplicate named capture
# groups (ES2025), which throw a SyntaxError at import time on Node 20 and 22.
# Keep this in step with .node-version and the CI workflow.
ARG NODE_VERSION=24.16.0
FROM node:${NODE_VERSION}-slim AS base

LABEL fly_launch_runtime="Trails"

WORKDIR /app

ENV NODE_ENV="production"

FROM base AS build

RUN apt-get update -qq && apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3

# The @blazetrails/* packages are vendored tarballs, not registry packages, so
# vendor/ and the workspace overrides that point at it have to be present
# before install.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY vendor/ ./vendor/
RUN corepack enable pnpm && pnpm install --frozen-lockfile

COPY . .
RUN pnpm exec trails-tsc-views build --views app/views
RUN pnpm run build

# Production serves no Vite: the framework mounts it only in development, and
# since the trails bump NODE_ENV=production is honoured. The layout links
# /assets/stylesheets/application.css and the dashboard its scripts, so they
# have to exist under public/, where the static middleware looks. The files are
# plain CSS and JS with no imports, so a copy is the whole precompile.
RUN mkdir -p public/assets && cp -r app/assets/. public/assets/

FROM base

# The tasks checkout is bind-mounted writable, and authoring and ingest commit
# into it from inside this container. Without an identity git refuses with
# "Author identity unknown"; match the identity the host's own tasks commits
# use so the history stays uniform. safe.directory is needed because the
# mounted checkout is owned by the host user, not root.
RUN apt-get update -qq && apt-get install --no-install-recommends -y git \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app /app

# Run as uid 1000, the host user that owns the bind-mounted checkout: a commit
# written as root leaves root-owned objects in the tasks repo that the host's
# own agents then cannot rewrite. btwhooks' container does the same.
# The official node image already ships that account as `node`.
RUN chown -R node:node /app
USER node

# Authoring and ingest commit into the mounted tasks checkout from inside this
# container. Without an identity git refuses with "Author identity unknown";
# match the identity the host's own tasks commits use so the history stays
# uniform. safe.directory is needed because git otherwise refuses a repository
# whose ownership it cannot vouch for.
RUN git config --global --add safe.directory '*' \
 && git config --global user.name "Dean Marano" \
 && git config --global user.email "here@dean.is"

# One listener, two audiences, both fronted by dokku's nginx: the public
# hostname behind SSO, and a 127.0.0.1:8080 server block for the JSON API. The
# container publishes NO host port — a fixed one collides with itself on every
# zero-downtime release. Binding 0.0.0.0 is the container's interface, not the
# box's.
ENV PORT=8080
EXPOSE 8080
CMD ["node_modules/.bin/tsx", "node_modules/@blazetrails/trailties/bin/trails.js", "server", "-b", "0.0.0.0", "-p", "8080"]
