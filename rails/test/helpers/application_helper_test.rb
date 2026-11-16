require "test_helper"

class ApplicationHelperTest < ActionView::TestCase
  test "nav_mark marks the exact page and the section a page is in" do
    assert_equal "page", nav_mark("/rfcs", "/rfcs")
    assert_equal "section", nav_mark("/rfcs", "/rfc/0234-no-void-promises")
    assert_equal "section", nav_mark("/backlog", "/story/a-story")
    assert_equal "section", nav_mark("/packages", "/packages/activerecord/files")
    assert_equal "section", nav_mark("/sessions", "/panes/42")
    assert_nil nav_mark("/packages", "/packagesx")
    assert_nil nav_mark("/rfcs", "/backlog")
  end
end
