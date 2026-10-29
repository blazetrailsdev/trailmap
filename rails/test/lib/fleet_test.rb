require "test_helper"
require "socket"

class FleetLibTest < ActiveSupport::TestCase
  test "Relay::Failure carries the plain text and the status" do
    failure = Fleet::Relay::Failure.new("ringo did not answer in 5s", 504)
    assert_equal [ "ringo did not answer in 5s", 504, "ringo did not answer in 5s" ], [ failure.plain, failure.status, failure.message ]
  end

  test "Relay.get answers ringo's response, and 502 when ringo is unreachable" do
    server = TCPServer.new("127.0.0.1", 0)
    port = server.addr[1]
    thread = Thread.new do
      client = server.accept
      client.gets("\r\n\r\n")
      client.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nhi")
      client.close
    end
    response = Fleet::Relay.get("http://127.0.0.1:#{port}/x", timeout: 5)
    assert_equal [ "200", "hi" ], [ response.code, response.body ]
    thread.join
    server.close
    error = assert_raises(Fleet::Relay::Failure) { Fleet::Relay.get("http://127.0.0.1:#{port}/x", timeout: 5) }
    assert_equal 502, error.status
    assert_match(/\Aringo is unreachable: /, error.plain)
  end

  test "Relay.get_bounded stops reading once the body passes the limit" do
    server = TCPServer.new("127.0.0.1", 0)
    port = server.addr[1]
    sent = 0
    thread = Thread.new do
      client = server.accept
      client.gets("\r\n\r\n")
      client.write("HTTP/1.1 200 OK\r\nContent-Length: #{64 << 20}\r\nConnection: close\r\n\r\n")
      chunk = "x" * 16_384
      begin
        while sent < 64 << 20
          client.write(chunk)
          sent += chunk.bytesize
        end
      rescue SystemCallError, IOError
        # The relay hung up early, which is the point.
      end
      client.close
    end
    response, body = Fleet::Relay.get_bounded("http://127.0.0.1:#{port}/x", timeout: 5, limit: 100_000)
    thread.join
    server.close
    assert_equal "200", response.code
    assert_nil body
    assert_operator sent, :<, 64 << 20
  end

  test "Relay.get_bounded answers the whole body within the limit" do
    server = TCPServer.new("127.0.0.1", 0)
    port = server.addr[1]
    thread = Thread.new do
      client = server.accept
      client.gets("\r\n\r\n")
      client.write("HTTP/1.1 404 Not Found\r\nContent-Length: 2\r\nConnection: close\r\n\r\nno")
      client.close
    end
    response, body = Fleet::Relay.get_bounded("http://127.0.0.1:#{port}/x", timeout: 5, limit: 2)
    thread.join
    server.close
    assert_equal [ "404", "no" ], [ response.code, body ]
  end

  test "SocketRelay.websocket? reads the upgrade headers" do
    assert Fleet::SocketRelay.websocket?(upgrade_env)
    assert_not Fleet::SocketRelay.websocket?({ "REQUEST_METHOD" => "GET", "HTTP_HOST" => "x" })
  end

  test "SocketRelay.new hijacks the socket and start answers the handshake" do
    browser, server_side = UNIXSocket.pair
    relay = Fleet::SocketRelay.new(upgrade_env.merge("rack.hijack" => -> { server_side }), "http://127.0.0.1:1/events")
    relay.start
    assert_match %r{\AHTTP/1.1 101 Switching Protocols}, browser.readpartial(4096)
  ensure
    browser&.close
    sleep 0.1
  end

  private

  def upgrade_env
    { "REQUEST_METHOD" => "GET", "HTTP_HOST" => "127.0.0.1", "REQUEST_URI" => "/fleet/socket",
      "HTTP_CONNECTION" => "Upgrade", "HTTP_UPGRADE" => "websocket", "HTTP_SEC_WEBSOCKET_VERSION" => "13",
      "HTTP_SEC_WEBSOCKET_KEY" => "dGhlIHNhbXBsZSBub25jZQ==", "HTTP_ORIGIN" => "http://127.0.0.1" }
  end

  # A viewer that records frames and whether it was ended.
  class Viewer
    attr_reader :frames, :ended_at

    def initialize = (@frames = Queue.new)
    def frame(message) = @frames << message
    def ended = (@ended_at = true)
  end

  # An SSE ringo counting its connections; it sends `frames`, then holds.
  def with_sse_ringo(frames)
    server = TCPServer.new("127.0.0.1", 0)
    connections = Queue.new
    thread = Thread.new do
      loop do
        client = server.accept
        connections << client
        client.gets("\r\n\r\n")
        client.write("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\n")
        frames.each { |f| client.write("data: #{f}\n\n") }
      end
    end
    yield "http://127.0.0.1:#{server.addr[1]}/events", connections
  ensure
    thread&.kill
    server&.close
  end

  test "holds one upstream connection for any number of viewers" do
    with_sse_ringo(%w[one]) do |url, connections|
      a = Viewer.new
      b = Viewer.new
      leave_a = Fleet::SharedStream.subscribe(url, a)
      leave_b = Fleet::SharedStream.subscribe(url, b)
      assert_equal "one", a.frames.pop(timeout: 5)
      assert_equal "one", b.frames.pop(timeout: 5)
      assert_equal 1, connections.size
      assert_equal 1, Fleet::SharedStream.reads(url)
      leave_a.call
      leave_b.call
    end
  end

  test "sends a viewer joining mid-stream the latest frame at once" do
    with_sse_ringo(%w[one two]) do |url, _|
      first = Viewer.new
      leave_first = Fleet::SharedStream.subscribe(url, first)
      2.times { first.frames.pop(timeout: 5) }
      late = Viewer.new
      leave_late = Fleet::SharedStream.subscribe(url, late)
      assert_equal "two", late.frames.pop(timeout: 1)
      leave_first.call
      leave_late.call
    end
  end

  test "ends the upstream read with the last viewer, and restarts it for the next" do
    with_sse_ringo(%w[one]) do |url, connections|
      viewer = Viewer.new
      leave = Fleet::SharedStream.subscribe(url, viewer)
      viewer.frames.pop(timeout: 5)
      leave.call
      assert_equal 0, Fleet::SharedStream.reads(url)
      again = Viewer.new
      leave_again = Fleet::SharedStream.subscribe(url, again)
      assert_equal "one", again.frames.pop(timeout: 5)
      assert_equal 2, connections.size
      leave_again.call
    end
  end

  # A relay over one end of a socket pair; the test reads the other end.
  def relay_to(events_url)
    browser, server = UNIXSocket.pair
    relay = Fleet::SocketRelay.new(upgrade_env.merge("rack.hijack" => -> { server }), events_url)
    relay.start
    browser.readpartial(4096) # the 101 handshake
    [ relay, browser ]
  end

  test "SocketRelay#frame sends one text message to the browser" do
    with_sse_ringo([]) do |url, _|
      relay, browser = relay_to(url)
      relay.frame("hello")
      assert_equal "\x81\x05hello".b, browser.readpartial(4096)
    ensure
      browser&.close
    end
  end

  test "SocketRelay#ended closes the socket with 1012 so the page reconnects" do
    with_sse_ringo([]) do |url, _|
      relay, browser = relay_to(url)
      relay.ended
      frame = browser.readpartial(4096)
      assert_equal 0x88, frame.getbyte(0)
      assert_equal 1012, frame.byteslice(2, 2).unpack1("n")
    ensure
      browser&.close
    end
  end

  test "never joins a stream that has finished, and starts a fresh one" do
    stream = Fleet::SharedStream.new("http://127.0.0.1:1/events")
    stream.stop
    assert_not stream.add(Viewer.new)
    with_sse_ringo(%w[one]) do |url, connections|
      first = Viewer.new
      leave = Fleet::SharedStream.subscribe(url, first)
      first.frames.pop(timeout: 5)
      leave.call
      again = Viewer.new
      leave_again = Fleet::SharedStream.subscribe(url, again)
      assert_equal "one", again.frames.pop(timeout: 5)
      assert_equal 2, connections.size
      leave_again.call
    end
  end

  test "ends every viewer when upstream cannot be reached" do
    viewer = Viewer.new
    Fleet::SharedStream.subscribe("http://127.0.0.1:1/events", viewer)
    deadline = Time.now + 5
    sleep 0.01 until viewer.ended_at || Time.now > deadline
    assert viewer.ended_at
    assert_equal 0, Fleet::SharedStream.reads("http://127.0.0.1:1/events")
  end
end
