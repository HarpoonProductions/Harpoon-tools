// Fluke editor v0.3 — forms-based editor for scenes.
import { renderScene, validate, ANIMATIONS, extractScene } from "../src/render.js";
import { importInfogram } from "../src/import-infogram.js";
import { initCanvas, drawOverlay, setOverlayHidden } from "./canvas.js";
import { initTimeline, renderTimeline, runPlayhead, hidePlayhead } from "./timeline.js";
import { loadRegistry, loadKit, kitStyles, loadKitFonts } from "./kits.js";
import { openFontPicker, loadFontList, googleFont } from "./fonts.js";
import { initLibrary, openLibrary, save as saveToLibrary, refreshStatus, forgetRef } from "./library.js";

const DRAFT_KEY = "harpoon-animate-draft-v1";
const LASTKIT_KEY = "harpoon-animate-last-kit";
const PHONE_PREVIEW = 375;
const DESKTOP_MEASURE = 760;

// ---------------------------------------------------------------- helpers
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  kids.flat(Infinity).forEach((k) => k != null && k !== false && el.append(k.nodeType ? k : document.createTextNode(k)));
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "value" || k === "checked" || k === "selected") el[k] = v;
    else el.setAttribute(k, v === true ? (k.startsWith("aria-") ? "true" : "") : v);
  }
  return el;
}
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 1800);
}
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode etc. */ } },
};

// ---------------------------------------------------------------- state
let scene = null;
let sel = { kind: "scene" };
let view = "desktop";
let frame = "layout";
let importNotes = [];
let kit = null, kitId = null; // the loaded client kit for scene.kit
let scrubT = null; // seconds: the moment shown while scrubbing the timeline (null = not scrubbing)
const runtime = { css: "", js: "" };

const blankScene = () => ({
  format: "harpoon-animate/1", id: "new-piece", title: "New piece", root: "div",
  canvas: { width: 1000, height: 543, background: null },
  trigger: { on: "view", threshold: 0.25, replay: true },
  styles: {
    heading: { family: "", source: "story", weight: 600, size: 56, lineHeight: 1.2, color: "#000000" },
    body: { family: "", source: "story", weight: 400, size: 24, lineHeight: 1.35, color: "#000000" },
  },
  elements: [],
});

// ---------------------------------------------------------------- history
let past = [], future = [], current = null, lastKey = null, lastTime = 0;
function commit(key) {
  const snap = JSON.stringify(scene);
  if (snap === current) return;
  const now = Date.now();
  if (!(key && key === lastKey && (key.startsWith("g:") || now - lastTime < 900))) { if (current) past.push(current); if (past.length > 150) past.shift(); }
  current = snap; future = []; lastKey = key; lastTime = now;
  store.set(DRAFT_KEY, snap);
  refresh();
}
function restore(snap) { scene = JSON.parse(snap); current = snap; lastKey = null; store.set(DRAFT_KEY, snap); fixSel(); refreshAll(); }
function undo() { if (!past.length) return; future.push(current); restore(past.pop()); }
function redo() { if (!future.length) return; past.push(current); restore(future.pop()); }
// Replaces the piece being edited (undoable). Anything not opened from the library is a new, unsaved piece there.
function setScene(s, notes = [], { keepLibrary = false } = {}) {
  if (!keepLibrary) forgetRef();
  if (current) past.push(current);
  scene = s; current = JSON.stringify(s); future = []; lastKey = null;
  store.set(DRAFT_KEY, current);
  importNotes = notes; sel = { kind: "scene" };
  refreshAll();
}

const elById = (id) => (scene.elements || []).find((e) => e.id === id);
function fixSel() {
  if (sel.kind === "element" && !elById(sel.id)) sel = { kind: "scene" };
  if (sel.kind === "style" && !(scene.styles || {})[sel.name]) sel = { kind: "scene" };
}
function choose(s) { sel = s; renderLayers(); renderProps(); highlight(); drawOverlay(); renderTimeline(); }

// ---------------------------------------------------------------- refresh
function refresh() { renderLayers(); renderPreview(); renderTimeline(); updateButtons(); refreshStatus(); }
function refreshAll() { refresh(); renderProps(); syncKit(); }
// Load the scene's client kit (from the HSE token sets) when it changes
function syncKit() {
  const id = scene?.kit?.id || null;
  if (id === kitId) return;
  kitId = id; kit = null;
  if (!id) { renderProps(); return; }
  loadKit(id).then((k) => { if (kitId !== id) return; kit = k; loadKitFonts(k); renderProps(); renderPreview(); })
    .catch((e) => toast(`Couldn't load the ${scene.kit.label || id} kit: ${e.message}`));
}
function applyKitStyles(k) {
  scene.styles = { ...(scene.styles || {}), ...kitStyles(k, scene.canvas.width) };
  commit(); renderProps(); toast(`Added ${k.label} type styles`);
}
function updateButtons() { $("#undoBtn").disabled = !past.length; $("#redoBtn").disabled = !future.length; }

