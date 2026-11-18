require "test_helper"

class StoryPagesHelperTest < ActionView::TestCase
  test "pr_url links a repo#N ref in the org, and declines anything else" do
    assert_equal "https://github.com/blazetrailsdev/trails/pull/7651", pr_url("trails#7651")
    assert_nil pr_url("7651")
    assert_nil pr_url("trails#")
  end

  test "pr_link is an anchor for a ref and escaped text otherwise" do
    assert_equal '<a target="_blank" rel="noopener" href="https://github.com/blazetrailsdev/trails/pull/7651">trails#7651</a>', pr_link("trails#7651")
    assert_equal "7651", pr_link("7651")
  end
end
