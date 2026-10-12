import { describe, expect, it } from "vitest";
import { setX } from "../support/config-x.js";
import { Dir, setEnv } from "@blazetrails/ruby-compat";
import { readDocument, stripFrontmatter } from "../../app/models/concerns/document.js";
import { tasksContentDir } from "../../config/tasks-content.js";

describe("stripFrontmatter", () => {
  it("drops a leading frontmatter block", () => {
    expect(stripFrontmatter("---\ntitle: x\n---\n\n## Context\n\nbody\n")).toBe(
      "## Context\n\nbody",
    );
  });

  it("leaves a document without frontmatter alone but for surrounding blank lines", () => {
    expect(stripFrontmatter("\n# Title\n\nbody\n")).toBe("# Title\n\nbody");
  });

  it("renders a document that only opens a block whole, as ringo does", () => {
    expect(stripFrontmatter("---\ntitle: x\n")).toBe("---\ntitle: x");
  });

  it("renders a document whose closing delimiter ends the file as empty", () => {
    expect(stripFrontmatter("---\ntitle: x\n---")).toBe("");
  });

  it("tolerates a byte-order mark", () => {
    expect(stripFrontmatter("﻿---\na: 1\n---\nbody\n")).toBe("body");
  });
});

describe("tasksContentDir", () => {
  it("derives the checkout from the database path when TASKS_DIR is unset", () => {
    setX("tasks", "dir", undefined);
    setEnv("TASKS_DATABASE", "/srv/tasks/.git/tasks.db");
    expect(tasksContentDir()).toBe("/srv/tasks");
  });

  it("prefers TASKS_DIR, without a trailing slash", () => {
    setX("tasks", "dir", "/srv/elsewhere/");
    expect(tasksContentDir()).toBe("/srv/elsewhere");
  });

  it("names no directory when neither variable does", () => {
    setX("tasks", "dir", undefined);
    setEnv("TASKS_DATABASE", undefined);
    expect(tasksContentDir()).toBeNull();
  });
});

describe("readDocument", () => {
  it("reads a file relative to the tasks checkout", async () => {
    setX("tasks", "dir", Dir.pwd());

    const doc = await readDocument("README.md");

    expect(doc.error).toBe("");
    expect(doc.markdown).toContain("trailmap");
  });

  it("returns the read failure as a value, so the page can still render", async () => {
    setX("tasks", "dir", Dir.pwd());

    const doc = await readDocument("rfcs/nope/stories/gone.md");

    expect(doc.markdown).toBe("");
    expect(doc.error).not.toBe("");
  });

  it("says which document it could not place when no checkout is configured", async () => {
    setX("tasks", "dir", undefined);
    setEnv("TASKS_DATABASE", undefined);

    const doc = await readDocument("rfcs/0136-trailmap/index.md");

    expect(doc.error).toContain("TASKS_DIR");
    expect(doc.error).toContain("rfcs/0136-trailmap/index.md");
  });

  it("has nothing to read for a record with no file", async () => {
    expect(await readDocument(null)).toEqual({ markdown: "", error: "" });
  });
});
