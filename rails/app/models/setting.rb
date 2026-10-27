# One-per-application settings, key/value. A row OVERRIDES the environment
# variable of the same meaning; the environment is the fallback.
class Setting < Hub
  self.primary_key = "key"

  FALLBACKS = { "ringo_base" => "RINGO_BASE" }.freeze
  MEMO_SECONDS = 10

  Resolved = Struct.new(:value, :source)

  class << self
    def lookup(key)
      resolve(key).value
    end

    # ringo's origin, without its trailing slash. THE only resolver.
    def ringo_base
      lookup("ringo_base")&.sub(%r{/+\z}, "").presence
    end

    # A setting's value AND which source won.
    def resolve(key)
      stored = stored_value(key)
      return Resolved.new(stored, "database") if stored
      from_env = ENV[FALLBACKS[key].to_s].to_s.strip
      return Resolved.new(from_env, "environment") if from_env.present?
      Resolved.new(nil, "unset")
    end

    # Upsert, so the database arbitrates two writers.
    def write(key, value)
      upsert({ key: key, value: value }, unique_by: :key)
      memo.delete(key)
    end

    def forget_resolved
      memo.clear
    end

    private

    def memo
      @memo ||= Concurrent::Map.new
    end

    # The row's trimmed value, cached for MEMO_SECONDS. With no hub configured
    # (most of the suite) the environment answers alone.
    def stored_value(key)
      cached = memo[key]
      return cached[:stored] if cached && Process.clock_gettime(Process::CLOCK_MONOTONIC) - cached[:at] < MEMO_SECONDS
      stored = find_by_key(key)&.value.to_s.strip.presence
      memo[key] = { at: Process.clock_gettime(Process::CLOCK_MONOTONIC), stored: stored }
      stored
    end

    def find_by_key(key)
      find_by(key: key)
    rescue ActiveRecord::ConnectionNotEstablished, ActiveRecord::ConnectionNotDefined, ActiveRecord::AdapterNotSpecified
      nil
    end
  end
end
