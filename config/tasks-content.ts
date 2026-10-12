/**
 * Where the RFC and story markdown lives.
 *
 * The database holds `file_path` — a path RELATIVE to the tasks checkout —
 * and never the body, so a show page has to read the file the way ringo does
 * (`webhook/story.go:145`, `webhook/rfcs.go:224`: `filepath.Join(sl.tasksDir,
 * st.FilePath)`).
 *
 * `TASKS_DIR` names that checkout. It is the same variable the shell
 * wrappers already use, so a host that can run the CLI can serve the pages
 * without a second thing to configure. When it is unset the directory is
 * derived from `TASKS_DATABASE`, which points at `<tasks checkout>/.git/
 * tasks.db` — two levels up is the checkout. Deriving it rather than
 * demanding both is deliberate: the deployment sets `TASKS_DATABASE` today,
 * and a page that 500s for want of an unset variable nobody has heard of is
 * worse than one that finds the file.
 *
 * `TASKS_DIR` is `config.x.tasks.dir`, which config/application.ts fills from
 * the environment at boot; the database path is config/database.ts's.
 */
import { Trails } from "@blazetrails/trailties";
import { tasksDatabasePath } from "./database.js";

/** The tasks checkout, or null when neither variable names one. */
export function tasksContentDir(): string | null {
  const dir = (Trails.application!.config.x.tasks.dir as string | undefined)?.trim();
  if (dir) return dir.replace(/\/+$/, "");

  const db = tasksDatabasePath();
  if (!db) return null;
  const match = /^(.*)\/\.git\/[^/]+$/.exec(db);
  return match ? match[1]! : null;
}
