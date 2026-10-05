/**
 * Refuse to boot a deployed environment that has no `secret_key_base`.
 *
 * The framework reads the secret for the first time while building a request,
 * before any middleware runs, and raises there. The server then answers
 * nothing at all: the first production deploy hung on every request, `/up`
 * included, until dokku's health check killed the container, with nothing in
 * the log. Reading it here turns that into a process that will not start and
 * says why, the same trade `tasks-database.ts` makes for the database.
 *
 * Development and test are left alone: the framework generates a local secret
 * for them on first use.
 */
import { Trails } from "@blazetrails/trailties";

if (!Trails.env["local?"]()) Trails.application!.secretKeyBase();
