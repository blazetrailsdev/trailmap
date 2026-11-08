/** The `package_meta` columns `compareKeys` reads. */
export interface CompareKeyed {
  package: string;
  compare_keys: string | null;
}

/**
 * The api:compare and test:compare keys a `package_meta` row's stats are
 * written under: `compare_keys` comma-split, or the package name when NULL.
 * Shared by the reader (`Stats`) and writer (`StatsSyncRecord`) models.
 */
export function compareKeys(this: CompareKeyed): string[] {
  return this.compare_keys ? this.compare_keys.split(",") : [this.package];
}

export const CompareKeys = { compareKeys };
