# The loopback JSON API's base: `/stories/*`, the mutation verbs, the read
# models and the deeper probes. Its clients — the tasks CLI and ringo — parse
# every answer as JSON, so a 500 here is JSON too. Only a 500: an error Rails
# maps to another status (404, 400) is raised again untouched.
class ApiController < ApplicationController
  include LoopbackOnly

  # The CLI and ringo post JSON with no session; there is no form to forge.
  skip_forgery_protection

  rescue_from StandardError, with: :render_server_error

  private

  def render_server_error(error)
    raise error unless ActionDispatch::ExceptionWrapper.status_code_for_exception(error.class.name) == 500
    logger.error("#{error.class.name}: #{error.message}\n#{error.backtrace&.join("\n")}")
    render json: { error: "internal_server_error", message: error.message }, status: :internal_server_error
  end

  def param(name)
    value = params[name]
    value.nil? || value == "" ? nil : value.to_s
  end
end
