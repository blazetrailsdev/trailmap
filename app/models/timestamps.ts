/**
 * Pin which columns Rails' timestamp touch is allowed to write.
 *
 * Rails' update-timestamp columns are BOTH `updated_at` and `updated_on`
 * (activerecord's timestamp.js: `UPDATED_ATTRS`). Here `updated_on` is
 * markdown's date-only `updated:` field, so letting the touch have it writes a
 * nanosecond instant into a column every reader parses as "YYYY-MM-DD".
 * readmodel's isoMidnight then builds an Invalid Date and buildIndex throws —
 * and buildIndex runs on every read and after every mutation, so ONE such row
 * takes every verb down for everyone on the host.
 *
 * Assigning the model's `_timestampAttributes*InModel` cache is not enough: it
 * is a CACHE, and `reloadSchemaFromCache` (model-schema.js:827, attributes.js:141)
 * nils it whenever column information is loaded or reset. A static-block
 * assignment therefore survives only until the first schema load, which in
 * tests happens never and in production happens within the hour — the fix
 * looked green and corrupted two more rows twenty-six minutes later.
 *
 * So define it as an accessor instead: reads always report the pinned columns,
 * and the library's reset writes are accepted and ignored.
 */
export function pinTimestampColumns(
  model: unknown,
  columns: { create: string[]; update: string[] },
): void {
  const pin = (prop: string, value: string[]): void => {
    Object.defineProperty(model, prop, {
      configurable: true,
      get: () => value,
      set: () => {
        /* the library's cache reset — deliberately inert */
      },
    });
  };
  pin("_timestampAttributesForCreateInModel", columns.create);
  pin("_timestampAttributesForUpdateInModel", columns.update);
  // Derived from the two above and cached separately, so it needs the same
  // treatment or it can be rebuilt from the unpinned defaults.
  pin("_allTimestampAttributesInModel", [...new Set([...columns.create, ...columns.update])]);
}
