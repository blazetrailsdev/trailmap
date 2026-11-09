import { getFs, getPath, StringIO } from "@blazetrails/ruby-compat";
import type { One } from "@blazetrails/activestorage";
import { Trails } from "@blazetrails/trailties";
import { AUDIT_FILE_RE } from "../../config/audit-files.ts";
import { Hub } from "./hub.ts";

export { AUDIT_FILE_RE };

/** A trailing ISO-basic timestamp (`-20260803T134718Z`), ringo's `tsSuffixRe`. */
const TS_SUFFIX_RE = /[-_]?\d{8}T\d{6}Z$/;

/** `AUDITS_DIR`, read once into `config.x` by config/application.ts. */
export function auditsDir(): string | null {
  const dir = (Trails.application!.config.x.audits.dir as string | undefined)?.trim();
  return dir ? dir.replace(/\/+$/, "") : null;
}

/** ringo's `auditTitle`: drop the extension and timestamp, de-kebab the slug. */
export function auditTitle(name: string): string {
  let base = name.replace(/\.md$/, "").replace(/\.html$/, "");
  base = base.replace(TS_SUFFIX_RE, "").replace(/[-_]/g, " ").trim();
  return base === "" ? name : base;
}

/**
 * `<owner>/<repo>` from an audits directory laid out as btwhooks writes it,
 * `…/github/<owner>/<repo>/audits`; any other layout is trails' own, which is
 * the only repository that has audits today.
 */
export function auditsRepo(dir: string): string {
  const match = /\/github\/([^/]+)\/([^/]+)\/audits$/.exec(dir);
  return match ? `${match[1]}/${match[2]}` : "blazetrailsdev/trails";
}

/**
 * One agent-written progress report. Agents still write files into
 * `AUDITS_DIR`; `Audit.importFrom` copies each into Active Storage once, and
 * the pages read the row and its `report` blob — never the directory.
 *
 * `name` is the filename and the route key (`/audits/<name>`), so `toParam`
 * answers it rather than the id.
 */
export class Audit extends Hub {
  static _tableName = "audits";

  declare report: One;

  static {
    this.hasOneAttached("report");
  }

  /** Every audit, newest first; ties in filename order, as ringo lists them. */
  static newestFirst() {
    return this.order({ writtenAt: "desc", name: "asc" });
  }

  /**
   * Import every audit file in `dir` that has no row yet: one row per file,
   * its contents attached as `report`. Re-running skips what is already
   * imported, so it is safe on a schedule. Answers the names it imported.
   */
  static async importFrom(dir: string | null = auditsDir()): Promise<string[]> {
    if (dir === null) return [];
    const [fs, path] = await Promise.all([getFs(), getPath()]);
    let names: string[];
    try {
      names = await fs.readdir!(dir);
    } catch (e) {
      if ((e as { code?: string }).code === "ENOENT") return [];
      throw e;
    }
    const known = new Set((await this.pluck("name")) as string[]);
    const repo = auditsRepo(dir);
    const imported: string[] = [];
    for (const name of [...names].sort()) {
      if (!AUDIT_FILE_RE.test(name) || known.has(name)) continue;
      const file = path.join(dir, name);
      const info = await fs.stat!(file);
      if (info.isDirectory()) continue;
      const audit = new Audit({
        repo,
        name,
        slug: name.replace(/\.(md|html)$/, ""),
        size: info.size,
        writtenAt: new Date(Math.floor(info.mtime.getTime() / 1000) * 1000),
      });
      await audit.report.attach({
        io: new StringIO(await fs.readFile!(file, "utf8")),
        filename: name,
        contentType: name.endsWith(".html") ? "text/html" : "text/markdown",
      });
      await audit.saveBang();
      imported.push(name);
    }
    return imported;
  }

  toParam(): string {
    return this.name;
  }

  /** ringo's `auditTitle`. */
  get title(): string {
    return auditTitle(this.name);
  }

  /** A self-contained HTML submission rather than markdown. */
  isHtml(): boolean {
    return this.name.endsWith(".html");
  }

  /** The report's contents, from its blob. */
  async read(): Promise<string> {
    return String(await this.report.download());
  }
}
