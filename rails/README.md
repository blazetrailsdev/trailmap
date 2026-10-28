# trailmap, in Rails

The same site as the trails app in the parent directory, written in Rails
8.0.2, the Rails trails ports. The two apps change together: the same
databases, the same routes, the same pages and JSON. The point is to prove that
trails and Rails produce the same output and can share data. See
../CLAUDE.md, "`rails/` is the same site in Rails".

- [DEVIATIONS.md](DEVIATIONS.md): every place the two apps differ, and what
  porting found.
- `script/tandem`: compares the two running apps path by path.

## Layout

Every TypeScript file has one Ruby counterpart:

| trails app | here |
| --- | --- |
| `app/models/concerns/repo-scope.ts` | `app/models/concerns/repo_scope.rb` |
| `app/controllers/rfc-pages-controller.ts` | `app/controllers/rfc_pages_controller.rb` |
| `app/views/rfc-pages/index.html.tse` | `app/views/rfc_pages/index.html.erb` |
| `app/serializers/story-json.ts` | `app/serializers/story_json.rb` |
| `config/fleet.ts`, `lib/fleet-relay.ts`, `lib/sse.ts` | `lib/fleet.rb`, `lib/fleet/*.rb` |
| `db/migrate`, `db/hub-migrate` | `db/migrate`, `db/hub_migrate` (same versions) |

Static assets are not copied. `app/javascript/*.js`,
`app/assets/stylesheets/application.css` and `vendor/ringo/*` are symlinks into
the trails app, so both serve the same bytes.

## Databases

The trails app's three connections, declared in `config/database.yml`:

| | Adapter | Env | Migrated here |
| --- | --- | --- | --- |
| `primary` | sqlite3 | `TASKS_DATABASE` | no: `database_tasks: false` (the CLI owns it) |
| `hub` | postgresql | `HUB_DATABASE_URL` | yes, `db/hub_migrate` |
| `stats` | sqlite3, read-only | `STATS_DB` | no |

Plain `bin/rails db:migrate` is safe: it touches only the hub. The two apps
share one hub, and the migration versions are identical, so either app can
migrate it.

## Running

```sh
bundle install   # pg 1.5.9 builds from source: needs libpq-dev
TASKS_DATABASE=<tasks checkout>/.git/tasks.db \
HUB_DATABASE_URL=postgres://… \
  bin/rails db:migrate db:seed

TASKS_DATABASE=… HUB_DATABASE_URL=… bin/rails server -p 4200
```

## Tests

```sh
HUB_TEST_DATABASE_URL=postgres://… bin/rails db:prepare test
```

The hub tests skip, by name, without `HUB_TEST_DATABASE_URL`. CI runs them
against a Postgres service (the `rails` job in `.github/workflows/ci.yml`).

## Comparing the two apps

Boot both against the same databases, the trails app on 4100 and this one on
4200, and run:

```sh
script/tandem            # the default path list
script/tandem --diff     # with a diff for each difference
script/tandem /rfc/0136-trailmap /story/some-id
```

Work on a copy of the tasks database (`sqlite3 <live> ".backup <copy>"`) when
any mutation is involved.
