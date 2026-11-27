# Refuses anything that did not arrive on loopback, with a 404 that declines
# to confirm the API exists. Any proxy header disqualifies a request, and the
# host is the RAW `Host` header — `request.host` honours X-Forwarded-Host.
# `request.local?` cannot stand in: docker's proxy rewrites the source.
#
# A write carrying `Origin` is refused too: browsers send it on every POST
# (`null` from a sandboxed frame), the CLI and ringo never do, and the API
# skips forgery protection — so a script in an `.html` audit viewed on
# loopback could otherwise land a form POST on a mutation verb.
module LoopbackOnly
  extend ActiveSupport::Concern

  FORWARDED_HEADERS = %w[HTTP_X_FORWARDED_FOR HTTP_X_FORWARDED_HOST HTTP_X_FORWARDED_PROTO
                         HTTP_X_FORWARDED_PORT HTTP_FORWARDED].freeze
  LOOPBACK_HOSTS = [ "127.0.0.1", "localhost", "::1", "[::1]" ].freeze
  SAFE_METHODS = %w[GET HEAD OPTIONS].freeze

  included do
    before_action :require_loopback
  end

  def self.loopback?(env)
    return false if FORWARDED_HEADERS.any? { |h| env[h].to_s.strip != "" }
    return false if !SAFE_METHODS.include?(env["REQUEST_METHOD"].to_s.upcase) && env.key?("HTTP_ORIGIN")
    host = env["HTTP_HOST"] or return false
    LOOPBACK_HOSTS.include?(strip_port(host.strip.downcase))
  end

  def self.strip_port(host)
    host.start_with?("[") ? host.sub(/\]:\d+\z/, "]") : host.sub(/\A([^:]*):\d+\z/, '\1')
  end

  private

  def require_loopback
    render json: { error: "not_found" }, status: :not_found unless LoopbackOnly.loopback?(request.env)
  end
end
