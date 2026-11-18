import type { ActionController } from "@blazetrails/actionpack";
import { included } from "@blazetrails/activesupport";
import { env } from "@blazetrails/ruby-compat";

interface IngestRequest {
  getHeader(key: string): unknown;
}

/**
 * Compares every character whatever the first mismatch, so the time taken
 * says nothing about how much of a guess was right. A length mismatch still
 * walks the expected token, against itself, before answering false.
 */
export function secureCompare(a: string, b: string): boolean {
  const mismatchedLength = a.length !== b.length;
  const other = mismatchedLength ? a : b;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ other.charCodeAt(i);
  return diff === 0 && !mismatchedLength;
}

/**
 * True when the request carries `Authorization: Bearer <t>` and `t` is
 * `TRAILMAP_INGEST_TOKEN`. An unset or empty token refuses everything: the
 * endpoints fail closed rather than open on a box that was never provisioned.
 */
export function isIngestTokenValid(request: IngestRequest, expected = env.TRAILMAP_INGEST_TOKEN): boolean {
  if (expected == null || expected === "") return false;
  const header = request.getHeader("HTTP_AUTHORIZATION");
  if (header == null) return false;
  const match = /^Bearer (.+)$/.exec(String(header).trim());
  if (match == null) return false;
  return secureCompare(expected, match[1]);
}

type IngestHost = Pick<ActionController.Base, "request" | "head">;

/**
 * `include(this, IngestToken)` on a create controller guards its actions with
 * `before_action :require_ingest_token`. Include it after `ApiController`'s
 * `LoopbackOnly`, so the loopback check runs first and a proxied request is a
 * 404 whatever token it carries.
 */
export const IngestToken = {
  [included](base: typeof ActionController.Base): void {
    base.beforeAction(":_requireIngestToken");
  },

  /** A 401 with no body: the response says nothing about why. */
  async _requireIngestToken(this: IngestHost): Promise<void> {
    if (isIngestTokenValid(this.request)) return;
    await this.head(401);
  },
};
