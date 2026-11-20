# `POST /rfc-refines` — a refine agent's report (kind=rfc-refine): the RFC
# id, its outcome and the summary markdown, stored as an RfcRefinement with the
# summary attached and `stories` the RFC's story count now. An optional `when`
# becomes `created_at` and an optional integer `stories` the count, for the
# import; an existing (rfc, when) answers 200 with its id, as does a
# concurrent post that loses the race to the unique (rfc_id, created_at)
# index (one without a `when` raises rather than be dropped). A `stories` that is not a
# non-negative integer is a 422. Unknown RFC 404, another kind 400, a
# bad outcome, a summary that is not a string or a `when` that is not a time
# 422. Needs the ingest bearer token (IngestToken).
class RfcRefinesController < ApiController
  include IngestToken
  skip_before_action :require_ingest_token, only: :index

  # `GET /rfc-refines` — every report, oldest first, without its summary, for
  # ringo's RFC index bar; `?rfc=` narrows it to one RFC. Needs no token.
  def index
    scope = param(:rfc) ? RfcRefinement.where(rfc_id: param(:rfc)) : RfcRefinement.all
    render json: scope.order(created_at: :asc, id: :asc).map { |r|
      { id: r.id, rfc: r.rfc_id, when: r.created_at.utc.iso8601, outcome: r.outcome, stories: r.stories }
    }
  end

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

    if created_at && (existing = RfcRefinement.find_by(rfc_id: rfc_id, created_at: created_at))
      return render json: { id: existing.id, rfc: rfc_id, outcome: existing.outcome }, status: :ok
    end

    stories = params[:stories]
    unless stories.nil? || (stories.is_a?(Integer) && stories >= 0)
      return render json: { error: "stories must be a non-negative integer" }, status: :unprocessable_entity
    end

    refine = RfcRefinement.new(rfc_id: rfc_id, outcome: param(:outcome).to_s,
                            stories: stories.nil? ? Story.where(rfc_id: rfc_id).count : stories, created_at: created_at,
                               summary: { io: StringIO.new(summary), filename: "summary.md", content_type: "text/markdown" })
    begin
      return render json: { error: refine.errors.full_messages.join(", ") }, status: :unprocessable_entity unless refine.save
    rescue ActiveRecord::RecordNotUnique
      raise unless created_at
      winner = RfcRefinement.find_by(rfc_id: rfc_id, created_at: created_at) or raise
      return render json: { id: winner.id, rfc: rfc_id, outcome: winner.outcome }, status: :ok
    end

    render json: { id: refine.id, rfc: rfc_id, outcome: refine.outcome }, status: :created
  end
end
