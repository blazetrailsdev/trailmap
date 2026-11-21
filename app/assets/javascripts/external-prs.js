/*
 * The pulls tab's External inbox (RFC 0253): ringo's open external PRs for
 * this repo, each with its review state and a "Draft review" button.
 *
 * Read through the fleet relay (`/fleet/read/external-prs`, one
 * `/fleet/read/external-review?repo=&pr=` per row) and re-read whenever the
 * fleet stream's envelope carries a new `external_pr.*` or
 * `external_review.*` event. Present only when `#externalPrs` is.
 */
import { timeAgo } from "./fleet-format.js";

/**
 * Whether an envelope event is one this repo's inbox redraws on: an
 * `external_pr.*` or `external_review.*` event about `nwo`. Another repo's
 * activity never redraws the rows, so a half-typed focus note is not rebuilt
 * for nothing.
 */
export function isInboxEvent(event, nwo) {
  const type = event?.type;
  if (typeof type !== "string") return false;
  if (!type.startsWith("external_pr.") && !type.startsWith("external_review.")) return false;
  return event.fields?.repo === nwo;
}

/**
 * The review state of one external PR:
 *
 * - `stale`: a draft exists, and the PR moved after it was drafted;
 * - `draft ready`: a draft exists;
 * - `drafting`: a review agent was started (`startedAt`, the server's time on
 *   `external_review.started`, or `Infinity` between the click and that event)
 *   and has written no draft since;
 * - `none`: neither.
 *
 * `sent` is the state a review posted to GitHub takes; ringo records no such
 * thing yet, so nothing here answers it.
 */
export function reviewState(pr, draft, startedAt) {
  const drafted = draft ? Date.parse(draft.draftedAt) : NaN;
  if (startedAt != null && !(drafted >= startedAt)) return "drafting";
  if (Number.isNaN(drafted)) return "none";
  return Date.parse(pr.lastActivityAt) > drafted ? "stale" : "draft ready";
}

/** The PRs of `nwo`, newest activity first, as ringo already orders them. */
export function prsOf(list, nwo) {
  return (Array.isArray(list) ? list : []).filter((pr) => pr && pr.repo === nwo);
}

function csrfHeaders() {
  const meta = document.querySelector('meta[name="csrf-token"]');
  return meta ? { "X-CSRF-Token": meta.content } : {};
}

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, attrs);
  node.append(...children);
  return node;
}

function boot(root) {
  const { repo, read, control, socket } = root.dataset;
  const list = root.querySelector(".external-list");
  // Per PR number, kept across redraws: when its review was started (server
  // time), why its last start failed, and the focus note being typed.
  const started = new Map();
  const failed = new Map();
  const notes = new Map();
  let seen = 0;

  async function draftOf(pr) {
    try {
      const response = await fetch(`${read}/external-review?repo=${encodeURIComponent(repo)}&pr=${pr.pr}`, { cache: "no-store" });
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  }

  async function start(pr, button) {
    button.disabled = true;
    failed.delete(pr.pr);
    try {
      const response = await fetch(`${control}/external-review/start`, {
        method: "POST",
        headers: { ...csrfHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ repo, pr: pr.pr, focus: (notes.get(pr.pr) ?? "").trim() }),
      });
      if (response.ok) {
        if (!started.has(pr.pr)) started.set(pr.pr, Infinity);
      } else {
        failed.set(pr.pr, (await response.text()).trim() || response.statusText);
      }
    } catch (error) {
      failed.set(pr.pr, error.message);
    }
    await draw();
  }

  function row(pr, state) {
    const focus = el("input", { type: "text", placeholder: "Focus (optional)", className: "external-focus", value: notes.get(pr.pr) ?? "" });
    focus.dataset.pr = String(pr.pr);
    focus.addEventListener("input", () => notes.set(pr.pr, focus.value));
    const button = el("button", { type: "button", className: "btn", textContent: "Draft review" });
    button.disabled = state === "drafting";
    button.addEventListener("click", () => start(pr, button));
    const error = failed.has(pr.pr) ? [el("div", { className: "row-meta external-error", textContent: `Could not start: ${failed.get(pr.pr)}` })] : [];
    return el(
      "div",
      { className: "item-row" },
      el(
        "span",
        { className: "row-main" },
        el(
          "span",
          { className: "titleline" },
          el("a", { className: "row-title", href: `https://github.com/${repo}/pull/${pr.pr}`, textContent: `#${pr.pr} ${pr.title ?? ""}` }),
          el("span", { className: "tag", textContent: "External" }),
          el("span", { className: "tag prog", textContent: state }),
        ),
        el(
          "div",
          { className: "row-meta" },
          `by ${pr.author || "?"}` +
            (pr.openedAt ? ` · opened ${timeAgo(Date.parse(pr.openedAt))}` : "") +
            ` · ${pr.lastAction || "activity"} by ${pr.lastActor || "?"} ${timeAgo(Date.parse(pr.lastActivityAt))}`,
        ),
        el("div", { className: "external-actions" }, focus, button),
        ...error,
      ),
    );
  }

  async function draw() {
    try {
      const response = await fetch(`${read}/external-prs`, { cache: "no-store" });
      if (!response.ok) throw new Error(response.status + " " + (await response.text()).trim());
      const prs = prsOf(await response.json(), repo);
      const drafts = await Promise.all(prs.map(draftOf));
      const active = document.activeElement?.classList?.contains("external-focus") ? document.activeElement : null;
      const caret = active ? [active.dataset.pr, active.selectionStart, active.selectionEnd] : null;
      root.hidden = prs.length === 0;
      list.replaceChildren(...prs.map((pr, i) => row(pr, reviewState(pr, drafts[i], started.get(pr.pr)))));
      const again = caret && list.querySelector(`.external-focus[data-pr="${caret[0]}"]`);
      if (again) {
        again.focus();
        again.setSelectionRange(caret[1], caret[2]);
      }
    } catch (error) {
      root.hidden = false;
      list.replaceChildren(el("div", { className: "empty", textContent: `External PRs unreadable: ${error.message}` }));
    }
  }

  function connect() {
    const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(scheme + "//" + window.location.host + socket);
    ws.onmessage = (message) => {
      const data = JSON.parse(message.data);
      const events = (Array.isArray(data) ? [] : data.events || []).filter((event) => isInboxEvent(event, repo));
      for (const event of events) {
        if (event.type === "external_review.started") started.set(event.fields.pr, Date.parse(event.at));
      }
      const latest = Math.max(0, ...events.map((event) => Date.parse(event.at) || 0));
      // The ring replays on connect, so the first frame can carry a start
      // the initial draw did not know about: it redraws too.
      if (latest > seen) {
        seen = latest;
        draw().catch(() => {});
      }
    };
    ws.onclose = () => setTimeout(connect, 5000);
  }

  draw().catch(() => {});
  connect();
}

if (typeof document !== "undefined") {
  const root = document.getElementById("externalPrs");
  if (root) boot(root);
}
