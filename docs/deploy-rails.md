# Deploying the Rails twin

`rails/` deploys as its own dokku app, **`trailmap-rails`**, beside `trailmap`
and on the same box. It exists so `rails/script/tandem` can compare the two
apps against the live databases on a schedule (../CLAUDE.md, "`rails/` is the
same site in Rails"). docs/deploy.md is the trails app's runbook; this file
records only what differs.

| | `trailmap` | `trailmap-rails` |
| --- | --- | --- |
| Image | `Dockerfile` | `rails/Dockerfile`, built from the repo root |
| Public vhost | `trailmap.deanoftech.com` | `trailmap-rails.deanoftech.com` (needs a DNS record) |
| Loopback API | `127.0.0.1:8080` | `127.0.0.1:8081` |
| `tasks.db` | read-write | **read-only** (`readonly: true`, SQLite enforces it) |
| Hub | `trailmap-hub`, linked as `HUB_DATABASE` | the same service, the same link alias |

## Why read-only

The Rails mutation API works, and the trails one refuses every request outside
`test` (rails/DEVIATIONS.md). Deployed read-write, the Rails app would quietly
become the only working writer to the CLI's live database. So production opens
`tasks.db` read-only, and a mutation verb answers 500
`SQLite3::ReadOnlyException` with nothing written. That lifts when both apps'
writers are fixed and compared.

The bind mount is the same writable directory trailmap mounts. SQLite needs
the directory writable for the WAL `-shm` file even when nothing is written.

## Why the repo root is the build context

The stylesheet, the fleet scripts and ringo's chart engine are symlinks from
`rails/` into the trails app, so a build that only sees `rails/` would ship
them dangling. dokku is pointed at the subdirectory's files explicitly:

```sh
dokku apps:create trailmap-rails
dokku builder-dockerfile:set trailmap-rails dockerfile-path rails/Dockerfile
dokku ps:set trailmap-rails procfile-path rails/Procfile
dokku app-json:set trailmap-rails appjson-path rails/app.json
dokku nginx:set trailmap-rails nginx-conf-sigil-path rails/nginx.conf.sigil
dokku ps:set trailmap-rails restart-policy on-failure:10
# Explicit: the loopback block proxies to the `trailmap-rails-8080` upstream,
# and without a map dokku assumes 5000 and the sigil fails `nginx -t`.
dokku ports:set trailmap-rails http:80:8080
```

## Configuration

The same environment as trailmap, except the secret, which each app gets its
own of:

```sh
dokku storage:mount trailmap-rails /home/dean/github/blazetrailsdev:/home/dean/github/blazetrailsdev
dokku storage:mount trailmap-rails /home/dean/.btwhooks/data/github/blazetrailsdev/trails/audits:/audits:ro
for key in TASKS_DATABASE TASKS_DIR AUDITS_DIR STATS_DB RINGO_BASE; do
  dokku config:set --no-restart trailmap-rails "$key=$(dokku config:get trailmap "$key")"
done
dokku config:set --no-restart trailmap-rails SECRET_KEY_BASE="$(openssl rand -hex 64)"
dokku network:set trailmap-rails attach-post-deploy fleet
dokku postgres:link trailmap-hub trailmap-rails --alias HUB_DATABASE --no-restart
dokku domains:set trailmap-rails trailmap-rails.deanoftech.com
dokku sso:protect trailmap-rails
```

The hub is SHARED. `rails/Procfile`'s `release` runs `bin/rails db:migrate`,
which touches only the hub (the other two databases are `database_tasks:
false` in production). The migration versions are identical in both apps, so
whichever deploys second finds nothing to do. A hub migration therefore lands
in both apps in the same PR.

`domains:set` creates the DNS record itself on this box (dokku's DNS
plugin). Then TLS, which adds `https:443:8080` to the port map:
`dokku letsencrypt:enable trailmap-rails`.

## Deploying

From a checkout, any branch:

```sh
git remote add dokku-rails dokku@localhost:trailmap-rails
git push dokku-rails HEAD:trunk   # this box deploys from `trunk`
```

## Checks

```sh
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8081/up   # 200
curl -s http://127.0.0.1:8081/stories/ready | head -c 200             # JSON
rails/script/tandem --trails http://127.0.0.1:8080 --rails http://127.0.0.1:8081
```

`rails/script/tandem-cron` runs that comparison hourly from the host crontab
and appends to `~/github/blazetrailsdev/tandem.log`.
