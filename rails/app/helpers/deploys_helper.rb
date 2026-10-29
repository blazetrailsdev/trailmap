module DeploysHelper
  # Where a run's log is read: by id alone; the controller finds the file from the run.
  def deploy_log_path(run)
    "/deploys/log?id=#{ERB::Util.url_encode(run["id"].to_s)}"
  end

  # A run's length as ringo's page writes it: `42s`, `2m 5s`.
  def deploy_duration(seconds)
    seconds < 60 ? "#{seconds}s" : "#{seconds / 60}m #{seconds % 60}s"
  end
end
