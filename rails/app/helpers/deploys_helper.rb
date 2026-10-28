module DeploysHelper
  # A run's length as ringo's page writes it: `42s`, `2m 5s`.
  def deploy_duration(seconds)
    seconds < 60 ? "#{seconds}s" : "#{seconds / 60}m #{seconds % 60}s"
  end
end