// ---------------------------------------------------------------- left panel
const ICON = { text: "T", rect: "▭", ellipse: "◯", line: "╱", image: "▣" };
function renderLayers() {
  $("#sceneBtn").setAttribute("aria-current", sel.kind === "scene");
  const sl = $("#styleList"); sl.replaceChildren();
  Object.entries(scene.styles || {}).forEach(([name, st]) => {
    sl.append(h("div", { class: "row" },
      h("button", { type: "button", class: "row-btn", "aria-current": sel.kind === "style" && sel.name === name, onclick: () => choose({ kind: "style", name }) },
        h("span", { class: "icon" }, "Aa"), h("span", { class: "name" }, name),
        h("span", { class: "tag" }, `${st.size}·${st.weight}`))));
  });
  const ll = $("#layerList"); ll.replaceChildren();
  const els = scene.elements || [];
  if (!els.length) ll.append(h("p", { class: "helper" }, "No layers yet — add one below."));
  els.forEach((e, i) => {
    const out = e.animate && ANIMATIONS.out.includes(e.animate.name);
    ll.append(h("div", { class: "row" },
      h("button", { type: "button", class: "row-btn", "aria-current": sel.kind === "element" && sel.id === e.id, onclick: () => choose({ kind: "element", id: e.id }) },
        h("span", { class: "icon", "aria-hidden": "true" }, ICON[e.type] || "?"),
        h("span", { class: "name" }, e.id),
        h("span", { class: "zbadge", title: `Stacking: ${stackPos(e.id)} of ${els.length} (1 = at the back)` }, String(stackPos(e.id))),
        e.type === "text" ? h("span", { class: "tag" }, e.tag || "p") : null,
        out ? h("span", { class: "tag", title: "Leaves during the animation" }, "out") : null,
        e.m?.hidden ? h("span", { class: "tag", title: "Hidden on phones" }, "no 📱") : null),
      h("button", { type: "button", class: "move", title: "Earlier in reading order", "aria-label": `Move ${e.id} up`, disabled: i === 0, onclick: () => moveLayer(i, -1) }, "↑"),
      h("button", { type: "button", class: "move", title: "Later in reading order", "aria-label": `Move ${e.id} down`, disabled: i === els.length - 1, onclick: () => moveLayer(i, 1) }, "↓")));
  });
}
function moveLayer(i, d) {
  const els = scene.elements; const j = i + d;
  [els[i], els[j]] = [els[j], els[i]];
  // keep how things stack: give every element an explicit z first
  els.forEach((e, k) => { if (e.z == null) e.z = (k === i ? j : k === j ? i : k) + 1; });
  commit();
}
function uniqueId(base) { let id = slug(base), n = 2; while (elById(id)) id = `${slug(base)}-${n++}`; return id; }
function addElement(type) {
  const W = scene.canvas.width, H = scene.canvas.height;
  const firstStyle = Object.keys(scene.styles || {})[0];
  const z = Math.max(0, ...(scene.elements || []).map((e, i) => e.z ?? i + 1)) + 1;
  const base = { x: round(W * 0.1), y: round(H * 0.1), w: round(W * 0.5), h: round(H * 0.2), z };
  const make = {
    text: { id: uniqueId("text"), type: "text", tag: "p", style: firstStyle, text: "New text", ...base, animate: { name: "fadeInUp", delay: 0, duration: 0.8 } },
    rect: { id: uniqueId("box"), type: "rect", fill: "#EEDEFF", ...base, animate: { name: "wipeInLeft", delay: 0, duration: 0.6 } },
    ellipse: { id: uniqueId("circle"), type: "ellipse", fill: "#C9495E", ...base, w: round(H * 0.3), h: round(H * 0.3), animate: { name: "zoomIn", delay: 0, duration: 0.6 } },
    line: { id: uniqueId("line"), type: "line", stroke: "#000000", strokeWidth: 2, ...base, h: 6, animate: { name: "wipeInLeft", delay: 0, duration: 0.6 } },
    image: { id: uniqueId("image"), type: "image", src: "", alt: "", fit: "contain", ...base, animate: { name: "fadeIn", delay: 0, duration: 0.8 } },
  }[type];
  if (!make.style) delete make.style;
  scene.elements = [...(scene.elements || []), make];
  sel = { kind: "element", id: make.id };
  commit(); renderProps();
}

// ---------------------------------------------------------------- preview
function previewHtml(s) {
  try { return renderScene(s, { allowInvalid: true, includeRuntime: false }); }
  catch (e) { return `<p style="color:#b3261e">Can't draw this scene: ${e.message}</p>`; }
}
function renderPreview() {
  const p = $("#preview");
  p.className = `preview ${view === "phone" ? "phone" : ""} f-${frame}`;
  p.innerHTML = previewHtml(scene);
  highlight();
  setOverlayHidden(false);
  if (scrubT != null) applyScrub();
  const M = scene.mobile;
  $("#stageNote").textContent = view === "phone"
    ? (M ? `Phone layout: below ${M.below}px wide the ${M.width}×${M.height} canvas is used. Position fields now edit the phone layout.` : "No phone layout: the desktop design is scaled down. Turn one on in Scene settings.")
    : `Desktop layout: ${scene.canvas.width}×${scene.canvas.height} canvas, scaled to fit the column. Story fonts show here only if installed on this computer.`;
  scheduleMeasure();
}
function highlight() {
  $("#selStyle").textContent = ""; // the selection box (canvas.js) shows what's selected
}
// Scrubbing: every layer paused at the same moment, so the canvas shows exactly that frame of the animation
function applyScrub() {
  const p = $("#preview");
  p.className = `preview ${view === "phone" ? "phone" : ""} f-scrub`;
  p.querySelector(".ha")?.classList.add("ha-run");
  setOverlayHidden(true);
  p.querySelectorAll(".ha-el").forEach((el) => el.getAnimations().forEach((an) => { an.pause(); an.currentTime = scrubT * 1000; }));
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) toast("Your computer has reduced motion on, so animations can't be shown");
}
function scrubTo(t) { scrubT = t; applyScrub(); }
function endScrub() { if (scrubT == null) return; scrubT = null; hidePlayhead(); renderPreview(); }
function play() {
  scrubT = null; hidePlayhead();
  const p = $("#preview");
  p.className = `preview ${view === "phone" ? "phone" : ""}`;
  const piece = p.querySelector(".ha");
  if (!piece) return;
  setOverlayHidden(true);
  runPlayhead();
  if (window.HarpoonAnimate) window.HarpoonAnimate.play(piece);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) toast("Your computer has reduced motion on, so animations are switched off");
}

// ---------------------------------------------------------------- issues (validation + overflow)
let measureTimer = 0;
function scheduleMeasure() { clearTimeout(measureTimer); measureTimer = setTimeout(measure, 150); }
function overflowing(container) {
  return $$(".ha-text", container).filter((n) => n.offsetParent !== null && (n.scrollHeight > n.clientHeight + 2 || n.scrollWidth > n.clientWidth + 2))
    .map((n) => [...n.classList].find((c) => c.startsWith("ha-e-")).slice(5));
}
async function measure() {
  const box = $("#measure");
  const html = previewHtml(scene);
  box.replaceChildren(h("div", { class: "f-layout", style: `width:${DESKTOP_MEASURE}px` }), h("div", { class: "f-layout", style: `width:${PHONE_PREVIEW}px` }));
  box.children[0].innerHTML = html; box.children[1].innerHTML = html;
  try { await document.fonts.ready; } catch { /* old browsers */ }
  const nameOf = (s) => (scene.elements.find((e) => slug(e.id) === s) || {}).id || s;
  const desk = overflowing(box.children[0]).map(nameOf);
  const phone = scene.mobile ? overflowing(box.children[1]).map(nameOf) : [];
  box.replaceChildren();
  renderIssues(desk, phone);
}
function renderIssues(desk = [], phone = []) {
  const { errors, warnings } = validate(scene);
  const list = $("#issues"); list.replaceChildren();
  const row = (cls, label, text, onx) => list.append(h("div", { class: `issue ${cls}` }, h("b", {}, label), h("span", {}, text),
    onx ? h("button", { type: "button", class: "x", "aria-label": "Dismiss", onclick: onx }, "×") : null));
  errors.forEach((e) => row("err", "Fix", e));
  warnings.forEach((w) => row("warn", "Check", w));
  desk.forEach((id) => row("warn", "Check", `“${id}” text overflows its box on desktop — make the box bigger or the text smaller`));
  phone.forEach((id) => row("warn", "Check", `“${id}” text overflows its box on phones — adjust it in the Phone layout`));
  importNotes.forEach((n, i) => row("note", "Import", n, () => { importNotes.splice(i, 1); renderIssues(desk, phone); }));
  if (!list.children.length) row("ok", "Ready", "No problems found.");
  $("#exportBtn").title = errors.length ? "Fix the problems listed under the preview first" : "";
}

