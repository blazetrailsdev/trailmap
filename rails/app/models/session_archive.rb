# One pane's working life on one PR: ringo's `SessionArchive`
# (`webhook/sessionarchive.go`). An ActiveModel, not a record: the archive is
# ringo's `index.json` on ringo's disk, read over the private network from
# ringo's `/api/sessions` as the deploys page reads its history. The finders
# carry ringo's names (`all`, `for_pr` for `ForPR`), and the row ringo sent is
# kept verbatim so `/api/sessions` relays its shape exactly.
class SessionArchive
  include ActiveModel::Model
  include ActiveModel::Attributes

  # How long ringo has to answer for the archive index.
  TIMEOUT = 5
  # How long ringo has to assemble one PR's timeline: it scans transcripts from disk.
  TIMELINE_TIMEOUT = 10

  # The archive could not be read: ringo is unset, down, or answered something else.
  class Unavailable < StandardError
    attr_reader :status

    def initialize(message, status)
      @status = status
      super(message)
    end
  end

  attribute :owner, :string
  attribute :repo, :string
  attribute :pr, :integer
  attribute :pane, :string
  attribute :branch, :string, default: ""
  attribute :cwd, :string, default: ""
  attribute :reason, :string, default: ""
  attribute :pane_log, :string, default: ""
  attribute :pane_log_bytes, :integer, default: 0
  attribute :truncated, :boolean, default: false

  # ringo's row, untouched.
  attr_accessor :row

  class << self
    def from_row(row)
      new(owner: row["owner"], repo: row["repo"], pr: row["pr"], pane: row["pane"],
          branch: row["branch"] || "", cwd: row["cwd"] || "", reason: row["reason"] || "",
          pane_log: row["pane_log"] || "", pane_log_bytes: row["pane_log_bytes"] || 0,
          truncated: row["truncated"] || false).tap { |archive| archive.row = row }
    end

    # ringo had nothing to say: no note, nothing unclaimed.
    NO_STATUS = { "mode" => "", "note" => "", "unclaimed_pane_logs" => 0, "unclaimed_pane_log_bytes" => 0 }.freeze

    # Every archive in ringo's `List` order, kept.
    def all
      base = Setting.ringo_base
      raise Unavailable.new("no ringo origin is configured", 503) if base.nil?
      begin
        response = Fleet::Relay.get("#{base}/api/sessions", timeout: TIMEOUT)
      rescue Fleet::Relay::Failure => e
        raise Unavailable.new(e.plain, e.status)
      end
      # The status alone: an error body may be a proxy's whole HTML page.
      raise Unavailable.new("ringo answered #{response.code}", 502) unless response.is_a?(Net::HTTPSuccess)
      begin
        rows = JSON.parse(response.body)
      rescue JSON::ParserError
        raise Unavailable.new("ringo answered, but not with the session archive as JSON", 502)
      end
      # Go encodes an empty archive's nil slice as `null`.
      (rows || []).map { |row| from_row(row) }
    end

    # ringo's `/api/sessions/status`: the archive's mode note and its unclaimed
    # pane captures, NO_STATUS when ringo cannot say (unset, down, or older
    # than the endpoint). Only two notes hang on it; `all` reports the failure.
    def status
      base = Setting.ringo_base
      return NO_STATUS if base.nil?
      response = Fleet::Relay.get("#{base}/api/sessions/status", timeout: TIMEOUT)
      return NO_STATUS unless response.is_a?(Net::HTTPSuccess)
      NO_STATUS.merge(JSON.parse(response.body))
    rescue Fleet::Relay::Failure, JSON::ParserError
      NO_STATUS
    end

    # One PR's timeline as ringo draws it, rows and order ringo's own. nil when
    # there is none to show: the cards stand without it.
    def timeline(owner:, repo:, pr:)
      base = Setting.ringo_base
      return if base.nil?
      query = { owner: owner, repo: repo, pr: pr }.to_query
      response = Fleet::Relay.get("#{base}/api/sessions/timeline?#{query}", timeout: TIMELINE_TIMEOUT)
      return unless response.is_a?(Net::HTTPSuccess)
      JSON.parse(response.body)
    rescue Fleet::Relay::Failure, JSON::ParserError
      nil
    end

    # ringo's `ForPR`: every archive recorded against one PR, one per pane.
    def for_pr(owner:, repo:, pr:)
      all.select { |a| a.owner == owner && a.repo == repo && a.pr == pr }
    end
  end

  def transcripts
    row["transcripts"] || []
  end

  def opened_at
    Time.iso8601(row["opened_at"])
  end

  # Go writes a zero `time.Time` for an open archive: `0001-01-01T00:00:00Z`.
  def closed_at
    at = row["closed_at"]
    return nil if at.blank? || at.start_with?("0001-")
    Time.iso8601(at)
  end

  # ringo's `Open`: still accumulating.
  def open?
    closed_at.nil?
  end

  # ringo's `Duration`, in milliseconds: until now for an open archive.
  def duration(now = Time.now)
    (((closed_at || now) - opened_at) * 1000).round
  end

  # ringo's `Cost`: the pinned transcripts' cost, summed.
  def cost
    transcripts.sum { |t| t["cost"] || 0 }
  end

  # ringo's `roleSplit`: distinct runners per role (keyed on the checkout, or
  # the session before CWD was recorded) and the passes they made.
  def role_split
    agents = Set.new
    reviewers = Set.new
    passes = 0
    transcripts.each do |t|
      key = t["cwd"].presence || t["session_id"]
      case t["role"]
      when "reviewer" then reviewers << key; passes += 1
      when "agent" then agents << key; passes += 1
      end
    end
    { agents: agents.size, reviewers: reviewers.size, passes: passes }
  end
end
