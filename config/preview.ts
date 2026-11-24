/**
 * A PR preview app: a dokku app built from one PR's head, serving copies of
 * the production data behind SSO (docs/deploy.md, "Preview apps").
 *
 * `TRAILMAP_PREVIEW` holds the PR number. It is read once, into
 * `config.x.preview.pr`, like trailmap's other settings, and this is its only
 * reader. The application uses it for the banner and nothing else: what a
 * preview must not reach is removed from its copies by `scripts/preview.sh`,
 * the one place that knows it is building a preview.
 */
import { Trails } from "@blazetrails/trailties";

/** The PR number this process previews, or null in a real deployment. */
export function previewPr(): number | null {
  const raw = (Trails.application!.config.x.preview.pr as string | undefined)?.trim();
  if (!raw) return null;
  const pr = Number(raw);
  return Number.isSafeInteger(pr) && pr > 0 && String(pr) === raw ? pr : null;
}
