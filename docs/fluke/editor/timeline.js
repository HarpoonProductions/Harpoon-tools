// Fluke editor — timeline strip: one row per layer, a bar from delay to delay + duration.
// Drag a bar to change its delay; drag its right end to change its duration. Snaps to 0.05s (hold Alt for free).

let api = null;
let ANIM = null;
let gestureId = 0;
let playRaf = 0;
const $ = (s, r = document) => r.querySelector(s);
const STEP = 0.05;

function kindOf(name) {
  if (ANIM.out.includes(name)) return "out";
  if (ANIM.attention.includes(name)) return "attn";
  return "in";
}
function totalTime() {
  const ends = api.scene.elements.filter((e) => e.animate?.name).map((e) => (e.animate.delay || 0) + (e.animate.duration ?? 1));
  api.scene.elements.filter((e) => e.type === "group").forEach((g) => { const s = api.groupSpan(g); if (s) ends.push(s.to); });
  return Math.max(1, ...ends) + 0.5;
}
const fmt = (n) => (Math.round(n * 100) / 100).toString().replace(/^0\./, ".") + "s";

let frozenTotal = null; // keep the scale still while dragging
export function renderTimeline() {
  const host = $("#timeline"); if (!host) return;
  const total = frozenTotal ?? totalTime();
  const rows = [];
  // ruler
  const ruler = h("div", { class: "tl-row tl-ruler" }, h("div", { class: "tl-label" }, "Time"));
  const rt = h("div", { class: "tl-track" });
  for (let t = 0; t <= total + 1e-9; t += 0.5) {
    rt.append(h("span", { class: "tl-tick", style: `left:${(t / total) * 100}%` }, t % 1 === 0 ? `${t}s` : ""));
  }
  rt.append(h("div", { class: "tl-playhead", id: "tlPlayhead" }));
  rt.title = "Click or drag along the ruler to see any moment";
  ruler.append(rt); rows.push(ruler);

  api.scene.elements.forEach((e) => {
    const a = e.animate;
    const selected = api.sel.kind === "element" && api.sel.id === e.id;
    const label = h("button", { type: "button", class: "tl-label", "aria-current": selected ? "true" : null, onclick: () => api.choose({ kind: "element", id: e.id }) }, e.id);
    const track = h("div", { class: "tl-track" });
    const span = e.type === "group" ? api.groupSpan(e) : null;
    if (span) {
      // a placed piece: one bar for everything inside it; drag it to change when it starts
      track.append(h("div", { class: "tl-bar k-in group", "data-id": e.id, "data-part": "move",
        style: `left:${(span.from / total) * 100}%;width:${(Math.max(0.05, span.to - span.from) / total) * 100}%`,
        title: `Placed piece: plays ${fmt(span.from)}–${fmt(span.to)} — drag to change when it starts` },
        h("span", { class: "tl-name" }, `placed piece · ${(e.elements || []).length} layers`)));
    } else if (e.type === "group") {
      track.append(h("span", { class: "tl-none" }, "placed piece — nothing inside animates"));
    } else if (a?.name) {
      const d = a.delay || 0, du = a.duration ?? 1;
      const bar = h("div", {
        class: `tl-bar k-${kindOf(a.name)}${a.loop ? " loop" : ""}`, "data-id": e.id, "data-part": "move",
        style: `left:${(d / total) * 100}%;width:${(du / total) * 100}%`,
        title: `${a.name}: starts ${fmt(d)}, lasts ${fmt(du)}${a.loop ? ", loops" : ""} — drag to move, drag the right end to change length`,
      }, h("span", { class: "tl-name" }, a.name + (a.loop ? " ↻" : "")), h("span", { class: "tl-end", "data-id": e.id, "data-part": "end" }));
      track.append(bar);
    } else {
      track.append(h("span", { class: "tl-none" }, "no animation — always visible"));
    }
    rows.push(h("div", { class: `tl-row${selected ? " sel" : ""}` }, label, track));
  });
  if (!api.scene.elements.length) rows.push(h("p", { class: "helper" }, "Add layers to see their timing here."));
  host.replaceChildren(...rows);
  const t = api.getScrub(); if (t != null) showPlayhead(t, total); // keep the scrubbed moment marked after edits
}

