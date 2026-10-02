/**
 * A helper under `app/helpers` is callable from a `.tse` template.
 *
 * This is what the trails bump to c0f89d79 was FOR. Before it `app/helpers`
 * was inert here: `renderMarkdown` — in `app/helpers/markdown-helper.ts` since
 * #8 — could not be named in a view, so the controllers render markdown
 * themselves and hand the view a string. Two things had to be true together:
 *
 * - the framework wires `app/helpers` into the view context (trails#7558), and
 * - the application loads the trailtie that does it. `config/application.ts`
 *   now imports `@blazetrails/trailties/all`, as `trails new` writes today;
 *   without that the helpers path is configured and never handed over.
 *
 * So the application is BOOTED, in a child process (see
 * `scripts/app-helpers-probe.ts` for why not in this one). A test that called
 * `helper(MarkdownHelper)` on a controller itself would pass on a framework
 * that never looked in the directory, and on an application that never loaded
 * the trailtie.
 */
import { describe, expect, it } from "vitest";
import { getChildProcessAsync, env } from "@blazetrails/ruby-compat";

describe("app/helpers", () => {
  it("reaches a template without the controller naming the helper", async () => {
    const child = await getChildProcessAsync();
    const result = child.spawnSync("node_modules/.bin/tsx", ["scripts/app-helpers-probe.ts"], {
      encoding: "utf8",
      // `test` is the one environment that boots with no tasks database.
      env: { ...env, NODE_ENV: "test", TASKS_DATABASE: undefined },
    });

    expect(result.status, result.stderr).toBe(0);
    const printed = result.stdout.trim().split("\n").at(-1)!;
    expect(JSON.parse(printed)).toEqual({
      status: 200,
      body: "<p>a <strong>bold</strong> claim</p>\n",
    });
  }, 60_000);
});
