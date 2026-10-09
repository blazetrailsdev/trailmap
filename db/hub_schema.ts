// This file is auto-generated from the current state of the database.
// Instead of editing this file, please use the migrations feature.

import type { DatabaseAdapter } from "@blazetrails/activerecord";

export const defineParams = { version: 2026_10_09_000004 };

export default async function defineSchema(ctx: DatabaseAdapter) {
  // These are extensions that must be enabled in order to support this database
  await ctx.enableExtension("pg_catalog.plpgsql");

  await ctx.createTable("owners", { force: "cascade" }, (t) => {
    t.string("login", { null: false });
    t.string("kind", { default: "organization", null: false });
    t.string("display_name");
    t.text("description");
    t.string("avatar_url");
    t.datetime("created_at", { null: false });
    t.datetime("updated_at", { null: false });
    t.index("lower((login)::text)", { name: "index_owners_on_lower_login", unique: true });
    t.index(["kind"], { name: "index_owners_on_kind" });
  });

  await ctx.createTable("repositories", { force: "cascade" }, (t) => {
    t.bigint("owner_id", { null: false });
    t.string("name", { null: false });
    t.string("checkout_path");
    t.string("default_branch", { default: "main", null: false });
    t.string("visibility", { default: "public", null: false });
    t.text("description");
    t.boolean("archived", { default: false, null: false });
    t.datetime("created_at", { null: false });
    t.datetime("updated_at", { null: false });
    t.index("owner_id, lower((name)::text)", { name: "index_repositories_on_owner_id_and_lower_name", unique: true });
    t.index(["owner_id"], { name: "index_repositories_on_owner_id" });
  });

  await ctx.createTable("repository_settings", { force: "cascade" }, (t) => {
    t.bigint("repository_id", { null: false });
    t.boolean("issues_enabled", { default: true, null: false });
    t.boolean("pulls_enabled", { default: true, null: false });
    t.boolean("actions_enabled", { default: true, null: false });
    t.boolean("projects_enabled", { default: true, null: false });
    t.boolean("wiki_enabled", { default: true, null: false });
    t.boolean("insights_enabled", { default: true, null: false });
    t.datetime("created_at", { null: false });
    t.datetime("updated_at", { null: false });
    t.index(["repository_id"], { name: "index_repository_settings_on_repository_id", unique: true });
  });

  await ctx.createTable("settings", { primaryKey: "key", id: "string", force: "cascade" }, (t) => {
    t.text("value");
    t.datetime("created_at", { null: false });
    t.datetime("updated_at", { null: false });
  });

  await ctx.addForeignKey("repositories", "owners");
  await ctx.addForeignKey("repository_settings", "repositories");
}
