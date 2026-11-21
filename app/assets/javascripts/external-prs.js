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

/** Whether an envelope event is one the inbox redraws on. */
export function isInboxEvent(event) {
  return typeof event?.type === "string" && /^external_(pr|review)\./.test(event.type);
}

/**
 * The review state of one external PR:
 *
 * - `stale`: a draft exists, and the PR moved after it was drafted;
 * - `draft ready`: a draft exists;
 * - `drafting`: a review agent was started and has written no draft since;
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
  const started = new Map();
  let seen = 0;

  async function draftOf(pr) {
    const response = await fetch(`${read}/external-review?repo=${encodeURIComponent(repo)}&pr=${pr.pr}`, { cache: "no-store" });
    return response.ok ? response.json() : null;
  }

  async function start(pr, focus, button) {
    button.disabled = true;
    const response = await fetch(`${control}/external-review/start`, {
      method: "POST",
      headers: { ...csrfHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ repo, pr: pr.pr, focus }),
    });
    if (response.ok) started.set(pr.pr, Date.now());
    else button.title = (await response.text()).trim() || response.statusText;
    await draw();
  }

  function row(pr, state) {
    const focus = el("input", { type: "text", placeholder: "Focus (optional)", className: "external-focus" });
    const button = el("button", { type: "button", className: "btn", textContent: "Draft review" });
    button.disabled = state === "drafting";
    button.addEventListener("click", () => start(pr, focus.value.trim(), button));
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
      ),
      el("span", { className: "row-actions" }, focus, button),
    );
  }

  async function draw() {
    try {
      const response = await fetch(`${read}/external-prs`, { cache: "no-store" });
      if (!response.ok) throw new Error(response.status + " " + (await response.text()).trim());
      const prs = prsOf(await response.json(), repo);
      const drafts = await Promise.all(prs.map(draftOf));
      root.hidden = prs.length === 0;
      list.replaceChildren(...prs.map((pr, i) => row(pr, reviewState(pr, drafts[i], started.get(pr.pr)))));
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
      const events = (Array.isArray(data) ? [] : data.events || []).filter(isInboxEvent);
      for (const event of events) {
        if (event.type === "external_review.started" && event.fields?.repo === repo) {
          started.set(event.fields.pr, Date.parse(event.at));
        }
      }
      const latest = Math.max(0, ...events.map((event) => Date.parse(event.at) || 0));
      if (latest > seen) {
        const first = seen === 0;
        seen = latest;
        if (!first) draw().catch(() => {});
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
