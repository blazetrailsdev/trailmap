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

ActiveRecord::Schema[8.0].define(version: 2026_11_05_000002) do
  create_table "api_call_args_stats", force: :cascade do |t|
    t.string "merge_commit_sha"
    t.integer "pr_number"
    t.string "package"
    t.integer "matched"
    t.integer "total"
    t.float "percent"
    t.integer "mismatched"
  end

  create_table "api_calls_stats", force: :cascade do |t|
    t.string "merge_commit_sha"
    t.integer "pr_number"
    t.string "package"
    t.integer "matched"
    t.integer "total"
    t.float "percent"
    t.integer "mismatched"
  end

  create_table "api_compare_privates_stats", force: :cascade do |t|
    t.string "merge_commit_sha"
    t.integer "pr_number"
    t.string "package"
    t.integer "matched"
    t.integer "total"
    t.float "percent"
    t.integer "missing"
  end

  create_table "api_compare_stats", force: :cascade do |t|
    t.string "merge_commit_sha"
    t.integer "pr_number"
    t.string "package"
    t.integer "matched"
    t.integer "total"
    t.float "percent"
    t.integer "misplaced"
    t.integer "missing"
  end

  create_table "claude_md_sections", force: :cascade do |t|
    t.string "merge_commit_sha"
    t.integer "pr_number"
    t.string "file"
    t.string "heading"
    t.string "anchor"
    t.text "lede"
  end

  create_table "package_file_stats", force: :cascade do |t|
    t.string "merge_commit_sha"
    t.integer "pr_number"
    t.string "package"
    t.string "rails_file"
    t.string "ts_file"
    t.integer "methods_matched"
    t.integer "methods_missing"
    t.integer "tests_matched"
    t.integer "tests_total"
  end

  create_table "package_mark_stats", force: :cascade do |t|
    t.string "merge_commit_sha"
    t.integer "pr_number"
    t.string "package"
    t.string "mark"
    t.integer "value"
    t.integer "matched"
    t.integer "total"
  end

  create_table "package_meta", force: :cascade do |t|
    t.string "merge_commit_sha"
    t.integer "pr_number"
    t.string "package"
    t.string "rails_counterpart"
    t.text "description"
    t.string "claude_md"
  end

  create_table "package_skip_tests", force: :cascade do |t|
    t.string "merge_commit_sha"
    t.integer "pr_number"
    t.string "package"
    t.string "file"
    t.string "test_name"
    t.string "cited_anchor"
  end

  create_table "package_tag_sites", force: :cascade do |t|
    t.string "merge_commit_sha"
    t.integer "pr_number"
    t.string "package"
    t.string "tag"
    t.string "receipt"
    t.string "file"
    t.integer "line"
    t.string "declaration"
    t.string "cited_anchor"
  end

  create_table "package_tag_stats", force: :cascade do |t|
    t.string "merge_commit_sha"
    t.integer "pr_number"
    t.string "package"
    t.string "tag"
    t.string "receipt"
    t.integer "count"
  end

  create_table "pull_requests", primary_key: "number", force: :cascade do |t|
    t.string "title"
    t.string "author"
    t.string "branch"
    t.string "merge_commit_sha"
    t.string "merged_at"
  end

  create_table "test_compare_stats", force: :cascade do |t|
    t.string "merge_commit_sha"
    t.integer "pr_number"
    t.string "package"
    t.integer "matched"
    t.integer "total"
    t.float "percent"
    t.integer "skipped"
    t.integer "files_mapped"
    t.integer "files_total"
    t.integer "misplaced"
    t.integer "assertion_count_mismatch"
    t.integer "assertion_kind_mismatch"
  end
end