// ---------------------------------------------------------------- animation chooser (hover to preview)
// "fadeInRight" → "Fade in right"
const animLabel = (n) => (n ? n.replace(/([A-Z])/g, " $1").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "None");
function setAnimation(name) {
  const e = elById(sel.id); if (!e) return;
  if (!name) delete e.animate; else e.animate = { delay: 0, duration: 0.8, ...(e.animate || {}), name };
  commit(); renderProps();
}
function animField() {
  const cur = elById(sel.id)?.animate?.name || "";
  const btn = h("button", { type: "button", class: "anim-btn", "aria-haspopup": "listbox", "aria-expanded": "false",
    onclick: () => openAnimPicker(btn) }, h("span", {}, animLabel(cur)), h("span", { class: "anim-caret", "aria-hidden": "true" }, "▾"));
  return h("div", { class: "f" }, h("span", { id: "animFieldLabel" }, "Animation"), btn);
}
// Plays one animation on the selected layer, with every other layer held in its finished state
function previewAnimation(name) {
  const e = elById(sel.id); if (!e) return;
  const copy = structuredClone(scene);
  const t = copy.elements.find((x) => x.id === e.id);
  if (!name) delete t.animate; else t.animate = { duration: 0.8, ...(e.animate || {}), name, delay: 0 };
  const p = $("#preview");
  p.className = `preview ${view === "phone" ? "phone" : ""} f-solo`;
  p.innerHTML = previewHtml(copy);
  p.querySelector(`.ha-e-${slug(e.id)}`)?.classList.add("solo");
  p.querySelector(".ha")?.classList.add("ha-run");
  setOverlayHidden(true);
}
let animPop = null;
function closeAnimPicker() {
  if (!animPop) return;
  animPop.remove(); animPop = null;
  document.removeEventListener("pointerdown", onAnimOutside, true);
  document.querySelector(".anim-btn")?.setAttribute("aria-expanded", "false");
  renderPreview();
}
function onAnimOutside(ev) { if (animPop && !animPop.contains(ev.target) && !ev.target.closest(".anim-btn")) closeAnimPicker(); }
function openAnimPicker(anchor) {
  if (animPop) return closeAnimPicker();
  endScrub();
  const cur = elById(sel.id)?.animate?.name || "";
  const opt = (name) => h("button", { type: "button", role: "option", class: `anim-opt${name === cur ? " current" : ""}`, "aria-selected": String(name === cur), "data-name": name,
    onmouseenter: () => previewAnimation(name), onfocus: () => previewAnimation(name),
    onclick: () => { const n = name; closeAnimPicker(); setAnimation(n); } }, animLabel(name));
  const group = (title, names) => h("div", { class: "anim-group" }, h("div", { class: "anim-group__title" }, title), h("div", { class: "anim-grid" }, names.map(opt)));
  animPop = h("div", { class: "anim-pop", role: "listbox", "aria-labelledby": "animFieldLabel" },
    h("p", { class: "anim-hint" }, "Hover (or use the arrow keys) to see it on the layer · click to choose · Esc to cancel"),
    group("Enter", ANIMATIONS.in), group("Leave", ANIMATIONS.out), group("Attention", ANIMATIONS.attention), group("No animation", [""]));
  const pop = animPop;
  pop.addEventListener("keydown", (k) => {
    // keys used here must not also reach the editor (arrow keys there nudge the selected layer)
    if (!["Escape", "ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(k.key)) return;
    k.preventDefault(); k.stopPropagation();
    if (k.key === "Escape") { closeAnimPicker(); anchor.focus(); return; }
    const opts = [...pop.querySelectorAll(".anim-opt")], i = opts.indexOf(document.activeElement);
    const next = k.key === "ArrowDown" || k.key === "ArrowRight" ? Math.min(opts.length - 1, i + 1) : Math.max(0, i - 1);
    opts[next]?.focus();
  });
  animPop.addEventListener("mouseleave", () => { if (animPop) renderPreview(); });
  document.body.append(animPop);
  const r = anchor.getBoundingClientRect(), w = Math.min(560, innerWidth - 24);
  Object.assign(animPop.style, { width: w + "px", left: Math.max(12, Math.min(r.right - w, innerWidth - w - 12)) + "px", top: Math.min(r.bottom + 6, innerHeight - 380) + "px" });
  anchor.setAttribute("aria-expanded", "true");
  document.addEventListener("pointerdown", onAnimOutside, true);
  (animPop.querySelector(".anim-opt.current") || animPop.querySelector(".anim-opt")).focus({ preventScroll: true });
}

// ---------------------------------------------------------------- property fields
// Each field reads and writes obj()[key]; obj is a function so it survives undo (which replaces the scene).
function field(label, control, extra) { return h("label", { class: "f" }, h("span", {}, label), control, extra || null); }
function setVal(getObj, key, v, { optional, cleanup } = {}) {
  const o = getObj();
  if (v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v))) { if (optional) delete o[key]; else return; }
  else o[key] = v;
  if (cleanup) cleanup();
}
function num(label, getObj, key, opts = {}) {
  const v = getObj()[key];
  const inp = h("input", { type: "number", step: opts.step ?? 1, min: opts.min, max: opts.max, value: v ?? "", placeholder: opts.placeholder ?? "" });
  inp.addEventListener("input", () => { setVal(getObj, key, inp.value === "" ? undefined : parseFloat(inp.value), opts); commit(label + key); });
  return field(label, inp);
}
function text(label, getObj, key, opts = {}) {
  const tag = opts.multiline ? "textarea" : "input";
  const inp = h(tag, { type: tag === "input" ? "text" : null, value: getObj()[key] ?? "", placeholder: opts.placeholder ?? "" });
  inp.addEventListener(opts.onChangeOnly ? "change" : "input", () => {
    if (opts.apply) opts.apply(inp.value, inp); else setVal(getObj, key, inp.value, opts);
    commit(label + key);
  });
  return field(label, inp, opts.help ? h("span", { class: "helper" }, opts.help) : null);
}
function select(label, getObj, key, options, opts = {}) {
  const cur = getObj()[key] ?? opts.fallback ?? "";
  const s = h("select", {}, options.map((o) => Array.isArray(o.group)
    ? h("optgroup", { label: o.label }, o.group.map((g) => h("option", { value: g.value ?? g, selected: (g.value ?? g) === cur }, g.label ?? g)))
    : h("option", { value: o.value ?? o, selected: String(o.value ?? o) === String(cur) }, o.label ?? o)));
  s.addEventListener("change", () => {
    const v = opts.number ? parseFloat(s.value) : s.value;
    if (opts.apply) opts.apply(v); else setVal(getObj, key, v, opts);
    commit(); if (opts.rerender) renderProps();
  });
  return field(label, s);
}
function check(label, getObj, key, opts = {}) {
  const c = h("input", { type: "checkbox", checked: opts.invert ? !getObj()[key] : !!getObj()[key] });
  c.addEventListener("change", () => {
    if (opts.apply) opts.apply(c.checked); else { const v = opts.invert ? !c.checked : c.checked; if (!v && opts.optional) delete getObj()[key]; else getObj()[key] = v; }
    commit(); if (opts.rerender) renderProps();
  });
  return h("label", { class: "check" }, c, label);
}
function pieceColours() {
  const seen = new Set();
  const add = (v) => { v = typeof v === "string" ? v.trim() : ""; if (v && v !== "transparent") seen.add(v); };
  Object.values(scene.styles || {}).forEach((st) => add(st.color));
  (scene.elements || []).forEach((e) => { add(e.color); add(e.fill); add(e.stroke); });
  add(scene.canvas?.background);
  return [...seen].slice(0, 18);
}
const linkedToken = (v) => (String(v || "").match(/^var\(--hse-([a-z0-9-]+)\s*,/) || [])[1] || null;
function colour(label, getObj, key, opts = {}) {
  const v = getObj()[key] || "";
  const hex = (String(v).match(/#[0-9a-f]{6}/i) || ["#000000"])[0];
  const pick = h("input", { type: "color", value: hex.toLowerCase(), "aria-label": label + " picker" });
  const t = h("input", { type: "text", value: v, placeholder: opts.placeholder ?? "none" });
  const note = h("span", { class: "linked" });
  const showLink = () => {
    const tok = linkedToken(t.value), sw = tok && kit?.swatches.find((x) => x.token === tok);
    note.textContent = tok ? `🔗 ${sw ? sw.name : tok} from the ${kit?.label || "client"} kit — follows the client's tokens in HSE` : "";
  };
  pick.addEventListener("input", () => { t.value = pick.value.toUpperCase(); setVal(getObj, key, t.value, opts); showLink(); commit(label + key); });
  t.addEventListener("input", () => { const m = t.value.match(/#[0-9a-f]{6}/i); if (m) pick.value = m[0].toLowerCase(); setVal(getObj, key, t.value.trim(), opts); showLink(); commit(label + key); });
  const use = (val) => { t.value = val; const m = val.match(/#[0-9a-f]{6}/i); if (m) pick.value = m[0].toLowerCase(); setVal(getObj, key, val, opts); showLink(); commit(); };
  const swatch = (val, name) => h("button", { type: "button", class: "sw", style: `background:${val}`, title: name, "aria-label": name, onclick: () => use(val) });
  const kitRow = kit ? h("div", { class: "swatches", role: "group", "aria-label": `${kit.label} colours` },
    kit.swatches.map((sw) => swatch(`var(--hse-${sw.token}, ${sw.hex})`, `${sw.name} ${sw.hex}`))) : null;
  // colours already used in this piece (kit colours are in the row above), so a colour picked once can be reused
  const mine = pieceColours().filter((v) => !(kit && linkedToken(v)));
  const pieceRow = mine.length ? h("div", { class: "swatches", role: "group", "aria-label": "Colours in this piece" },
    kitRow ? h("span", { class: "sw-label" }, "In this piece") : null, mine.map((v) => swatch(v, v))) : null;
  showLink();
  // buttons can't sit inside a <label>, so swatches go just after it
  return h("div", { class: "f-group" }, field(label, h("div", { class: "colour" }, pick, t)), kitRow, pieceRow, note);
}
const grid = (n, ...kids) => h("div", { class: n === 3 ? "grid3" : "grid2" }, ...kids);
const section = (title, ...kids) => h("fieldset", {}, h("legend", {}, title), ...kids);

// ---------------------------------------------------------------- right panel
function renderProps() {
  if (animPop) { animPop.remove(); animPop = null; document.removeEventListener("pointerdown", onAnimOutside, true); }
  const p = $("#props"); p.replaceChildren(); p.className = "panel right props";
  if (sel.kind === "style") return p.append(...styleProps(sel.name));
  if (sel.kind === "element" && elById(sel.id)) return p.append(...elementProps(sel.id));
  p.append(...sceneProps());
}

function sceneProps() {
  const S = () => scene, C = () => scene.canvas, T = () => (scene.trigger ||= { on: "view", threshold: 0.25, replay: true });
  const out = [h("p", { class: "title" }, "Scene settings"), h("p", { class: "sub" }, "The whole piece: client kit, size, behaviour and phone layout.")];
  out.push(kitSection());
  out.push(section("Piece",
    text("Title", S, "title"),
    text("Short name (used in the code)", S, "id", { onChangeOnly: true, apply: (v, inp) => { scene.id = slug(v); inp.value = scene.id; } }),
    select("Wrapper element", S, "root", [{ value: "div", label: "div — no special meaning" }, { value: "figure", label: "figure — quote or image with caption" }, { value: "section", label: "section" }, { value: "header", label: "header — e.g. an animated title" }], { fallback: "div" }),
    text("Label for screen readers (optional)", S, "label", { optional: true, placeholder: "e.g. Quote from Cyrus Ardalan" })));
  out.push(section("Canvas",
    grid(2, num("Width", C, "width", { min: 1 }), num("Height", C, "height", { min: 1 })),
    colour("Background", C, "background", { optional: true, placeholder: "transparent" }),
    h("p", { class: "helper" }, "Canvas units, not pixels: the piece scales to the width of the column it sits in.")));
  out.push(section("Animation trigger",
    select("Play", T, "on", [{ value: "view", label: "When scrolled into view" }, { value: "load", label: "As soon as the page loads" }], { rerender: true }),
    T().on === "view" ? grid(2,
      select("When this much is visible", T, "threshold", [0.1, 0.25, 0.5, 0.75].map((v) => ({ value: v, label: `${v * 100}%` })), { number: true }),
      h("div", {}, check("Replay when scrolled back to", T, "replay"))) : h("p", { class: "helper" }, "No script needed: it plays as soon as the browser draws it.")));
  const hasM = !!scene.mobile;
  out.push(section("Phone layout",
    check("Use a separate phone layout", S, "mobile", { apply: (on) => {
      if (on) scene.mobile = { below: 560, width: 375, height: Math.round(scene.canvas.height / scene.canvas.width * 375 * 1.5) };
      else { delete scene.mobile; scene.elements.forEach((e) => delete e.m); }
    }, rerender: true }),
    hasM ? [grid(3, num("Below (px)", () => scene.mobile, "below", { min: 200 }), num("Width", () => scene.mobile, "width", { min: 1 }), num("Height", () => scene.mobile, "height", { min: 1 })),
      h("p", { class: "helper" }, "Switch the preview to Phone to arrange it. Layers you don't move keep their desktop position, scaled."),
      h("div", { class: "actions" }, h("button", { type: "button", class: "secondary mini", onclick: copyDesktopToPhone }, "Copy desktop positions to phone"))]
      : h("p", { class: "helper" }, "Without one, the desktop design is scaled down on phones — fine for big type, too small for long quotes.")));
  return out;
}
function copyDesktopToPhone() {
  const M = scene.mobile, W = scene.canvas.width, H = scene.canvas.height;
  scene.elements.forEach((e) => {
    e.m = { ...(e.m || {}), x: round(e.x * M.width / W), y: round(e.y * M.height / H), w: round(e.w * M.width / W), h: round(e.h * M.height / H) };
    if (e.type === "text") { const st = (scene.styles || {})[e.style] || {}; e.m.size = round((e.size ?? st.size ?? 16) * M.width / W); }
  });
  commit(); toast("Copied — now adjust in Phone view");
}

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => ({ value: w, label: String(w) }));
function styleProps(name) {
  const St = () => scene.styles[name];
  const used = scene.elements.filter((e) => e.style === name).length;
  return [
    h("p", { class: "title" }, `Type style: ${name}`),
    h("p", { class: "sub" }, `How text looks. Used by ${used} layer${used === 1 ? "" : "s"}. What the text is (heading, quote…) is set on each layer.`),
    section("Style",
      text("Name", () => ({ name }), "name", { onChangeOnly: true, apply: (v, inp) => {
        const nn = slug(v); if (!nn || nn === name || scene.styles[nn]) { inp.value = name; return; }
        scene.styles[nn] = scene.styles[name]; delete scene.styles[name];
        scene.elements.forEach((e) => { if (e.style === name) e.style = nn; });
        sel = { kind: "style", name: nn }; setTimeout(renderProps);
      } }),
      fontField(St),
      select("Font comes from", St, "source", [{ value: "story", label: "The story (already loaded)" }, { value: "google", label: "Google Fonts (added automatically)" }], { fallback: "story" }),
      grid(2, select("Weight", St, "weight", weightOptions(St()), { number: true, fallback: 400 }), h("div", {}, h("span", { class: "f" }, " "), check("Italic", St, "italic", { optional: true }))),
      grid(3, num("Size", St, "size", { min: 1, step: 0.5 }), num("Line height", St, "lineHeight", { min: 0.5, step: 0.05 }), num("Spacing (em)", St, "letterSpacing", { step: 0.01, optional: true, placeholder: "0" })),
      colour("Colour", St, "color", { placeholder: "#000000" }),
      text("Fallback fonts", St, "fallback", { optional: true, placeholder: "system-ui, sans-serif" })),
    h("div", { class: "actions" },
      h("button", { type: "button", class: "danger mini", disabled: used > 0, title: used ? "Still used by layers" : "", onclick: () => { delete scene.styles[name]; sel = { kind: "scene" }; commit(); renderProps(); } }, "Delete style")),
  ];
}
function addStyle() {
  let n = 1; while (scene.styles[`style-${n}`]) n++;
  const name = `style-${n}`;
  scene.styles = { ...(scene.styles || {}), [name]: { family: "", source: "story", weight: 400, size: 32, lineHeight: 1.2, color: "#000000" } };
  sel = { kind: "style", name }; commit(); renderProps();
}

const EASINGS = [{ value: "ease", label: "Ease" }, { value: "ease-out", label: "Ease out (gentle stop)" }, { value: "ease-in", label: "Ease in" },
  { value: "ease-in-out", label: "Ease in and out" }, { value: "linear", label: "Linear" }, { value: "cubic-bezier(.34,1.56,.64,1)", label: "Overshoot" }];
const TAGS = [{ value: "h1", label: "H1 — page title" }, { value: "h2", label: "H2 — heading" }, { value: "h3", label: "H3" }, { value: "h4", label: "H4" },
  { value: "p", label: "Paragraph" }, { value: "blockquote", label: "Quote" }, { value: "figcaption", label: "Caption (in a figure)" }, { value: "span", label: "Inline text" },
  { value: "decorative", label: "Decorative — hidden from screen readers" }];

function elementProps(id) {
  const E = () => elById(sel.id) || {};
  const e = E();
  const out = [h("p", { class: "title" }, `${{ text: "Text", rect: "Box", ellipse: "Circle", line: "Line", image: "Image" }[e.type]} layer`)];
  out.push(text("Layer name", E, "id", { onChangeOnly: true, apply: (v, inp) => {
    const nid = slug(v); if (!nid || (nid !== e.id && elById(nid))) { inp.value = e.id; toast("That name is taken"); return; }
    E().id = nid; sel = { kind: "element", id: nid }; inp.value = nid;
  } }));

  if (e.type === "text") {
    const st = (scene.styles || {})[e.style] || {};
    out.push(section("Text",
      text("Text", E, "text", { multiline: true }),
      grid(2, select("What it is", E, "tag", TAGS, { fallback: "p" }), select("Align", E, "align", ["left", "center", "right"], { fallback: "left", optional: true })),
      select("Type style", E, "style", [{ value: "", label: "(none)" }, ...Object.keys(scene.styles || {})], { optional: true, rerender: true }),
      h("p", { class: "helper" }, "Leave these blank to use the type style."),
      grid(3, num("Size", E, "size", { optional: true, step: 0.5, placeholder: st.size ?? "" }),
        select("Weight", E, "weight", [{ value: "", label: st.weight ? `(${st.weight})` : "(style)" }, ...WEIGHTS], { optional: true, number: false, apply: (v) => { if (v === "") delete E().weight; else E().weight = +v; } }),
        num("Line height", E, "lineHeight", { optional: true, step: 0.05, placeholder: st.lineHeight ?? "" })),
      colour("Colour", E, "color", { optional: true, placeholder: st.color || "style colour" })));
  }
  if (e.type === "image") {
    out.push(section("Image",
      h("div", { class: "actions img-actions" },
        h("button", { type: "button", class: "primary mini", onclick: () => openUploader(e.id) }, e.src ? "Replace image…" : "Upload or choose an image…")),
      e.src ? h("img", { class: "img-thumb", src: e.src, alt: "" }) : null,
      text("Image URL", E, "src", { help: "The button opens Harpoon Upload: upload to the harpn bucket, or pick an image already there. You can also paste any image link." }),
      check("Decorative (no alt text needed)", E, "decorative", { optional: true, rerender: true }),
      e.decorative ? null : text("Alt text", E, "alt", { placeholder: "Describe what the image shows" }),
      select("Fit", E, "fit", [{ value: "contain", label: "Whole image" }, { value: "cover", label: "Fill the box (crop)" }], { fallback: "contain" })));
  }
  if (e.type === "rect" || e.type === "ellipse") {
    out.push(section("Look",
      colour("Fill", E, "fill", { optional: true }),
      grid(2, colour("Border", E, "stroke", { optional: true }), num("Border width", E, "strokeWidth", { optional: true, min: 0, placeholder: "0" })),
      e.type === "rect" ? num("Corner radius", E, "radius", { optional: true, min: 0, placeholder: "0" }) : null));
  }
  if (e.type === "line") {
    out.push(section("Look", grid(2, colour("Colour", E, "stroke"), num("Thickness", E, "strokeWidth", { min: 0.5, step: 0.5 })),
      h("p", { class: "helper" }, "Drawn across the box. Rotate 90° for a vertical rule.")));
  }

  // Position: desktop or phone, following the preview toggle
  const phone = view === "phone" && scene.mobile;
  if (phone) {
    const M = () => { const el = E(); return (el.m ||= {}); };
    const tidy = () => { const el = E(); if (el.m && !Object.keys(el.m).length) delete el.m; };
    const M2 = scene.mobile, W = scene.canvas.width, H = scene.canvas.height;
    const ph = (k, total, full) => String(round(e[k] * total / full));
    out.push(section("Position — phone layout",
      h("p", { class: "phone-flag" }, "📱 Editing the phone layout. Blank = keep the desktop position, scaled."),
      check("Hide on phones", M, "hidden", { optional: true, cleanup: tidy, apply: (on) => { if (on) M().hidden = true; else { delete M().hidden; tidy(); } }, rerender: true }),
      e.m?.hidden ? null : [grid(2, num("X", M, "x", { optional: true, cleanup: tidy, placeholder: ph("x", M2.width, W) }), num("Y", M, "y", { optional: true, cleanup: tidy, placeholder: ph("y", M2.height, H) })),
        grid(2, num("Width", M, "w", { optional: true, cleanup: tidy, placeholder: ph("w", M2.width, W) }), num("Height", M, "h", { optional: true, cleanup: tidy, placeholder: ph("h", M2.height, H) })),
        e.type === "text" ? num("Text size on phones", M, "size", { optional: true, cleanup: tidy, step: 0.5 }) : null]));
  } else {
    out.push(section("Position",
      grid(2, num("X", E, "x"), num("Y", E, "y")),
      grid(2, num("Width", E, "w", { min: 0 }), num("Height", E, "h", { min: 0 })),
      grid(2, num("Rotate °", E, "rotate", { optional: true, placeholder: "0" }), num("Opacity", E, "opacity", { optional: true, min: 0, max: 1, step: 0.05, placeholder: "1" })),
      h("p", { class: "helper" }, "Arrow keys nudge the selected layer (Shift = 10).")));
  }
  out.push(stackSection(e.id));

  const A = () => E().animate || {};
  const a = e.animate || {};
  const isFade = /^fade(In|Out)(Up|Down|Left|Right)$/.test(a.name || "");
  out.push(section("Animation",
    animField(),
    a.name ? [grid(2, num("Delay (s)", () => (E().animate ||= {}), "delay", { min: 0, step: 0.1, placeholder: "0" }), num("Duration (s)", () => (E().animate ||= {}), "duration", { min: 0.05, step: 0.1, placeholder: "1" })),
      select("Easing", () => (E().animate ||= {}), "easing", EASINGS, { fallback: "ease", optional: true }),
      isFade ? num("Travel (fraction of its size)", () => (E().animate ||= {}), "distance", { optional: true, min: 0, step: 0.05, placeholder: "0.1" }) : null,
      ANIMATIONS.attention.includes(a.name) ? check("Loop forever", () => (E().animate ||= {}), "loop", { optional: true }) : null] : null));

  out.push(h("div", { class: "actions" },
    h("button", { type: "button", class: "secondary mini", onclick: () => duplicate(e.id) }, "Duplicate"),
    h("button", { type: "button", class: "danger mini", onclick: () => { scene.elements = scene.elements.filter((x) => x.id !== e.id); sel = { kind: "scene" }; commit(); renderProps(); } }, "Delete layer")));
  void A;
  return out;
}
// ---------------------------------------------------------------- images via Harpoon Upload
// The editor opens upload.har.pn in a small window ("pick mode"); the person signs in there as usual, uploads or picks
// an image, and the page posts the URL back. Only messages from the uploader's own origin are accepted.
const UPLOAD_ORIGIN = (() => {
  try { // local testing only: ?upload=http://localhost:3510
    const q = new URLSearchParams(location.search).get("upload");
    if (q && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return new URL(q).origin;
  } catch { /* fall through */ }
  return "https://upload.har.pn";
})();
let pickTarget = null;
function openUploader(id) {
  pickTarget = id;
  const w = window.open(`${UPLOAD_ORIGIN}/?pick=animate&origin=${encodeURIComponent(location.origin)}`, "harpoon-upload", "width=1040,height=800");
  if (!w) toast("Your browser blocked the upload window — allow pop-ups for this page and try again");
}
addEventListener("message", (ev) => {
  if (ev.origin !== UPLOAD_ORIGIN) return;
  const d = ev.data || {};
  if (d.type !== "harpoon-upload:picked" || typeof d.url !== "string") return;
  if (!/^https:\/\//.test(d.url) && !/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(d.url)) return;
  const e = elById(pickTarget);
  if (!e) return toast("That image layer no longer exists");
  const wasEmpty = !e.src;
  e.src = d.url;
  commit(); renderProps();
  toast(`Image added${d.name ? ": " + d.name : ""}${e.alt || e.decorative ? "" : " — now add alt text"}`);
  // a new image layer takes the picture's proportions
  if (wasEmpty) {
    const img = new Image();
    img.onload = () => {
      const el = elById(e.id); if (!el || !img.naturalWidth) return;
      el.h = round(el.w * img.naturalHeight / img.naturalWidth);
      commit(); renderProps(); drawOverlay();
    };
    img.src = d.url;
  }
});

// ---------------------------------------------------------------- client kit + fonts
function kitSection() {
  const pickKit = h("select", { "aria-label": "Client kit" }, h("option", { value: "" }, "No kit"));
  loadRegistry().then((reg) => {
    reg.forEach((t) => pickKit.append(h("option", { value: t.id }, t.label)));
    pickKit.value = scene.kit?.id || "";
  }).catch(() => pickKit.append(h("option", { disabled: true }, "Couldn't load the kits")));
  pickKit.addEventListener("change", async () => {
    const id = pickKit.value;
    if (!id) { delete scene.kit; commit(); syncKit(); return; }
    try {
      const k = await loadKit(id);
      scene.kit = { id: k.id, label: k.label }; store.set(LASTKIT_KEY, k.id);
      commit(); syncKit();
      if (confirm(`Add ${k.label}'s type styles (Display, Heading, Body, Caption, Kicker)?\n\nStyles with those names are replaced; your other styles stay.`)) applyKitStyles(k);
    } catch (e) { toast(e.message); pickKit.value = scene.kit?.id || ""; }
  });
  const loaded = kit && kit.id === scene.kit?.id;
  return section("Client kit",
    field("Kit", pickKit),
    loaded ? h("div", { class: "kit-info" },
      kit.logo ? h("img", { src: kit.logo, alt: "" }) : null,
      h("div", {}, h("b", {}, kit.label), h("span", {}, kit.description || ""),
        h("span", {}, `Fonts: ${[...new Set([kit.fonts.display.family, kit.fonts.body.family])].filter(Boolean).join(", ")}`)),
      h("div", { class: "swatches static" }, kit.swatches.map((sw) => h("span", { class: "sw", style: `background:${sw.hex}`, title: `${sw.name} ${sw.hex}` })))) :
      scene.kit ? h("p", { class: "helper" }, `Loading the ${scene.kit.label} kit…`) : null,
    loaded ? h("div", { class: "actions" }, h("button", { type: "button", class: "secondary mini", onclick: () => applyKitStyles(kit) }, "Add kit type styles")) : null,
    h("p", { class: "helper" }, "Kits are the Harpoon token sets made with the Token Generator — the same brand files HSE stories use. Kit colours stay linked: in HSE stories they follow the client's tokens; in Shorthand they use the colour shown."),
    h("a", { class: "helper", href: "https://harpoon-token-generator.onrender.com", target: "_blank", rel: "noopener" }, "Add or change a kit in the Token Generator ↗"));
}
function nearestWeight(list, w) { return list.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a), list[0]); }
function weightOptions(st) {
  const gf = st.source === "google" && st.family ? googleFont(st.family) : null;
  return gf ? gf.weights.map((w) => ({ value: w, label: String(w) })) : WEIGHTS;
}
function fontField(St) {
  const inp = h("input", { type: "text", value: St().family || "", placeholder: "blank = the story's font" });
  inp.addEventListener("input", () => { St().family = inp.value; commit("family"); });
  const btn = h("button", { type: "button", class: "secondary mini", onclick: () => openFontPicker({ current: St().family, kit, onPick: (c) => {
    const st = St();
    st.family = c.family; st.source = c.source;
    if (c.fallback) st.fallback = c.fallback;
    if (c.weights?.length && !c.weights.includes(st.weight)) st.weight = nearestWeight(c.weights, st.weight || 400);
    commit(); renderProps();
  } }) }, "Choose…");
  const st = St();
  const where = !st.family ? "Uses the story's font." : st.source === "google" ? "Google Font — added to the piece automatically." : "The story must already load this font.";
  return h("div", { class: "f-group" }, h("div", { class: "font-row" }, field("Font", inp), btn), h("span", { class: "helper" }, where));
}

// ---------------------------------------------------------------- stacking (what sits in front)
// Separate from reading order. Kept as a clean 1..N sequence so there are never ties: 1 = at the back.
function stackOrder() {
  return scene.elements.map((e, i) => ({ e, i }))
    .sort((a, b) => ((a.e.z ?? a.i + 1) - (b.e.z ?? b.i + 1)) || (a.i - b.i)).map((x) => x.e);
}
function stackPos(id) { return stackOrder().findIndex((e) => e.id === id) + 1; }
function restack(id, pos) {
  const order = stackOrder();
  const i = order.findIndex((e) => e.id === id); if (i < 0) return;
  const [el] = order.splice(i, 1);
  pos = Math.max(1, Math.min(order.length + 1, Math.round(pos) || 1));
  order.splice(pos - 1, 0, el);
  order.forEach((e, k) => { e.z = k + 1; });
}
const STACK_LABEL = { front: "in front of everything", back: "behind everything", forward: "one step forward", backward: "one step back" };
function stack(cmd) {
  if (sel.kind !== "element") return;
  const p = stackPos(sel.id), n = scene.elements.length;
  const np = { front: n, back: 1, forward: p + 1, backward: p - 1 }[cmd];
  if (np < 1 || np > n || np === p) return toast(cmd === "front" || cmd === "forward" ? "Already at the front" : "Already at the back");
  restack(sel.id, np); commit(); renderProps(); drawOverlay();
  toast(`Moved ${STACK_LABEL[cmd]} (${np} of ${n})`);
}
function stackSection(id) {
  const n = scene.elements.length, p = stackPos(id);
  const inp = h("input", { type: "number", min: 1, max: n, step: 1, value: p, "aria-label": "Stacking position" });
  inp.addEventListener("change", () => { const v = parseInt(inp.value, 10); if (!v) { inp.value = p; return; } restack(id, v); commit(); renderProps(); drawOverlay(); });
  const btn = (cmd, label, title, disabled) => h("button", { type: "button", class: "secondary mini", title, disabled, onclick: () => stack(cmd) }, label);
  return section("Stacking",
    h("div", { class: "stack-row" },
      btn("back", "⇊ To back", "Send to back (⇧⌘[)", p === 1),
      btn("backward", "↓ Back", "Send backward (⌘[)", p === 1),
      btn("forward", "↑ Forward", "Bring forward (⌘])", p === n),
      btn("front", "⇈ To front", "Bring to front (⇧⌘])", p === n)),
    h("label", { class: "f stack-pos" }, h("span", {}, `Position (1 = at the back, ${n} = at the front)`), inp),
    h("p", { class: "helper" }, "What sits in front. Separate from reading order (the layers list), which is what screen readers follow."));
}

function duplicate(id) {
  const src = elById(id); const copy = JSON.parse(JSON.stringify(src));
  copy.id = uniqueId(src.id); copy.x += 20; copy.y += 20;
  const i = scene.elements.indexOf(src);
  scene.elements.splice(i + 1, 0, copy);
  restack(copy.id, stackPos(src.id) + 1);
  sel = { kind: "element", id: copy.id }; commit(); renderProps();
}

// ---------------------------------------------------------------- open / import
function openModal(id) { const m = $(id); m.classList.add("open"); m.setAttribute("aria-hidden", "false"); (m.querySelector("button, input, textarea") || m).focus(); }
function closeModals() { $$(".modal.open").forEach((m) => { m.classList.remove("open"); m.setAttribute("aria-hidden", "true"); }); }

async function importInfogramFile(file) {
  let html;
  if (/\.zip$/i.test(file.name)) {
    if (!window.JSZip) throw new Error("The zip reader didn't load — unzip it and choose index.html instead");
    const zip = await window.JSZip.loadAsync(file);
    const idx = Object.keys(zip.files).filter((n) => /(^|\/)index\.html?$/i.test(n)).sort((a, b) => a.length - b.length)[0];
    if (!idx) throw new Error("No index.html in that zip");
    html = await zip.file(idx).async("string");
  } else html = await file.text();
  const { scene: s, warnings } = importInfogram(html);
  setScene(s, warnings);
  toast(`Imported “${s.title}”`);
}

// ---------------------------------------------------------------- export
let tab = "piece";
const NOTES = {
  piece: "Everything in one block — paste into a Shorthand HTML block. The shared animation code is included, so it works on its own and loads with the page.",
  lean: "For stories that already have the shared code (next tab) in their head. Lighter when a story has several pieces.",
  head: "Add once per story: Shorthand → story settings → custom head code. Then use “Piece (shared code in story)” for each piece.",
  json: "The editable source. Keep it for the library, or open it here later. (Pieces also carry it, so pasting a piece back in works too.)",
};
function exportText() {
  if (tab === "json") return JSON.stringify(scene, null, 2);
  if (tab === "head") return `<!-- Fluke shared code -->\n<style>${runtime.css.trim()}</style>\n<script>${runtime.js.trim()}</script>`;
  const { errors } = validate(scene);
  if (errors.length) return "Fix these first:\n- " + errors.join("\n- ");
  return renderScene(scene, { runtimeCss: runtime.css, runtimeJs: runtime.js, includeRuntime: tab === "piece", embedSource: true });
}
function showTab(t) {
  tab = t;
  $$("#exportModal [role=tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === t));
  $("#exportNote").textContent = NOTES[t];
  const txt = exportText();
  $("#exportCode").textContent = txt;
  $("#exportSize").textContent = `${(new Blob([txt]).size / 1024).toFixed(1)} KB`;
}

// ---------------------------------------------------------------- wiring
function wire() {
  $("#sceneBtn").addEventListener("click", () => choose({ kind: "scene" }));
  $("#addStyleBtn").addEventListener("click", addStyle);
  $$("[data-add]").forEach((b) => b.addEventListener("click", () => addElement(b.dataset.add)));
  $$("[data-view]").forEach((b) => b.addEventListener("click", () => {
    view = b.dataset.view; $$("[data-view]").forEach((x) => x.setAttribute("aria-pressed", x === b)); renderPreview(); renderProps();
  }));
  $$("[data-frame]").forEach((b) => b.addEventListener("click", () => {
    frame = b.dataset.frame; scrubT = null; hidePlayhead(); $$("[data-frame]").forEach((x) => x.setAttribute("aria-pressed", x === b)); renderPreview();
  }));
  $("#playBtn").addEventListener("click", play);
  $("#undoBtn").addEventListener("click", undo);
  $("#redoBtn").addEventListener("click", redo);
  $("#newBtn").addEventListener("click", async () => {
    if (!confirm("Start a new piece? You can undo this.")) return;
    const s = blankScene(), last = store.get(LASTKIT_KEY);
    if (last) {
      try { const k = await loadKit(last); s.kit = { id: k.id, label: k.label }; s.styles = kitStyles(k, s.canvas.width); toast(`New piece with the ${k.label} kit`); }
      catch { /* kit gone: plain piece */ }
    }
    setScene(s);
  });
  $("#openBtn").addEventListener("click", () => openModal("#openModal"));
  $("#libraryBtn").addEventListener("click", () => openLibrary());
  $("#exportBtn").addEventListener("click", () => { openModal("#exportModal"); showTab(validate(scene).errors.length ? "json" : tab); });
  $$("[data-close]").forEach((b) => b.addEventListener("click", closeModals));
  $$(".modal").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) closeModals(); }));
  $$("#exportModal [role=tab]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  $("#copyBtn").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("#exportCode").textContent); toast("Copied"); } catch { toast("Copy failed — select the text and copy it"); }
  });
  $("#downloadBtn").addEventListener("click", () => {
    const ext = tab === "json" ? "json" : "html";
    const a = h("a", { href: URL.createObjectURL(new Blob([$("#exportCode").textContent], { type: ext === "json" ? "application/json" : "text/html" })), download: `${scene.id}${tab === "head" ? "-shared-code" : ""}.${ext}` });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $("#infogramFile").addEventListener("change", async (ev) => {
    const f = ev.target.files[0]; ev.target.value = ""; if (!f) return;
    try { await importInfogramFile(f); closeModals(); } catch (e) { toast(e.message); }
  });
  $("#jsonFile").addEventListener("change", async (ev) => {
    const f = ev.target.files[0]; ev.target.value = ""; if (!f) return;
    try { setScene(JSON.parse(await f.text())); closeModals(); } catch (e) { toast("Couldn't read that file: " + e.message); }
  });
  $("#pasteBtn").addEventListener("click", () => {
    try { const s = extractScene($("#pasteHtml").value); if (!s) return toast("No Fluke piece found in that HTML"); setScene(s); $("#pasteHtml").value = ""; closeModals(); toast("Opened"); }
    catch (e) { toast("Couldn't read that piece: " + e.message); }
  });
  $$("[data-example]").forEach((b) => b.addEventListener("click", async () => {
    try { setScene(await (await fetch("../scenes/" + b.dataset.example)).json()); closeModals(); } catch (e) { toast(e.message); }
  }));
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { endScrub(); return closeModals(); }
    const typing = ev.target instanceof Element && ev.target.closest("input, textarea, select, [contenteditable], .anim-pop");
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "z" && !typing) { ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "s") { ev.preventDefault(); saveToLibrary(); return; }
    if (!typing && sel.kind === "element" && (ev.key === "Delete" || ev.key === "Backspace") && !$(".modal.open")) {
      ev.preventDefault(); scene.elements = scene.elements.filter((x) => x.id !== sel.id); sel = { kind: "scene" }; commit(); renderProps(); drawOverlay(); return;
    }
    if (!typing && sel.kind === "element" && (ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "d") { ev.preventDefault(); duplicate(sel.id); return; }
    if (!typing && sel.kind === "element" && (ev.metaKey || ev.ctrlKey) && (ev.code === "BracketRight" || ev.code === "BracketLeft")) {
      ev.preventDefault(); stack(ev.code === "BracketRight" ? (ev.shiftKey ? "front" : "forward") : (ev.shiftKey ? "back" : "backward")); return;
    }
    if (typing || sel.kind !== "element" || !ev.key.startsWith("Arrow") || $(".modal.open")) return;
    const e = elById(sel.id); if (!e) return;
    ev.preventDefault();
    const step = ev.shiftKey ? 10 : 1;
    const t = view === "phone" && scene.mobile ? (e.m ||= {}) : e;
    const M = scene.mobile, W = scene.canvas.width, H = scene.canvas.height;
    if (t === e.m) { t.x ??= round(e.x * M.width / W); t.y ??= round(e.y * M.height / H); }
    if (ev.key === "ArrowLeft") t.x = round(t.x - step); if (ev.key === "ArrowRight") t.x = round(t.x + step);
    if (ev.key === "ArrowUp") t.y = round(t.y - step); if (ev.key === "ArrowDown") t.y = round(t.y + step);
    commit("nudge"); renderProps();
  });
}

// ---------------------------------------------------------------- start
const api = {
  get scene() { return scene; }, get sel() { return sel; }, get view() { return view; },
  choose, commit, renderProps, slug, stack, stackPos, toast,
  getScene: () => scene,
  scrubTo, endScrub, getScrub: () => scrubT,
  loadScene: (s) => setScene(s, [], { keepLibrary: true }),
  renderStatic: (s) => previewHtml(s),
};
async function start() {
  wire();
  initCanvas(api);
  initTimeline(api, ANIMATIONS);
  try {
    const [c, j] = await Promise.all([fetch("../runtime/ha.css").then((r) => r.text()), fetch("../runtime/ha.js").then((r) => r.text())]);
    runtime.css = c; runtime.js = j; $("#runtimeCss").textContent = c;
  } catch (e) { toast("Couldn't load the animation code: " + e.message); }
  let s = null;
  const draft = store.get(DRAFT_KEY);
  if (draft) { try { s = JSON.parse(draft); } catch { s = null; } }
  if (!s) { try { s = await (await fetch("../scenes/ardalan-quote.json")).json(); } catch { s = blankScene(); } }
  scene = s; current = JSON.stringify(s);
  initLibrary(api); // before the first refresh, which shows the library status
  refreshAll();
  loadFontList().then(() => { if (sel.kind === "style") renderProps(); }).catch(() => {});
}
start();
