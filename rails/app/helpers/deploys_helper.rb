module DeploysHelper
  # Where a run's log is read: the id, and the base name of the capture ringo
  # recorded, which `DeploysController#log` reads off the mount.
  def deploy_log_path(run)
    file = File.basename(run["logFile"].to_s)
    "/deploys/log?id=#{ERB::Util.url_encode(run["id"].to_s)}" + (file.empty? ? "" : "&file=#{ERB::Util.url_encode(file)}")
  end

  # A run's length as ringo's page writes it: `42s`, `2m 5s`.
  def deploy_duration(seconds)
    seconds < 60 ? "#{seconds}s" : "#{seconds / 60}m #{seconds % 60}s"
  end
end
