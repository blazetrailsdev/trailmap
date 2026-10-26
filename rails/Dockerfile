# syntax=docker/dockerfile:1
#
# The Rails app's image. BUILT FROM THE REPOSITORY ROOT, not from rails/:
# the stylesheet, the fleet scripts and ringo's chart engine are symlinks into
# the trails app (rails/README.md, "Layout"), and a build context of rails/
# alone would ship them dangling. dokku is told so:
#
#   dokku builder-dockerfile:set trailmap-rails dockerfile-path rails/Dockerfile
#
# The image keeps the repository's shape under /app, so every relative symlink
# resolves exactly as it does in a checkout.

ARG RUBY_VERSION=3.3.11
FROM ruby:${RUBY_VERSION}-slim AS base

WORKDIR /app/rails

ENV RAILS_ENV="production" \
    BUNDLE_DEPLOYMENT="1" \
    BUNDLE_PATH="/usr/local/bundle" \
    BUNDLE_WITHOUT="development:test"

# Runtime libraries: sqlite3 for the task domain and stats, libpq for the hub,
# git for /up/ready's identity check against the mounted tasks checkout.
RUN apt-get update -qq \
 && apt-get install --no-install-recommends -y libsqlite3-0 libpq5 libyaml-0-2 git \
 && rm -rf /var/lib/apt/lists/*

FROM base AS build

# pg 1.5.9 (the version trails vendors) builds from source against libpq-dev.
RUN apt-get update -qq \
 && apt-get install --no-install-recommends -y build-essential libpq-dev libyaml-dev pkg-config \
 && rm -rf /var/lib/apt/lists/*

COPY rails/Gemfile rails/Gemfile.lock ./
RUN bundle install && rm -rf ~/.bundle "${BUNDLE_PATH}"/ruby/*/cache

# The shared assets the symlinks point at, then the app.
COPY app/assets/ /app/app/assets/
COPY vendor/ringo/parity.css vendor/ringo/parity-draw.js /app/vendor/ringo/
COPY rails/ ./

RUN bundle exec bootsnap precompile app/ lib/ \
 && SECRET_KEY_BASE_DUMMY=1 ./bin/rails assets:precompile

FROM base

COPY --from=build /usr/local/bundle /usr/local/bundle
COPY --from=build /app /app

# uid 1000, the host user that owns the bind-mounted tasks checkout, as the
# trails app's image does.
RUN groupadd --system --gid 1000 rails \
 && useradd rails --uid 1000 --gid 1000 --create-home --shell /bin/bash \
 && mkdir -p log tmp storage && chown -R rails:rails log tmp storage \
 && git config --system --add safe.directory '*' \
 && git config --system user.name "Dean Marano" \
 && git config --system user.email "here@dean.is"
# The identity matches the trails app's image (../Dockerfile), so /up/ready's
# `git var` check answers the same in both. This app never commits.
USER 1000:1000

ENV PORT=8080
EXPOSE 8080
# Keep in step with `web` in rails/Procfile, which wins on a dokku deploy.
CMD ["./bin/rails", "server", "-b", "0.0.0.0", "-p", "8080"]
