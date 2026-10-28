# The mutation verbs as JSON on loopback. Thin on purpose: every decision is
# on Story. `exit_code` is the CLI's, and the HTTP status derives from it.
class MutationsController < ApiController
  # Mirrors the tasks CLI's src/pr-ref.ts.
  PR_REF_RE = /\A([a-z0-9][a-z0-9._-]*)#([1-9]\d*)\z/
  PR_REF_USAGE = "--pr takes repo#N, e.g. trails#7228 or tasks#94"
  INVALID_PR = Object.new.freeze

  # `tasks claim <id...> [--assignee NAME]`
  def claim
    ids = story_ids
    return usage("claim requires at least one story id") if ids.empty?
    run { Story.claim_all(ids, param(:assignee) || ids.first) }
  end

  def release
    ids = story_ids
    return usage("release requires at least one story id") if ids.empty?
    run { Story.release_all(ids) }
  end

  # `tasks in-progress <id...> --pr repo#N` — the PR is required.
  def in_progress
    ids = story_ids
    pr = pr_param
    return usage("in-progress requires at least one story id") if ids.empty?
    return usage(PR_REF_USAGE) if pr.equal?(INVALID_PR)
    return usage("in-progress requires --pr") if pr.nil?
    run { Story.mark_tracking_all(ids, "in-progress", pr) }
  end

  # `tasks done <id...> [--pr repo#N]`
  def done
    ids = story_ids
    pr = pr_param
    return usage("done requires at least one story id") if ids.empty?
    return usage(PR_REF_USAGE) if pr.equal?(INVALID_PR)
    run { Story.mark_tracking_all(ids, "done", pr) }
  end

  def record_spawn
    ids = story_ids
    source = param(:source)
    rfc = param(:rfc)
    return usage("record-spawn requires --source and either story ids or --rfc") if source.nil? || (ids.empty? && rfc.nil?)
    run { [ Story.record_spawn(ids, source, branch: param(:branch), pane: param(:pane), rfc: rfc) ] }
  end

  def block
    reason = param(:reason) or return usage("block requires a reason")
    on_one { |story| story.block(reason) }
  end

  # The empty-reason refusal is the MODEL's.
  def close
    return usage("close requires a reason") if params[:reason].nil?
    on_one { |story| story.close(params[:reason].to_s) }
  end

  # An unknown status is refused here — deliberate hardening over the CLI.
  def status_set
    status = param(:status) or return usage("status-set requires a status")
    return usage(%(unknown status "#{status}")) unless Story::STATUSES.include?(status)
    on_one { |story| story.status_set(status) }
  end

  # `"clear"` and null clear it; a non-number is refused rather than cleared.
  def priority
    raw = params[:priority]
    priority = nil
    unless raw.nil? || raw == "clear"
      priority = js_number(raw)
      return usage(%(priority must be a number or "clear")) if priority.nil?
    end
    on_one { |story| story.priority_set(priority) }
  end

  private

  def on_one
    ids = story_ids
    return usage("this verb takes exactly one story id") unless ids.size == 1
    run { [ yield(Story.find_all_or_raise(ids).first) ] }
  end

  # One transaction per request, around whatever the verb does.
  def run
    lines = ApplicationRecord.transaction { yield }
    render json: { ok: true, lines: lines }
  rescue VerbExit => e
    render json: { ok: false, error: e.message, exit_code: e.code }, status: e.code == 1 ? 422 : 409
  end

  def usage(message)
    render json: { ok: false, error: message, exit_code: 1 }, status: :bad_request
  end

  # A JSON array or a lone string, deduped as the CLI does.
  def story_ids
    raw = params[:ids]
    list = raw.is_a?(Array) ? raw.map(&:to_s).reject(&:empty?) : [ param(:ids) || param(:id) ].compact
    list.uniq
  end

  def pr_param
    value = param(:pr) or return nil
    m = PR_REF_RE.match(value.strip)
    m ? "#{m[1]}##{m[2].to_i}" : INVALID_PR
  end

  # JavaScript's `Number(raw)`, finite only; whole numbers as Integer.
  def js_number(raw)
    n = raw.is_a?(Numeric) ? raw : (raw.to_s.strip.empty? ? 0 : Float(raw.to_s.strip, exception: false))
    return nil if n.nil? || !n.to_f.finite?
    n == n.to_i ? n.to_i : n
  end
end
