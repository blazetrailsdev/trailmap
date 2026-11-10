// Shared render helpers for the concepts. `?open=<id>` expands a session.
window.openId = new URLSearchParams(location.search).get("open");
window.stageIdx = (k) => STAGES.findIndex((s) => s.key === k);
window.stageOf = (k) => STAGES[stageIdx(k)];

window.topbar = (active = "Fleet") => `
  <header class="topbar">
    <div class="brand"><span class="brand-mark"></span>trailmap</div>
    <nav class="nav">${["Fleet", "Stories", "Parity", "Deploys", "Panes"].map((n) => `<a href="#" class="${n === active ? "on" : ""}">${n}</a>`).join("")}</nav>
    <div class="spacer"></div>
    <div class="search">Search sessions, stories, PRs…  ⌘K</div>
    <div class="avatar">DM</div>
  </header>`;

window.stageChip = (k) => `<span class="chip stage stage-${k}"><span class="dot"></span>${stageOf(k).label}</span>`;
window.prLink = (s) => (s.pr ? `<a class="mono" href="#">${s.repo}#${s.pr}</a>` : `<span class="mono muted">no PR yet</span>`);

window.stepper = (k, { compact = false } = {}) => {
  const cur = stageIdx(k);
  return `<ol class="stepper ${compact ? "compact" : ""}">${STAGES.map((s, i) => {
    const st = i < cur ? "done" : i === cur ? "now" : "todo";
    return `<li class="step ${st} stage-${s.key}"><span class="node">${i < cur ? "✓" : i + 1}</span><span class="lbl">${compact ? s.short : s.label}</span></li>`;
  }).join("")}</ol>`;
};

window.renderLog = () => `<div class="log">${LOG.map((r) => {
  const ic = { sys: "•", tool: "›", say: "C", user: "D", warn: "!", transition: "→" }[r.k];
  const body = r.tool ? `<span class="tool-call">${r.tool}</span>${r.ok ? ` <span class="chip" style="color:var(--forest)">${r.ok}</span>` : ""}` : r.text;
  return `<div class="log-row ${r.k} ${r.stage ? "stage-" + r.stage : ""}"><time>${r.t}</time><span class="ic">${ic}</span><div>${body}</div></div>`;
}).join("")}<div class="log-row sys"><time>10:45:02</time><span class="ic">•</span><div class="muted"><i>working…</i></div></div></div>`;

window.renderComposer = (s) => `
  <div class="composer">
    <textarea placeholder="Message this session (${s.branch})…">Also run parity:api:params before pushing.</textarea>
    <button class="btn primary">Send</button>
  </div>
  <div class="hint" style="margin-top:6px">Delivered to the session's pane · ⌘↵ to send · mock only</div>`;

window.stepperCss = `
.stepper { list-style: none; margin: 0; padding: 0; display: flex; align-items: center; }
.step { display: flex; align-items: center; gap: 6px; flex: 1; position: relative; font-size: 12px; color: var(--ink-3); white-space: nowrap; }
.step:not(:last-child)::after { content: ""; flex: 1; height: 2px; margin: 0 8px; background: var(--line); border-radius: 2px; min-width: 10px; }
.step.done:not(:last-child)::after { background: var(--forest); }
.step .node { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 700; background: var(--surface-2); border: 1.5px solid var(--line); color: var(--ink-3); flex: none; }
.step.done .node { background: var(--forest); border-color: var(--forest); color: #fff; }
.step.now .node { background: var(--c); border-color: var(--c); color: #fff; box-shadow: 0 0 0 4px color-mix(in srgb, var(--c) 22%, transparent); }
.step.now .lbl { color: var(--ink); font-weight: 600; }
.step.done .lbl { color: var(--ink-2); }
.stepper.compact .lbl { font-size: 11px; }
`;
