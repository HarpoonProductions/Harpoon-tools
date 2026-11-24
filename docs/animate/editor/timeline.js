// Harpoon Animate editor — timeline strip: one row per layer, a bar from delay to delay + duration.
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
  ruler.append(rt); rows.push(ruler);

  api.scene.elements.forEach((e) => {
    const a = e.animate;
    const selected = api.sel.kind === "element" && api.sel.id === e.id;
    const label = h("button", { type: "button", class: "tl-label", "aria-current": selected ? "true" : null, onclick: () => api.choose({ kind: "element", id: e.id }) }, e.id);
    const track = h("div", { class: "tl-track" });
    if (a?.name) {
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
}

function startDrag(ev) {
  const bar = ev.target.closest("[data-part]"); if (!bar) return;
  const id = bar.dataset.id, part = bar.dataset.part;
  const e = api.scene.elements.find((x) => x.id === id); if (!e?.animate) return;
  ev.preventDefault();
  if (!(api.sel.kind === "element" && api.sel.id === id)) api.choose({ kind: "element", id });
  const track = bar.closest(".tl-track") || $("#timeline .tl-track");
  const width = track.getBoundingClientRect().width;
  frozenTotal = totalTime();
  const pps = width / frozenTotal;
  const x0 = ev.clientX, d0 = e.animate.delay || 0, du0 = e.animate.duration ?? 1;
  const key = "g:t" + ++gestureId;
  const host = $("#timeline");
  host.setPointerCapture(ev.pointerId);
  const snap = (v, free) => (free ? Math.round(v * 1000) / 1000 : Math.round(v / STEP) * STEP);
  const move = (m) => {
    const el = api.scene.elements.find((x) => x.id === id); if (!el?.animate) return;
    const dt = (m.clientX - x0) / pps;
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
  $("#timeline").addEventListener("pointerdown", (ev) => { if (ev.button === 0) startDrag(ev); });
}
