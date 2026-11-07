# The stats database's tables, for the TEST environment only. trailmap's
# stats sync owns that schema (../db/stats-sync-migrate) and its dump
# ../db/statsSync_schema.ts is read here line for line, so a column added to
# the sync reaches these tests with no edit on this side. Hand-written, not
# dumped: the stats database has no migrations here, so Rails never rewrites it.
module StatsSyncSchema
  SOURCE = File.expand_path("../../db/statsSync_schema.ts", __dir__)

  # The dump's TypeScript, as the ActiveRecord::Schema Ruby it mirrors.
  def self.ruby
    File.readlines(SOURCE).filter_map do |line|
      next "end" if line.start_with?("  });")
      next unless line.start_with?("  await ctx.", "    t.")

      line.sub(/await ctx.createTable\((.*), \{ (.*) \}, \(t\) => \{$/) { "create_table #{$1}, #{$2} do |t|" }
          .sub(/, \{ ([^{}]*) \}\)/) { ", #{$1})" }
          .gsub(/\b([a-z]+[A-Z]\w*): /) { "#{$1.underscore}: " }
          .delete_suffix(";\n")
    end.join("\n")
  end

  def self.version
    File.read(SOURCE)[/version: ([\d_]+)/, 1].delete("_").to_i
  end
end

ActiveRecord::Schema[8.0].define(version: StatsSyncSchema.version) do
  instance_eval(StatsSyncSchema.ruby, StatsSyncSchema::SOURCE)
end
