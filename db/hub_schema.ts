// This file is auto-generated from the current state of the database. Instead
// of editing this file, please use the migrations feature of Active Record to
// incrementally modify your database, and then regenerate this schema definition.
//
// This file is the source Trails uses to define your schema when running `bin/trails
// db:schema:load`. When creating a new database, `bin/trails db:schema:load` tends to
// be faster and is potentially less error prone than running all of your
// migrations from scratch. Old migrations may fail to apply correctly if those
// migrations use external dependencies or application code.
//
// It's strongly recommended that you check this file into your version control system.

import { Schema } from "@blazetrails/activerecord";
import type { PostgreSQLAdapter } from "@blazetrails/activerecord/connection-adapters/postgresql-adapter.js";

await Schema.get(8).define<PostgreSQLAdapter>({ version: 2026_10_11_000006 }, async (ctx) => {
  // These are extensions that must be enabled in order to support this database
  await ctx.enableExtension("pg_catalog.plpgsql");

  await ctx.createTable("owners", { force: "cascade" }, (t) => {
    t.string("login", { null: false });
    t.string("kind", { default: "organization", null: false });
    t.string("display_name");
    t.text("description");
    t.datetime("created_at", { null: false });
    t.datetime("updated_at", { null: false });
    t.index("lower((login)::text)", { name: "index_owners_on_lower_login", unique: true });
    t.index(["kind"], { name: "index_owners_on_kind" });
  });

  await ctx.createTable("parity_days", { force: "cascade" }, (t) => {
    t.string("metric", { null: false });
    t.string("package", { null: false });
    t.date("day", { null: false });
    t.integer("pr_number", { null: false });
    t.integer("matched", { null: false });
    t.integer("total", { null: false });
    t.decimal("percent", { precision: 5, scale: 2, null: false });
    t.jsonb("gaps");
    t.datetime("created_at", { null: false });
    t.datetime("updated_at", { null: false });
    t.index(["metric", "day"], { name: "index_parity_days_on_metric_and_day" });
    t.index(["metric", "package", "day"], { name: "index_parity_days_on_metric_and_package_and_day", unique: true });
    t.checkConstraint("matched <= total", { name: "parity_days_matched_within_total" });
    t.checkConstraint("percent >= 0::numeric AND percent <= 100::numeric", { name: "parity_days_percent_is_a_percentage" });
    t.checkConstraint("total >= 0 AND matched >= 0", { name: "parity_days_counts_are_not_negative" });
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
    t.index("lower((name)::text)", { name: "index_repositories_on_lower_name", unique: true });
    t.index(["owner_id"], { name: "index_repositories_on_owner_id" });
  });

  await ctx.createTable("repository_collaborators", { primaryKey: ["repository_id","owner_id"], force: "cascade" }, (t) => {
    t.bigint("repository_id", { null: false });
    t.bigint("owner_id", { null: false });
    t.string("role", { default: "read", null: false });
    t.datetime("created_at", { null: false });
    t.datetime("updated_at", { null: false });
    t.index(["owner_id"], { name: "index_repository_collaborators_on_owner_id" });
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
  await ctx.addForeignKey("repository_collaborators", "owners");
  await ctx.addForeignKey("repository_collaborators", "repositories");
  await ctx.addForeignKey("repository_settings", "repositories");
});
