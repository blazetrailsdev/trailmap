# What a story blocks and what blocks it, transitively: breadth-first over
# `story_deps`, one round per level with the far ends preloaded, so a level
# costs two queries however wide it is. `seen` ends a cycle after one lap.
module DepGraph
  Node = Struct.new(:id, :title, :status, :depth, :via, keyword_init: true)
  Graph = Struct.new(:blocked_by, :blocks, :cyclic, keyword_init: true)

  module_function

  def for(id)
    up = walk(id, :blocked_by)
    down = walk(id, :blocks)
    reached = up[:reached] + down[:reached]
    rfc_ids = reached.filter_map { |r| r[:story]&.rfc_id }.uniq
    rfc_status = rfc_ids.empty? ? {} : Rfc.where(id: rfc_ids).pluck(:id, :status).to_h
    held = Story.dep_held_ids(reached.map { |r| r[:id] })
    node = lambda do |r|
      story = r[:story]
      status = story.nil? ? "" : EffectiveStatus.shown(rfc_status[story.rfc_id], story.status, held.include?(story.id)).to_s
      Node.new(id: r[:id], title: story&.title, status: status, depth: r[:depth], via: r[:via])
    end
    Graph.new(blocked_by: up[:reached].map(&node), blocks: down[:reached].map(&node), cyclic: up[:cyclic])
  end

  def walk(start, direction)
    seen = Set[start]
    reached = []
    cyclic = false
    frontier = [ start ]
    depth = 1
    while frontier.any?
      edges =
        if direction == :blocked_by
          StoryDep.where(story_id: frontier).includes(:depends_on).order(:rowid)
        else
          StoryDep.where(depends_on_id: frontier).includes(:story).order(:rowid)
        end
      following = []
      edges.each do |edge|
        from, id, story =
          if direction == :blocked_by
            [ edge.story_id, edge.depends_on_id, edge.depends_on ]
          else
            [ edge.depends_on_id, edge.story_id, edge.story ]
          end
        cyclic = true if id == start
        next if seen.include?(id)
        seen << id
        reached << { id: id, story: story, depth: depth, via: depth == 1 ? nil : from }
        following << id
      end
      frontier = following
      depth += 1
    end
    { reached: reached, cyclic: cyclic }
  end
end
