import type { ActionController } from "@blazetrails/actionpack";
import { presence } from "@blazetrails/activesupport";

/**
 * The JSON API's readings of `params`, in one place: the mutation and read
 * verbs take the same flags the CLI does, and two private copies of these had
 * already begun to disagree about whether "absent" was `null` or `undefined`.
 */

/** `params.fetch(name, nil).presence`, as a string: `undefined` when absent or blank. */
export function presentParam(params: ActionController.Parameters, name: string): string | undefined {
  const value = presence(params.fetch(name, null));
  return value == null ? undefined : String(value);
}

/**
 * `Integer(params[name], exception: false)`, read as the CLI reads its
 * `--max-loc`: leading digits count (`parseInt`), anything else is `undefined`.
 */
export function integerParam(params: ActionController.Parameters, name: string): number | undefined {
  const value = presentParam(params, name);
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Mirrors the tasks CLI's src/pr-ref.ts. */
const PR_REF_RE = /^([a-z0-9][a-z0-9._-]*)#([1-9]\d*)$/;

export const PR_REF_USAGE = "--pr takes repo#N, e.g. trails#7228 or tasks#94";

/** A `--pr` that was given but is not `repo#N`. */
export const INVALID_PR = Symbol("invalid pr");

/**
 * A `repo#N` PR ref (`trails#7228`, `tasks#94`), the shape the tasks CLI's
 * `--pr` takes since PR numbers from different repos collide. `null` when
 * absent or empty, `INVALID_PR` when given but malformed — a bare `7`,
 * `7abc`, `trails#07` — which the verbs refuse, as the CLI does.
 */
export function prRefParam(
  params: ActionController.Parameters,
  name: string,
): string | null | typeof INVALID_PR {
  const value = presentParam(params, name);
  if (value === undefined) return null;
  const m = PR_REF_RE.exec(value.trim());
  return m ? `${m[1]}#${Number(m[2])}` : INVALID_PR;
}
