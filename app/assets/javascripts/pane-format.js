/*
 * The live pane page's pure half: what one poll of the screen relay does to
 * the page's state, and the strings its header shows. No `document` here, so
 * `test/assets/pane-format.test.js` exercises it directly; `pane.js` is the
 * DOM wiring around it.
 */
import { esc, paneDot, timeAgo } from "./fleet-format.js";

/** How often the page asks for the screen. */
export const POLL_MS = 2000;

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
});

/**
 * Fold one poll into the state. `outcome` is `{ body }` for an answer from
 * ringo or `{ error }` for anything else (ringo down, a timeout, a 5xx from
 * the relay). Returns the next state and, only when the screen actually
 * changed, the `html` to put on the page -- `null` means leave the DOM alone,
 * which is every case but one.
 */
export function screenStep(state, outcome, now = Date.now()) {
  const body = outcome.body;
  if (outcome.error || !body || typeof body !== "object") {
    return { state: { ...state, unreachable: outcome.error || "ringo sent no screen" }, html: null };
  }
  if (body.exists === false) {
    return { state: { ...state, exited: true, unreachable: "", updatedAt: now }, html: null };
  }
  const next = { ...state, unreachable: "", updatedAt: now, status: body.status || "" };
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

/** The worktree's name: the last segment of the pane's working directory. */
export function worktreeName(cwd) {
  const parts = String(cwd || "").split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

/** The header's status: the dashboard's dot, and the word beside it. '' once the pane is gone. */
export function statusHtml(state) {
  if (state.exited || !state.updatedAt) return "";
  return paneDot(state.status).trim() + " " + esc(state.status || "idle");
}

export function updatedText(state, now = Date.now()) {
  if (!state.updatedAt) return state.unreachable ? "" : "connecting…";
  return "updated " + timeAgo(state.updatedAt, now);
}

/** What has gone wrong, if anything; the pane's exit outranks a lost ringo. */
export function noticeText(state, { paused }) {
  if (state.exited) {
    return state.hash ? "This pane has exited — showing its last screen." : "This pane has exited.";
  }
  if (state.unreachable) return "ringo is unreachable — retrying. (" + state.unreachable + ")";
  if (paused) return "Paused.";
  return "";
}

/** Whether a scroller sits at its end, and so should follow new output. */
export function atBottom({ scrollTop, scrollHeight, clientHeight }) {
  return scrollHeight - scrollTop - clientHeight <= STICK_PX;
}
