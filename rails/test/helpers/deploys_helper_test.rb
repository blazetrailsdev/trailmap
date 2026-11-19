require "test_helper"

# The preview tag and link on /deploys, as app/helpers/deploys-helper.ts has them.
class DeploysHelperTest < ActionView::TestCase
  test "deploy_kind tags preview runs and nothing else" do
    assert_equal "preview", deploy_kind("target" => "preview")
    assert_equal "preview teardown", deploy_kind("target" => "preview teardown")
    assert_equal "preview sweep", deploy_kind("target" => "preview sweep")
    assert_nil deploy_kind("target" => "trunk")
    assert_nil deploy_kind("target" => "previewish")
    assert_nil deploy_kind({})
  end

  test "deploy_preview_url links only an https URL" do
    assert_equal "https://trailmap-pr-160.deanoftech.com/", deploy_preview_url("url" => "https://trailmap-pr-160.deanoftech.com/")
    assert_nil deploy_preview_url("url" => "javascript:alert(1)")
    assert_nil deploy_preview_url("url" => "http://trailmap-pr-160.deanoftech.com/")
    assert_nil deploy_preview_url("url" => "not a url")
    assert_nil deploy_preview_url({})
  end
end