function startDrag(ev) {
  const bar = ev.target.closest("[data-part]"); if (!bar) return;
  const id = bar.dataset.id, part = bar.dataset.part;
  const e = api.scene.elements.find((x) => x.id === id); if (!e || (!e.animate && e.type !== "group")) return;
  const isGroup = e.type === "group";
  ev.preventDefault();
  if (!(api.sel.kind === "element" && api.sel.id === id)) api.choose({ kind: "element", id });
  const track = bar.closest(".tl-track") || $("#timeline .tl-track");
  const width = track.getBoundingClientRect().width;
  frozenTotal = totalTime();
  const pps = width / frozenTotal;
  const x0 = ev.clientX, d0 = isGroup ? e.start || 0 : e.animate.delay || 0, du0 = isGroup ? 0 : e.animate.duration ?? 1;
  const key = "g:t" + ++gestureId;
  const host = $("#timeline");
  host.setPointerCapture(ev.pointerId);
  const snap = (v, free) => (free ? Math.round(v * 1000) / 1000 : Math.round(v / STEP) * STEP);
  const move = (m) => {
    const el = api.scene.elements.find((x) => x.id === id); if (!el || (!el.animate && !isGroup)) return;
    const dt = (m.clientX - x0) / pps;
    if (isGroup) { el.start = Math.max(0, +snap(d0 + dt, m.altKey).toFixed(3)); if (!el.start) delete el.start; api.commit(key); return; }
    if (part === "end") el.animate.duration = Math.max(STEP, +snap(du0 + dt, m.altKey).toFixed(3));
    else el.animate.delay = Math.max(0, +snap(d0 + dt, m.altKey).toFixed(3));
    api.commit(key);
  };
  const up = () => {
    host.removeEventListener("pointermove", move); host.removeEventListener("pointerup", up); host.removeEventListener("pointercancel", up);
    frozenTotal = null; renderTimeline(); api.renderProps();
  };
  host.addEventListener("pointermove", move); host.addEventListener("pointerup", up); host.addEventListener("pointercancel", up);
}

// Scrubbing: click or drag along the ruler to freeze the canvas at that moment
function startScrub(ev) {
  const track = $("#timeline .tl-ruler .tl-track"); if (!track) return;
  ev.preventDefault();
  const r = track.getBoundingClientRect(), total = totalTime();
  const host = $("#timeline");
  host.setPointerCapture(ev.pointerId);
  const go = (x) => {
    const t = Math.round(Math.max(0, Math.min(total, ((x - r.left) / r.width) * total)) / STEP) * STEP;
    showPlayhead(t, total); api.scrubTo(+t.toFixed(2));
  };
  go(ev.clientX);
  const move = (m) => go(m.clientX);
  const up = () => { host.removeEventListener("pointermove", move); host.removeEventListener("pointerup", up); host.removeEventListener("pointercancel", up); };
  host.addEventListener("pointermove", move); host.addEventListener("pointerup", up); host.addEventListener("pointercancel", up);
}
export function showPlayhead(t, total = totalTime()) {
  cancelAnimationFrame(playRaf);
  const ph = $("#tlPlayhead"); if (!ph) return;
  ph.style.display = "block"; ph.style.left = `${Math.min(1, t / total) * 100}%`; ph.dataset.t = `${t.toFixed(2)}s`;
}
export function hidePlayhead() { const ph = $("#tlPlayhead"); if (ph) { ph.style.display = "none"; ph.removeAttribute("data-t"); } }

// Moves the playhead across the ruler while the preview plays
export function runPlayhead() {
  cancelAnimationFrame(playRaf);
  const ph = $("#tlPlayhead"); if (!ph) return;
  const total = totalTime(), t0 = performance.now();
  ph.style.display = "block";
  const tick = (now) => {
    const t = (now - t0) / 1000;
    ph.style.left = `${Math.min(1, t / total) * 100}%`;
    if (t < total) playRaf = requestAnimationFrame(tick); else setTimeout(() => { ph.style.display = "none"; }, 400);
  };
  playRaf = requestAnimationFrame(tick);
}

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v);
  }
  kids.flat().forEach((k) => k != null && el.append(k));
  return el;
}

export function initTimeline(a, animations) {
  api = a; ANIM = animations;
  $("#timeline").addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    if (ev.target.closest(".tl-ruler .tl-track")) return startScrub(ev);
    startDrag(ev);
  });
}
