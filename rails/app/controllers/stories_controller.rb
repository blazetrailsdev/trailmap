# The read verbs — `ready`, `next-bundle`, `list` (index), `show`,
# `touching` — as JSON on loopback. Shapes are `readmodel.ts`'s, verbatim.
class StoriesController < ApiController
  # `next-bundle`'s default budget, the CLI's `--max-loc` default.
  DEFAULT_MAX_LOC = 250

  # `tasks list [--status S] [--rfc R] [--cluster C]`
  def index
    index = Story.ranking_rows
    render_stories(Ranking.list_filtered_in(index, rfc: param(:rfc), status: param(:status), cluster: param(:cluster)), index)
  end

  # `tasks ready [--rfc R]`, in ready-queue order.
  def ready
    stories, index = Story.ready_queue(rfc: param(:rfc))
    render_stories(stories, index)
  end

  # `tasks next-bundle`. The OBJECT shape is a contract with btwhooks.
  def next_bundle
    max_loc = int_param(:"max-loc") || DEFAULT_MAX_LOC
    rows, index, empty_reason = Story.bundle(max_loc: max_loc, cluster: param(:cluster), rfc: param(:rfc))
    summary = Ranking.summarize_bundle(rows, max_loc)
    respond_json(stories: StoryJson.serialize_all(rows, index), bundle_total_loc: summary[:total],
                 max_loc: max_loc, lead_exceeds_budget: summary[:lead_exceeds_budget], empty_reason: empty_reason)
  end

  # `tasks show <id>` — found in the snapshot, as the CLI does.
  def show
    id = params[:id].to_s
    index = Story.ranking_index
    story = index.stories.find { |s| s.id == id }
    return render json: { error: %(story "#{id}" not found) }, status: :not_found if story.nil?
    render_stories([ story ], index)
  end

  # `tasks touching <path> [--all]`. A missing path is refused: the
  # substring tier would match everything.
  def touching
    path = param(:path)
    return render json: { error: "touching requires a path" }, status: :bad_request if path.nil?
    index = Story.ranking_index
    render_stories(Story.touching(path, index: index, all: !param(:all).nil?), index)
  end

  private

  def render_stories(rows, index)
    stories = StoryJson.serialize_all(rows, index)
    respond_json(action_name == "show" ? stories.first : stories)
  end

  # Rails' `negotiate_mime` over the one type on offer, reading the Accept
  # header alone: ringo's Go client sends none, which is `*/*`.
  def respond_json(payload)
    accept = request.headers["Accept"].to_s.strip
    accepted = accept.empty? ? [ Mime::ALL ] : Mime::Type.parse(accept)
    if accepted.any? { |type| type.to_s == "*/*" || type == Mime[:json] }
      render json: payload
    else
      render json: { error: "not_acceptable" }, status: :not_acceptable
    end
  end

  def int_param(name)
    value = param(name) or return nil
    value[/\A\s*[-+]?\d+/]&.to_i
  end
end
