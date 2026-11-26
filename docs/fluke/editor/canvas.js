// Fluke editor — on-canvas editing: selection box, move / resize / rotate handles, snapping guides.
// Works in canvas units. In Phone or Square view (with that layout on) it edits the layer's overrides for it (e.m / e.s).

import { richText } from "./richtext.js?v=a35c7f4";

let api = null;
const SNAP_PX = 6;          // snap distance on screen
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const DIR = { nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0] };
let gestureId = 0;
let dragging = false;
let hidden = false;
let cycleTimer = 0;   // a second click picks the layer underneath — unless it turns out to be a double-click
let editing = null;
let barPlacer = null; // keeps the word-styling toolbar next to the text being edited   // id of the text layer being edited in place
let brushing = null;  // id of the image layer whose brush path is being drawn
let draft = [];       // the brush points being drawn, as fractions of the layer's box

const $ = (s, r = document) => r.querySelector(s);

export function phoneMode() { return !!api.layoutKey(); } // editing a layout other than desktop

// Effective box of an element in the units of the canvas being edited
export function boxOf(e) {
  const s = api.scene, W = s.canvas.width, H = s.canvas.height;
  const lk = api.layoutKey();
  if (lk) {
    const L = api.layoutCanvas(s, lk), m = e[lk] || {};
    if (e.type === "group") { const b = api.groupBoxIn(s, e, lk); return { ...b, r: 0, cw: L.width, ch: L.height, hidden: !!m.hidden }; }
    const f = api.layoutFallback(s, lk, e);
    return { x: m.x ?? f.x, y: m.y ?? f.y, w: m.w ?? f.w, h: m.h ?? f.h, r: e.rotate || 0, cw: L.width, ch: L.height, hidden: !!m.hidden };
  }
  return { x: e.x, y: e.y, w: e.w, h: e.h, r: e.rotate || 0, cw: W, ch: H, hidden: false };
}
function setBox(e, b) {
  const r = (n) => Math.round(n * 10) / 10;
  const lk = api.layoutKey();
  if (lk) e[lk] = { ...(e[lk] || {}), x: r(b.x), y: r(b.y), w: r(Math.max(1, b.w)), h: r(Math.max(1, b.h)) };
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
  const L = api.layoutKey() ? api.layoutCanvas(api.scene, api.layoutKey()) : api.scene.canvas;
  const cw = L.width, ch = L.height;
  return { left: sr.left - hr.left, top: sr.top - hr.top, width: sr.width, height: sr.height, sx: sr.width / cw, sy: sr.height / ch, sr, e };
}
function selected() { return api.sel.kind === "element" ? api.scene.elements.find((x) => x.id === api.sel.id) : null; }

// ---------------------------------------------------------------- drawing
export function drawOverlay(guides = []) {
  const ov = $("#overlay");
  if (!ov || !api?.scene) return; // scene not loaded yet
  const g = geometry();
  if (brushing && (!g?.e || g.e.id !== brushing)) stopBrushDraw();
  if (g && brushing) { Object.assign(ov.style, { left: g.left + "px", top: g.top + "px", width: g.width + "px", height: g.height + "px" }); ov.replaceChildren(...brushOverlay(g)); return; }
  if (!g || hidden || editing) { ov.replaceChildren(); return; }
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
    if (!moved && kind === "move" && wasSelected) { clearTimeout(cycleTimer); cycleTimer = setTimeout(() => cycleUnder(start), 280); }
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
  // a layer inside a placed piece selects the piece
  const g = [...n.classList].find((k) => k.startsWith("ha-g-"));
  if (g) { const ge = api.scene.elements.find((x) => api.slug(x.id) === g.slice(5)); if (ge) return ge.id; }
  const c = [...n.classList].find((k) => k.startsWith("ha-e-")); if (!c) return null;
  const s = c.slice(5);
  const e = api.scene.elements.find((x) => api.slug(x.id) === s); return e ? e.id : null;
}

