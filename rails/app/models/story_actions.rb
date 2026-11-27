# Which buttons `/story/<id>` offers, and so which of its POSTs it accepts:
# ../../../app/models/concerns/story-actions.ts, over the stored status.
module StoryActions
  Offered = Struct.new(:ready, :draft, :top, :block, :close, :release, :spawn, keyword_init: true)

  module_function

  def for(status, priority)
    open = !%w[done closed].include?(status)
    Offered.new(ready: status == "draft", draft: %w[ready blocked].include?(status),
                top: %w[draft ready blocked].include?(status) && priority != 0,
                block: open && status != "blocked", close: open, release: status == "claimed", spawn: open)
  end
end
