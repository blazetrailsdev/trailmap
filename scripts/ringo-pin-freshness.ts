/**
 * IS THE VENDORED RINGO STILL RINGO?
 *
 * `vendor/ringo/PIN` records the btwhooks commit both ringo gates diff
 * against, and `SHA256` (scripts/ringo-pin.ts) makes the snapshot
 * tamper-evident. Neither notices the other failure: when ringo's `/backlog`
 * script changes tomorrow, the snapshot is UNTOUCHED — and that is the
 * problem. Both gates keep passing, green, against a copy of the old ringo,
 * and the drift they exist to catch is invisible for as long as nobody
 * remembers to run `scripts/vendor-ringo.sh`.
 *
 * So this compares the pin against btwhooks' current HEAD and says so when
 * they differ. It cannot be a CI job: btwhooks has no remote for CI to clone,
 * which is the whole reason the snapshot is vendored. It belongs where a
 * checkout exists — the box — so `scripts/deploy.sh` runs it and a human can
 * run it by hand:
 *
 *     pnpm ringo:pin [--src <btwhooks-checkout>]
 *
 * It WARNS and never fails. Bumping the pin is its own PR by design
 * (README's vendoring section), so a stale pin is a prompt, not a broken
 * gate — and a box with no btwhooks checkout is not an error either, it is a
 * machine this check has nothing to say on.
 */
import { argv, Dir, env, exit, getChildProcessAsync, getFs, getPath } from "@blazetrails/ruby-compat";

/** Where btwhooks is checked out on the box, unless `--src`/`RINGO_SRC` says otherwise. */
const DEFAULT_SRC = "github/deanmarano/btwebooks";

/** What the check found, so the test can assert on it without reading stdout. */
export interface PinFreshness {
  /** The commit `vendor/ringo/PIN` records. */
  pinned: string;
  /** btwhooks' HEAD, or null when there is no checkout to ask. */
  head: string | null;
  /** The checkout that was asked, reported either way. */
  src: string;
  /** Every line to print, in order. */
  report: string[];
}

/** Compare `vendor/ringo/PIN` against the HEAD of the btwhooks checkout at `src`. */
export async function ringoPinFreshness(src: string, root?: string): Promise<PinFreshness> {
  const [fs, path, child] = await Promise.all([
    getFs(),
    getPath(),
    getChildProcessAsync(),
  ]);
  root ??= Dir.pwd();
  const pinned = (await fs.readFile!(path.join(root, "vendor", "ringo", "PIN"), "utf8")).trim();

  if (!(await fs.exists(path.join(src, ".git")))) {
    return {
      pinned,
      head: null,
      src,
      report: [
        `ringo pin: ${pinned} (vendor/ringo/PIN)`,
        `no btwhooks checkout at ${src}, so its HEAD is unknown here — nothing to compare.`,
      ],
    };
  }

  const result = child.spawnSync("git", ["-C", src, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (result.status !== 0) {
    return {
      pinned,
      head: null,
      src,
      report: [
        `ringo pin: ${pinned} (vendor/ringo/PIN)`,
        `could not read HEAD of ${src}: ${result.stderr.trim()}`,
      ],
    };
  }
  const head = result.stdout.trim();

  if (head === pinned) {
    return { pinned, head, src, report: [`ringo pin is current: ${pinned} == ${src} HEAD.`] };
  }

  // How far behind, in ringo's own commits — a number is what makes the
  // difference between "bump it" and "bump it now" legible at a glance.
  const behind = child.spawnSync("git", ["-C", src, "rev-list", "--count", `${pinned}..${head}`], {
    encoding: "utf8",
  });
  const count = behind.status === 0 ? behind.stdout.trim() : "an unknown number of";

  return {
    pinned,
    head,
    src,
    report: [
      `STALE RINGO PIN: vendor/ringo is ${count} commits behind ${src}.`,
      `  vendor/ringo/PIN  ${pinned}`,
      `  btwhooks HEAD     ${head}`,
      "  Both ringo gates are passing against a snapshot of the older ringo, so",
      "  drift since then is invisible. Re-vendor in a PR of its own:",
      `    ./scripts/vendor-ringo.sh ${src} HEAD`,
      "  This is a WARNING, not a failure — see README's vendoring section.",
    ],
  };
}

async function main(args: readonly string[]): Promise<number> {
  const path = getPath();
  const at = args.indexOf("--src");
  const src =
    at !== -1 && args[at + 1] !== undefined
      ? args[at + 1]!
      : (env.RINGO_SRC ?? path.join(env.HOME ?? "", DEFAULT_SRC));

  for (const line of (await ringoPinFreshness(src)).report) console.log(line);
  // Always 0. A stale pin is a prompt; the gates are what fail.
  return 0;
}

if (env.VITEST === undefined) exit(await main(argv));
