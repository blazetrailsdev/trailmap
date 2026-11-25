import type { DeployRow } from "../controllers/deploys-controller.ts";

export const DeploysHelper = {
  /** Where a run's log is read: by id alone; the controller finds the file from the run. */
  deployLogPath(run: Pick<DeployRow, "id">): string {
    return `/deploys/log?id=${encodeURIComponent(run.id)}`;
  },

  /** The same log replayed through the terminal emulator, for the row's inline view. */
  deployScreenPath(run: Pick<DeployRow, "id">): string {
    return `/deploys/screen?id=${encodeURIComponent(run.id)}`;
  },

  /** A preview run's kind, for its tag: `preview`, `preview teardown`, `preview sweep`. Null for a deploy. */
  deployKind(run: Pick<DeployRow, "target">): string | null {
    const target = run.target ?? "";
    return target === "preview" || target.startsWith("preview ") ? target : null;
  },

  /**
   * A preview's address, linked only when it is an https URL: it is relayed
   * from ringo, which read it from a log, and an href is no place to trust
   * that blindly. Rails' `URI.parse(url).to_s`, so both pages link one href
   * for one row: Ruby's RFC 3986 grammar, not WHATWG's, decides what parses.
   */
  deployPreviewUrl(run: Pick<DeployRow, "url">): string | null {
    const url = run.url ?? "";
    // `RFC3986_Parser#split` raises "URI must be ascii only" before it matches.
    if (!/^[\x00-\x7f]*$/.test(url)) return null;
    const match = RFC3986_URI.exec(url);
    if (!match?.groups) return null;
    const { scheme, userinfo, host, port, path, query, fragment } = match.groups;
    if (scheme.toLowerCase() !== "https" || !host) return null;
    let str = `https://${userinfo === undefined ? "" : `${userinfo}@`}${host}`;
    const portNumber = port ? Number(port) : null;
    if (portNumber !== null && portNumber !== 443) str += `:${portNumber}`;
    str += path;
    if (query !== undefined) {
      const escaped = uriQuery(query);
      if (escaped === null) return null;
      str += `?${escaped}`;
    }
    if (fragment !== undefined) str += `#${fragment}`;
    return str;
  },

  /** A run's length as ringo's page writes it: `42s`, `2m 5s`. */
  deployDuration(seconds: number): string {
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  },
};

const DEC_OCTET = String.raw`(?:[1-9]\d|1\d{2}|2[0-4]\d|25[0-5]|\d)`;
const IPV4 = String.raw`${DEC_OCTET}\.${DEC_OCTET}\.${DEC_OCTET}\.${DEC_OCTET}`;
const H16 = "[0-9A-Fa-f]{1,4}";
const LS32 = `(?:${H16}:${H16}|${IPV4})`;
const IPV6 = [
  `(?:${H16}:){6}${LS32}`,
  `::(?:${H16}:){5}${LS32}`,
  `${H16}?::(?:${H16}:){4}${LS32}`,
  `(?:(?:${H16}:)?${H16})?::(?:${H16}:){3}${LS32}`,
  `(?:(?:${H16}:){0,2}${H16})?::(?:${H16}:){2}${LS32}`,
  `(?:(?:${H16}:){0,3}${H16})?::${H16}:${LS32}`,
  `(?:(?:${H16}:){0,4}${H16})?::${LS32}`,
  `(?:(?:${H16}:){0,5}${H16})?::${H16}`,
  `(?:(?:${H16}:){0,6}${H16})?::`,
].join("|");
const IPVFUTURE = String.raw`v[0-9A-Fa-f]+\.[!$&-.0-9:;=A-Z_a-z~]+`;
const PCT = "%[0-9A-Fa-f]{2}";
const HOST = `\\[(?:${IPV6}|${IPVFUTURE})\\]|${IPV4}|(?:${PCT}|[!$&-.0-9;=A-Z_a-z~])*`;
const USERINFO = `(?:${PCT}|[!$&-.0-9:;=A-Z_a-z~])*`;
const SEG = `(?:${PCT}|[!$&-.0-9:;=@A-Z_a-z~/])`;
const FRAGMENT = `(?:${PCT}|[!$&-.0-9:;=@A-Z_a-z~/?])*`;

/**
 * The authority form of uri-1.1.2's `RFC3986_Parser::RFC3986_URI`, the only
 * form with a host, which `deploy_preview_url` requires.
 */
const RFC3986_URI = new RegExp(
  `^(?<scheme>[A-Za-z][+\\-.0-9A-Za-z]*)://` +
    `(?:(?<userinfo>${USERINFO})@)?(?<host>${HOST})(?::(?<port>\\d*))?` +
    `(?<path>(?:/${SEG}*)?)(?:\\?(?<query>[^#]*))?(?:#(?<fragment>${FRAGMENT}))?$`,
);

/** uri-1.1.2's `Generic#query=`: null where it raises on a bad escape. */
function uriQuery(query: string): string | null {
  const v = query.replace(/[\t\r\n]/g, "");
  if (/%[^0-9A-Fa-f]{2}/.test(v)) return null;
  return v.replace(/(?!%[0-9A-Fa-f]{2}|[!$-&(-;=?-_a-~])[\s\S]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}
