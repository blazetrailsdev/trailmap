/**
 * The markdown behind a record's `file_path`.
 *
 * `ingest` stores the metadata and leaves the body on disk, so the show pages
 * read the file exactly as ringo does — `filepath.Join(sl.tasksDir,
 * FilePath)`, frontmatter stripped, render the rest.
 *
 * Reads go through the framework's fs adapter rather than `node:fs`, and
 * through its async surface: a page read is request work, and blocking the
 * single-threaded server on disk for it is the thing the adapter's async half
 * exists to avoid.
 *
 * A failure is a VALUE, not a throw. ringo renders the read error inline on
 * the page (`data.MarkdownErr`) and still shows the metadata it already has,
 * because a story whose file has been renamed or rehomed is exactly when you
 * want to look at its page.
 */
import { getFs, getPath } from "@blazetrails/ruby-compat";
import { tasksContentDir } from "../../../config/tasks-content.js";

export interface Document {
  /** The body, frontmatter removed, or "" when there is none to show. */
  markdown: string;
  /** Why the body is missing, or "" when it is not. */
  error: string;
}

/** Read and strip the document at `filePath`, relative to the tasks checkout. */
export async function readDocument(filePath: string | null): Promise<Document> {
  if (!filePath) return { markdown: "", error: "" };

  const dir = tasksContentDir();
  if (dir === null) {
    return {
      markdown: "",
      error:
        "TASKS_DIR names no tasks checkout, so the markdown for " +
        `${filePath} cannot be read.`,
    };
  }

  const [fs, path] = await Promise.all([getFs(), getPath()]);
  if (!fs.readFile) {
    return { markdown: "", error: "the filesystem adapter cannot read files asynchronously" };
  }
  try {
    const source = await fs.readFile(path.join(dir, filePath), "utf8");
    return { markdown: stripFrontmatter(source), error: "" };
  } catch (e) {
    return { markdown: "", error: (e as Error).message };
  }
}

/**
 * Drop a leading `---` frontmatter block. A port of ringo's
 * `stripFrontmatter` (`webhook/spawnloop.go:1975`) construct for construct,
 * including its two edge cases: a file that only opens a block renders whole,
 * and one whose closing `---` ends the file renders as empty.
 */
export function stripFrontmatter(source: string): string {
  const s = source.startsWith("﻿") ? source.slice(1) : source;
  if (!s.startsWith("---")) return s.trim();

  const rest = s.slice(3);
  const idx = rest.indexOf("\n---");
  if (idx < 0) return s.trim();

  const after = rest.slice(idx + 4);
  const nl = after.indexOf("\n");
  return nl < 0 ? "" : after.slice(nl).trim();
}
