# The rest of RFC 0222's summary tables, for the TEST environment only, as the
# stats sync writes them. Mirrors ../../test/models/stats-schema.ts.
class CreatePackageSummaryTables < ActiveRecord::Migration[8.0]
  def change
    { package_tag_stats: { tag: :string, receipt: :string, count: :integer },
      package_mark_stats: { mark: :string, value: :integer, matched: :integer, total: :integer },
      package_tag_sites: { tag: :string, receipt: :string, file: :string, line: :integer, declaration: :string, cited_anchor: :string },
      package_skip_tests: { file: :string, test_name: :string, cited_anchor: :string },
      package_file_stats: { rails_file: :string, ts_file: :string, methods_matched: :integer, methods_missing: :integer,
                            tests_matched: :integer, tests_total: :integer },
      claude_md_sections: { file: :string, heading: :string, anchor: :string, lede: :text } }.each do |table, columns|
      create_table table do |t|
        t.string :merge_commit_sha
        t.integer :pr_number
        t.string :package unless table == :claude_md_sections
        columns.each { |name, type| t.column name, type }
      end
    end
  end
end
