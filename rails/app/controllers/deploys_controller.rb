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
    id = params[:id].to_s
    return render plain: "unknown deploy", status: :not_found if id.empty?
    base = Setting.ringo_base or return render plain: "no ringo origin is configured", status: :service_unavailable
    # The run's own file, from its row: never a name the request supplies.
    if DeployLog.dir
      run = history(base).first.find { |r| r["id"] == id }
      return render plain: DeployLog.read(run["logFile"]) if run && DeployLog.local?(run["logFile"])
    end
    response = Fleet::Relay.get("#{base}/deploys/log?id=#{ERB::Util.url_encode(id)}", timeout: TIMEOUT)
    render plain: response.body, status: response.code.to_i
  rescue Fleet::Relay::Failure => e
    render plain: e.plain, status: e.status
  end

  private

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
