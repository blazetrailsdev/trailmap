# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.0].define(version: 2026_10_11_000006) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pg_catalog.plpgsql"

  create_table "owners", force: :cascade do |t|
    t.string "login", null: false
    t.string "kind", default: "organization", null: false
    t.string "display_name"
    t.text "description"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index "lower((login)::text)", name: "index_owners_on_lower_login", unique: true
    t.index ["kind"], name: "index_owners_on_kind"
  end

  create_table "parity_days", force: :cascade do |t|
    t.string "metric", null: false
    t.string "package", null: false
    t.date "day", null: false
    t.integer "pr_number", null: false
    t.integer "matched", null: false
    t.integer "total", null: false
    t.decimal "percent", precision: 5, scale: 2, null: false
    t.jsonb "gaps"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["metric", "day"], name: "index_parity_days_on_metric_and_day"
    t.index ["metric", "package", "day"], name: "index_parity_days_on_metric_and_package_and_day", unique: true
    t.check_constraint "matched <= total", name: "parity_days_matched_within_total"
    t.check_constraint "percent >= 0::numeric AND percent <= 100::numeric", name: "parity_days_percent_is_a_percentage"
    t.check_constraint "total >= 0 AND matched >= 0", name: "parity_days_counts_are_not_negative"
  end

  create_table "repositories", force: :cascade do |t|
    t.bigint "owner_id", null: false
    t.string "name", null: false
    t.string "checkout_path"
    t.string "default_branch", default: "main", null: false
    t.string "visibility", default: "public", null: false
    t.text "description"
    t.boolean "archived", default: false, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index "lower((name)::text)", name: "index_repositories_on_lower_name", unique: true
    t.index ["owner_id"], name: "index_repositories_on_owner_id"
  end

  create_table "repository_collaborators", primary_key: ["repository_id", "owner_id"], force: :cascade do |t|
    t.bigint "repository_id", null: false
    t.bigint "owner_id", null: false
    t.string "role", default: "read", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["owner_id"], name: "index_repository_collaborators_on_owner_id"
  end

  create_table "repository_settings", force: :cascade do |t|
    t.bigint "repository_id", null: false
    t.boolean "issues_enabled", default: true, null: false
    t.boolean "pulls_enabled", default: true, null: false
    t.boolean "actions_enabled", default: true, null: false
    t.boolean "projects_enabled", default: true, null: false
    t.boolean "wiki_enabled", default: true, null: false
    t.boolean "insights_enabled", default: true, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["repository_id"], name: "index_repository_settings_on_repository_id", unique: true
  end

  create_table "settings", primary_key: "key", id: :string, force: :cascade do |t|
    t.text "value"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
  end

  add_foreign_key "repositories", "owners"
  add_foreign_key "repository_collaborators", "owners"
  add_foreign_key "repository_collaborators", "repositories"
  add_foreign_key "repository_settings", "repositories"
end
