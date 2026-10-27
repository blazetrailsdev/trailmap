require "test_helper"

class SessionsHelperTest < ActionView::TestCase
  test "session_time is Go's Jan 2 15:04 in the offset ringo wrote" do
    assert_equal "Oct 7 07:44", session_time("2026-10-07T07:44:36.18-04:00")
    assert_equal "garbage", session_time("garbage")
  end

  test "short_dur" do
    assert_equal "<1m", short_dur(59_000)
    assert_equal "42m", short_dur(42 * 60_000)
    assert_equal "3h05m", short_dur(185 * 60_000)
  end

  test "money" do
    assert_equal "—", money(0)
    assert_equal "$1.25", money(1.255)
  end

  test "human_bytes" do
    assert_equal "512 B", human_bytes(512)
    assert_equal "2.0 KB", human_bytes(2048)
    assert_equal "3.0 MB", human_bytes(3 * 2**20)
    assert_equal "5.0 GB", human_bytes(5 * 2**30)
  end

  test "short_id" do
    assert_equal "0123456789ab…", short_id("0123456789abcdef")
    assert_equal "short", short_id("short")
  end

  test "or_dash" do
    assert_equal "—", or_dash("")
    assert_equal "—", or_dash(nil)
    assert_equal "main", or_dash("main")
  end
end
