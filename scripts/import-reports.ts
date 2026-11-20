/**
 * ONE-TIME IMPORT of what ringo kept on disk before trailmap stored it (RFC
 * 0243): the audits directory, and ringo's refine reports.
 *
 *     pnpm tsx scripts/import-reports.ts [--data <ringo-data-dir>] [--api <url>]
 *
 * - `<data>/github/<owner>/<repo>/audits/*.{md,html}` → `POST /audits`, `repo`
 *   from the directory and `slug` / `writtenAt` / `format` from the name
 *   (`<slug>-<YYYYMMDDTHHMMSSZ>.<ext>`, else the file's mtime).
 * - `<data>/refine-history.json` ∪ `<data>/refines.json` → `POST /rfc-refines`,
 *   deduplicated on `(rfc, when)`, `when` and `stories` as ringo recorded them.
 *
 * It drives the two loopback endpoints and nothing else, so there is no second
 * write path, and both answer 200 for a report they already hold: a re-run
 * creates nothing. The token is `TRAILMAP_INGEST_TOKEN`, else
 * `~/.config/trailmap/ingest-token`, as `rfc-refine-done.sh` reads it.
 */
import { argv, env, exit, getFs, getPath } from "@blazetrails/ruby-compat";

/** One POST to the loopback API: the status and the parsed body. */
export type Post = (path: string, body: Record<string, unknown>) => Promise<{ status: number; body: unknown }>;

export interface ImportCounts {
  audits: { created: number; existing: number; failed: string[] };
  refinements: { created: number; existing: number; failed: string[] };
}

/** ringo's `refineReport` (btwebooks webhook/spawnloop.go). */
interface RefineReport {
  when: string;
  outcome: string;
  summary?: string;
  stories?: number;
}

const STAMPED_RE = /^(.+)-(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z\.(md|html)$/;
const AUDIT_RE = /^([a-zA-Z0-9][a-zA-Z0-9._-]*)\.(md|html)$/;

function tally(counts: ImportCounts["audits"], what: string, res: { status: number; body: unknown }): void {
  if (res.status === 201) counts.created++;
  else if (res.status === 200) counts.existing++;
  else counts.failed.push(`${what}: ${res.status} ${JSON.stringify(res.body)}`);
}

async function readJson<T>(file: string): Promise<T | null> {
  const fs = getFs();
  if (!(await fs.exists(file))) return null;
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

async function importAudits(dataDir: string, post: Post, counts: ImportCounts["audits"]): Promise<void> {
  const [fs, path] = [getFs(), getPath()];
  const root = path.join(dataDir, "github");
  if (!(await fs.exists(root))) return;
  for (const owner of (await fs.readdir!(root)).sort()) {
    for (const repo of (await fs.readdir!(path.join(root, owner))).sort()) {
      const dir = path.join(root, owner, repo, "audits");
      if (!(await fs.exists(dir))) continue;
      for (const name of (await fs.readdir!(dir)).sort()) {
        const plain = AUDIT_RE.exec(name);
        if (plain === null) continue;
        const file = path.join(dir, name);
        const stamped = STAMPED_RE.exec(name);
        const [slug, writtenAt, format] =
          stamped !== null
            ? [stamped[1], `${stamped[2]}-${stamped[3]}-${stamped[4]}T${stamped[5]}:${stamped[6]}:${stamped[7]}Z`, stamped[8]]
            : [plain[1], new Date(Math.floor((await fs.stat!(file)).mtime.getTime() / 1000) * 1000).toISOString(), plain[2]];
        const body = await fs.readFile(file, "utf8");
        tally(counts, `${owner}/${repo}/${name}`, await post("/audits", { repo: `${owner}/${repo}`, slug, writtenAt, format, body }));
      }
    }
  }
}

/** History ∪ latest, keyed on `(rfc, when)`; `when` to the millisecond, so a re-run finds the row it wrote. */
function refineReports(
  history: Record<string, RefineReport[]>,
  latest: Record<string, RefineReport>,
): [string, string, RefineReport][] {
  const seen = new Map<string, [string, string, RefineReport]>();
  const add = (rfc: string, rep: RefineReport) => {
    const when = new Date(rep.when).toISOString();
    if (!seen.has(`${rfc} ${when}`)) seen.set(`${rfc} ${when}`, [rfc, when, rep]);
  };
  for (const [rfc, reps] of Object.entries(history)) for (const rep of reps) add(rfc, rep);
  for (const [rfc, rep] of Object.entries(latest)) add(rfc, rep);
  return [...seen.values()].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
}

async function importRefinements(dataDir: string, post: Post, counts: ImportCounts["refinements"]): Promise<void> {
  const path = getPath();
  const history = (await readJson<Record<string, RefineReport[]>>(path.join(dataDir, "refine-history.json"))) ?? {};
  const latest = (await readJson<Record<string, RefineReport>>(path.join(dataDir, "refines.json"))) ?? {};
  for (const [rfc, when, rep] of refineReports(history, latest)) {
    const body: Record<string, unknown> = { kind: "rfc-refine", id: rfc, outcome: rep.outcome, summary: rep.summary ?? "", when };
    if (rep.stories !== undefined && rep.stories > 0) body.stories = rep.stories;
    tally(counts, `${rfc} ${when}`, await post("/rfc-refines", body));
  }
}

/** Import everything under `dataDir` through `post`, and say what happened. */
export async function importReports(dataDir: string, post: Post): Promise<ImportCounts> {
  const counts: ImportCounts = {
    audits: { created: 0, existing: 0, failed: [] },
    refinements: { created: 0, existing: 0, failed: [] },
  };
  await importAudits(dataDir, post, counts.audits);
  await importRefinements(dataDir, post, counts.refinements);
  return counts;
}

async function main(args: readonly string[]): Promise<number> {
  const path = getPath();
  const opt = (flag: string) => {
    const at = args.indexOf(flag);
    return at !== -1 ? args[at + 1] : undefined;
  };
  const dataDir = opt("--data") ?? path.join(env.HOME ?? "", ".btwhooks", "data");
  const api = opt("--api") ?? env.TRAILMAP_API ?? "http://127.0.0.1:8080";
  const tokenFile = path.join(env.HOME ?? "", ".config", "trailmap", "ingest-token");
  const token =
    env.TRAILMAP_INGEST_TOKEN ?? ((await getFs().exists(tokenFile)) ? (await getFs().readFile(tokenFile, "utf8")).trim() : "");

  const post: Post = async (route, body) => {
    const res = await fetch(`${api}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // a 401 answers plain text
    }
    return { status: res.status, body: parsed };
  };

  const counts = await importReports(dataDir, post);
  for (const [kind, c] of Object.entries(counts)) {
    console.log(`${kind}: ${c.created} created, ${c.existing} already stored, ${c.failed.length} failed`);
    for (const f of c.failed) console.log(`  failed ${f}`);
  }
  return counts.audits.failed.length + counts.refinements.failed.length === 0 ? 0 : 1;
}

if (env.VITEST === undefined) exit(await main(argv));
