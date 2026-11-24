// Harpoon Animate editor — on-canvas editing: selection box, move / resize / rotate handles, snapping guides.
// Works in canvas units. In Phone view (with a phone layout) it edits the element's phone overrides (e.m).

let api = null;
const SNAP_PX = 6;          // snap distance on screen
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const DIR = { nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0] };
let gestureId = 0;
let dragging = false;
let hidden = false;

const $ = (s, r = document) => r.querySelector(s);

export function phoneMode() { return api.view === "phone" && !!api.scene.mobile; }

// Effective box of an element in the units of the canvas being edited
export function boxOf(e) {
  const s = api.scene, W = s.canvas.width, H = s.canvas.height;
  if (phoneMode()) {
    const M = s.mobile, m = e.m || {};
    return { x: m.x ?? e.x * M.width / W, y: m.y ?? e.y * M.height / H, w: m.w ?? e.w * M.width / W, h: m.h ?? e.h * M.height / H,
      r: e.rotate || 0, cw: M.width, ch: M.height, hidden: !!m.hidden };
  }
  return { x: e.x, y: e.y, w: e.w, h: e.h, r: e.rotate || 0, cw: W, ch: H, hidden: false };
}
function setBox(e, b) {
  const r = (n) => Math.round(n * 10) / 10;
  if (phoneMode()) e.m = { ...(e.m || {}), x: r(b.x), y: r(b.y), w: r(Math.max(1, b.w)), h: r(Math.max(1, b.h)) };
  else { e.x = r(b.x); e.y = r(b.y); e.w = r(Math.max(1, b.w)); e.h = r(Math.max(1, b.h)); }
}
// Axis-aligned bounds of a (possibly rotated) box
function aabb(b) {
  const a = (b.r || 0) * Math.PI / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const w = b.w * c + b.h * s, h = b.w * s + b.h * c, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  return { l: cx - w / 2, r: cx + w / 2, t: cy - h / 2, b: cy + h / 2, cx, cy };
}

function geometry() {
  const sceneEl = $("#preview .ha-scene"), host = $("#stageInner");
  if (!sceneEl || !host) return null;
  const sr = sceneEl.getBoundingClientRect(), hr = host.getBoundingClientRect();
  const e = selected();
  const cw = phoneMode() ? api.scene.mobile.width : api.scene.canvas.width;
  const ch = phoneMode() ? api.scene.mobile.height : api.scene.canvas.height;
  return { left: sr.left - hr.left, top: sr.top - hr.top, width: sr.width, height: sr.height, sx: sr.width / cw, sy: sr.height / ch, sr, e };
}
function selected() { return api.sel.kind === "element" ? api.scene.elements.find((x) => x.id === api.sel.id) : null; }

// ---------------------------------------------------------------- drawing
export function drawOverlay(guides = []) {
  const ov = $("#overlay");
  if (!ov || !api?.scene) return; // scene not loaded yet
  const g = geometry();
  if (!g || hidden) { ov.replaceChildren(); return; }
  Object.assign(ov.style, { left: g.left + "px", top: g.top + "px", width: g.width + "px", height: g.height + "px" });
  const kids = [];
  guides.forEach((gd) => {
    const d = document.createElement("div");
    d.className = "guide " + gd.axis;
    if (gd.axis === "v") d.style.left = gd.at * g.sx + "px"; else d.style.top = gd.at * g.sy + "px";
    kids.push(d);
  });
  if (g.e) {
    const b = boxOf(g.e);
    if (!b.hidden) {
      const box = document.createElement("div");
      box.className = "sel-box";
      box.dataset.handle = "move";
      Object.assign(box.style, { left: b.x * g.sx + "px", top: b.y * g.sy + "px", width: b.w * g.sx + "px", height: b.h * g.sy + "px", rotate: b.r + "deg" });
      HANDLES.forEach((hd) => {
        const h = document.createElement("div");
        h.className = "handle h-" + hd; h.dataset.handle = hd; h.title = "Drag to resize (Shift keeps proportions, Alt from the centre)";
        box.append(h);
      });
      const rot = document.createElement("div");
      rot.className = "handle h-rot"; rot.dataset.handle = "rotate"; rot.title = "Drag to rotate (Shift snaps to 15°)";
      box.append(rot);
      const tag = document.createElement("div");
      tag.className = "sel-size";
      tag.textContent = dragging ? `${Math.round(b.x)}, ${Math.round(b.y)} · ${Math.round(b.w)} × ${Math.round(b.h)}${b.r ? ` · ${Math.round(b.r)}°` : ""}` : `${Math.round(b.w)} × ${Math.round(b.h)}`;
      box.append(tag);
      kids.push(box);
      if (!dragging) {
        // stacking buttons beside the box (kept upright, whatever the rotation)
        const a = aabb(b), n = api.scene.elements.length, p = api.stackPos(g.e.id);
        const tools = document.createElement("div");
        tools.className = "sel-tools";
        Object.assign(tools.style, { left: a.r * g.sx + 10 + "px", top: a.t * g.sy + "px" });
        [["front", "⇈", "Bring to front (⇧⌘])", p === n], ["forward", "↑", "Bring forward (⌘])", p === n],
          ["backward", "↓", "Send backward (⌘[)", p === 1], ["back", "⇊", "Send to back (⇧⌘[)", p === 1]].forEach(([cmd, label, title, off]) => {
          const bt = document.createElement("button");
          bt.type = "button"; bt.dataset.stack = cmd; bt.textContent = label; bt.title = title; bt.setAttribute("aria-label", title); bt.disabled = off;
          tools.append(bt);
        });
        kids.push(tools);
      }
    }
  }
  ov.replaceChildren(...kids);
}
export function setOverlayHidden(v) { hidden = v; drawOverlay(); }

