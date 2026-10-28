import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POLL_MS, atBottom } from "../../app/assets/javascripts/pane-format.js";
import { createPaneLoop, paintScreen } from "../../app/assets/javascripts/pane-loop.js";

/**
 * The pane page's polling loop, driven with fake timers: `pane.js` hands it a
 * fetch, a hidden flag and a painter, and these stand in for all three.
 */
function harness(answer = () => ({ body: { unchanged: true } })) {
  const page = { hidden: false };
  const fetchScreen = vi.fn(async () => answer());
  const loop = createPaneLoop({ fetchScreen, hidden: () => page.hidden, paint: () => {} });
  return { page, fetchScreen, loop };
}

describe("pane loop", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("polls at once on start, then every POLL_MS", async () => {
    const { fetchScreen, loop } = harness();
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchScreen).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(fetchScreen).toHaveBeenCalledTimes(2);
  });

  it("asks nothing while the tab is hidden", async () => {
    const { page, fetchScreen, loop } = harness();
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    page.hidden = true;
    loop.pollNow();
    await vi.advanceTimersByTimeAsync(POLL_MS * 10);
    expect(fetchScreen).toHaveBeenCalledTimes(1);
  });

  it("asks at once on returning to the tab, not after a pending timer", async () => {
    const { page, fetchScreen, loop } = harness();
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    page.hidden = true;
    page.hidden = false;
    loop.pollNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchScreen).toHaveBeenCalledTimes(2);
  });

  it("asks at once on Resume, and nothing while paused", async () => {
    const { fetchScreen, loop } = harness();
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    loop.togglePause();
    await vi.advanceTimersByTimeAsync(POLL_MS * 5);
    expect(fetchScreen).toHaveBeenCalledTimes(1);
    loop.togglePause();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchScreen).toHaveBeenCalledTimes(2);
  });

  it("never runs two loops at once", async () => {
    const { fetchScreen, loop } = harness();
    loop.start();
    loop.pollNow();
    loop.togglePause();
    loop.togglePause();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchScreen).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(fetchScreen).toHaveBeenCalledTimes(4);
  });

  it("stops asking once the pane no longer exists", async () => {
    const { fetchScreen, loop } = harness(() => ({ body: { exists: false } }));
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    loop.pollNow();
    await vi.advanceTimersByTimeAsync(POLL_MS * 5);
    expect(fetchScreen).toHaveBeenCalledTimes(1);
    expect(loop.state.exited).toBe(true);
  });
});

describe("paintScreen", () => {
  it("follows the output from the bottom", () => {
    const screen = { scrollTop: 800, scrollHeight: 1000, clientHeight: 200, innerHTML: "" };
    paintScreen(screen, "<span>new</span>", atBottom);
    expect(screen.innerHTML).toBe("<span>new</span>");
    expect(screen.scrollTop).toBe(1000);
  });

  it("holds the scroll position of a reader who has scrolled up", () => {
    const screen = { scrollTop: 100, scrollHeight: 1000, clientHeight: 200, innerHTML: "" };
    paintScreen(screen, "<span>new</span>", atBottom);
    expect(screen.scrollTop).toBe(100);
  });
});
