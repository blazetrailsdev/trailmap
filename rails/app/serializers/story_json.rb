# The story object every read verb returns — `readmodel.ts`'s `buildIndex()`
# mapping, field for field and in order. A cross-repo contract: btwhooks'
# Go side and the CLI's `--json` both parse it.
module StoryJson
  module_function

  # ISO midnight from a stored date-only string; nil drops the field, not
  # the response.
  def iso_midnight(value)
    return nil if value.nil? || value == ""
    Date.iso8601(value.to_s[0, 10]).strftime("%Y-%m-%dT00:00:00.000Z")
  rescue Date::Error
    nil
  end

  def integer_or_nil(value)
    value.is_a?(Integer) ? value : nil
  end

  def serialize(story, index)
    raw = story.status&.to_s
    {
      id: story.id,
      rfc: story.rfc_id,
      title: story.title,
      status: EffectiveStatus.of(index.rfc_status[story.rfc_id], raw),
      raw_status: raw,
      cluster: story.cluster,
      packages: index.packages.fetch(story.id, []),
      priority: integer_or_nil(story.priority),
      updated: iso_midnight(story.updated_on),
      deps: index.deps.fetch(story.id, []),
      deps_rfc: index.rfc_deps.fetch(story.id, []),
      est_loc: story.est_loc,
      pr: story.pr,
      claim: story.claim_at&.to_s,
      assignee: story.assignee,
      blocked_by: story.blocked_by,
      closed_reason: story.closed_reason,
      story_paths: index.paths.fetch(story.id, []),
      file_path: story.file_path
    }
  end

  def serialize_all(stories, index)
    stories.map { |s| serialize(s, index) }
  end
end