// ---------------------------------------------------------------- snapping
function snapTargets(exceptId, cw, ch) {
  const xs = [0, cw / 2, cw], ys = [0, ch / 2, ch];
  api.scene.elements.forEach((o) => {
    if (o.id === exceptId) return;
    const b = boxOf(o); if (b.hidden) return;
    const a = aabb(b);
    xs.push(a.l, a.cx, a.r); ys.push(a.t, a.cy, a.b);
  });
  return { xs, ys };
}
function nearest(values, targets, thr) {
  let best = null;
  values.forEach((v) => targets.forEach((t) => { const d = t - v; if (Math.abs(d) <= thr && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t }; }));
  return best;
}

// ---------------------------------------------------------------- gestures
function startGesture(kind, ev, e, wasSelected) {
  const g = geometry(); if (!g) return;
  const b0 = boxOf(e);
  const start = { x: ev.clientX, y: ev.clientY };
  const key = "g:" + ++gestureId;
  const stage = $("#stageInner");
  let moved = false;
  stage.setPointerCapture(ev.pointerId);
  const centre = { x: g.sr.left + (b0.x + b0.w / 2) * g.sx, y: g.sr.top + (b0.y + b0.h / 2) * g.sy };
  const startAngle = Math.atan2(ev.clientY - centre.y, ev.clientX - centre.x) * 180 / Math.PI;
  const thrX = SNAP_PX / g.sx, thrY = SNAP_PX / g.sy;
  const targets = snapTargets(e.id, b0.cw, b0.ch);

  const onMove = (m) => {
    const dx = (m.clientX - start.x) / g.sx, dy = (m.clientY - start.y) / g.sy;
    if (!moved && Math.hypot(m.clientX - start.x, m.clientY - start.y) < 3) return;
    if (!moved) { moved = true; dragging = true; }
    const el = api.scene.elements.find((x) => x.id === e.id); if (!el) return;
    let guides = [];
    if (kind === "move") {
      const nb = { ...b0, x: b0.x + dx, y: b0.y + dy };
      if (!m.altKey) {
        const a = aabb(nb);
        const sx = nearest([a.l, a.cx, a.r], targets.xs, thrX), sy = nearest([a.t, a.cy, a.b], targets.ys, thrY);
        if (sx) { nb.x += sx.d; guides.push({ axis: "v", at: sx.at }); }
        if (sy) { nb.y += sy.d; guides.push({ axis: "h", at: sy.at }); }
      }
      setBox(el, nb);
    } else if (kind === "rotate") {
      let ang = Math.atan2(m.clientY - centre.y, m.clientX - centre.x) * 180 / Math.PI - startAngle + b0.r;
      if (m.shiftKey) ang = Math.round(ang / 15) * 15;
      ang = ((Math.round(ang) % 360) + 540) % 360 - 180;
      if (ang === 0) delete el.rotate; else el.rotate = ang;
    } else {
      const [hx, hy] = DIR[kind];
      const a = b0.r * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
      // pointer movement in the element's own (rotated) axes
      let lx = dx * cos + dy * sin, ly = -dx * sin + dy * cos;
      const fromCentre = m.altKey ? 2 : 1;
      let w = b0.w + hx * lx * fromCentre, h = b0.h + hy * ly * fromCentre;
      if (m.shiftKey && hx && hy) { const k = Math.max(w / b0.w, h / b0.h); w = b0.w * k; h = b0.h * k; }
      w = Math.max(1, w); h = Math.max(1, h);
      let cx = b0.x + b0.w / 2, cy = b0.y + b0.h / 2;
      if (!m.altKey) {
        const ox = hx * (w - b0.w) / 2, oy = hy * (h - b0.h) / 2;
        cx += ox * cos - oy * sin; cy += ox * sin + oy * cos;
      }
      const nb = { ...b0, x: cx - w / 2, y: cy - h / 2, w, h };
      if (!b0.r && !m.altKey && !m.shiftKey) {
        // snap the edges being dragged
        if (hx) { const edge = hx < 0 ? nb.x : nb.x + nb.w; const s = nearest([edge], targets.xs, thrX);
          if (s) { if (hx < 0) { nb.x += s.d; nb.w -= s.d; } else nb.w += s.d; guides.push({ axis: "v", at: s.at }); } }
        if (hy) { const edge = hy < 0 ? nb.y : nb.y + nb.h; const s = nearest([edge], targets.ys, thrY);
          if (s) { if (hy < 0) { nb.y += s.d; nb.h -= s.d; } else nb.h += s.d; guides.push({ axis: "h", at: s.at }); } }
      }
      setBox(el, nb);
    }
    api.commit(key);
    drawOverlay(guides);
  };
  const onUp = () => {
    stage.removeEventListener("pointermove", onMove);
    stage.removeEventListener("pointerup", onUp);
    stage.removeEventListener("pointercancel", onUp);
    dragging = false;
    if (!moved && kind === "move" && wasSelected) cycleUnder(start);
    else { api.renderProps(); drawOverlay(); }
  };
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
}

