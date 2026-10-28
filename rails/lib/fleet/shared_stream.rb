require "net/http"

module Fleet
  # One upstream read of ringo's stream per URL, and everyone reading it. It
  # starts with the first viewer and is killed when the last one leaves.
  class SharedStream
    CONNECT_TIMEOUT = 10
    @streams = {}
    @lock = Mutex.new

    class << self
      # Join the read of `url`; answers the lambda that leaves it.
      def subscribe(url, viewer)
        stream = @lock.synchronize { @streams[url.to_s] ||= new(url).tap(&:start) }
        stream.add(viewer)
        lambda do
          last = stream.remove(viewer)
          @lock.synchronize { @streams.delete(url.to_s) if @streams[url.to_s] == stream } if last
          stream.stop if last
        end
      end

      # How many upstream reads are open for `url` right now: zero or one.
      def reads(url)
        @lock.synchronize { @streams.key?(url.to_s) ? 1 : 0 }
      end

      def forget(stream, url)
        @lock.synchronize { @streams.delete(url.to_s) if @streams[url.to_s] == stream }
      end
    end

    def initialize(url)
      @url = URI(url)
      @viewers = []
      @latest = nil
      @mutex = Mutex.new
    end

    def start
      @thread = Thread.new do
        pump
      ensure
        self.class.forget(self, @url)
        left = @mutex.synchronize { @viewers.dup.tap { @viewers.clear } }
        left.each(&:ended)
      end
    end

    def stop = @thread&.kill

    def add(viewer)
      latest = @mutex.synchronize { @viewers << viewer; @latest }
      viewer.frame(latest) if latest
    end

    # True when `viewer` was the last one.
    def remove(viewer)
      @mutex.synchronize { !@viewers.delete(viewer).nil? && @viewers.empty? }
    end

    private

    def fan_out(message)
      viewers = @mutex.synchronize { @latest = message; @viewers.dup }
      # One viewer's closed socket must not cost the others this frame.
      viewers.each { |v| v.frame(message) rescue nil }
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
