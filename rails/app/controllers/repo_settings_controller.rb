# `/:owner/:repo/settings` — the record, its feature switches and the
# application settings with where each value comes from. `update` writes the
# switches; the global settings are not writable from a repository's page.
class RepoSettingsController < RepoController
  self.tab = "settings"

  Global = Struct.new(:key, :value, :from, keyword_init: true)
  Collaborator = Struct.new(:login, :role, :can_push, keyword_init: true)
  Switch = Struct.new(:tab, :enabled, keyword_init: true)

  def show
    row = @repo.settings
    @global = Setting::FALLBACKS.map do |key, env|
      resolved = Setting.resolve(key)
      Global.new(key: key, value: resolved.value,
                 from: resolved.source == "database" ? "this database" : "#{env} (environment)")
    end
    collaborators = RepositoryCollaborator.where(repository_id: @repo.id).includes(:owner).map do |c|
      Collaborator.new(login: c.owner&.login || c.owner_id.to_s, role: c.role, can_push: c.can_push?)
    end
    @collaborators = StableSort.sort(collaborators) { |a, b| LocaleCompare.compare(a.login, b.login) }
    @has_switches = !row.nil?
    @switches = RepositorySetting::OPTIONAL_TABS.map { |t| Switch.new(tab: t, enabled: row.nil? || row.enabled?(t)) }
    @form = row || RepositorySetting.new(repository_id: @repo.id)
    @can_administer = @repo.administrable_by?(viewer)
  end

  def update
    raise ActiveRecord::RecordNotFound, "#{@repo.name_with_owner} has no settings this viewer may change" unless @repo.administrable_by?(viewer)
    row = @repo.settings || @repo.build_settings
    row.update!(switch_params)
    redirect_to repo_settings_path(@owner.login, @repo.name), status: :see_other
  end

  private

  # Exactly the six switches: repository_id and id are never assignable.
  def switch_params
    params.require(:repository_setting).permit(*RepositorySetting::OPTIONAL_TABS.map { |t| "#{t}_enabled" })
  end
end
