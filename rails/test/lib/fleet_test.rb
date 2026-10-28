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
end
