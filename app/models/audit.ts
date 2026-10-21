import { getFs, getPath } from "@blazetrails/ruby-compat";
import { Trails } from "@blazetrails/trailties";

/**
 * The only filename shape the audit viewer will serve: no separators, no
 * dotfiles, and either extension an agent may submit — `.md`, which is
 * rendered, or `.html`, which is served as written. ringo's `auditFileRe`
 * (webhook/audits.go), character for character, and it is the whole of the
 * path-traversal defence: a name that matches cannot leave the directory.
 */
export const AUDIT_FILE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(md|html)$/;

/** A trailing ISO-basic timestamp (`-20260803T134718Z`), ringo's `tsSuffixRe`. */
const TS_SUFFIX_RE = /[-_]?\d{8}T\d{6}Z$/;

/**
 * One agent-written progress report in the audits directory.
 *
 * File-backed, not a model on any database: the audits are a directory of
 * files agents write, as they are for ringo, and RFC 0136 leaves them so.
 */
export interface Audit {
  name: string;
  title: string;
  /** mtime, truncated to the second — ringo compares RFC 3339 strings. */
  when: Date;
  size: number;
}

/** `AUDITS_DIR`, read once into `config.x` by config/application.ts. */
export function auditsDir(): string | null {
  const dir = (Trails.application!.config.x.audits.dir as string | undefined)?.trim();
  return dir ? dir.replace(/\/+$/, "") : null;
}

/** Whether `name` is a self-contained HTML submission rather than markdown. */
export function isHtmlAudit(name: string): boolean {
  return name.endsWith(".html");
}

/** ringo's `auditTitle`: drop the extension and timestamp, de-kebab the slug. */
export function auditTitle(name: string): string {
  let base = name.replace(/\.md$/, "").replace(/\.html$/, "");
  base = base.replace(TS_SUFFIX_RE, "").replace(/[-_]/g, " ").trim();
  return base === "" ? name : base;
}

/**
 * The audits, newest first — ringo's `listAudits`. A missing directory is no
 * audits yet, not an error.
 *
 * Ties keep filename order, because Go's `os.ReadDir` returns entries sorted by
 * name and ringo then sorts on a whole-second timestamp string.
 */
export async function listAudits(): Promise<Audit[]> {
  const dir = auditsDir();
  if (dir === null) return [];
  const [fs, path] = await Promise.all([getFs(), getPath()]);
  if (!fs.readdir || !fs.stat) throw new Error("the filesystem adapter cannot list directories asynchronously");

  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (e) {
    if ((e as { code?: string }).code === "ENOENT") return [];
    throw e;
  }
  const out: Audit[] = [];
  for (const name of [...names].sort()) {
    if (!AUDIT_FILE_RE.test(name)) continue;
    try {
      const info = await fs.stat(path.join(dir, name));
      if (info.isDirectory()) continue;
      const when = new Date(Math.floor(info.mtime.getTime() / 1000) * 1000);
      out.push({ name, title: auditTitle(name), when, size: info.size });
    } catch {
      continue;
    }
  }
  return out.sort((a, b) => b.when.getTime() - a.when.getTime());
}

/**
 * One audit's contents, or `null` when there is no such file. The caller has
 * already checked `name` against `AUDIT_FILE_RE`; this checks it again rather
 * than trust that, since it is the line between a name and a path.
 */
export async function readAudit(name: string): Promise<string | null> {
  const dir = auditsDir();
  if (dir === null || !AUDIT_FILE_RE.test(name)) return null;
  const [fs, path] = await Promise.all([getFs(), getPath()]);
  if (!fs.readFile) throw new Error("the filesystem adapter cannot read files asynchronously");
  try {
    return await fs.readFile(path.join(dir, name), "utf8");
  } catch (e) {
    if ((e as { code?: string }).code === "ENOENT") return null;
    throw e;
  }
}
