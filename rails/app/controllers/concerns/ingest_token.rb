# The ingest create endpoints need `Authorization: Bearer <TRAILMAP_INGEST_TOKEN>`
# (or Rails' `Token` scheme). An unset or empty token refuses everything:
# the endpoints fail closed on a box that was never provisioned. Include it
# after ApiController's LoopbackOnly, so a proxied request is a 404 first.
module IngestToken
  extend ActiveSupport::Concern

  included do
    before_action :require_ingest_token
  end

  private

  def require_ingest_token
    expected = ENV["TRAILMAP_INGEST_TOKEN"]
    authenticate_or_request_with_http_token do |token, _options|
      expected.present? && ActiveSupport::SecurityUtils.secure_compare(token, expected)
    end
  end
end
