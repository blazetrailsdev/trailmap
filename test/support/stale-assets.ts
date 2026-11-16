/**
 * The message for an assertion on a logical asset link. With a `public/assets`
 * build present (scripts/build-assets.sh, which scripts/dashboard-e2e.sh runs),
 * the layout links the digested names instead, so the link assertions fail for
 * a reason the diff does not show.
 */
export const staleAssets =
  "expected the logical asset name; if public/assets exists, a leftover scripts/build-assets.sh build makes the layout link digested names: remove public/assets";
