require "open3"

# Move an RFC through its lifecycle, and promote its draft stories in one
# batch. A port of `tasks rfc-status` (tasks/src/rfc-status.ts), as
# ../../app/models/rfc-status.ts is: the frontmatter is rewritten, committed
# and pushed, then the row and the `rfc-status` event are written — what
# ingest would project from that commit.
module RfcStatus
  ALLOWED = {
    "draft" => %w[active closed postponed],
    "active" => %w[draft closed postponed],
    "postponed" => %w[draft active closed],
    "closed" => [],
    "superseded" => []
  }.freeze

  Move = Struct.new(:to, :label, :confirm, keyword_init: true)
  READY = Move.new(to: "active", label: "Mark ready", confirm: "Mark this RFC ready (active)? Its ready stories become pickable by the spawn loop.")
  DRAFT = Move.new(to: "draft", label: "Back to draft", confirm: "Move this RFC back to draft? Its stories stop being picked up.")
  POSTPONE = Move.new(to: "postponed", label: "Postpone", confirm: "Postpone this RFC? Its stories stop being picked up until it is made ready again.")
  CLOSE = Move.new(to: "closed", label: "Close RFC", confirm: "Close this RFC? Refused while any of its stories are unfinished — use Sunset for that.")

  module_function

  # ringo's `rfcStatusMoves` (rfcs.go:1158), in its order.
  def moves(status)
    { "draft" => [ READY, POSTPONE, CLOSE ], "active" => [ DRAFT, POSTPONE, CLOSE ], "postponed" => [ READY, DRAFT, CLOSE ] }.fetch(status.to_s, [])
  end

  def git(dir, *args)
    output, status = Open3.capture2e("git", "-C", dir, *args)
    raise "git #{args.first}: #{output.strip}" unless status.success?
    output.strip
  end

  def edit_frontmatter(text, rel, edits)
    m = text.match(/\A(---\n)(.*?)(\n---\n)(.*)\z/m) or raise VerbExit.new(1, "#{rel} has no frontmatter block")
    lines = m[2].split("\n", -1)
    edits.each do |key, value|
      i = lines.index { |l| l.match?(/\A#{key}:(\s|\z)/) }
      next lines << "#{key}: #{value}" if i.nil?
      raise VerbExit.new(1, %(refusing to edit list-valued frontmatter key "#{key}" in #{rel})) if lines[i + 1]&.match?(/\A[ \t]/)
      lines[i] = "#{key}: #{value}"
    end
    m[1] + lines.join("\n") + m[3] + m[4]
  end

  def set(id, to, reason: nil)
    raise VerbExit.new(1, %(unknown RFC status "#{to}" (one of: #{Rfc.statuses.keys.join(", ")}))) unless Rfc.statuses.key?(to)
    dir = Document.tasks_content_dir or raise VerbExit.new(1, "TASKS_DIR names no tasks checkout")
    branch = (git(dir, "rev-parse", "--abbrev-ref", "HEAD") rescue nil)
    if branch != "main"
      raise VerbExit.new(1, "#{dir} is on #{branch && branch != "HEAD" ? branch : "a detached HEAD"}, not main — refusing to set rfc status.")
    end
    rfc = Rfc.find_by(id: id) or raise VerbExit.new(1, %(no such RFC "#{id}"))
    from = rfc.status
    return "rfc #{id} already #{to}" if from == to
    raise VerbExit.new(1, "RFC #{id} is #{from} — cannot move it to #{to}.") unless ALLOWED.fetch(from, []).include?(to)

    if to == "closed"
      open = Story.where(rfc_id: id).reject { |s| %w[done closed].include?(s.status) }
      if open.any?
        shown = open.first(5).map(&:id).join(", ")
        raise VerbExit.new(1, "RFC #{id} still has #{open.size} unfinished stor#{open.size == 1 ? "y" : "ies"} " \
                              "(#{shown}#{open.size > 5 ? ", …" : ""}) — close or rehome them first, or sunset the RFC.")
      end
    end

    rel = rfc.file_path || File.join("rfcs", id, "README.md")
    abs = File.join(dir, rel)
    raise VerbExit.new(1, "#{rel} does not exist") unless File.exist?(abs)
    updated = Time.now.utc.to_date.iso8601
    File.write(abs, edit_frontmatter(File.read(abs, encoding: "UTF-8"), rel, "status" => to, "updated" => updated))

    note = reason.to_s.strip.presence
    begin
      git(dir, "add", "--", rel)
      git(dir, "commit", "-q", "-m", "rfc(#{id}): #{from} -> #{to}#{note ? "\n\n#{note}" : ""}")
    rescue RuntimeError => e
      # Put the file back so a failed commit leaves no edit behind.
      (git(dir, "reset", "-q", "--", rel) rescue nil)
      (git(dir, "checkout", "--", rel) rescue nil)
      raise VerbExit.new(1, "rfc-status could not commit #{rel}: #{e.message}")
    end
    line = "rfc #{id}: #{from} -> #{to}"
    begin
      git(dir, "push", "--quiet", "origin", "HEAD:main")
    rescue RuntimeError
      begin
        git(dir, "pull", "--rebase", "--autostash", "--quiet", "origin", "main")
        git(dir, "push", "--quiet", "origin", "HEAD:main")
      rescue RuntimeError => e
        line += "\nwarning: rfc-status committed locally but could not push: #{e.message}\n  the work is on local main; push it or the next run will."
      end
    end

    ApplicationRecord.transaction do
      rfc.update!(status: to, updated_on: updated)
      Event.create!(at: Time.now.utc.iso8601, verb: "rfc-status", story_id: nil, rfc_id: id, pr: nil, actor: nil,
                    detail: { from: from, to: to, note: note }.to_json)
      # What ingest does next for an RFC whose status it projects.
      RfcClose.close_if_complete(id)
    end
    line
  end

  # ringo's `HandleRFCReadyDrafts`: `status-set <id...> ready --from draft`.
  def ready_drafts(id)
    raise VerbExit.new(1, %(no such RFC "#{id}")) unless Rfc.exists?(id: id)
    drafts = Story.where(rfc_id: id, status: "draft").pluck(:id)
    raise VerbExit.new(2, "rfc #{id} has no draft stories") if drafts.empty?
    Story.status_set_all(drafts, "ready", from: "draft")
  end
end
