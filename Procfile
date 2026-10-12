# Deployment tasks, dokku's documented place for a migration:
# https://dokku.com/docs/advanced-usage/deployment-tasks/
#
# `release` rather than app.json's `scripts.dokku.predeploy`, and the doc says
# why: a predeploy container is COMMITTED back into the built image, which is
# what it is for ("for changing the built image"), while a release container's
# changes are discarded ("tasks like migrations, since changes are not
# persisted to disk"). `trails db migrate` rewrites db/schema.ts and
# db/hub_schema.ts as it runs, so under predeploy every release would bake a
# schema dump into the image and the deployed files would drift from the repo.
#
# A failed release task fails the deploy and leaves the running containers
# alone, which is the property that makes this worth having: a hub that cannot
# be migrated never gets a container serving pages against it.
#
# NO `--database` flag. The unflagged command registers both configurations
# and migrates both; `--database hub` loads the task domain's SQLite schema
# into Postgres (docs/deploy.md).
release: bin/trails db migrate

# `web` is declared even though the Dockerfile's CMD says the same thing, and
# the duplication is deliberate. A Procfile takes precedence over CMD for the
# process types it names, and dokku's process docs warn that an app whose
# Procfile declares no `web` has "the process count for every process type set
# to zero" under `ps:scale --clear`. Naming it here costs one line and removes
# the question entirely. Keep it in step with the Dockerfile.
web: bin/trails server -b 0.0.0.0 -p 8080
