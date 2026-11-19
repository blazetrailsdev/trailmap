import { RecordNotFound } from "@blazetrails/activerecord";
import { Range } from "@blazetrails/ruby-compat";
import { type Extended } from "@blazetrails/activesupport";
import type { ClassMethods } from "@blazetrails/activestorage/attached/model";
import type { One } from "@blazetrails/activestorage/attached/one";
import { AUDIT_FILE_RE } from "../../config/audit-files.ts";
import { ApplicationRecord } from "./application-record.ts";

export { AUDIT_FILE_RE };

/** The legacy filename, `<slug>-<YYYYMMDDTHHMMSSZ>.<format>`, split in three. */
const PARAM_RE = /^(.+)-(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z\.(md|html)$/;

/** Rails' `find` message and fields (activerecord/lib/active_record/core.rb:280). */
function notFound(name: string): RecordNotFound {
  return new RecordNotFound(`Couldn't find Audit with 'name'=${name}`, "Audit", "name", name);
}

/**
 * One agent-written progress report. On `Base`, with the report itself in
 * Active Storage (RFC 0243, which reverses 0136's file-backed audits). The
 * param is the filename the report had in the audits directory, so
 * `/audits/<file>` keeps working.
 */
export class Audit extends ApplicationRecord {
  declare body: One;

  static {
    (this as unknown as Extended<typeof ClassMethods>).hasOneAttached("body");
  }

  /** Every audit, newest first. */
  static newestFirst() {
    return this.order({ written_at: "desc", id: "desc" });
  }

  /**
   * The audit `toParam` names, raising `RecordNotFound` (a 404) for a name
   * that does not parse or names no audit. The stamp is whole seconds, so it
   * matches the second it names, whatever precision `written_at` was stored at.
   */
  static override find = async function (this: typeof Audit, name: unknown) {
    const parts = PARAM_RE.exec(String(name));
    const [, slug, y, mo, d, h, mi, s, format] = parts ?? [];
    const second = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
    const audit =
      parts === null
        ? null
        : await this.findBy({ slug, format, written_at: new Range(new Date(second), new Date(second + 1000), true) });
    if (audit === null) throw notFound(String(name));
    return audit;
  } as typeof ApplicationRecord.find;

  override toParam = (): string => `${this.slug}-${this.written_at.utc().strftime("%Y%m%dT%H%M%SZ")}.${this.format}`;

  /** The title the report gave, else its slug de-kebabbed, as ringo's `auditTitle`. */
  get title(): string {
    const title = this.readAttribute("title") as string | null;
    return title != null && title.trim() !== "" ? title : this.slug.replace(/[-_]/g, " ");
  }

  get when() {
    return this.written_at;
  }

  /** A self-contained HTML submission rather than markdown. */
  isHtml(): boolean {
    return this.format === "html";
  }

  /** The body's `byte_size`. */
  async size(): Promise<number | null> {
    return (await this._blob()).byte_size;
  }

  /** The report, `body.download`. */
  async read(): Promise<string> {
    return new TextDecoder().decode(await (await this._blob()).download());
  }

  private async _blob() {
    const blob = await (await this.body.attachment)?.blob;
    if (blob == null) throw notFound(this.toParam());
    return blob;
  }
}

