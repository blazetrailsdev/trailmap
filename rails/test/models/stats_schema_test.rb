require "test_helper"

# db/stats_schema.rb translates ../db/statsSync_schema.ts; every table and
# column the dump declares must come out the other side, typed the same.
class StatsSchemaTest < ActiveSupport::TestCase
  test "loads every table and column of the stats sync's dump" do
    dump = File.read(Rails.root.join("../db/statsSync_schema.ts"))
    tables = dump.scan(/createTable\("(\w+)", \{([^}]*)\}, \(t\) => \{\n(.*?)\n  \}\);/m)
    assert_equal dump.scan("createTable(").size, tables.size
    connection = PackageMeta.connection
    tables.each do |table, options, body|
      columns = connection.columns(table).to_h { |c| [ c.name, c.type ] }
      primary = options[/primaryKey: "(\w+)"/, 1] || "id"
      assert_includes columns.keys, primary, table
      body.scan(/t\.(\w+)\("(\w+)"/).each do |type, name|
        next if type == "index"
        assert_equal type.to_sym, columns[name], "#{table}.#{name}"
      end
    end
  end
end
