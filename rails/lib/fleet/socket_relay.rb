require "websocket/driver"

module Fleet
  # Relay ringo's event stream to one browser over a hijacked WebSocket:
  # each SSE event's JSON goes out as one text message, unchanged. One
  # upstream per browser, ending when the browser's does. When ringo's stream
  # ends the socket closes with 1012 and the page reconnects.
  #
  # The `websocket-driver` gem is the Ruby twin of the npm package
  # ../../../lib/fleet-relay.ts drives, by the same author.
  class SocketRelay
    PING_INTERVAL = 25
    CLOSE_GRACE = 5
    CONNECT_TIMEOUT = 10

    # The driver's view of the hijacked IO.
    Wire = Struct.new(:env, :io) do
      def url = "ws://#{env['HTTP_HOST']}#{env['REQUEST_URI']}"
      def write(data) = io.write(data)
    end

    def self.websocket?(env)
      WebSocket::Driver.websocket?(env)
    end

    def initialize(env, events_url)
      @io = env["rack.hijack"].call
      @driver = WebSocket::Driver.rack(Wire.new(env, @io))
      @events_url = URI(events_url)
      @closed = false
      @mutex = Mutex.new
    end

    def start
      @driver.on(:open) { open }
      @driver.on(:close) { finish }
      @driver.on(:error) { finish }
      @driver.start
      @reader = Thread.new { read_browser }
    end

    private

    def open
      @keepalive = Thread.new { loop { sleep PING_INTERVAL; synchronize { @driver.ping } } }
      @pump = Thread.new do
        pump
      ensure
        unless @closed
          synchronize { @driver.close("upstream ended", 1012) }
          Thread.new { sleep CLOSE_GRACE; finish }
        end
      end
    end

    def read_browser
      loop { @driver.parse(@io.readpartial(4096)) }
    rescue IOError, SystemCallError
      finish
    end

    def pump
      Net::HTTP.start(@events_url.host, @events_url.port, open_timeout: CONNECT_TIMEOUT, read_timeout: nil) do |http|
        req = Net::HTTP::Get.new(@events_url)
        req["Accept"] = "text/event-stream"
        http.request(req) do |response|
          return unless response.is_a?(Net::HTTPSuccess)
          pending = +""
          response.read_body do |chunk|
            return if @closed
            data, pending = Sse.data(pending + chunk.force_encoding(Encoding::UTF_8))
            data.each { |message| synchronize { @driver.text(message) } }
          end
        end
      end
    rescue StandardError
      # ringo unreachable, or the browser left: nothing to forward.
    end

    def synchronize(&block)
      @mutex.synchronize(&block) unless @closed
    end

    def finish
      return if @closed
      @closed = true
      @keepalive&.kill
      @pump&.kill unless Thread.current == @pump
      @io.close unless @io.closed?
    rescue IOError
      nil
    end
  end
end