// Clicking again on the selected layer picks the next layer underneath (e.g. text under a panel)
function cycleUnder(pt) {
  const ov = $("#overlay"); ov.style.pointerEvents = "none";
  const prev = ov.style.visibility; ov.style.visibility = "hidden";
  const stack = document.elementsFromPoint(pt.x, pt.y).filter((n) => n.closest && n.closest("#preview") && n.classList.contains("ha-el"));
  ov.style.visibility = prev; ov.style.pointerEvents = "";
  const ids = stack.map((n) => elementIdFromNode(n)).filter(Boolean);
  if (ids.length < 2) return;
  const i = ids.indexOf(api.sel.id);
  api.choose({ kind: "element", id: ids[(i + 1) % ids.length] });
}
function elementIdFromNode(n) {
  const c = [...n.classList].find((k) => k.startsWith("ha-e-")); if (!c) return null;
  const s = c.slice(5);
  const e = api.scene.elements.find((x) => api.slug(x.id) === s); return e ? e.id : null;
}

export function initCanvas(a) {
  api = a;
  const stage = $("#stageInner");
  stage.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    const st = ev.target.closest("[data-stack]");
    if (st) { ev.preventDefault(); if (!st.disabled) api.stack(st.dataset.stack); return; }
    const handle = ev.target.closest("[data-handle]");
    const cur = selected();
    if (handle && cur) { ev.preventDefault(); return startGesture(handle.dataset.handle, ev, cur, true); }
    const node = ev.target.closest("#preview .ha-el");
    if (node) {
      const id = elementIdFromNode(node); if (!id) return;
      ev.preventDefault();
      const was = api.sel.kind === "element" && api.sel.id === id;
      if (!was) api.choose({ kind: "element", id });
      return startGesture("move", ev, api.scene.elements.find((x) => x.id === id), was);
    }
    if (ev.target.closest("#preview")) api.choose({ kind: "scene" });
  });
  new ResizeObserver(() => drawOverlay()).observe($("#preview"));
  addEventListener("resize", () => drawOverlay());
}
