# A story may depend on a whole RFC closing.
class StoryRfcDep < ApplicationRecord
  belongs_to :story
  belongs_to :rfc
end
