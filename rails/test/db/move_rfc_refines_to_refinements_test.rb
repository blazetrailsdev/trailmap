require "test_helper"
require Rails.root.join("db/hub_migrate/20261117000007_create_rfc_refines")
require Rails.root.join("db/hub_migrate/20261119000008_move_rfc_refines_to_refinements")

# The hub migration that moves the refine reports onto Base, ported from
# ../../test/db/move-rfc-refines-to-refinements.test.ts.
class MoveRfcRefinesToRefinementsTest < ActiveSupport::TestCase
  COLUMNS = "rfc_id, outcome, summary, created_at, updated_at"

  setup { require_hub! }

  test "moves every report onto Base with its summary attached, and back" do
    connection = Hub.connection
    CreateRfcRefines.new.exec_migration(connection, :up)
    connection.execute "INSERT INTO rfc_refines (#{COLUMNS}) VALUES " \
                       "('0136-trailmap', 'changed', '# Report\n\nclosed **3**', '2026-11-01 09:00:00.123456', '2026-11-01 09:30:00')"
    before = connection.select_all("SELECT #{COLUMNS} FROM rfc_refines").to_a

    MoveRfcRefinesToRefinements.new.exec_migration(connection, :up)

    assert_not connection.table_exists?("rfc_refines")
    moved = RfcRefinement.sole
    assert_equal [ "0136-trailmap", "changed", nil ], [ moved.rfc_id, moved.outcome, moved.stories ]
    assert_equal Time.utc(2026, 11, 1, 9, 0, Rational(123_456, 1_000_000)), moved.created_at
    assert_equal [ "text/markdown", "# Report\n\nclosed **3**" ], [ moved.summary.content_type, moved.summary.download ]

    MoveRfcRefinesToRefinements.new.exec_migration(connection, :down)

    assert_equal 0, RfcRefinement.count
    assert_equal before, connection.select_all("SELECT #{COLUMNS} FROM rfc_refines").to_a
  ensure
    connection&.execute "DROP TABLE IF EXISTS rfc_refines"
  end
end