export function initCanvas(a) {
  api = a;
  const stage = $("#stageInner");
  document.addEventListener("keydown", brushKey, true);
  stage.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    if (brushing) return brushPointerDown(ev);
    if (api.getScrub() != null) api.endScrub(); // back from the scrubbed frame to editing
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
  // double-click a text layer to type straight into it
  stage.addEventListener("dblclick", (ev) => {
    clearTimeout(cycleTimer);
    const nodes = document.elementsFromPoint(ev.clientX, ev.clientY).filter((n) => n.classList?.contains("ha-text") && n.closest("#preview"));
    const under = nodes.map(elementIdFromNode).filter(Boolean);
    const cur = selected(), at = { x: ev.clientX, y: ev.clientY };
    if (cur?.type === "text" && (under.includes(cur.id) || ev.target.closest(".sel-box"))) { ev.preventDefault(); return startTextEdit(cur.id, at); }
    const first = nodes[0]; if (!first) return;
    const inPiece = api.groupTextOf(first); // text inside a placed piece: edit it there, in this copy
    ev.preventDefault();
    startTextEdit(inPiece || elementIdFromNode(first), at);
  });
  new ResizeObserver(() => drawOverlay()).observe($("#preview"));
  addEventListener("resize", () => drawOverlay());
}

// ---------------------------------------------------------------- edit text in place
// A textarea laid exactly over the layer, in the layer's own font, size, spacing, colour and alignment, so it wraps
// the way the piece will. The real text is hidden underneath while you type; each keystroke updates the scene.
// target: a layer id, or { gid, path } for a text layer inside a placed piece
export function startTextEdit(target, at = null) {
  if (editing) finishTextEdit();
  const inPiece = target && typeof target === "object";
  const id = inPiece ? target.gid : target;
  const top = () => api.scene.elements.find((x) => x.id === id);
  const get = inPiece ? () => api.findInGroup(top(), target.path) || {} : () => top() || {};
  if (!top() || get().type !== "text") return;
  if (!(api.sel.kind === "element" && api.sel.id === id)) api.choose({ kind: "element", id });
  const nodeSlug = api.slug(inPiece ? `${id}-${target.path.join("-")}` : id);
  const node = $(`#preview .ha-e-${nodeSlug}`), g = geometry();
  if (!node || !g) return;
  const cs = getComputedStyle(node);
  // where the words sit, in screen pixels from the canvas's corner
  const b = inPiece ? (() => { const r = node.getBoundingClientRect(); return { x: (r.left - g.sr.left) / g.sx, y: (r.top - g.sr.top) / g.sy, w: r.width / g.sx, h: r.height / g.sy, r: 0 }; })() : boxOf(top());
  let layer = $("#editLayer");
  if (!layer) { layer = document.createElement("div"); layer.id = "editLayer"; $("#stageInner").append(layer); }
  Object.assign(layer.style, { left: g.left + "px", top: g.top + "px", width: g.width + "px", height: g.height + "px" });
  const hide = document.createElement("style");
  hide.id = "editHide"; hide.textContent = `#preview .ha-e-${nodeSlug}{visibility:hidden!important}`;
  document.head.append(hide);
  // the words, in the layer's own font, with the word-styling toolbar just above
  const key = "g:text-" + nodeSlug + "-" + ++gestureId;
  // a layer inside a placed piece is measured in that piece's canvas, with that piece's type styles
  const holder = () => (inPiece ? api.findHolder(top(), target.path) : api.scene);
  const rt = richText({ get, label: `Text of ${inPiece ? target.path.join(" › ") : id}`, swatches: api.rtSwatches, fonts: api.rtFonts,
    ...api.rtType(get, (holder()?.canvas || api.scene.canvas).width, () => holder()?.styles), compact: true,
    commit: (typing) => { if (get().type !== "text") return finishTextEdit(); api.commit(typing ? key : undefined); } });
  const ta = rt.box;
  ta.classList.add("text-edit");
  const minH = b.h * g.sy;
  Object.assign(ta.style, {
    left: 0, top: 0, width: "100%", minHeight: minH + "px",
    fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle,
    lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, color: cs.color, textAlign: cs.textAlign,
  });
  const wrap = document.createElement("div");
  wrap.className = "text-edit-wrap";
  Object.assign(wrap.style, { left: b.x * g.sx + "px", top: b.y * g.sy + "px", width: b.w * g.sx + "px", rotate: b.r + "deg" });
  wrap.append(ta);
  // the toolbar floats in the window just above the words (or below, near the top), never cut off by the stage
  const bar = rt.bar; bar.classList.add("text-edit-bar"); document.body.append(bar);
  const placeBar = () => {
    if (!bar.isConnected) return;
    const r = ta.getBoundingClientRect(), bh = bar.offsetHeight, bw = bar.offsetWidth, top0 = 64;
    let y = r.top - bh - 8; if (y < top0) y = Math.min(innerHeight - bh - 8, r.bottom + 8);
    bar.style.top = Math.max(top0, y) + "px"; bar.style.left = Math.max(8, Math.min(innerWidth - bw - 8, r.left)) + "px";
  };
  barPlacer = placeBar;
  const inside = (n) => wrap.contains(n) || bar.contains(n);
  [wrap, bar].forEach((el) => {
    el.addEventListener("keydown", (k) => {
      if (k.key === "Escape" && /^(SELECT|INPUT)$/.test(k.target.tagName)) { k.stopPropagation(); ta.focus(); return; } // closes the menu, not the editing
      if (k.key === "Escape" || (k.key === "Enter" && (k.metaKey || k.ctrlKey))) { k.preventDefault(); k.stopPropagation(); finishTextEdit(); }
    });
    // finish when the focus leaves both the words and their toolbar
    el.addEventListener("focusout", (ev) => { if (!inside(ev.relatedTarget)) setTimeout(() => { if (!inside(document.activeElement)) finishTextEdit(); }, 0); });
  });
  ta.addEventListener("input", placeBar);
  addEventListener("scroll", placeBar, true); addEventListener("resize", placeBar);
  layer.replaceChildren(wrap);
  requestAnimationFrame(placeBar);
  editing = id;
  setOverlayHidden(true);
  if (at) rt.focusAt(at.x, at.y); else rt.focus(true);
}
export function finishTextEdit() {
  if (!editing) return;
  editing = null;
  $("#editHide")?.remove();
  $(".text-edit-bar")?.remove();
  if (barPlacer) { removeEventListener("scroll", barPlacer, true); removeEventListener("resize", barPlacer); barPlacer = null; }
  const layer = $("#editLayer"); if (layer) layer.replaceChildren();
  setOverlayHidden(false);
  api.renderProps();
}
export const isEditingText = () => !!editing;

