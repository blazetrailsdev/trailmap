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
    "broadcast-targets" => "broadcast/targets"
  }.freeze

  # ringo's controls the page may reach. An allowlist: this route forwards
  # to a process that can merge pull requests.
  CONTROLS = %w[
    spawn merge-pr spawnloop/dismiss spawnloop/dismiss-failed spawnloop/config spawnloop/skip
    spawnloop/spawn-now ci-fixer/spawn reviewer/assign worker/spawn broadcast drain drain-one
    poke-stalled cancel-cleanup ask/answer reviewer/drain-codex reviewer/drain-claude pause refresh-usage
    spawnloop/rfc-batch-spawn spawnloop/rfc-refine spawnloop/story-spawn
  ].freeze

  SCREEN_HASH_MAX = 128

  def self.pane_id?(id)
    id.match?(/\A[0-9]{1,10}\z/)
  end

  def self.screen_hash?(have)
    have.length <= SCREEN_HASH_MAX
  end
end
