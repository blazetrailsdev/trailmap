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

  test "nav_mark reads the request, marking only a GET or HEAD" do
    request.path = "/rfcs"
    assert_equal "page", nav_mark("/rfcs")
    request.request_method = "POST"
    assert_nil nav_mark("/rfcs")
  end

  test "nav_mark unescapes both sides" do
    assert_equal "page", nav_mark("/rfcs", "/rfc%73")
    assert_equal "section", nav_mark("/packages", "/packages/a%20b")
    assert_equal "page", nav_mark("/rfcs/", "/rfcs")
    assert_equal "section", nav_mark("/sessions/", "/panes/42")
  end
end
