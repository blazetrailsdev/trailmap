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
  noticeText,
  screenUrl,
  statusHtml,
  updatedText,
  worktreeName,
} from "./pane-format.js";
import { createPaneLoop, paintScreen } from "./pane-loop.js";

const byId = (id) => document.getElementById(id);
const screenPath = byId("paneConfig").dataset.screenPath;
const screen = byId("paneScreen");
const pauseButton = byId("panePause");

/** The header. Every value but the status dot goes in as text. */
function paintHeader() {
  const { state, paused } = loop;
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

async function fetchScreen(hash) {
  try {
    const response = await fetch(screenUrl(screenPath, hash), {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(POLL_MS * 2),
    });
    if (!response.ok) {
      const error = (await response.text()).slice(0, 200) || "HTTP " + response.status;
      return { error, status: response.status };
    }
    return { body: await response.json() };
  } catch (error) {
    return { error: error && error.message ? error.message : String(error) };
  }
}

const loop = createPaneLoop({
  fetchScreen,
  hidden: () => document.hidden,
  paint(html) {
    if (html !== null) paintScreen(screen, html, atBottom);
    paintHeader();
  },
});

pauseButton.addEventListener("click", () => {
  loop.togglePause();
  paintHeader();
});

// A hidden tab stops asking; coming back asks at once rather than a beat later.
document.addEventListener("visibilitychange", loop.pollNow);

// "updated Ns ago" keeps counting between polls, and while they are failing.
setInterval(() => {
  byId("paneUpdated").textContent = updatedText(loop.state);
}, 1000);

paintHeader();
loop.start();
