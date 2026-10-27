# The stats database's tables, for the TEST environment only: the schema is
# the stats-sync cron's, and no other environment migrates it
# (`database_tasks: false`). Mirrors ../../test/models/stats-schema.ts.
class CreateStatsTables < ActiveRecord::Migration[8.0]
  def change
    create_table :pull_requests, primary_key: :number do |t|
      t.string :title, :author, :branch, :merge_commit_sha, :merged_at
    end

    common = lambda do |t|
      t.string :merge_commit_sha
      t.integer :pr_number
      t.string :package
      t.integer :matched, :total
      t.float :percent
    end

    create_table :api_compare_stats do |t|
      common.call(t)
      t.integer :misplaced, :missing
    end
    create_table :api_compare_privates_stats do |t|
      common.call(t)
      t.integer :missing
    end
    create_table :test_compare_stats do |t|
      common.call(t)
      t.integer :skipped, :files_mapped, :files_total, :misplaced, :assertion_count_mismatch, :assertion_kind_mismatch
    end
    %i[api_calls_stats api_call_args_stats].each do |table|
      create_table table do |t|
        common.call(t)
        t.integer :mismatched
      end
    end
  end
end
