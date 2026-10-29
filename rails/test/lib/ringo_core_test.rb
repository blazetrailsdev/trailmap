require "test_helper"

# ringo's core.wasm under wasmtime: the same answers the trails app's
# lib/ringo-core.ts gets from it.
class RingoCoreTest < ActiveSupport::TestCase
  test "render_pane_log replays a log to escaped scrollback" do
    replay = RingoCore.render_pane_log("plain \e[31mred <b>\e[0m\r\nsecond row\r\n", 20_000)
    assert_includes replay["html"], "red &lt;b&gt;"
    assert_equal 3, replay["lines"]
  end

  test "parse_transcript reads a session back into turns" do
    tr = RingoCore.parse_transcript(%({"type":"user","timestamp":"2026-08-26T14:00:00Z","message":{"content":"hi"}}\n), 20_000)
    assert_equal [ "hi" ], tr["Turns"].map { |t| t["Prompt"] }
  end

  test "run raises core's own message on a bad mode" do
    error = assert_raises(RingoCore::Error) { RingoCore.run([ "nope" ], "") }
    assert_includes error.message, "unknown mode: nope"
  end
end
