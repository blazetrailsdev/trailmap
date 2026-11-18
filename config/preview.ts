/**
 * A PR preview app: a dokku app built from one PR's head, serving copies of
 * the production data behind SSO (docs/deploy.md, "Preview apps").
 *
 * `TRAILMAP_PREVIEW` holds the PR number. It is read once, into
 * `config.x.preview.pr`, like trailmap's other settings, and this is its only
 * reader.
 *
 * A preview must never act on the real fleet. Its hub is a clone of
 * production's, so its `settings` row names production's ringo, and the fleet
 * page's controls would be forwarded there. `Setting.ringoBase()` answers null
 * in a preview for that reason. Every other write lands in the preview's own
 * copies, which `scripts/preview.sh down` destroys.
 */
import { Trails } from "@blazetrails/trailties";

/** The PR number this process previews, or null in a real deployment. */
export function previewPr(): number | null {
  const raw = (Trails.application!.config.x.preview.pr as string | undefined)?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}
