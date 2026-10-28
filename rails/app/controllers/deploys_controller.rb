# `/deploys` and `/deploys/log?id=<run>`, read-only. The history is relayed
# from ringo; each log is read from ringo's pane-log directory, mounted
# read-only (DeployLog), and relayed only when that is not mounted.
class DeploysController < ApplicationController
  TIMEOUT = 5

  def index
    no_store
    base = Setting.ringo_base
    @runs = []
    @problem = base.nil? ? "no ringo origin is configured" : nil
    return if base.nil?
    response = Fleet::Relay.get("#{base}/api/deploys", timeout: TIMEOUT)
    if !response.is_a?(Net::HTTPSuccess)
      @problem = "ringo answered #{response.code}"
    else
      begin
        @runs = JSON.parse(response.body)
      rescue JSON::ParserError
        @problem = "ringo answered, but not with the deploy history as JSON"
      end
    end
  rescue Fleet::Relay::Failure => e
    @problem = e.plain
  end

  def log
    no_store
    id = params[:id].to_s
    return render plain: "unknown deploy", status: :not_found if id.empty?
    return render plain: DeployLog.read(params[:file]) if DeployLog.local?(params[:file])
    base = Setting.ringo_base or return render plain: "no ringo origin is configured", status: :service_unavailable
    response = Fleet::Relay.get("#{base}/deploys/log?id=#{ERB::Util.url_encode(id)}", timeout: TIMEOUT)
    render plain: response.body, status: response.code.to_i
  rescue Fleet::Relay::Failure => e
    render plain: e.plain, status: e.status
  end
end
