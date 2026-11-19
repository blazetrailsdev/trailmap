require "test_helper"
require Rails.root.join("db/hub_migrate/20261117000007_create_rfc_refines")
require Rails.root.join("db/hub_migrate/20261119000008_move_rfc_refines_to_refinements")

# The hub migration that drops `rfc_refines`, ported from
# ../../test/db/move-rfc-refines-to-refinements.test.ts.
class MoveRfcRefinesToRefinementsTest < ActiveSupport::TestCase
  setup do
    require_hub!
    @connection = Hub.connection
    CreateRfcRefines.new.exec_migration(@connection, :up)
  end

  teardown { @connection&.execute "DROP TABLE IF EXISTS rfc_refines" }

  test "drops an empty table, and down recreates it" do
    MoveRfcRefinesToRefinements.new.exec_migration(@connection, :up)
    assert_not @connection.table_exists?("rfc_refines")
    MoveRfcRefinesToRefinements.new.exec_migration(@connection, :down)
    assert @connection.table_exists?("rfc_refines")
  end

  test "refuses to drop a table that holds reports" do
    @connection.execute "INSERT INTO rfc_refines (rfc_id, outcome, summary, created_at, updated_at) " \
                        "VALUES ('0136-trailmap', 'changed', 'x', '2026-11-01 09:00:00', '2026-11-01 09:00:00')"
    error = assert_raises(RuntimeError) { MoveRfcRefinesToRefinements.new.exec_migration(@connection, :up) }
    assert_match(/holds 1 row/, error.message)
    assert @connection.table_exists?("rfc_refines")
  end
end
