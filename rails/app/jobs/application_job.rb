# A job that fails for good mails `EMAIL`. `after_discard` is the one hook
# Active Job runs for both ways that happens: `retry_on` running out of
# attempts, and an exception nothing rescued. A failure that will be retried
# does not reach it, so each failed job is mailed once.
class ApplicationJob < ActiveJob::Base
  after_discard { |job, exception| job.mail_failure(exception) }

  # Never raises: Active Job re-raises the first error an `after_discard`
  # block raises in place of the job's own, and the job's is the one to keep.
  def mail_failure(exception)
    to = ENV["EMAIL"]
    return failure_mail_not_sent("no alert email sent: EMAIL is not set") if to.blank?

    OpsMailer.job_failed(
      to: to,
      job_class: self.class.name,
      job_id: job_id,
      arguments: arguments.inspect,
      executions: executions,
      exception_class: exception.class.name,
      message: exception.message,
      # Headed by the exception, as a JavaScript `stack` is, so both apps' mail reads alike.
      backtrace: [ "#{exception.class.name}: #{exception.message}", *Array(exception.backtrace).map { |l| "    at #{l}" } ].join("\n"),
      details: failure_details
    ).deliver_now
  rescue StandardError => e
    failure_mail_not_sent("alert email to #{to} could not be sent: #{e.message}")
  end

  private
    # What a job adds to its failure mail beyond the exception: a stage, a log tail.
    def failure_details
      []
    end

    # Where a job notes that its failure went unmailed.
    def failure_mail_not_sent(reason)
      logger&.error("[#{self.class.name}] #{reason}")
    end
end
