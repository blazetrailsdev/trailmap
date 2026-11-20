# `POST /audits` — an audit agent's report, replacing the file
# `audit-report/run.sh` wrote: slug, repo and body, with an optional format
# (md default, or html), title and writtenAt (now, to the second, when absent).
# The body is attached as `<slug>-<stamp>.<format>`; 201 {id, url}, id the
# filename `to_param` gives. An existing (repo, slug, writtenAt) answers 200
# with its id, for the import. A bad slug, unknown format, empty body or a
# writtenAt that is not a time is a 422, as is a missing repo. A concurrent
# import that loses the race to the unique index answers 200 with the winner's id. Needs the ingest bearer token.
class AuditReportsController < ApiController
  include IngestToken
  skip_before_action :require_ingest_token, only: :index

  # `GET /audit-reports` — every audit, newest first, without its body, for
  # ringo's Audits list. Not `GET /audits`: that is the page. Needs no token.
  def index
    render json: Audit.newest_first.map { |a|
      { name: a.to_param, repo: a.repo, slug: a.slug, title: a.title, format: a.format, when: a.written_at.utc.iso8601 }
    }
  end

  def create
    body = params[:body]
    body = "" if body.nil?
    return render json: { error: "body must be a non-empty string" }, status: :unprocessable_entity unless body.is_a?(String) && body != ""

    written_at_ = param(:writtenAt)
    begin
      written_at = written_at_ ? Time.zone.iso8601(written_at_) : Time.current.change(usec: 0)
    rescue ArgumentError
      return render json: { error: "writtenAt must be a time" }, status: :unprocessable_entity
    end

    slug = param(:slug).to_s
    repo = param(:repo).to_s
    # Required here, not on the model: audits imported before #179 carry none.
    return render json: { error: "repo must be given" }, status: :unprocessable_entity if repo == ""
    existing = Audit.find_by(repo: repo, slug: slug, written_at: written_at)
    return render json: { id: existing.to_param, url: "/audits/#{existing.to_param}" }, status: :ok if existing

    # The body's, not params': the route's format: :json default outranks it there.
    format = request.request_parameters[:format].presence&.to_s || "md"
    audit = Audit.new(slug: slug, repo: repo, format: format, title: param(:title), written_at: written_at)
    return render json: { error: audit.errors.full_messages.join(", ") }, status: :unprocessable_entity unless audit.valid?

    audit.body = { io: StringIO.new(body), filename: audit.to_param, content_type: Audit::CONTENT_TYPES[format] }
    begin
      audit.save!
    rescue ActiveRecord::RecordNotUnique
      winner = Audit.find_by(repo: repo, slug: slug, written_at: written_at) or raise
      return render json: { id: winner.to_param, url: "/audits/#{winner.to_param}" }, status: :ok
    end
    render json: { id: audit.to_param, url: "/audits/#{audit.to_param}" }, status: :created
  end
end
