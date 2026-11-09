# Delivery goes over SMTP to `SMTP_ADDRESS` (the relay the host's msmtp used,
# ../docs/deploy.md), from the same variables the trails side reads.
class ApplicationMailer < ActionMailer::Base
  self.smtp_settings = {
    address: ENV.fetch("SMTP_ADDRESS", "localhost"),
    port: Integer(ENV.fetch("SMTP_PORT", "587")),
    user_name: ENV["SMTP_USER_NAME"],
    password: ENV["SMTP_PASSWORD"],
    authentication: (ENV["SMTP_USER_NAME"].present? ? :plain : nil),
    enable_starttls_auto: true
  }
end
