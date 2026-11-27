# Errors go to Bugsink, which speaks the Sentry protocol, when SENTRY_DSN is
# set; the twin of config/initializers/error-reporting.ts. sentry-rails
# subscribes to Rails.error itself, so ApiController#render_server_error's
# Rails.error.report reaches it. Unset (tests, development), nothing is sent.
if ENV["SENTRY_DSN"].present?
  Sentry.init do |config|
    config.dsn = ENV["SENTRY_DSN"]
    config.release = ENV["GIT_REV"]
    config.environment = Rails.env
  end
end
