/*
 * The pane page's polling loop, apart from the DOM so a test can drive it with
 * fake timers: when to ask, when not to, and never two loops at once.
 * `pane.js` hands it the fetch, whether the tab is hidden, and what to paint.
 */
import { initialState, pollDelay, screenStep, shouldPoll } from "./pane-format.js";

export function createPaneLoop({ fetchScreen, hidden, paint }) {
  let state = initialState();
  let paused = false;
  let inFlight = false;
  let timer = null;

  const polling = () => shouldPoll(state, { paused, hidden: hidden() });

  async function poll() {
    timer = null;
    if (inFlight || !polling()) return;
    inFlight = true;
    const step = screenStep(state, await fetchScreen(state.hash));
    inFlight = false;
    state = step.state;
    paint(step.html);
    schedule(pollDelay(state));
  }

  function schedule(delay) {
    if (timer !== null || !polling()) return;
    timer = setTimeout(poll, delay);
  }

  /**
   * Ask now if the page should be asking at all. A timer armed before the tab
   * was hidden, or before Pause, may still be pending; it is dropped first, or
   * `schedule` would leave the reader waiting out the rest of its two seconds.
   */
  function pollNow() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    schedule(0);
  }

  return {
    get state() {
      return state;
    },
    get paused() {
      return paused;
    },
    start: () => schedule(0),
    pollNow,
    togglePause() {
      paused = !paused;
      pollNow();
    },
  };
}

/**
 * Put a new screen into `screen`. `html` is ringo's own rendering -- escaped
 * text in styled spans -- so it goes in as HTML. A reader at the bottom keeps
 * following the output; one who has scrolled up is left where they are.
 */
export function paintScreen(screen, html, atBottom) {
  const follow = atBottom(screen);
  screen.innerHTML = html;
  if (follow) screen.scrollTop = screen.scrollHeight;
}
