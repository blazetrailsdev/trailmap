/**
 * Boot the application before the suite, as Rails' `test_helper.rb` requires
 * `config/environment`: tests run under `config.loadDefaults("8.0")`, not the
 * framework's bare defaults. vitest isolates each test file, so "once" means
 * once per file's module graph.
 */
import { Base } from "@blazetrails/activerecord";
import { Trails } from "@blazetrails/trailties";
import "../../config/environment.ts";
import { Hub } from "../../app/models/hub.ts";

// The test files connect their own scratch databases. The fallback pool the
// boot leaves on `Base` is a schemaless SQLite that `Hub` would inherit, so
// `Setting`'s "no pool" branch would become "no such table".
await Hub.removeConnection();
await Base.removeConnection();

// Routes load lazily. Loaded here, before a test can touch the route set,
// nothing races the first draw.
await Trails.application!.reloadRoutesUnlessLoaded();
