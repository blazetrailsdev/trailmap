require "test_helper"

class LoopbackOnlyTest < ActiveSupport::TestCase
  def loopback?(env) = LoopbackOnly.loopback?(env)

  test "accepts loopback with no proxy headers, in each spelling" do
    [ "127.0.0.1", "127.0.0.1:8080", "localhost", "[::1]:3000", "LOCALHOST" ].each do |host|
      assert loopback?("HTTP_HOST" => host), host
    end
  end

  test "refuses the public hostname, and no Host at all" do
    assert_not loopback?("HTTP_HOST" => "trailmap.deanoftech.com")
    assert_not loopback?({})
  end

  test "refuses a proxied request whatever host it claims" do
    LoopbackOnly::FORWARDED_HEADERS.each do |header|
      assert_not loopback?("HTTP_HOST" => "127.0.0.1", header => "127.0.0.1"), header
    end
  end
end
