# `/audits`, `/audits/<file>` and `/audits/<file>/raw` — the agent-written
# progress reports, ported from ringo's webhook/audits.go. The route checks
# the filename; a well-formed one with no file is RecordNotFound, a 404.
class AuditsController < ApplicationController
  def index
    @audits = Audit.all
    load_selected(@audits.first)
  end

  def show
    selected = Audit.find(params[:id])
    @audits = Audit.all
    load_selected(selected)
    render :index
  end

  # One audit on its own. Agent-written and served from this origin, so it is
  # sandboxed: an opaque origin and no scripts.
  def raw
    audit = Audit.find(params[:id])
    source = audit.read
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    response.headers["Content-Security-Policy"] = "sandbox"
    return render html: source.html_safe, layout: false if audit.html?
    @title = audit.title
    @body = helpers.render_markdown(Document.strip_frontmatter(source))
    render layout: false
  end

  private

  # Markdown renders inline; an `.html` audit only ever in the sandboxed frame.
  def load_selected(selected)
    @selected = selected
    @body = selected.nil? || selected.html? ? nil : helpers.render_markdown(Document.strip_frontmatter(selected.read))
    @configured = !Audit.dir.nil?
  end
end
