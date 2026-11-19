# `POST /rfc-refines` — a refine agent's report (kind=rfc-refine): the RFC
# id, its outcome and the summary markdown, stored as an RfcRefinement with the
# summary attached and `stories` the RFC's story count now. An optional `when`
# becomes `created_at`, for the import. Unknown RFC 404, another kind 400, a
# bad outcome, a summary that is not a string or a `when` that is not a time
# 422. Needs the ingest bearer token (IngestToken).
class RfcRefinesController < ApiController
  include IngestToken

  def create
    kind = param(:kind) || "rfc-refine"
    return render json: { error: %(unsupported kind "#{kind}") }, status: :bad_request unless kind == "rfc-refine"

    rfc_id = param(:id).to_s
    return render json: { error: %(no RFC "#{rfc_id}") }, status: :not_found unless Rfc.exists?(id: rfc_id)

    summary = params[:summary]
    summary = "" if summary.nil?
    return render json: { error: "summary must be a string" }, status: :unprocessable_entity unless summary.is_a?(String)

    when_ = param(:when)
    begin
      created_at = Time.zone.iso8601(when_) if when_
    rescue ArgumentError
      return render json: { error: "when must be a time" }, status: :unprocessable_entity
    end

    refine = RfcRefinement.new(rfc_id: rfc_id, outcome: param(:outcome).to_s,
                            stories: Story.where(rfc_id: rfc_id).count, created_at: created_at,
                               summary: { io: StringIO.new(summary), filename: "summary.md", content_type: "text/markdown" })
    return render json: { error: refine.errors.full_messages.join(", ") }, status: :unprocessable_entity unless refine.save

    render json: { id: refine.id, rfc: rfc_id, outcome: refine.outcome }, status: :created
  end
end
