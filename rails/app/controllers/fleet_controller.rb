# The fleet pages' lines to ringo, all through trailmap: ringo is another
# origin behind the same SSO, so the page talks to trailmap and trailmap
# talks to ringo over the private network.
class FleetController < ApplicationController
  CONTROL_TIMEOUT = 30
  SCREEN_TIMEOUT = 1.5
  REVIEWERS_TIMEOUT = 5

  before_action :require_ringo, except: :control

  # `GET /fleet/socket`, a WebSocket handshake. The handshake must name this
  # site as its origin, as Action Cable requires of its own.
  def socket
    return render plain: "Page not found", status: :not_found if request.origin.nil? || request.origin != request.base_url
    unless request.env["rack.hijack"] && Fleet::SocketRelay.websocket?(request.env)
      return render plain: "This endpoint speaks WebSocket only", status: :upgrade_required
    end
    Fleet::SocketRelay.new(request.env, "#{@base}/events").start
    head :ok
  end

  # `POST /fleet/control/<ringo path>`: forward one control. Forgery
  # protection sees that it came from this page.
  def control
    path = params[:path].to_s
    return render plain: "Not a fleet control", status: :not_found unless Fleet::CONTROLS.include?(path)
    return unless require_ringo
    response = Fleet::Relay.post("#{@base}/#{path}", body: request.raw_post, content_type: request.content_type,
                                 timeout: CONTROL_TIMEOUT)
    render plain: response.body, status: response.code.to_i
  rescue Fleet::Relay::Failure => e
    render plain: e.plain, status: e.status
  end

  # `GET /fleet/reviewers`: ringo's `/reviewer/list`, unchanged.
  def reviewers
    relay_read("reviewer/list")
  end

  def read
    name = params[:name].to_s
    return render plain: "Not a fleet read", status: :not_found unless Fleet::READS.key?(name)
    agent = params[:agent].to_s
    relay_read(Fleet::READS[name] + (name == "drain-status" && agent.match?(/\A[a-z]+\z/) ? "?agent=#{agent}" : ""))
  end

  # `GET /fleet/pane/<n>/screen[?have=<hash>]`
  def screen
    id = params[:id].to_s
    return render plain: "Not a pane id", status: :bad_request unless Fleet.pane_id?(id)
    have = params[:have].to_s
    return render plain: "Not a screen hash", status: :bad_request unless Fleet.screen_hash?(have)
    no_store
    query = have.empty? ? "" : "?have=#{ERB::Util.url_encode(have)}"
    response = Fleet::Relay.get("#{@base}/pane/#{id}/screen#{query}", timeout: SCREEN_TIMEOUT)
    if response.is_a?(Net::HTTPSuccess)
      render json: response.body
    elsif pane_gone?(response.body)
      # The contract is 200 for a gone pane, whatever status ringo used.
      render json: { exists: false }
    else
      render plain: response.body, status: response.code.to_i
    end
  rescue Fleet::Relay::Failure => e
    render plain: e.plain, status: e.status
  end

  private

  def require_ringo
    @base = Setting.ringo_base
    return true if @base
    render plain: "no ringo origin is configured", status: :service_unavailable
    false
  end

  def relay_read(path)
    no_store
    response = Fleet::Relay.get("#{@base}/#{path}", timeout: REVIEWERS_TIMEOUT)
    if response.is_a?(Net::HTTPSuccess)
      render json: response.body
    else
      render plain: response.body, status: response.code.to_i
    end
  rescue Fleet::Relay::Failure => e
    render plain: e.plain, status: e.status
  end

  def pane_gone?(text)
    body = JSON.parse(text.to_s)
    body.is_a?(Hash) && body["exists"] == false
  rescue JSON::ParserError
    false
  end
end
