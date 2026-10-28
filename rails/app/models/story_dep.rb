# Self-referential join: `story_id` depends on `depends_on_id`.
class StoryDep < ApplicationRecord
  belongs_to :story
  belongs_to :depends_on, class_name: "Story"
end