// ---------------------------------------------------------------- brush path (for the brushIn animation)
// The person clicks points in the order the brush moved. Points are stored as fractions of the layer's box, so the
// path follows the layer when it's moved or resized. A faint band shows how much each part of the path reveals.
const SVGNS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs) => { const n = document.createElementNS(SVGNS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };
export const isBrushing = () => brushing;
export function startBrushDraw(id) {
  const e = api.scene.elements.find((x) => x.id === id);
  if (!e || e.type !== "image") return;
  if (phoneMode()) { api.toast("Draw the brush path in Desktop view — it's used for every layout"); return; }
  if (editing) finishTextEdit();
  brushing = id;
  draft = (e.brush?.points || []).map((p) => [...p]);
  api.renderPreview(); api.renderProps();
}
export function stopBrushDraw() {
  if (!brushing) return;
  brushing = null; draft = [];
  api.renderPreview(); api.renderProps();
}
// The scene is the truth (undo/redo can change it); only a lone first point lives just here, as a path needs two
function syncDraft(e) {
  const pts = e?.brush?.points;
  if (Array.isArray(pts) && pts.length >= 2) draft = pts.map((p) => [...p]);
  else if (draft.length >= 2) draft = [];
}
function saveDraft(key) {
  const e = api.scene.elements.find((x) => x.id === brushing); if (!e) return;
  const r3 = (n) => Math.round(n * 1000) / 1000;
  if (draft.length >= 2) { e.brush = { ...(e.brush || {}), points: draft.map(([x, y]) => [r3(x), r3(y)]) }; }
  else if (e.brush) { delete e.brush.points; if (!Object.keys(e.brush).length) delete e.brush; }
  api.commit(key);
}
function toFraction(ev, g, e) {
  const b = boxOf(e);
  const px = (ev.clientX - g.sr.left) / g.sx, py = (ev.clientY - g.sr.top) / g.sy;
  const a = -(b.r || 0) * Math.PI / 180, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const lx = (px - cx) * Math.cos(a) - (py - cy) * Math.sin(a), ly = (px - cx) * Math.sin(a) + (py - cy) * Math.cos(a);
  const clamp = (n) => Math.max(-0.25, Math.min(1.25, n));
  return [clamp((lx + b.w / 2) / b.w), clamp((ly + b.h / 2) / b.h)];
}
function brushOverlay(g) {
  const e = g.e, b = boxOf(e);
  syncDraft(e);
  const box = document.createElement("div");
  box.className = "brush-box";
  Object.assign(box.style, { left: b.x * g.sx + "px", top: b.y * g.sy + "px", width: b.w * g.sx + "px", height: b.h * g.sy + "px", rotate: b.r + "deg" });
  const svg = svgEl("svg", { viewBox: `0 0 ${b.w} ${b.h}`, preserveAspectRatio: "none", class: "brush-svg" });
  const { width, soft } = api.brushOf({ ...e, brush: { ...(e.brush || {}), points: draft.length >= 2 ? draft : undefined } });
  if (draft.length >= 2) {
    const d = api.brushPathD(draft, b.w, b.h);
    svg.append(svgEl("path", { d, class: "brush-band", "stroke-width": width * b.w }),
      svgEl("path", { d, class: "brush-line" }));
  }
  box.append(svg);
  draft.forEach(([x, y], i) => {
    const pt = document.createElement("div");
    pt.className = "brush-pt" + (i === 0 ? " first" : "");
    pt.dataset.brushPt = i; pt.textContent = i + 1;
    pt.title = i === 0 ? "Start: where the brush first touches. Drag to move" : "Drag to move";
    Object.assign(pt.style, { left: x * 100 + "%", top: y * 100 + "%", rotate: -b.r + "deg" });
    box.append(pt);
  });
  const bar = document.createElement("div");
  bar.className = "brush-tools";
  const btn = (label, act, title) => { const x = document.createElement("button"); x.type = "button"; x.textContent = label; x.dataset.brush = act; x.title = title; return x; };
  const tip = document.createElement("span");
  tip.textContent = draft.length ? `${draft.length} point${draft.length > 1 ? "s" : ""} · click to add the next` : "Click where the brush starts, then along its route";
  bar.append(tip, btn("Undo point", "undo", "Remove the last point (Backspace)"), btn("Clear", "clear", "Start the path again"), btn("Done", "done", "Finish drawing (Enter)"));
  void soft;
  return [box, bar];
}
function brushPointerDown(ev) {
  const g = geometry(); if (!g?.e) return;
  syncDraft(g.e);
  const tool = ev.target.closest("[data-brush]");
  if (tool) {
    ev.preventDefault();
    const act = tool.dataset.brush;
    if (act === "done") return stopBrushDraw();
    if (act === "undo") draft.pop(); else if (act === "clear") draft = [];
    saveDraft("brush-" + ++gestureId); drawOverlay(); return;
  }
  ev.preventDefault();
  const stage = $("#stageInner");
  const ptEl = ev.target.closest("[data-brush-pt]");
  let i;
  if (ptEl) i = +ptEl.dataset.brushPt;
  else { draft.push(toFraction(ev, g, g.e)); i = draft.length - 1; }
  const key = "brush-" + ++gestureId;
  saveDraft(key); drawOverlay();
  stage.setPointerCapture(ev.pointerId);
  const onMove = (m) => { draft[i] = toFraction(m, g, g.e); saveDraft(key); drawOverlay(); };
  const onUp = () => { stage.removeEventListener("pointermove", onMove); stage.removeEventListener("pointerup", onUp); stage.removeEventListener("pointercancel", onUp); api.renderProps(); };
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
}
function brushKey(ev) {
  if (!brushing) return;
  if (ev.target instanceof Element && ev.target.closest("input, textarea, select")) return;
  if (["Escape", "Enter"].includes(ev.key)) { ev.preventDefault(); ev.stopPropagation(); stopBrushDraw(); }
  else if (ev.key === "Backspace" || ev.key === "Delete") { ev.preventDefault(); ev.stopPropagation(); syncDraft(api.scene.elements.find((x) => x.id === brushing)); draft.pop(); saveDraft("brush-" + ++gestureId); drawOverlay(); }
  else if (ev.key.startsWith("Arrow")) { ev.preventDefault(); ev.stopPropagation(); }
}
