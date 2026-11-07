import { Migration } from "@blazetrails/activerecord";

/**
 * The api:compare and test:compare keys a package's rows are written under
 * (`actionpack` → `actiondispatch,actioncontroller,...`), from the package
 * summary's `compareKeys`. NULL on a commit synced before trails emitted it,
 * and a reader then keys the package by its own name.
 */
export class AddCompareKeysToPackageMeta extends Migration.get(8) {
  async change(): Promise<void> {
    await this.addColumn("package_meta", "compare_keys", "string");
  }
}
