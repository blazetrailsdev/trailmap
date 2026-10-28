/*
 * /deploys while a deploy runs: re-read the page every few seconds and swap
 * the history in, as ringo's page polls `/api/deploys` (webhook/deploys_page.go).
 *
 * Present only when `#deploysConfig` is, which the server renders only while
 * a row is `running`; the re-read page decides whether to keep going. A log
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
  const open = new Set([...document.querySelectorAll("details.deploy-log[open]")].map((d) => d.dataset.run));
  let next;
  try {
    next = new DOMParser().parseFromString(await (await fetch(location.href, { cache: "no-store" })).text(), "text/html");
  } catch {
    return setTimeout(() => refresh(ms), ms);
  }
  const list = document.querySelector(LIST);
  const fresh = next.querySelector(LIST);
  if (list && fresh) {
    for (const details of fresh.querySelectorAll("details.deploy-log")) details.open = open.has(details.dataset.run);
    list.replaceWith(fresh);
    wire(fresh);
    for (const details of fresh.querySelectorAll("details.deploy-log[open]")) loadLog(details);
  }
  if (next.getElementById("deploysConfig")) setTimeout(() => refresh(ms), ms);
}

wire(document);
const config = document.getElementById("deploysConfig");
if (config) setTimeout(() => refresh(Number(config.dataset.refreshMs)), Number(config.dataset.refreshMs));
