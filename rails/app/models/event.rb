# Append-only. The velocity and RFC burndown charts read this table.
class Event < ApplicationRecord
  belongs_to :story, optional: true
  belongs_to :rfc, optional: true
end
