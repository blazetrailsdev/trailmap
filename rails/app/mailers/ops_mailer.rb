# Mail to whoever runs trailmap: failed jobs, and the probe `/mail-test` sends.
class OpsMailer < ApplicationMailer
  # `failure` carries what ApplicationJob#mail_failure reports: :to, :job_class,
  # :job_id, :arguments, :executions, :exception_class, :message, :backtrace, :details.
  def job_failed(failure)
    lines = [
      "#{failure[:job_class]} failed for good and was discarded.",
      "",
      "Job:        #{failure[:job_class]}",
      "Job id:     #{failure[:job_id] || "(none)"}",
      "Arguments:  #{failure[:arguments]}",
      "Executions: #{failure[:executions]}",
      "Exception:  #{failure[:exception_class]}: #{failure[:message]}"
    ]
    lines.push("", *failure[:details]) if failure[:details].any?
    lines.push("", "Backtrace:", failure[:backtrace])
    mail(
      to: failure[:to],
      from: failure[:to],
      subject: "[trailmap] #{failure[:job_class]} failed: #{failure[:exception_class]}: #{failure[:message].lines.first.to_s.chomp}",
      body: "#{lines.join("\n")}\n"
    )
  end

  def probe(to:, from:)
    mail(
      to: to,
      from: from,
      subject: "[trailmap] test email",
      body: "This is a test email from trailmap's /mail-test page, sent at #{Time.now.utc.iso8601(3)}.\n"
    )
  end
end
