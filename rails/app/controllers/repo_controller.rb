# The base of the eight tab controllers under `/:owner/:repo`. Loads the
# repository, enforces visibility once for every tab, and builds the tab bar.
# An unknown owner or repository, an unreadable one and a disabled tab are
# all the same 404.
class RepoController < ApplicationController
  Tab = Struct.new(:key, :label, :href, :active, keyword_init: true)

  # The keys are the route segments.
  TAB_LABELS = [
    [ "code", "Code", "" ], [ "issues", "Issues", "/issues" ], [ "pulls", "Pull requests", "/pulls" ],
    [ "actions", "Actions", "/actions" ], [ "projects", "Projects", "/projects" ], [ "wiki", "Wiki", "/wiki" ],
    [ "insights", "Insights", "/pulse" ], [ "settings", "Settings", "/settings" ]
  ].freeze

  # The tab this controller serves.
  class_attribute :tab, default: "code"

  before_action :load_repository

  private

  def load_repository
    login = params[:owner].to_s
    name = params[:repo].to_s
    @repo = login.empty? || name.empty? ? nil : Repository.find_by_nwo(login, name)
    raise ActiveRecord::RecordNotFound, "No repository #{login}/#{name}" if @repo.nil? || !@repo.readable_by?(viewer)
    raise ActiveRecord::RecordNotFound, "#{login}/#{name} has its #{tab} tab turned off" unless switches.enabled?(tab)
    @owner = @repo.owner
    @nwo = @repo.name_with_owner
    @tabs = TAB_LABELS.select { |key, _, _| switches.enabled?(key) }.map do |key, label, suffix|
      Tab.new(key: key, label: label, href: "/#{@nwo}#{suffix}", active: key == tab)
    end
  end

  # A repo's switches, or everything-on when its row has not been written.
  def switches
    @repo.settings || RepositorySetting::ALL_ENABLED
  end

  def closed_status?(status)
    Story::RESOLVED_DEP_STATUSES.include?(status)
  end

  def by_priority_then_id(rows)
    StableSort.sort(rows) do |a, b|
      ((a.priority || 1_000_000) <=> (b.priority || 1_000_000)).nonzero? || LocaleCompare.compare(a.id, b.id)
    end
  end
end
