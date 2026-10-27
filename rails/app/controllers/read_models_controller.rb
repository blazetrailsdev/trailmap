# The two read-models `index.json` and `events.json` carried, served whole
# for ringo. ORDERING IS PART OF THE ANSWER.
class ReadModelsController < ApiController
  EVENT_COLUMNS = %i[at verb story_id rfc_id pr actor detail].freeze

  def index
    snapshot = Story.ranking_rows
    render json: { rfcs: RfcJson.serialize_all(Rfc.order(:id)), stories: StoryJson.serialize_all(snapshot.stories, snapshot) }
  end

  # Chronological; `id` breaks ties on second-resolution `at`. Plucked.
  def events
    rows = Event.order(:at, :id).pluck(*EVENT_COLUMNS)
    render json: {
      events: rows.map do |at, verb, story, rfc, pr, actor, detail|
        { at: at.to_s, verb: verb, story: story, rfc: rfc, pr: pr, actor: actor, detail: detail }
      end
    }
  end
end
