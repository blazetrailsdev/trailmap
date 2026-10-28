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
  def check_database
    file = ENV["TASKS_DATABASE"].to_s.strip
    if file.present? && !File.exist?(file)
      return { ok: false, error: "#{file} is gone: the open connection is reading a file nothing else can see" }
    end
    { ok: true, stories: Story.count }
  end

  def check_stories(database)
    return { ok: false, error: "not counted: the database check failed" } unless database[:ok]
    count = database[:stories].to_i
    count.positive? ? { ok: true, count: count } : { ok: false, count: count, error: "the stories table is empty" }
  end

  # The head db/migrate expects against schema_migrations, for EQUALITY: the
  # tasks CLI migrates this file too, so it can be ahead.
  def check_migrations
    context = Story.connection_pool.migration_context
    expected = context.migrations.last&.version
    actual = context.current_version.nonzero?
    versions = { expected: expected, actual: actual }
    return { ok: false, **versions, error: "no migrations found under #{context.migrations_paths.join(', ')}" } if expected.nil?
    return { ok: true, **versions } if actual == expected
    why = actual && actual > expected ? "the database is ahead of this release" : "a migration did not run"
    { ok: false, **versions, error: "schema_migrations is at #{actual || 'no version'}, and db/migrate expects #{expected}: #{why}" }
  end

  # Writable is proven by writing an empty directory, which git cannot track.
  def check_checkout
    dir = Document.tasks_content_dir or return { ok: false, error: "TASKS_DIR names no tasks checkout" }
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
