require "net/http"

module Fleet
  # One upstream read of ringo's stream per URL, and everyone reading it. It
  # starts with the first viewer and is killed when the last one leaves.
  class SharedStream
    CONNECT_TIMEOUT = 10
    @streams = {}
    @lock = Mutex.new

    class << self
      # Join the read of `url`; answers the lambda that leaves it. A stream
      # that has finished is replaced, never joined: its viewers were already
      # ended, and one added after that would wait on it forever.
      def subscribe(url, viewer)
        key = url.to_s
        loop do
          stream = @lock.synchronize do
            current = @streams[key]
            current = @streams[key] = new(key).tap(&:start) if current.nil? || current.finished?
            current
          end
          next unless stream.add(viewer)
          return -> { leave(key, stream, viewer) }
        end
      end

      # How many upstream reads are open for `url` right now: zero or one.
      def reads(url)
        @lock.synchronize { @streams.key?(url.to_s) ? 1 : 0 }
      end

      def forget(stream, key)
        @lock.synchronize { @streams.delete(key) if @streams[key] == stream }
      end

      private

      # Removing the last viewer and retiring the stream are one critical
      # section, so no `subscribe` can join it in between.
      def leave(key, stream, viewer)
        last = @lock.synchronize do
          stream.remove(viewer).tap { |l| @streams.delete(key) if l && @streams[key] == stream }
        end
        stream.stop if last
      end
    end

    def initialize(key)
      @key = key
      @url = URI(key)
      @viewers = []
      @latest = nil
      @finished = false
      @mutex = Mutex.new
    end

    def start
      @thread = Thread.new do
        pump
      ensure
        left = @mutex.synchronize { @finished = true; @viewers.dup.tap { @viewers.clear } }
        self.class.forget(self, @key)
        left.each(&:ended)
      end
    end

    def finished? = @mutex.synchronize { @finished }

    def stop
      @mutex.synchronize { @finished = true }
      @thread&.kill
    end

    # False, adding nothing, when the stream has finished.
    def add(viewer)
      latest = @mutex.synchronize do
        return false if @finished
        @viewers << viewer
        @latest
      end
      viewer.frame(latest) if latest
      true
    end

    # True when `viewer` was the last one; that retires the stream.
    def remove(viewer)
      @mutex.synchronize do
        (!@viewers.delete(viewer).nil? && @viewers.empty?).tap { |last| @finished = true if last }
      end
    end

    private

    def fan_out(message)
      viewers = @mutex.synchronize { @latest = message; @viewers.dup }
      # One viewer's closed socket must not cost the others this frame.
      viewers.each do |v|
        v.frame(message)
      rescue IOError, SystemCallError
        nil
      end
    end

    def pump
      Net::HTTP.start(@url.host, @url.port, open_timeout: CONNECT_TIMEOUT, read_timeout: nil) do |http|
        req = Net::HTTP::Get.new(@url)
        req["Accept"] = "text/event-stream"
        http.request(req) do |response|
          return unless response.is_a?(Net::HTTPSuccess)
          pending = +""
          response.read_body do |chunk|
            data, pending = Sse.data(pending + chunk.force_encoding(Encoding::UTF_8))
            data.each { |message| fan_out(message) }
          end
        end
      end
    rescue StandardError
      # ringo unreachable: nothing to forward, and every viewer is ended.
    end
  end
end
