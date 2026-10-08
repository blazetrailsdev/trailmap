/*
 * The live pane page's DOM wiring: poll the screen relay, and assign what
 * `./pane-format.js` decides onto the elements the `.tse` rendered.
 *
 * Polling, not the fleet page's socket: a screen is a few hundred kilobytes
 * that ringo captures on request, and `have=<hash>` makes the common poll --
 * nothing changed -- a few bytes.
 */
import {
  POLL_MS,
  atBottom,
  initialState,
  noticeText,
  screenStep,
  screenUrl,
  shouldPoll,
  statusHtml,
  updatedText,
  worktreeName,
} from "./pane-format.js";

const byId = (id) => document.getElementById(id);
const screenPath = byId("paneConfig").dataset.screenPath;
const screen = byId("paneScreen");
const pauseButton = byId("panePause");

let state = initialState();
let paused = false;
let inFlight = false;
let timer = null;

const polling = () => shouldPoll(state, { paused, hidden: document.hidden });

/** The header. Every value but the status dot goes in as text. */
function paintHeader() {
  const worktree = byId("paneWorktree");
  worktree.textContent = worktreeName(state.cwd);
  worktree.title = state.cwd;
  byId("paneStatus").innerHTML = statusHtml(state);
  byId("paneUpdated").textContent = updatedText(state);
  const notice = byId("paneNotice");
  notice.textContent = noticeText(state, { paused });
  notice.className = "pane-notice" + (state.exited || state.unreachable ? " bad" : "");
  byId("paneLines").textContent = state.lines ? " (" + state.lines + " now)" : "";
  pauseButton.textContent = paused ? "Resume" : "Pause";
  pauseButton.disabled = state.exited;
}

/**
 * Put a new screen on the page. `html` is ringo's own rendering -- escaped
 * text in styled spans -- so it goes in as HTML. A reader at the bottom keeps
 * following the output; one who has scrolled up is left where they are.
 */
function paintScreen(html) {
  const follow = atBottom(screen);
  screen.innerHTML = html;
  if (follow) screen.scrollTop = screen.scrollHeight;
}

async function fetchScreen() {
  try {
    const response = await fetch(screenUrl(screenPath, state.hash), {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(POLL_MS * 2),
    });
    if (!response.ok) return { error: (await response.text()).slice(0, 200) || "HTTP " + response.status };
    return { body: await response.json() };
  } catch (error) {
    return { error: error && error.message ? error.message : String(error) };
  }
}

async function poll() {
  timer = null;
  if (inFlight || !polling()) return;
  inFlight = true;
  const step = screenStep(state, await fetchScreen());
  inFlight = false;
  state = step.state;
  if (step.html !== null) paintScreen(step.html);
  paintHeader();
  schedule(POLL_MS);
}

function schedule(delay) {
  if (timer !== null || !polling()) return;
  timer = setTimeout(poll, delay);
}

pauseButton.addEventListener("click", () => {
  paused = !paused;
  paintHeader();
  schedule(0);
});

// A hidden tab stops asking; coming back asks at once rather than a beat later.
document.addEventListener("visibilitychange", () => schedule(0));

// "updated Ns ago" keeps counting between polls, and while they are failing.
setInterval(() => {
  byId("paneUpdated").textContent = updatedText(state);
}, 1000);

paintHeader();
schedule(0);
