# The fleet pages' configuration: the paths the page reaches ringo through,
# and the allowlists that bound what it may reach. ../config/fleet.ts.
module Fleet
  SOCKET_PATH = "/fleet/socket"
  CONTROL_PATH = "/fleet/control"
  REVIEWERS_PATH = "/fleet/reviewers"
  READ_PATH = "/fleet/read"
  PANE_PATH = "/fleet/pane"

  # Reads the page makes outside the stream, by name → ringo path.
  READS = {
    "usage" => "usage-status",
    "codex-usage" => "codex-usage-status",
    "asks" => "ask/list",
    "drain-status" => "reviewer/drain-status",
    "spawn-loop" => "spawnloop/config",
    "reviewer-config" => "reviewer/config",
    "broadcast-targets" => "broadcast/targets",
    "external-prs" => "api/external-prs",
    "external-review" => "api/external-reviews",
    "pr-trust" => "api/pr-trust",
    "external-on-trusted" => "api/external-on-trusted"
  }.freeze

  # The reads that take `?repo=` alone.
  REPO_READS = %w[pr-trust external-on-trusted].freeze

  # `?repo=<owner/repo>`, or "" when it is not one.
  def self.repo_query(repo)
    return "" unless repo.match?(%r{\A[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}\z})
    "?repo=#{CGI.escape(repo)}"
  end

  # The query `external-review` forwards, or "" when repo or pr is not one.
  def self.external_review_query(repo, pr)
    return "" unless repo.match?(%r{\A[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}\z}) && pr.match?(/\A[0-9]{1,10}\z/)
    "?repo=#{CGI.escape(repo)}&pr=#{pr}"
  end

  # The repos the spawn dialog offers first, in this order: the ones spawned
  # into most. Every other repo follows them by name.
  SPAWN_ORDER = %w[blazetrailsdev/trails blazetrailsdev/trailmap blazetrailsdev/tasks].freeze

  # ringo's controls the page may reach. An allowlist: this route forwards
  # to a process that can merge pull requests.
  CONTROLS = %w[
    merge-pr spawnloop/dismiss spawnloop/dismiss-failed spawnloop/config spawnloop/skip
    spawnloop/spawn-now ci-fixer/spawn reviewer/assign worker/spawn broadcast drain drain-one
    poke-stalled cancel-cleanup ask/answer reviewer/drain-codex reviewer/drain-claude pause refresh-usage
    spawnloop/rfc-batch-spawn spawnloop/rfc-refine spawnloop/story-spawn spawnloop/dashboard-spawn
    external-review/start api/pr-trust external-review/forward
  ].freeze

  SCREEN_HASH_MAX = 128

  # ringo's own cap on one pane message (`paneSendMaxBytes`), in bytes.
  PANE_MESSAGE_MAX_BYTES = 4096

  # Why `text` cannot be sent to a pane, or nil when it can. ringo decides the rest.
  def self.pane_message_problem(text)
    return "message is empty" if text.empty?
    return "message is longer than #{PANE_MESSAGE_MAX_BYTES} bytes" if text.bytesize > PANE_MESSAGE_MAX_BYTES
    nil
  end

  # ringo's allowlist of tmux key names (`paneKeyNames`) and its cap (`paneKeysMax`).
  PANE_KEYS = %w[Enter Up Down Left Right Escape Tab].freeze
  PANE_KEYS_MAX = 16

  # Why `keys` cannot be pressed in a pane, or nil when they can.
  def self.pane_keys_problem(keys)
    return "no keys given" unless keys.is_a?(Array) && keys.any?
    return "at most #{PANE_KEYS_MAX} keys at a time" if keys.size > PANE_KEYS_MAX
    bad = keys.find_index { |key| !PANE_KEYS.include?(key) }
    return "key #{keys[bad]} is not one of #{PANE_KEYS.join(", ")}" unless bad.nil?
    nil
  end

  def self.pane_id?(id)
    id.match?(/\A[0-9]{1,10}\z/)
  end

  def self.screen_hash?(have)
    have.length <= SCREEN_HASH_MAX
  end
end
