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

  test "clock" do
    assert_equal "14:00:01", clock("2026-08-26T14:00:01.123Z")
    assert_equal "", clock("0001-01-01T00:00:00Z")
  end

  test "call_ms" do
    call = { "StartedAt" => "2026-08-26T14:00:00Z", "EndedAt" => "2026-08-26T14:00:12.5Z" }
    assert_equal 12_500, call_ms(call)
    assert_equal 0, call_ms(call.merge("EndedAt" => "0001-01-01T00:00:00Z"))
    assert_equal 0, call_ms(call.merge("EndedAt" => "2026-08-26T13:59:00Z"))
  end

  test "wall_ms" do
    assert_equal 3_600_000, wall_ms({ "FirstAt" => "2026-08-26T14:00:00Z", "LastAt" => "2026-08-26T15:00:00Z" })
  end

  test "tool_dur" do
    assert_equal "", tool_dur(0)
    assert_equal "30ms", tool_dur(30)
    assert_equal "1.5s", tool_dur(1500)
    assert_equal "1.6s", tool_dur(1650)
    assert_equal "10m00s", tool_dur(600_000)
  end

  test "clip" do
    assert_equal "short", clip("short", 10)
    assert_equal "abcd\n… clipped, 2 B more", clip("abcdef", 4)
  end

  test "first_line" do
    assert_equal "one", first_line("  one  ")
    assert_equal "one …", first_line("one\ntwo")
    assert_equal "#{"x" * 96} …", first_line("x" * 100)
  end

  test "plural" do
    assert_equal "prompt", plural(1, "prompt", "prompts")
    assert_equal "prompts", plural(2, "prompt", "prompts")
  end

  test "reviewed_from" do
    assert reviewed_from("/w/trails-reviews/pr-9430")
    assert_not reviewed_from("/w/trails")
  end
end
