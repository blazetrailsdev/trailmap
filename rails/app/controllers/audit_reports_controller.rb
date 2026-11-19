# `POST /audits` — an audit agent's report, replacing the file
# `audit-report/run.sh` wrote: slug, repo and body, with an optional format
# (md default, or html), title and writtenAt (now, to the second, when absent).
# The body is attached as `<slug>-<stamp>.<format>`; 201 {id, url}, id the
# filename `to_param` gives. An existing (repo, slug, writtenAt) answers 200
# with its id, for the import. A bad slug, unknown format, empty body or a
# writtenAt that is not a time is a 422. Needs the ingest bearer token.
class AuditReportsController < ApiController
  include IngestToken

  CONTENT_TYPES = { "md" => "text/markdown", "html" => "text/html" }.freeze

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
    existing = Audit.find_by(repo: repo, slug: slug, written_at: written_at)
    return render json: { id: existing.to_param, url: "/audits/#{existing.to_param}" }, status: :ok if existing

    # The body's, not params': the route's format: :json default outranks it there.
    format = request.request_parameters[:format].presence&.to_s || "md"
    audit = Audit.new(slug: slug, repo: repo, format: format, title: param(:title), written_at: written_at)
    return render json: { error: audit.errors.full_messages.join(", ") }, status: :unprocessable_entity unless audit.valid?

    audit.body = { io: StringIO.new(body), filename: audit.to_param, content_type: CONTENT_TYPES[format] }
    audit.save!
    render json: { id: audit.to_param, url: "/audits/#{audit.to_param}" }, status: :created
  end
end
