// This file is auto-generated from the current state of the database.
// Instead of editing this file, please use the migrations feature.

import type { DatabaseAdapter } from "@blazetrails/activerecord";

export const defineParams = { version: 2026_08_25_000006 };

export default async function defineSchema(ctx: DatabaseAdapter) {
  await ctx.createTable("events", { force: "cascade" }, (t) => {
    t.string("at", { null: false });
    t.string("verb", { null: false });
    t.string("story_id");
    t.string("rfc_id");
    t.integer("pr");
    t.string("actor");
    t.text("detail");
    t.index(["at"], { name: "index_events_on_at" });
    t.index(["rfc_id"], { name: "index_events_on_rfc_id" });
    t.index(["story_id"], { name: "index_events_on_story_id" });
    t.index(["verb"], { name: "index_events_on_verb" });
  });

  await ctx.createTable("meta", { primaryKey: "key", id: "string", force: "cascade" }, (t) => {
    t.text("value");
    t.datetime("created_at", { null: false });
    t.datetime("updated_at", { null: false });
  });

  await ctx.createTable("rfcs", { id: "string", force: "cascade" }, (t) => {
    t.integer("number");
    t.string("slug");
    t.string("title");
    t.string("status", { default: "draft", null: false });
    t.string("owner");
    t.string("superseded_by");
    t.integer("priority");
    t.string("file_path");
    t.datetime("created_at", { null: false });
    t.datetime("updated_at", { null: false });
    t.string("created_on");
    t.string("updated_on");
    t.text("packages");
    t.text("clusters");
    t.text("related_rfcs");
    t.index(["status"], { name: "index_rfcs_on_status" });
  });

  await ctx.createTable("stories", { id: "string", force: "cascade" }, (t) => {
    t.string("rfc_id", { null: false });
    t.string("title");
    t.string("cluster");
    t.integer("priority");
    t.integer("est_loc");
    t.string("file_path");
    t.string("status", { default: "draft", null: false });
    t.integer("pr");
    t.string("assignee");
    t.string("blocked_by");
    t.text("closed_reason");
    t.string("claim_at");
    t.datetime("created_at", { null: false });
    t.datetime("updated_at", { null: false });
    t.string("updated_on");
    t.index(["rfc_id", "status"], { name: "index_stories_on_rfc_id_and_status" });
    t.index(["status"], { name: "index_stories_on_status" });
  });

  await ctx.createTable("story_deps", { id: false, force: "cascade" }, (t) => {
    t.string("story_id", { null: false });
    t.string("depends_on_id", { null: false });
    t.index(["depends_on_id"], { name: "index_story_deps_on_depends_on_id" });
    t.index(["story_id", "depends_on_id"], { name: "index_story_deps_on_story_id_and_depends_on_id", unique: true });
    t.index(["story_id"], { name: "index_story_deps_on_story_id" });
  });

  await ctx.createTable("story_packages", { id: false, force: "cascade" }, (t) => {
    t.string("story_id", { null: false });
    t.string("package", { null: false });
    t.index(["package"], { name: "index_story_packages_on_package" });
    t.index(["story_id"], { name: "index_story_packages_on_story_id" });
  });

  await ctx.createTable("story_paths", { id: false, force: "cascade" }, (t) => {
    t.string("story_id", { null: false });
    t.string("path", { null: false });
    t.index(["path"], { name: "index_story_paths_on_path" });
    t.index(["story_id"], { name: "index_story_paths_on_story_id" });
  });

  await ctx.createTable("story_rfc_deps", { id: false, force: "cascade" }, (t) => {
    t.string("story_id", { null: false });
    t.string("rfc_id", { null: false });
    t.index(["story_id", "rfc_id"], { name: "index_story_rfc_deps_on_story_id_and_rfc_id", unique: true });
    t.index(["story_id"], { name: "index_story_rfc_deps_on_story_id" });
  });
}