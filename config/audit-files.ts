/**
 * The only filename shape an audit may have: no separators, no dotfiles, and
 * either extension an agent may submit — `.md`, which is rendered, or `.html`,
 * which is served as written. ringo's `auditFileRe` (webhook/audits.go),
 * character for character.
 *
 * Here rather than in app/models/audit.ts for the reason `LOGIN_FORMAT` lives
 * in owner-names.ts: the route table builds its `:id` constraint from it, and
 * config/routes.ts should not load a model to draw.
 */
export const AUDIT_FILE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(md|html)$/;

/**
 * `AUDIT_FILE_RE` as a route segment constraint. No `^` or `$`: a segment
 * constraint is matched against the whole segment and an anchored one is
 * rejected, as in Rails.
 */
export const AUDIT_SEGMENT = new RegExp(AUDIT_FILE_RE.source.slice(1, -1));

/** The legacy filename, `<slug>-<YYYYMMDDTHHMMSSZ>.<format>`, split in three: `Audit.find` and the import read it. */
export const PARAM_RE = /^(.+)-(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z\.(md|html)$/;
