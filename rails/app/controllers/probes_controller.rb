# `/up/ready` and `/up/deep`, the probes beside `/up`. `/up` (Rails' own
# health check) touches nothing; these can see a database that will not
# open, an empty backlog, or a checkout the container cannot write.
class ProbesController < ApiController
  # The bound on one `deep`, in seconds.
  class_attribute :deep_timeout, default: 5.0

  @in_flight = nil
  @in_flight_lock = Mutex.new
  class << self
    attr_accessor :in_flight
    attr_reader :in_flight_lock
  end

  # Every check runs on every request. Keys are wire names.
  def ready
    database = check { check_database }
    checks = {
      database: database,
      stories: check_stories(database),
      migrations: check { check_migrations },
      hub_migrations: check { check_hub_migrations },
      checkout: check { check_checkout },
      git_identity: check { check_git_identity }
    }
    failing = checks.reject { |_, c| c[:ok] }.keys.map(&:to_s)
    render json: { status: failing.empty? ? "ok" : "unready", failing: failing, checks: checks },
           status: failing.empty? ? :ok : :service_unavailable
  end

  # A real ready queue, timed and bounded; overlapping calls share one run.
  def deep
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    rows = shared_queue.join(deep_timeout)&.value
    latency_ms = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1000).round
    raise_timeout if rows.nil? || latency_ms > deep_timeout * 1000
    render json: { status: "ok", ready: { rows: rows, latency_ms: latency_ms } }
  rescue StandardError => e
    render json: { status: "down", error: e.message }, status: :service_unavailable
  end

  private

  def raise_timeout
    raise "timeout: the ready queue took longer than #{(deep_timeout * 1000).round}ms"
  end

  def shared_queue
    self.class.in_flight_lock.synchronize do
      self.class.in_flight ||= Thread.new do
        Rails.application.executor.wrap { Story.ready_queue.first.size }
      ensure
        self.class.in_flight_lock.synchronize { self.class.in_flight = nil }
      end
    end
  end

  def check
    yield
  rescue StandardError => e
    { ok: false, error: e.message }
  end

  # The path must still exist: an open connection reads an unlinked inode.
  # Exists, is the file the connection opened (TasksDatabase.identity, recorded
  # at boot), and answers a count. Without a recorded identity the second
  # question degrades to the first, and `identity` says so.
  def check_database
    file = ENV["TASKS_DATABASE"].to_s.strip
    identity = nil
    if file.present?
      unless File.exist?(file)
        return { ok: false, error: "#{file} is gone: the open connection is reading a file nothing else can see" }
      end
      opened = TasksDatabase.identity
      if opened.nil? || opened[:path] != file
        identity = "unchecked: no dev/ino was recorded for this file, so only its existence was"
      else
        now = File.stat(file)
        if now.dev != opened[:dev] || now.ino != opened[:ino]
          return { ok: false, error: "#{file} was replaced: the connection opened dev #{opened[:dev]} ino #{opened[:ino]}, " \
                                     "and the path is now dev #{now.dev} ino #{now.ino}" }
        end
      end
    end
    { ok: true, **(identity ? { identity: identity } : {}), stories: Story.count }
  end

  def check_stories(database)
    return { ok: false, error: "not counted: the database check failed" } unless database[:ok]
    count = database[:stories].to_i
    count.positive? ? { ok: true, count: count } : { ok: false, count: count, error: "the stories table is empty" }
  end

  # The head db/migrate expects against schema_migrations, for EQUALITY: the
  # tasks CLI migrates this file too, so it can be ahead.
  def check_migrations
    head_check(Story.connection_pool.migration_context, "db/migrate")
  end

  # The hub's head against db/hub_migrate. Skipped, green, when no hub URL is
  # configured — only a test process can serve without one.
  def check_hub_migrations
    return { ok: true, skipped: "HUB_DATABASE_URL is not set" } if Hub.connection_db_config.database.blank?
    head_check(Hub.connection_pool.migration_context, "db/hub-migrate")
  end

  # `dir` is the trails spelling, db/hub-migrate, so both apps answer the same
  # body; DEVIATIONS.md has the directory names.
  def head_check(context, dir)
    expected = context.migrations.last&.version
    actual = context.current_version.nonzero?
    versions = { expected: expected, actual: actual }
    return { ok: false, **versions, error: "no migrations found under #{context.migrations_paths.join(', ')}" } if expected.nil?
    return { ok: true, **versions } if actual == expected
    why = actual && actual > expected ? "the database is ahead of this release" : "a migration did not run"
    { ok: false, **versions, error: "schema_migrations is at #{actual || 'no version'}, and #{dir} expects #{expected}: #{why}" }
  end

  PROBE_SWEEP_AGE = 5.minutes

  # Writable is proven by writing an empty directory, which git cannot track.
  # A kill between the two calls leaves one; those older than PROBE_SWEEP_AGE
  # are swept first, and younger ones may be a concurrent probe's.
  def check_checkout
    dir = Document.tasks_content_dir or return { ok: false, error: "TASKS_DIR names no tasks checkout" }
    sweep_probes(dir)
    probe = begin
      Dir.mktmpdir(".up-ready-", dir)
    rescue SystemCallError => e
      return { ok: false, dir: dir, error: e.message }
    end
    begin
      Dir.rmdir(probe)
    rescue SystemCallError => e
      return { ok: false, dir: dir, error: "left #{probe} behind: #{e.message}" }
    end
    { ok: true, dir: dir }
  end

  # Best effort: a failed sweep leaves the leftovers, and never decides the check.
  def sweep_probes(dir)
    cutoff = PROBE_SWEEP_AGE.ago
    Dir.glob(".up-ready-*", base: dir).each do |name|
      path = File.join(dir, name)
      Dir.rmdir(path) if File.mtime(path) < cutoff
    rescue SystemCallError
      next
    end
  rescue SystemCallError
    nil
  end

  # `git var` resolves each identity exactly as a commit would.
  def check_git_identity
    dir = Document.tasks_content_dir or return { ok: false, error: "TASKS_DIR names no tasks checkout" }
    %w[GIT_AUTHOR_IDENT GIT_COMMITTER_IDENT].each do |ident|
      output, status = Open3.capture2e("git", "-C", dir, "var", ident)
      return { ok: false, error: "#{ident}: #{output.strip}" } unless status.success?
    end
    { ok: true }
  rescue SystemCallError => e
    { ok: false, error: e.message }
  end
end
