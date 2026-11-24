module DeploysHelper
  # Where a run's log is read: by id alone; the controller finds the file from the run.
  def deploy_log_path(run)
    "/deploys/log?id=#{ERB::Util.url_encode(run["id"].to_s)}"
  end

  # The same log replayed through the terminal emulator, for the row's inline view.
  def deploy_screen_path(run)
    "/deploys/screen?id=#{ERB::Util.url_encode(run["id"].to_s)}"
  end

  # A preview run's kind, for its tag: `preview`, `preview teardown`, `preview sweep`. Nil for a deploy.
  def deploy_kind(run)
    target = run["target"].to_s
    target if target == "preview" || target.start_with?("preview ")
  end

  # A preview's address, linked only when it is an https URL: it is relayed
  # from ringo, which read it from a log.
  def deploy_preview_url(run)
    uri = URI.parse(run["url"].to_s)
    uri.to_s if uri.is_a?(URI::HTTPS) && uri.host.present?
  rescue URI::InvalidURIError
    nil
  end

  # A run's length as ringo's page writes it: `42s`, `2m 5s`.
  def deploy_duration(seconds)
    seconds < 60 ? "#{seconds}s" : "#{seconds / 60}m #{seconds % 60}s"
  end
end
