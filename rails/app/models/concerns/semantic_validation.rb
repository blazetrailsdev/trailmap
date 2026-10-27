# The SEMANTIC half of validation, moved off the content repo's
# validate-lib.mjs: everything relational. Runs in the `ingest` context only.
# MESSAGES ARE PART OF THE CONTRACT, copied verbatim.
module SemanticValidation
  # Mirrors btwhooks' PR_MAX_LOC.
  MAX_EST_LOC = 700

  DepViolations = Struct.new(:ref_violations, :cycles)

  module_function

  def terminal_status?(status)
    status == "done" || status == "closed"
  end

  def lifecycle_errors(story)
    errors = []
    status = story.status.to_s
    case status
    when "draft", "ready"
      { "claim" => story.claim_at, "assignee" => story.assignee, "pr" => story.pr }.each do |key, value|
        errors << "status: #{status} must have null #{key} (got #{value.to_json})" unless value.nil?
      end
    when "claimed"
      errors << "status: claimed requires a claim timestamp" if story.claim_at.blank?
      errors << "status: claimed requires an assignee" if story.assignee.blank?
    when "in-progress"
      errors << "status: in-progress requires a claim timestamp" if story.claim_at.blank?
      errors << "status: in-progress requires an assignee" if story.assignee.blank?
      errors << "status: in-progress requires a pr" if story.pr.nil?
    when "blocked"
      errors << "status: blocked requires blocked-by" if story.blocked_by.blank?
    when "closed"
      errors << "status: closed requires closed-reason" if story.closed_reason.blank?
    end
    if status != "blocked" && !story.blocked_by.nil?
      errors << %(blocked-by is set but status is "#{status}" — only blocked stories carry blocked-by)
    end
    if status != "closed" && !story.closed_reason.nil?
      errors << %(closed-reason is set but status is "#{status}" — only closed stories carry closed-reason)
    end
    errors
  end

  def est_loc_errors(story)
    return [] if story.est_loc.nil? || terminal_status?(story.status)
    return [] if story.est_loc <= MAX_EST_LOC
    [ "est-loc #{story.est_loc} exceeds the #{MAX_EST_LOC} LOC per-PR ceiling" ]
  end

  def closed_rfc_errors(rfc, stories)
    return [] unless rfc.status == "closed"
    stories.reject { |s| terminal_status?(s.status) }
           .map { |s| %(status: closed but story "#{s.id}" is "#{s.status}", not done or closed) }
  end

  # Reference + cycle checks over the story dep graph.
  def check_dep_graph(story_ids:, rfc_ids:, deps_of:, deps_rfc_of:, seeds:)
    seeds = seeds.to_a
    refs = []
    seeds.each do |from|
      deps_of.call(from).each { |dep| refs << { from: from, dep: dep, kind: "dep" } unless story_ids.include?(dep) }
      deps_rfc_of.call(from).each { |dep| refs << { from: from, dep: dep, kind: "deps-rfc" } unless rfc_ids.include?(dep) }
    end

    color = {}
    cycles = []
    visit = lambda do |id, stack|
      return cycles << [ *stack, id ] if color[id] == :gray
      return if color[id] == :black
      color[id] = :gray
      deps_of.call(id).each { |dep| visit.call(dep, [ *stack, id ]) if story_ids.include?(dep) }
      color[id] = :black
    end
    seeds.each { |id| visit.call(id, []) }
    DepViolations.new(refs, cycles)
  end

  def dep_graph_messages(violations)
    messages = violations.ref_violations.map { |v| %(#{v[:kind]} "#{v[:dep]}" does not exist) }
    violations.cycles.each { |cycle| messages << "dep cycle detected: #{cycle.join(' → ')}" }
    messages
  end
end
