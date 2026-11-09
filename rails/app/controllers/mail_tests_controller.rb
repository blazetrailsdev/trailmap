# `/mail-test` — prove the mail path works without waiting for a job to fail.
# One form sends a test email now; one button enqueues FailingProbeJob, whose
# discard mails `EMAIL` the way a real failure's would. Its door is
# `/dashboard`'s (the app's Authelia), deliberately not LoopbackOnly.
class MailTestsController < ApplicationController
  def show
    render_page(nil, :ok)
  end

  def deliver
    to = params[:to].to_s.strip
    unless to.match?(/\A[^\s@]+@[^\s@]+\z/)
      return render_page({ ok: false, message: "Give an email address to send to." }, :unprocessable_entity)
    end

    begin
      OpsMailer.probe(to: to, from: ENV["EMAIL"].presence || to).deliver_now
    rescue StandardError => e
      return render_page({ ok: false, message: "The test email to #{to} could not be sent: #{e.message}" }, :bad_gateway)
    end
    render_page({ ok: true, message: "Sent a test email to #{to}." }, :ok)
  end

  def enqueue
    begin
      job = FailingProbeJob.perform_later("enqueued #{Time.now.utc.iso8601(3)}")
    rescue StandardError => e
      return render_page({ ok: false, message: "FailingProbeJob could not be enqueued: #{e.message}" }, :bad_gateway)
    end
    id = job ? job.job_id : nil
    email = ENV["EMAIL"].presence
    message = if email
      "Enqueued FailingProbeJob #{id}. When the worker runs it, its failure is mailed to #{email}."
    else
      "Enqueued FailingProbeJob #{id}, but EMAIL is not set, so its failure will not be mailed."
    end
    render_page({ ok: !email.nil?, message: message }, :ok)
  end

  private
    def render_page(outcome, status)
      @outcome = outcome
      @alert_to = ENV["EMAIL"].presence
      @smtp_address = ENV.fetch("SMTP_ADDRESS", "localhost")
      @to = params[:to] || ENV["EMAIL"] || ""
      render :show, status: status
    end
end
