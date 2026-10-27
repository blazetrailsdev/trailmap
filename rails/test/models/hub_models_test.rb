require "test_helper"

class HubModelsTest < ActiveSupport::TestCase
  setup { require_hub! }

  test "Owner#to_param is the login" do
    assert_equal "blazetrailsdev", Owner.new(login: "blazetrailsdev").to_param
  end

  test "RepositoryCollaborator#can_push? for write and admin, not read" do
    assert RepositoryCollaborator.new(role: "write").can_push?
    assert RepositoryCollaborator.new(role: "admin").can_push?
    assert_not RepositoryCollaborator.new(role: "read").can_push?
  end

  test "RepositorySetting#enabled? reads the switch; an unknown tab is on" do
    setting = RepositorySetting.new(issues_enabled: false, pulls_enabled: true)
    assert_not setting.enabled?(:issues)
    assert setting.enabled?("pulls")
    assert setting.enabled?("code")
  end

  test "Repository#name_with_owner and #to_param" do
    repo = hub_repo!("trails")
    assert_equal "blazetrailsdev/trails", repo.name_with_owner
    assert_equal "trails", repo.to_param
  end

  test "Repository#readable_by?: public to all, private to the owner and collaborators" do
    repo = hub_repo!("secret", visibility: "private")
    owner = repo.owner
    friend = Owner.create!(login: "friend", kind: "user")
    stranger = Owner.create!(login: "stranger", kind: "user")
    RepositoryCollaborator.create!(repository: repo, owner: friend, role: "read")
    assert repo.readable_by?(owner)
    assert repo.readable_by?(friend)
    assert_not repo.readable_by?(stranger)
    assert_not repo.readable_by?(nil)
    assert hub_repo!("open").readable_by?(nil)
  end

  test "Repository.find_by_nwo is case-insensitive and loads the owner" do
    hub_repo!("trails")
    repo = Repository.find_by_nwo("BlazeTrailsDev", "Trails")
    assert_equal "trails", repo.name
    assert_equal "blazetrailsdev", repo.owner.login
    assert_nil Repository.find_by_nwo("nobody", "trails")
    assert_nil Repository.find_by_nwo("blazetrailsdev", "nothing")
  end

  test "fleet_repos, checkouts_or_none, spawn_choices and import_fleet_repos" do
    with_fleet_repo_paths("b/two=/w/two, a/one=/w/one,junk,=/x") do
      assert_equal [ [ "a/one", "/w/one" ], [ "b/two", "/w/two" ] ], Repository.fleet_repos.map(&:to_a)
      hub_repo!("one", login: "a", checkout_path: "/elsewhere")
      hub_repo!("bare")
      assert_equal [ [ "a/one", "/elsewhere" ] ], Repository.checkouts_or_none.map(&:to_a)
      assert_equal [ [ "a/one", "/elsewhere" ], [ "b/two", "/w/two" ] ], Repository.spawn_choices.map(&:to_a)
      imported = Repository.import_fleet_repos
      assert_equal %w[a/one b/two], imported.map(&:name_with_owner)
      assert_equal "/w/one", Repository.find_by_nwo("a", "one").checkout_path
      assert Repository.find_by_nwo("b", "two").settings
    end
  end

  private

  def with_fleet_repo_paths(value)
    previous = Rails.configuration.x.fleet.repo_paths
    Rails.configuration.x.fleet.repo_paths = value
    yield
  ensure
    Rails.configuration.x.fleet.repo_paths = previous
  end
end
