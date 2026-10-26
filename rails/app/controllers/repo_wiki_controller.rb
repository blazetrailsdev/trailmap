# `/:owner/:repo/wiki` — the RFCs whose work touches this repository, and the
# one named by `?page=` rendered through the markdown helper.
class RepoWikiController < RepoController
  self.tab = "wiki"

  Page = Struct.new(:id, :title, :status, :href, keyword_init: true)

  def index
    rfc_ids = RepoScope.stories_for(@repo.name).to_set(&:rfc_id)
    pages = Rfc.all.select { |r| rfc_ids.include?(r.id) }.map do |rfc|
      Page.new(id: rfc.id, title: rfc.title || rfc.id, status: rfc.status, href: "/#{@nwo}/wiki?page=#{rfc.id}")
    end
    @pages = StableSort.sort(pages) { |a, b| LocaleCompare.compare(a.id, b.id) }
    requested = params[:page].to_s
    @selected = @pages.any? { |p| p.id == requested } ? requested : nil
    rfc = @selected && Rfc.find_by(id: @selected)
    doc = rfc && Document.read(rfc.file_path)
    @page_title = rfc && (rfc.title || rfc.id)
    @body = doc.nil? || doc.markdown.empty? ? nil : helpers.render_markdown(doc.markdown)
    @error = doc&.error.to_s
  end
end
