# `POST /rfc-refines` — a refine agent's report (kind=rfc-refine): the RFC
# id, its outcome and the summary markdown, stored for the RFC page's
# Refinements tab. Unknown RFC 404, another kind 400, a bad outcome or a
# summary that is not a string 422.
class RfcRefinesController < ApiController
  def create
    kind = param(:kind) || "rfc-refine"
    return render json: { error: %(unsupported kind "#{kind}") }, status: :bad_request unless kind == "rfc-refine"

    rfc_id = param(:id).to_s
    return render json: { error: %(no RFC "#{rfc_id}") }, status: :not_found unless Rfc.exists?(id: rfc_id)

    summary = params.fetch(:summary, "")
    return render json: { error: "summary must be a string" }, status: :unprocessable_entity unless summary.is_a?(String)

    refine = RfcRefine.new(rfc_id: rfc_id, outcome: param(:outcome).to_s, summary: summary)
    return render json: { error: refine.errors.full_messages.join(", ") }, status: :unprocessable_entity unless refine.save

    render json: { id: refine.id, rfc: rfc_id, outcome: refine.outcome }, status: :created
  end
end
