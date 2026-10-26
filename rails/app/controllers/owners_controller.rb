# `/:owner` — who this is, and the repositories under it the viewer can read,
# each with its open-story count from one grouped query.
class OwnersController < ApplicationController
  Row = Struct.new(:name, :href, :description, :visibility, :default_branch, :archived, :open_count, keyword_init: true)

  def show
    login = params[:owner].to_s
    @owner = login.empty? ? nil : Owner.find_by_login(login)
    raise ActiveRecord::RecordNotFound, "No owner #{login}" if @owner.nil?

    repos = @owner.repositories.order(:name).select { |r| r.readable_by?(viewer) }
    open_counts = RepoScope.open_counts_by_repo(repos.map(&:name))
    @rows = repos.map do |r|
      Row.new(name: r.name, href: "/#{@owner.login}/#{r.name}", description: r.description, visibility: r.visibility,
              default_branch: r.default_branch, archived: r.archived, open_count: open_counts.fetch(r.name, 0))
    end
  end
end
