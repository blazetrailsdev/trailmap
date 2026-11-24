# `/deploys` and `/deploys/log?id=<run>`, read-only. The history is relayed
# from ringo; each log is read from ringo's pane-log directory, mounted
# read-only (DeployLog), found from the run's own row, and relayed when the
# row names none or nothing is mounted.
class DeploysController < ApplicationController
  TIMEOUT = 5

  def index
    no_store
    base = Setting.ringo_base
    @runs, @problem = base.nil? ? [ [], "no ringo origin is configured" ] : history(base)
  end

  def log
    no_store
    text, status = read_log
    render plain: text, status: status if text
  end

  # One run's log replayed through ringo's terminal emulator, the one the pane
  # view uses: a deploy log is a tmux pane capture too. An HTML fragment for
  # the row's `pre.terminal`; a refusal stays plain text.
  def screen
    no_store
    text, status = read_log
    return unless text
    return render plain: text, status: status unless status == 200
    # The pane view's bounds: the tail of the capture, at most its rows kept,
    # so one request's emulator work is capped however long the deploy ran.
    bytes = text.b
    bytes = bytes.byteslice(-SessionsController::PANE_VIEW_MAX_BYTES, SessionsController::PANE_VIEW_MAX_BYTES) if bytes.bytesize > SessionsController::PANE_VIEW_MAX_BYTES
    html = begin
      RingoCore.render_pane_log(bytes, SessionsController::PANE_VIEW_MAX_LINES)["html"]
    rescue StandardError => e
      # A refusal in plain text, as a relay failure is: the row shows it as
      # the reason rather than inlining an error page.
      return render plain: "log not rendered: #{e.message}", status: :internal_server_error
    end
    render html: html.html_safe
  end

  private

  # The run's log text and status, or nil once a refusal is rendered.
  def read_log
    id = params[:id].to_s
    if id.empty?
      render plain: "unknown deploy", status: :not_found
      return
    end
    base = Setting.ringo_base
    if base.nil?
      render plain: "no ringo origin is configured", status: :service_unavailable
      return
    end
    # The run's own file, from its row: never a name the request supplies.
    if DeployLog.dir
      run = history(base).first.find { |r| r["id"] == id }
      return [ DeployLog.read(run["logFile"]), 200 ] if run && DeployLog.local?(run["logFile"])
    end
    response = Fleet::Relay.get("#{base}/deploys/output?id=#{ERB::Util.url_encode(id)}", timeout: TIMEOUT)
    [ response.body, response.code.to_i ]
  rescue Fleet::Relay::Failure => e
    render plain: e.plain, status: e.status
    nil
  end

  # ringo's deploy history, and why there is none to show.
  def history(base)
    response = Fleet::Relay.get("#{base}/api/deploys", timeout: TIMEOUT)
    return [ [], "ringo answered #{response.code}" ] unless response.is_a?(Net::HTTPSuccess)
    [ JSON.parse(response.body), nil ]
  rescue JSON::ParserError
    [ [], "ringo answered, but not with the deploy history as JSON" ]
  rescue Fleet::Relay::Failure => e
    [ [], e.plain ]
  end
end
