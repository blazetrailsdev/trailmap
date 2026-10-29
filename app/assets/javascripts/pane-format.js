/*
 * The live pane page's pure half: what one poll of the screen relay does to
 * the page's state, and the strings its header shows. No `document` here, so
 * `test/assets/pane-format.test.js` exercises it directly; `pane.js` is the
 * DOM wiring around it.
 */
import { esc, paneDot, timeAgo } from "./fleet-format.js";

/** How often the page asks for the screen. */
export const POLL_MS = 2000;

/** How often it asks once a poll has failed in a way retrying will not fix. */
export const SLOW_POLL_MS = 30000;

/** The relay's own 503, which shares a status with ringo's "tmux is down". */
const NO_ORIGIN = "no ringo origin is configured";

/** Within this many pixels of the end counts as "at the bottom". */
export const STICK_PX = 24;

export const initialState = () => ({
  hash: "",
  status: "",
  cwd: "",
  lines: 0,
  /** When ringo last answered, in ms; 0 before the first answer. */
  updatedAt: 0,
  /** The pane is gone. Terminal: polling stops and the last screen stays. */
  exited: false,
  /** Why the last poll failed, '' when it did not. */
  unreachable: "",
  /** Which kind of failure that was: see `failureKind`. '' when it did not. */
  failure: "",
});

/**
 * What a failed poll means, from the status the relay answered with (0 when
 * nothing answered at all). Three cases, because they need different words
 * and one of them a different cadence:
 *
 *   unreachable  502/504, or no answer: ringo is down or slow. Transient.
 *   pane         any other status, ringo's 503 above all: ringo was reached,
 *                and tmux was not (or it is busy: 408, 429). Transient.
 *   refused      404/400, and the relay's unconfigured 503: no such endpoint,
 *                a bad request, or no ringo to ask. Retrying will not fix it.
 */
export function failureKind(status, error = "") {
  if (!status || status === 502 || status === 504) return "unreachable";
  if (status === 503 && error.trim() === NO_ORIGIN) return "refused";
  return status === 400 || status === 404 ? "refused" : "pane";
}

/**
 * Fold one poll into the state. `outcome` is `{ body }` for an answer from
 * ringo or `{ error, status }` for anything else (ringo down, a timeout,
 * a failure status from the relay); `status` is absent when nothing
 * answered. Returns the next state and, only when the screen actually
 * changed, the `html` to put on the page -- `null` means leave the DOM alone,
 * which is every case but one.
 */
export function screenStep(state, outcome, now = Date.now()) {
  const body = outcome.body;
  if (outcome.error || !body || typeof body !== "object") {
    const unreachable = outcome.error || "ringo sent no screen";
    const failure = failureKind(outcome.status, unreachable);
    return { state: { ...state, unreachable, failure }, html: null };
  }
  if (body.exists === false) {
    return { state: { ...state, exited: true, unreachable: "", failure: "", updatedAt: now }, html: null };
  }
  const next = {
    ...state,
    unreachable: "",
    failure: "",
    updatedAt: now,
    status: body.status || "",
    input: body.pane_input || "",
  };
  if (body.unchanged || typeof body.html !== "string") return { state: next, html: null };
  next.cwd = body.cwd || "";
  next.lines = body.lines || 0;
  next.hash = body.hash || "";
  return { state: next, html: body.html };
}

/** The relay's URL for the next poll, naming the screen the page already has. */
export function screenUrl(path, hash) {
  return hash ? path + "?have=" + encodeURIComponent(hash) : path;
}

/** Whether the page should be polling at all right now. */
export function shouldPoll(state, { paused, hidden }) {
  return !state.exited && !paused && !hidden;
}

/** How long to wait before the next poll: slowly, once asking again cannot help. */
export function pollDelay(state) {
  return state.failure === "refused" ? SLOW_POLL_MS : POLL_MS;
}

/** The worktree's name: the last segment of the pane's working directory. */
export function worktreeName(cwd) {
  const parts = String(cwd || "").split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

/** The header's status: the dashboard's dot, and the word beside it. '' once the pane is gone. */
export function statusHtml(state) {
  if (state.exited || !state.updatedAt) return "";
  return paneDot(state.status, state.input).trim() + " " + esc(state.status || "idle");
}

export function updatedText(state, now = Date.now()) {
  if (!state.updatedAt) return state.unreachable ? "" : "connecting…";
  return "updated " + timeAgo(state.updatedAt, now);
}

const FAILURE_TEXT = {
  unreachable: "ringo is unreachable — retrying.",
  pane: "ringo answered, but cannot read this pane — retrying.",
  refused: "ringo refused the request, and retrying will not fix it — asking again every 30s.",
};

/** What has gone wrong, if anything; the pane's exit outranks a lost ringo. */
export function noticeText(state, { paused }) {
  if (state.exited) {
    return state.hash ? "This pane has exited — showing its last screen." : "This pane has exited.";
  }
  if (state.unreachable) return FAILURE_TEXT[state.failure || "unreachable"] + " (" + state.unreachable + ")";
  if (paused) return "Paused.";
  return "";
}

/** Whether a scroller sits at its end, and so should follow new output. */
export function atBottom({ scrollTop, scrollHeight, clientHeight }) {
  return scrollHeight - scrollTop - clientHeight <= STICK_PX;
}
