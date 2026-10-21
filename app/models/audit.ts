import { Attributes, Model, type AttributesClassHalf } from "@blazetrails/activemodel";
import { RecordNotFound } from "@blazetrails/activerecord";
import { include } from "@blazetrails/activesupport";
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

function isEnoent(e: unknown): boolean {
  return (e as { code?: string }).code === "ENOENT";
}

/**
 * One agent-written progress report in the audits directory.
 *
 * An ActiveModel, not an ActiveRecord: the audits are a directory of files
 * agents write, as they are for ringo, and RFC 0136 leaves them so. The class
 * methods are shaped like AR's finders — `all`, `first`, `findBy`, `find`
 * raising `RecordNotFound` — so a controller reads the same either way; the
 * "table" is `AUDITS_DIR` and the primary key is the filename.
 */
export class Audit extends Model {
  declare static attribute: AttributesClassHalf["attribute"];

  static {
    include(this, Attributes);
    this.attribute("name", "string");
    this.attribute("size", "integer");
    // mtime, truncated to the second — ringo compares RFC 3339 strings.
    this.attribute("when", "datetime");
  }

  /**
   * Every audit, newest first — ringo's `listAudits`. A missing or unset
   * directory is no audits yet, not an error.
   *
   * Ties keep filename order, because Go's `os.ReadDir` returns entries sorted
   * by name and ringo then sorts on a whole-second timestamp string.
   */
  static async all(): Promise<Audit[]> {
    const dir = auditsDir();
    if (dir === null) return [];
    const [fs, path] = await Promise.all([getFs(), getPath()]);
    if (!fs.readdir || !fs.stat) {
      throw new Error("the filesystem adapter cannot list directories asynchronously");
    }

    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch (e) {
      if (isEnoent(e)) return [];
      throw e;
    }
    const out: Audit[] = [];
    for (const name of [...names].sort()) {
      if (!AUDIT_FILE_RE.test(name)) continue;
      try {
        const info = await fs.stat(path.join(dir, name));
        if (info.isDirectory()) continue;
        const when = new Date(Math.floor(info.mtime.getTime() / 1000) * 1000);
        out.push(new Audit({ name, size: info.size, when }));
      } catch {
        continue;
      }
    }
    return out.sort((a, b) => b.when.getTime() - a.when.getTime());
  }

  /** The newest audit, or null when there are none. */
  static async first(): Promise<Audit | null> {
    return (await this.all())[0] ?? null;
  }

  /**
   * The audit with this filename, or null. A name that fails `AUDIT_FILE_RE`
   * is null before anything touches the filesystem — this is the line between
   * a name and a path, so it checks rather than trusts its caller.
   */
  static async findBy({ name }: { name: string }): Promise<Audit | null> {
    if (!AUDIT_FILE_RE.test(name)) return null;
    return (await this.all()).find((audit) => audit.name === name) ?? null;
  }

  /** `findBy`, raising `RecordNotFound` (a 404) for a missing audit, as AR's `find`. */
  static async find(name: string): Promise<Audit> {
    const audit = await this.findBy({ name });
    if (audit === null) throw new RecordNotFound(`Couldn't find Audit with name=${name}`);
    return audit;
  }

  /**
   * The filename is the primary key, and an audit that was listed exists on
   * disk — so, as Rails' `to_param` does from `persisted?` and `id`,
   * `toParam()` answers the name `/audits/<file>` takes.
   */
  get id(): string {
    return this.name;
  }

  isPersisted(): boolean {
    return true;
  }

  /** ringo's `auditTitle`. */
  get title(): string {
    return auditTitle(this.name);
  }

  /** A self-contained HTML submission rather than markdown. */
  isHtml(): boolean {
    return this.name.endsWith(".html");
  }

  /** The file's contents. Only reachable for a name `all` listed. */
  async read(): Promise<string> {
    const dir = auditsDir();
    if (dir === null) throw new RecordNotFound(`Couldn't find Audit with name=${this.name}`);
    const [fs, path] = await Promise.all([getFs(), getPath()]);
    if (!fs.readFile) throw new Error("the filesystem adapter cannot read files asynchronously");
    try {
      return await fs.readFile(path.join(dir, this.name), "utf8");
    } catch (e) {
      if (isEnoent(e)) throw new RecordNotFound(`Couldn't find Audit with name=${this.name}`);
      throw e;
    }
  }
}

export interface Audit extends Attributes {
  get name(): string;
  set name(value: unknown);
  get size(): number;
  set size(value: unknown);
  get when(): Date;
  set when(value: unknown);
}
