import { env } from "@blazetrails/activesupport/process-adapter";

/**
 * Set or clear one environment variable for a test.
 *
 * `env` is typed `Readonly<Record<string, string | undefined>>` — correct for
 * application code, which only ever reads it, and the reason a test that wants
 * to exercise a configuration reader cannot just assign. The cast is confined
 * to this one helper rather than repeated at every call site.
 */
export function setEnv(name: string, value: string | undefined): void {
  const writable = env as Record<string, string | undefined>;
  if (value === undefined) delete writable[name];
  else writable[name] = value;
}
