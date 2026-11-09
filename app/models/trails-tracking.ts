import { getFs, getPath } from "@blazetrails/ruby-compat";
import { tasksDatabasePath } from "../../config/database.ts";

/**
 * What `pnpm trails:status` last said about the tasks CLI's trails: the pin,
 * how far behind trails main it is, and whether the last tracking run failed.
 *
 * The tasks repo's `scripts/track-trails-cron.sh` writes it after every
 * hourly run to `trails-status.txt` beside `tasks.db`, a directory this app
 * already reads. Null when there is no tasks database or no run has written
 * the file yet.
 */
export class TrailsTracking {
  static async status(): Promise<string | null> {
    const db = tasksDatabasePath();
    if (!db) return null;
    const [fs, path] = await Promise.all([getFs(), getPath()]);
    try {
      return (await fs.readFile!(path.join(path.dirname(db), "trails-status.txt"), "utf8")).trimEnd();
    } catch (e) {
      if ((e as { code?: string }).code === "ENOENT") return null;
      throw e;
    }
  }

  /** `trails:status` escalates a pin held too long with an `ERROR:` line. */
  static isFailing(status: string): boolean {
    return /^ERROR:/m.test(status);
  }
}
