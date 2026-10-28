/*
 * /deploys while a deploy runs: re-read the page every few seconds and swap
 * the history in, as ringo's page polls `/api/deploys` (webhook/deploys_page.go).
 *
 * Present only when `#deploysConfig` is, which the server renders only while
 * a row is `running`. A failed re-read retries; only a history with no
 * running row stops it. A log
 * row left open stays open, and an open log is re-read with its row.
 */
const LIST = ".card.deploys";

/** Fill an opened row's log, once per render. */
async function loadLog(details) {
  const pre = details.querySelector("pre[data-src]");
  if (!pre || pre.dataset.loaded) return;
  pre.dataset.loaded = "1";
  try {
    pre.textContent = await (await fetch(pre.dataset.src, { cache: "no-store" })).text();
  } catch (error) {
    pre.textContent = "(log unreadable: " + error.message + ")";
  }
}

function wire(root) {
  for (const details of root.querySelectorAll("details.deploy-log")) {
    details.addEventListener("toggle", () => details.open && loadLog(details));
  }
}

async function refresh(ms) {
  const again = () => setTimeout(() => refresh(ms), ms);
  const open = new Set([...document.querySelectorAll("details.deploy-log[open]")].map((d) => d.dataset.run));
  let next;
  try {
    const response = await fetch(location.href, { cache: "no-store" });
    if (!response.ok) return again();
    next = new DOMParser().parseFromString(await response.text(), "text/html");
  } catch {
    return again();
  }
  const list = document.querySelector(LIST);
  const fresh = next.querySelector(LIST);
  // No history in the answer (ringo unreachable, or not JSON) says nothing
  // about whether the deploy finished: keep asking. Only a history with no
  // running row stops the loop.
  if (!list || !fresh) return again();
  for (const details of fresh.querySelectorAll("details.deploy-log")) details.open = open.has(details.dataset.run);
  list.replaceWith(fresh);
  wire(fresh);
  for (const details of fresh.querySelectorAll("details.deploy-log[open]")) loadLog(details);
  if (next.getElementById("deploysConfig")) again();
}

wire(document);
const config = document.getElementById("deploysConfig");
if (config) setTimeout(() => refresh(Number(config.dataset.refreshMs)), Number(config.dataset.refreshMs));
