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
const sendPath = byId("paneConfig").dataset.sendPath;
const sendForm = byId("paneSend");
const sendInput = byId("paneMessage");
const sendButton = byId("paneSendButton");
const sendResult = byId("paneSendResult");
const keysPath = byId("paneConfig").dataset.keysPath;
const keyButtons = [...byId("paneKeys").querySelectorAll("button[data-key]")];
let sending = false;

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
  // An exited pane has nobody to read the line; ringo would refuse it with 410.
  sendInput.disabled = state.exited;
  sendButton.disabled = state.exited || sending;
  for (const button of keyButtons) button.disabled = state.exited;
}

/**
 * POST the line through trailmap's relay with the page's CSRF token. A 204 is
 * "typed"; anything else shows ringo's (or the relay's) own text.
 */
async function postToPane(path, body) {
  const meta = document.querySelector('meta[name="csrf-token"]');
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(meta ? { "X-CSRF-Token": meta.content } : {}) },
      body: JSON.stringify(body),
    });
    if (response.ok) return { ok: true };
    return { ok: false, error: (await response.text()).slice(0, 300) || "HTTP " + response.status };
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : String(error) };
  }
}

sendForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = sendInput.value;
  if (text === "" || sending) return;
  sending = true;
  sendResult.className = "muted";
  sendResult.textContent = "sending…";
  paintHeader();
  const outcome = await postToPane(sendPath, { text });
  sending = false;
  if (outcome.ok) {
    sendInput.value = "";
    sendResult.textContent = "sent";
  } else {
    sendResult.className = "bad";
    sendResult.textContent = outcome.error;
  }
  paintHeader();
  loop.pollNow();
});

/**
 * Press one key in the pane; the result line says what happened. One press at
 * a time: a press while another is in flight is dropped, so the line always
 * names the key it answers for.
 */
let pressing = false;
async function pressKey(key) {
  if (loop.state.exited || pressing) return;
  pressing = true;
  sendResult.className = "muted";
  sendResult.textContent = "pressing " + key + "…";
  const outcome = await postToPane(keysPath, { keys: [key] });
  pressing = false;
  sendResult.className = outcome.ok ? "muted" : "bad";
  sendResult.textContent = outcome.ok ? key + " pressed" : outcome.error;
  loop.pollNow();
}

for (const button of keyButtons) {
  button.addEventListener("click", () => pressKey(button.dataset.key));
}

// With the screen focused, the keys a TUI prompt wants go to the pane. Tab is
// left to move focus; its button presses it.
const SCREEN_KEYS = { ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Enter: "Enter", Escape: "Escape" };
screen.addEventListener("keydown", (event) => {
  const key = SCREEN_KEYS[event.key];
  if (key === undefined || event.altKey || event.ctrlKey || event.metaKey) return;
  event.preventDefault();
  // Holding a key down is one press, not a burst of send-keys.
  if (event.repeat) return;
  pressKey(key);
});

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
