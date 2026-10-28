require "websocket/driver"

module Fleet
  # Relay ringo's event stream to a browser over a hijacked WebSocket: each
  # SSE event's JSON goes out as one text message, unchanged. ONE upstream
  # read however many browsers (`SharedStream`): ringo's stream is whole
  # snapshots, so a viewer joining mid-stream is sent the latest frame at
  # once. When ringo's stream ends the socket closes with 1012 and the page
  # reconnects.
  #
  # The `websocket-driver` gem is the Ruby twin of the npm package
  # ../../../lib/fleet-relay.ts drives, by the same author.
  class SocketRelay
    PING_INTERVAL = 25
    CLOSE_GRACE = 5

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


    # SharedStream's viewer side.
    def frame(message)
      synchronize { @driver.text(message) }
    end

    def ended
      @unsubscribe = nil
      return if @closed
      synchronize { @driver.close("upstream ended", 1012) }
      Thread.new { sleep CLOSE_GRACE; finish }
    end

    private

    def open
      @keepalive = Thread.new { loop { sleep PING_INTERVAL; synchronize { @driver.ping } } }
      @unsubscribe = SharedStream.subscribe(@events_url, self)
    end

    def read_browser
      loop { @driver.parse(@io.readpartial(4096)) }
    rescue IOError, SystemCallError
      finish
    end

    # A write to a browser that has already gone ends the relay, not the thread.
    def synchronize(&block)
      @mutex.synchronize(&block) unless @closed
    rescue IOError, SystemCallError
      finish
    end

    def finish
      return if @closed
      @closed = true
      @keepalive&.kill
      @unsubscribe&.call
      @io.close unless @io.closed?
    rescue IOError
      nil
    end
  end
end
