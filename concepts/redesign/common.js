// Shared render helpers for the concepts. `?open=<id>` expands a session.
{
  const th = new URLSearchParams(location.search).get("theme");
  const sys = matchMedia("(prefers-color-scheme: dark)");
  const apply = () => { document.documentElement.dataset.theme = th === "dark" || th === "light" ? th : sys.matches ? "dark" : "light"; };
  apply();
  sys.addEventListener("change", apply);
}
window.openId = new URLSearchParams(location.search).get("open");
window.stageIdx = (k) => STAGES.findIndex((s) => s.key === k);
window.stageOf = (k) => STAGES[stageIdx(k)];

window.topbar = (active = "Dashboard") => `
  <header class="topbar">
    <div class="brand"><span class="brand-mark"></span>trailmap</div>
    <nav class="nav">${["Dashboard", "Stories", "Parity", "Deploys", "Panes"].map((n) => `<a href="#" class="${n === active ? "on" : ""}">${n}</a>`).join("")}</nav>
    <div class="spacer"></div>
    <div class="search"><span>Search sessions, stories, PRs…</span><span class="kbd">⌘K</span></div>
    <button class="search-btn" aria-label="Search"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg></button>
    <div class="avatar">DM</div>
  </header>`;

window.stageChip = (k) => `<span class="chip stage stage-${k}"><span class="dot"></span>${stageOf(k).label}</span>`;
window.prState = (s) => (s.stage === "merged" ? "merged" : s.stage === "ready" ? "open" : "draft");
window.prLink = (s) => (s.pr ? `<a class="mono" href="#">${s.repo}#${s.pr}</a>` : `<span class="mono muted">no PR yet</span>`);

const _svg = (d) => `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
window.STAGE_ICONS = {
  drafting: _svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  self: _svg('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>'),
  ringo: _svg('<path d="M4 8h12l-3-3M20 16H8l3 3"/>'),
  ci: _svg('<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>'),
  ready: _svg('<path d="M5 21V4h12l-2.5 4 2.5 4H5"/>'),
  merged: _svg('<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 7v10M6 8c0 3 5 4 10 4"/>'),
};
window.stageHeader = () => `<ol class="stepper header">${STAGES.map((s) => `<li class="step stage-${s.key}"><span class="node">${STAGE_ICONS[s.key]}</span><span class="hl">${s.label}</span></li>`).join("")}</ol>`;
// At Reviewer convergence the line branches into a loop: the agent on top, the
// reviewer below, the one whose turn it is filled in, with what each is doing.
window.reviewLoop = (r) => {
  const sat = (who, y, letter) => `<g class="sat ${r.turn === who ? "on" : ""}"><circle cx="24" cy="${y}" r="7"/><text x="24" y="${y + 3}" text-anchor="middle">${letter}</text></g>`;
  const lbl = (who, pos, name, text) => `<span class="rv-lbl ${pos} ${r.turn === who ? "on" : ""}"><b>${name}</b> ${text}</span>`;
  return `<span class="rv" role="img" aria-label="Review round ${r.round}. Agent: ${r.agent}. Reviewer: ${r.reviewer}.">
    ${lbl("agent", "top", "Agent", r.agent)}
    <svg viewBox="0 0 48 48" width="62" height="62" aria-hidden="true">
      <circle class="ring" cx="24" cy="24" r="17"/>
      <circle class="run ${r.turn}" cx="24" cy="24" r="17"/>
      <path class="dir" d="M5.2 21.5 7 26l2.6-4.1M42.8 26.5 41 22l-2.6 4.1"/>
      ${sat("agent", 7, "A")}${sat("reviewer", 41, "R")}
      <text class="round" x="24" y="27.5" text-anchor="middle">${r.round}</text>
    </svg>
    ${lbl("reviewer", "bottom", "Reviewer", r.reviewer)}
  </span>`;
};
window.stepper = (k, session) => {
  const cur = stageIdx(k);
  return `<ol class="stepper" aria-label="Stage: ${stageOf(k).label}">${STAGES.map((s, i) => {
    const st = i < cur ? "done" : i === cur ? "now" : "todo";
    return `<li class="step ${st} stage-${s.key}">${st === "now" && s.key === "ringo" && session && session.review ? reviewLoop(session.review) : `<span class="node" title="${s.label}">${STAGE_ICONS[s.key]}</span>`}<span class="lbl">${s.label}</span></li>`;
  }).join("")}</ol>`;
};

window.renderLog = (s) => `<div class="log">${logFor(s).map((r) => {
  const ic = { sys: "•", tool: "›", say: "C", user: "D", warn: "!", transition: "→" }[r.k];
  const body = r.tool ? `<span class="tool-call">${r.tool}</span>${r.ok ? ` <span class="chip" style="color:var(--forest)">${r.ok}</span>` : ""}` : r.text;
  return `<div class="log-row ${r.k} ${r.stage ? "stage-" + r.stage : ""}"><time>${r.t}</time><span class="ic">${ic}</span><div>${body}</div></div>`;
}).join("")}${s.stage === "merged" ? "" : `<div class="log-row sys"><time>now</time><span class="ic">•</span><div class="muted"><i>${s.idle ? `idle for ${s.idle}` : "working…"}</i></div></div>`}</div>`;

window.renderComposer = (s) => s.stage === "merged" ? "" : `
  <div class="composer">
    <textarea aria-label="Message this session" placeholder="Message ${s.story}…  (⌘↵ to send)"></textarea>
    <button class="btn primary">Send</button>
  </div>`;

