// Fluke editor — scenes, canvas, timeline, kits, fonts and library.
// Core parts load together (without them there's no editor). Optional parts — client kits, the font picker, the
// library and the Infogram importer — load separately: if one doesn't arrive (e.g. a hosting hiccup straight after an
// update), only that feature is unavailable, and it says so, instead of the whole editor coming up blank.
import { renderScene, validate, ANIMATIONS, extractScene, nearestWeight, BLENDS, IMAGE_ONLY_ANIMATIONS, brushOf, brushPathD, isScreenFit, flattenGroups, groupSpan, groupPhoneBox, groupBoxIn, layoutCanvas, layoutFallback } from "../src/render.js?v=a35c7f4";
import { initCanvas, drawOverlay, setOverlayHidden, startBrushDraw, stopBrushDraw, isBrushing } from "./canvas.js?v=a35c7f4";
import { initTimeline, renderTimeline, runPlayhead, hidePlayhead } from "./timeline.js?v=a35c7f4";
import { richText } from "./richtext.js?v=a35c7f4";
window.__flukeStarted = true; // the core arrived; index.html shows a "reload" message if this never happens

// Stand-ins until (or unless) each optional part loads
const unavailable = (label) => () => toast(`${label} didn't load — reload the page to use it`);
let loadRegistry = () => Promise.reject(new Error("Client kits didn't load — reload the page"));
let loadKit = loadRegistry, kitStyles = () => ({}), loadKitFonts = () => {};
let openFontPicker = unavailable("The font picker"), loadFontList = () => Promise.resolve([]), googleFont = () => null, fontListLoaded = () => false;
let initLibrary = () => {}, openLibrary = unavailable("The library"), saveToLibrary = unavailable("The library");
let refreshStatus = () => {}, forgetRef = () => {};
const failedParts = [];
async function loadOptionalParts() {
  const [k, f, l] = await Promise.allSettled([import("./kits.js?v=a35c7f4"), import("./fonts.js?v=a35c7f4"), import("./library.js?v=a35c7f4")]);
  if (k.status === "fulfilled") ({ loadRegistry, loadKit, kitStyles, loadKitFonts } = k.value); else failedParts.push("client kits");
  if (f.status === "fulfilled") ({ openFontPicker, loadFontList, googleFont, fontListLoaded } = f.value); else failedParts.push("the font picker");
  if (l.status === "fulfilled") ({ initLibrary, openLibrary, save: saveToLibrary, refreshStatus, forgetRef } = l.value); else failedParts.push("the library");
  [k, f, l].forEach((r) => { if (r.status === "rejected") console.error(r.reason); });
}
async function importInfogram(html, opts) {
  let mod;
  try { mod = await import("../src/import-infogram.js?v=a35c7f4"); }
  catch { throw new Error("The Infogram importer didn't load — reload the page and try again"); }
  return mod.importInfogram(html, opts);
}

const DRAFT_KEY = "harpoon-animate-draft-v1";
const LASTKIT_KEY = "harpoon-animate-last-kit";
const LASTKIND_KEY = "fluke-last-new-kind";
const PHONE_PREVIEW = 375;
const DESKTOP_MEASURE = 760;
const SQUARE_PREVIEW = 600;
// The layout being edited: "m" (phone), "s" (square) or null (desktop). A view whose layout is off shows the desktop design.
const layoutKey = () => (view === "phone" && scene?.mobile ? "m" : view === "square" && layoutCanvas(scene, "s") ? "s" : null);
const LAYOUT_NAME = { m: "phone", s: "square" };
const viewCls = () => (view === "desktop" ? "" : view);

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
function toast(msg, ms = 1800) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), ms);
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

// kind "screen": a whole Shorthand section — 2560×1440, with a 1440×2560 layout for upright phones
const blankScene = (kind = "column") => kind === "screen" ? {
  format: "harpoon-animate/1", id: "new-section", title: "New full-screen section", root: "section",
  canvas: { width: 2560, height: 1440, background: null, fit: "contain" },
  mobile: { below: 560, width: 1440, height: 2560 },
  trigger: { on: "view", threshold: 0.5, replay: true },
  styles: {
    heading: { family: "", source: "story", weight: 600, size: 144, lineHeight: 1.1, color: "#000000" },
    body: { family: "", source: "story", weight: 400, size: 48, lineHeight: 1.35, color: "#000000" },
  },
  elements: [],
} : ({
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
// reveal: when the panels are stacked (narrow windows) the settings panel is below the timeline — bring it into view
function choose(s, { reveal = false } = {}) {
  sel = s; renderLayers(); renderProps(); highlight(); drawOverlay(); renderTimeline();
  const p = $("#props"), r = p.getBoundingClientRect();
  if (reveal && (r.top > innerHeight - 80 || r.bottom < 80)) p.scrollIntoView({ behavior: "smooth", block: "start" });
}

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
const ICON = { text: "T", rect: "▭", ellipse: "◯", line: "╱", image: "▣", group: "▦" };
function renderLayers() {
  $("#sceneBtn").setAttribute("aria-current", sel.kind === "scene");
  const sl = $("#styleList"); sl.replaceChildren();
  Object.entries(scene.styles || {}).forEach(([name, st]) => {
    sl.append(h("div", { class: "row" },
      h("button", { type: "button", class: "row-btn", "aria-current": sel.kind === "style" && sel.name === name, onclick: () => choose({ kind: "style", name }, { reveal: true }) },
        h("span", { class: "icon" }, "Aa"), h("span", { class: "name" }, name),
        h("span", { class: "tag" }, `${st.size}·${st.weight}`))));
  });
  const ll = $("#layerList"); ll.replaceChildren();
  const els = scene.elements || [];
  if (!els.length) ll.append(h("p", { class: "helper" }, "No layers yet — add one below."));
  els.forEach((e, i) => {
    const out = e.animate && ANIMATIONS.out.includes(e.animate.name);
    ll.append(h("div", { class: "row" },
      h("button", { type: "button", class: "row-btn", "aria-current": sel.kind === "element" && sel.id === e.id, onclick: () => choose({ kind: "element", id: e.id }, { reveal: true }) },
        h("span", { class: "icon", "aria-hidden": "true" }, ICON[e.type] || "?"),
        h("span", { class: "name" }, e.id),
        h("span", { class: "zbadge", title: `In front/behind: ${stackPos(e.id)} of ${els.length} (1 = at the back). Click to change.`,
          onclick: (ev) => { ev.stopPropagation(); showStacking(e.id); } }, String(stackPos(e.id))),
        e.type === "text" ? h("span", { class: "tag" }, e.tag || "p") : null,
        out ? h("span", { class: "tag", title: "Leaves during the animation" }, "out") : null,
        e.m?.hidden ? h("span", { class: "tag", title: "Hidden on phones" }, "no 📱") : null),
      h("button", { type: "button", class: "move", title: "Earlier in reading order (what screen readers hear first). Doesn't change what sits in front.", "aria-label": `Move ${e.id} earlier in reading order`, disabled: i === 0, onclick: () => moveLayer(i, -1) }, "↑"),
      h("button", { type: "button", class: "move", title: "Later in reading order (what screen readers hear first). Doesn't change what sits in front.", "aria-label": `Move ${e.id} later in reading order`, disabled: i === els.length - 1, onclick: () => moveLayer(i, 1) }, "↓")));
  });
}
function moveLayer(i, d) {
  const els = scene.elements; const j = i + d;
  [els[i], els[j]] = [els[j], els[i]];
  // keep how things stack: give every element an explicit z first
  els.forEach((e, k) => { if (e.z == null) e.z = (k === i ? j : k === j ? i : k) + 1; });
  commit();
  // the arrows are easily mistaken for "in front / behind": say what they did, once per session
  if (!moveLayer.told) { moveLayer.told = true; toast("Reading order changed — that's what screen readers follow. To put a layer in front or behind, click its number.", 5000); }
}
// select a layer and bring its Stacking settings into view, briefly highlighted
function showStacking(id) {
  choose({ kind: "element", id });
  const fs = [...$("#props").querySelectorAll("fieldset")].find((f) => f.querySelector("legend")?.textContent === "Stacking");
  if (!fs) return;
  fs.scrollIntoView({ behavior: "smooth", block: "center" });
  fs.classList.remove("flash"); void fs.offsetWidth; fs.classList.add("flash");
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
function previewHtml(s, layout) {
  try { return renderScene(s, { allowInvalid: true, includeRuntime: false, fontInfo: googleFont, asColumn: true, layout }); }
  catch (e) { return `<p style="color:#b3261e">Can't draw this scene: ${e.message}</p>`; }
}
function renderPreview() {
  const p = $("#preview");
  // while drawing a brush path, show the finished frame so the whole image is there to trace
  p.className = `preview ${viewCls()} f-${isBrushing() ? "end" : frame}`;
  p.innerHTML = previewHtml(scene, layoutKey() === "s" ? "s" : undefined);
  // preview only: the story's page colour behind the piece (the checkerboard means "transparent")
  $("#stage").style.background = scene.page || "";
  highlight();
  setOverlayHidden(false);
  if (scrubT != null) applyScrub();
  const M = scene.mobile;
  const scr = isScreenFit(scene), crop = scene.canvas.fit === "cover";
  const Q = layoutCanvas(scene, "s");
  $("#stageNote").textContent = view === "square"
    ? (Q ? `Square layout: on screens between 3:4 and 4:3 (near-square windows, tablets) the ${Q.width}×${Q.height} canvas is used. Layers you haven't moved sit where they are in the desktop design. Position fields now edit the square layout.`
         : scr ? "No square layout: near-square screens show the desktop or phone design with bands. Turn one on in Scene settings." : "Square layouts are for full-screen pieces. This piece fits its column, so it simply scales.")
    : view === "phone"
    ? (M ? (scr ? `Phone layout: on screens ${Q ? "narrower than 3:4" : "taller than they are wide"} the ${M.width}×${M.height} canvas is used${crop ? ", filling the screen (edges may be cropped)" : ""}. Position fields now edit the phone layout.`
              : `Phone layout: below ${M.below}px wide the ${M.width}×${M.height} canvas is used. Position fields now edit the phone layout.`)
         : "No phone layout: the desktop design is scaled down. Turn one on in Scene settings.")
    : scr ? `Full screen: ${scene.canvas.width}×${scene.canvas.height} canvas, ${crop ? "scaled to fill the window — on screens of a different shape the edges are cropped, so keep text away from them" : "scaled to fit inside the window, with bands of background on screens of a different shape"}.`
    : `Desktop layout: ${scene.canvas.width}×${scene.canvas.height} canvas, scaled to fit the column. Story fonts show here only if installed on this computer.`;
  scheduleMeasure();
}
function highlight() {
  $("#selStyle").textContent = ""; // the selection box (canvas.js) shows what's selected
}
// Scrubbing: every layer paused at the same moment, so the canvas shows exactly that frame of the animation
function applyScrub() {
  const p = $("#preview");
  p.className = `preview ${viewCls()} f-scrub`;
  p.querySelector(".ha")?.classList.add("ha-run");
  setOverlayHidden(true);
  p.querySelectorAll(".ha-el").forEach((el) => el.getAnimations().forEach((an) => { an.pause(); an.currentTime = scrubT * 1000; }));
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) toast("Your computer has reduced motion on, so animations can't be shown");
}
function scrubTo(t) { scrubT = t; applyScrub(); }
function endScrub() { if (scrubT == null) return; scrubT = null; hidePlayhead(); renderPreview(); }
function play() {
  stopBrushDraw();
  scrubT = null; hidePlayhead();
  const p = $("#preview");
  p.className = `preview ${viewCls()}`;
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
// Text overflows when it needs more lines than its box has room for, or a word is wider than the box.
// (Comparing scrollHeight would flag fonts whose letters reach slightly beyond their line height — common with tight
// line spacing, and Infogram's one-line boxes — even though nothing is cut off or pushed out of place.)
function overflowing(container) {
  return $$(".ha-text", container).filter((n) => {
    if (n.offsetParent === null) return false;
    const cs = getComputedStyle(n);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    const range = document.createRange(); range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0);
    if (!rects.length) return false;
    const box = n.getBoundingClientRect();
    const tops = rects.map((r) => r.top).sort((x, y) => x - y);
    const lines = tops.reduce((count, t, i) => (i && t - tops[i - 1] > lh * 0.5 ? count + 1 : count), 1);
    const tooTall = lines * lh > box.height + lh * 0.3;
    const tooWide = rects.some((r) => r.right > box.right + 2 || r.left < box.left - 2);
    return tooTall || tooWide;
  }).map((n) => [...n.classList].find((c) => c.startsWith("ha-e-")).slice(5));
}
async function measure() {
  const box = $("#measure");
  const html = previewHtml(scene);
  const hasQ = !!layoutCanvas(scene, "s");
  box.replaceChildren(h("div", { class: "f-layout", style: `width:${DESKTOP_MEASURE}px` }), h("div", { class: "f-layout", style: `width:${PHONE_PREVIEW}px` }),
    h("div", { class: "f-layout", style: `width:${SQUARE_PREVIEW}px` }));
  box.children[0].innerHTML = html; box.children[1].innerHTML = html;
  if (hasQ) box.children[2].innerHTML = previewHtml(scene, "s");
  try { await document.fonts.ready; } catch { /* old browsers */ }
  const nameOf = (s) => (scene.elements.find((e) => slug(e.id) === s) || {}).id || s;
  const desk = overflowing(box.children[0]).map(nameOf);
  const phone = scene.mobile ? overflowing(box.children[1]).map(nameOf) : [];
  const square = hasQ ? overflowing(box.children[2]).map(nameOf) : [];
  box.replaceChildren();
  renderIssues(desk, phone, square);
}
// Fonts the preview can't show as chosen: unknown Google names, missing weights, story fonts not installed here
function fontNotes() {
  const notes = [], seen = new Set();
  (scene.elements || []).filter((e) => e.type === "text").forEach((e) => {
    const st = { ...((scene.styles || {})[e.style] || {}), ...Object.fromEntries(["family", "source", "weight", "italic"].filter((k) => e[k] !== undefined).map((k) => [k, e[k]])) };
    if (!st.family) return;
    const key = [st.family, st.source, st.weight, st.italic].join("|"); if (seen.has(key)) return; seen.add(key);
    if (st.source === "google" && fontListLoaded()) {
      const gf = googleFont(st.family);
      if (!gf) notes.push(`“${st.family}” isn't a Google Font name, so it won't load — check the spelling, or use Choose…`);
      else if (!gf.weights.includes(+(st.weight || 400))) notes.push(`${gf.family} has no ${st.weight} weight — it's shown and exported as ${nearestWeight(gf.weights, +(st.weight || 400))}`);
      else if (st.italic && !gf.italic) notes.push(`${gf.family} has no italic — it's shown and exported upright`);
    } else if (st.source !== "google" && !fontInstalled(st.family)) {
      notes.push(`“${st.family}” is a story font that isn't installed on this computer, so the preview uses a stand-in`);
    }
  });
  return notes;
}
// "element portrait-1-relic: …" → the layer to select (a layer inside a placed piece selects the piece)
function layerOfIssue(text) {
  const m = /^element ([^:]+):/.exec(text); if (!m) return null;
  if (elById(m[1])) return m[1];
  try { const k = flattenGroups(scene).elements.find((x) => x.id === m[1]); return k?.group && elById(k.group) ? k.group : null; }
  catch { return null; }
}
function renderIssues(desk = [], phone = [], square = []) {
  const { errors, warnings } = validate(scene);
  const list = $("#issues"); list.replaceChildren();
  const row = (cls, label, text, onx) => {
    const id = layerOfIssue(text);
    list.append(h("div", { class: `issue ${cls}` }, h("b", {}, label),
      id ? h("button", { type: "button", class: "issue-go", title: "Select this layer", onclick: () => choose({ kind: "element", id }, { reveal: true }) }, text) : h("span", {}, text),
      onx ? h("button", { type: "button", class: "x", "aria-label": "Dismiss", onclick: onx }, "×") : null));
  };
  errors.forEach((e) => row("err", "Fix", e));
  warnings.forEach((w) => row("warn", "Check", w));
  fontNotes().forEach((n) => row("warn", "Check", n));
  desk.forEach((id) => row("warn", "Check", `“${id}” text overflows its box on desktop — make the box bigger or the text smaller`));
  phone.forEach((id) => row("warn", "Check", `“${id}” text overflows its box on phones — adjust it in the Phone layout`));
  square.forEach((id) => row("warn", "Check", `“${id}” text overflows its box on square screens — adjust it in the Square layout`));
  importNotes.forEach((n, i) => row("note", "Import", n, () => { importNotes.splice(i, 1); renderIssues(desk, phone, square); }));
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
  p.className = `preview ${viewCls()} f-solo`;
  p.innerHTML = previewHtml(copy, layoutKey() === "s" ? "s" : undefined);
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
    group("Enter", elById(sel.id)?.type === "image" ? ANIMATIONS.in : ANIMATIONS.in.filter((n) => !IMAGE_ONLY_ANIMATIONS.has(n))), group("Leave", ANIMATIONS.out), group("Attention", ANIMATIONS.attention), group("No animation", [""]));
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
// What the word-styling toolbar offers: the kit's colours and fonts first, then what the piece already uses
function rtSwatches() {
  const kitOnes = kit ? kit.swatches.map((sw) => ({ value: `var(--hse-${sw.token}, ${sw.hex})`, name: `${sw.name} ${sw.hex}` })) : [];
  return [...kitOnes, ...pieceColours().filter((v) => !(kit && linkedToken(v))).map((v) => ({ value: v, name: v }))];
}
function rtFonts() {
  const out = new Map();
  const add = (f, label) => { if (f?.family && !out.has(f.family)) out.set(f.family, { family: f.family, source: f.source || "story", fallback: f.fallback || "", label }); };
  if (kit) { add({ ...kit.fonts.display, source: kit.fontSource(kit.fonts.display.family) }, `${kit.fonts.display.family} (kit display)`); add({ ...kit.fonts.body, source: kit.fontSource(kit.fonts.body.family) }, `${kit.fonts.body.family} (kit body)`); }
  Object.values(scene.styles || {}).forEach((st) => add(st, st.family));
  return [...out.values()];
}
// The kit's sizes and weights for the word toolbar. units: the width of the canvas the layer's size is measured in;
// styles(): the type styles that apply to it (the piece's own, for a layer inside a placed piece).
function rtType(get, units, styles) {
  const SIZE_NAMES = { display: "Display", heading: "Heading", body: "Body", caption: "Caption", kicker: "Kicker" };
  return {
    baseSize: () => { const e = get(); return e.size ?? (styles() || {})[e.style]?.size ?? 16; },
    sizes: () => (kit ? Object.entries(kitStyles(kit, units)).map(([n, s]) => ({ label: `${SIZE_NAMES[n] || n} ${s.size}`, size: s.size })) : []),
    weights: () => (kit ? Object.entries(kit.weights).map(([n, v]) => ({ label: `${n.charAt(0).toUpperCase() + n.slice(1)} ${v}`, value: v }))
      : [300, 400, 500, 600, 700, 800].map((v) => ({ label: String(v), value: v }))),
  };
}
// The words of a text layer, with a toolbar for styling some of them
function richField(get, label = "Text", undoKey = "rt", units = scene.canvas.width, styles = () => scene.styles) {
  const r = richText({ get, label, swatches: rtSwatches, fonts: rtFonts, ...rtType(get, units, styles), commit: (typing) => commit(typing ? undoKey : undefined) });
  return h("div", { class: "f rt-field" }, h("span", {}, label), r.el,
    h("span", { class: "helper" }, "Select words to make them bold, italic, another colour, font or size."));
}
const linkedToken = (v) => (String(v || "").match(/^var\(--hse-([a-z0-9-]+)\s*,/) || [])[1] || null;
function colour(label, getObj, key, opts = {}) {
  const v = getObj()[key] || "";
  const hex = (String(v).match(/#[0-9a-f]{6}/i) || ["#000000"])[0];
  const pick = h("input", { type: "color", value: hex.toLowerCase(), "aria-label": label + " picker", class: v ? "" : "empty" });
  const t = h("input", { type: "text", value: v, placeholder: opts.placeholder ?? "none" });
  const note = h("span", { class: "linked" });
  const showLink = () => {
    const tok = linkedToken(t.value), sw = tok && kit?.swatches.find((x) => x.token === tok);
    note.textContent = tok ? `🔗 ${sw ? sw.name : tok} from the ${kit?.label || "client"} kit — follows the client's tokens in HSE` : "";
  };
  t.addEventListener("input", () => pick.classList.toggle("empty", !t.value.trim()));
  pick.addEventListener("input", () => { pick.classList.remove("empty"); t.value = pick.value.toUpperCase(); setVal(getObj, key, t.value, opts); showLink(); commit(label + key); });
  t.addEventListener("input", () => { const m = t.value.match(/#[0-9a-f]{6}/i); if (m) pick.value = m[0].toLowerCase(); setVal(getObj, key, t.value.trim(), opts); showLink(); commit(label + key); });
  const use = (val) => { pick.classList.remove("empty"); t.value = val; const m = val.match(/#[0-9a-f]{6}/i); if (m) pick.value = m[0].toLowerCase(); setVal(getObj, key, val, opts); showLink(); commit(); };
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
    select("Wrapper element", S, "root", [{ value: "div", label: "div — no special meaning" }, { value: "figure", label: "figure — quote or image with caption" }, { value: "section", label: "section" }, { value: "header", label: "header — e.g. an animated title" },
      { value: "h1", label: "H1 heading — words are parts of one title" }, { value: "h2", label: "H2 heading — words are parts of one heading" }, { value: "h3", label: "H3 heading" }], { fallback: "div" }),
    text("Label for screen readers (optional)", S, "label", { optional: true, placeholder: "e.g. Quote from Cyrus Ardalan" })));
  const scr = isScreenFit(scene);
  out.push(section("Canvas",
    select("Size on the page", C, "fit", [{ value: "column", label: "Fits the column it sits in" },
      { value: "contain", label: "Full screen — all of it shows (bands take the background colour)" }, { value: "cover", label: "Full screen — fills edge to edge, edges may crop" }],
      { fallback: "column", rerender: true, apply: (v) => {
        if (v === "column") delete scene.canvas.fit; else scene.canvas.fit = v;
        // going full screen: give it an upright layout for phones, if it has none
        if (v !== "column" && !scene.mobile) scene.mobile = { below: 560, width: scene.canvas.height, height: scene.canvas.width };
      } }),
    grid(2, num("Width", C, "width", { min: 1 }), num("Height", C, "height", { min: 1 })),
    colour("Background", C, "background", { optional: true, placeholder: "transparent" }),
    h("div", { class: "actions" }, h("button", { type: "button", class: "secondary mini", disabled: !scene.canvas.background,
      onclick: () => { delete scene.canvas.background; commit(); renderProps(); } }, "Make transparent")),
    h("p", { class: "helper" }, scene.canvas.background ? "The piece has its own background colour." : "Transparent: the story's page colour shows through."),
    colour("Preview on page colour", S, "page", { optional: true, placeholder: "white" }),
    h("p", { class: "helper" }, "Editor only — set it to the story's page tint to see how the piece sits on it. Not part of the code."),
    h("p", { class: "helper" }, scr ? "Canvas units, not pixels: the piece fills the screen height and the width of its block — set the Shorthand section to full width."
      : "Canvas units, not pixels: the piece scales to the width of the column it sits in.")));
  out.push(section("Animation trigger",
    select("Play", T, "on", [{ value: "view", label: "When scrolled into view" }, { value: "load", label: "As soon as the page loads" }], { rerender: true }),
    T().on === "view" ? grid(2,
      select("When this much is visible", T, "threshold", [0.1, 0.25, 0.5, 0.75].map((v) => ({ value: v, label: `${v * 100}%` })), { number: true }),
      h("div", {}, check("Replay when scrolled back to", T, "replay"))) : h("p", { class: "helper" }, "No script needed: it plays as soon as the browser draws it.")));
  const hasM = !!scene.mobile;
  out.push(section("Phone layout",
    check("Use a separate phone layout", S, "mobile", { apply: (on) => {
      if (on) scene.mobile = isScreenFit(scene) ? { below: 560, width: scene.canvas.height, height: scene.canvas.width }
        : { below: 560, width: 375, height: Math.round(scene.canvas.height / scene.canvas.width * 375 * 1.5) };
      else { delete scene.mobile; scene.elements.forEach((e) => delete e.m); }
    }, rerender: true }),
    hasM ? [scr ? grid(2, num("Width", () => scene.mobile, "width", { min: 1 }), num("Height", () => scene.mobile, "height", { min: 1 }))
        : grid(3, num("Below (px)", () => scene.mobile, "below", { min: 200 }), num("Width", () => scene.mobile, "width", { min: 1 }), num("Height", () => scene.mobile, "height", { min: 1 })),
      scr ? h("p", { class: "helper" }, scene.square ? "Full screen: used on screens narrower than 3:4 (phones held upright). Near-square screens use the square layout." : "Full screen: used whenever the screen is taller than it is wide (phones held upright).") : null,
      h("p", { class: "helper" }, "Switch the preview to Phone to arrange it. Layers you don't move keep their desktop position, scaled."),
      h("div", { class: "actions" }, h("button", { type: "button", class: "secondary mini", onclick: copyDesktopToPhone }, "Copy desktop positions to phone"))]
      : h("p", { class: "helper" }, "Without one, the desktop design is scaled down on phones — fine for big type, too small for long quotes.")));
  if (scr || scene.square) {
    const hasQ = !!scene.square;
    out.push(section("Square layout",
      check("Use a square layout for near-square screens", S, "square", { apply: (on) => {
        if (on) { const side = Math.round(Math.sqrt(scene.canvas.width * scene.canvas.height)); scene.square = { width: side, height: side }; }
        else { delete scene.square; scene.elements.forEach((e) => delete e.s); }
      }, rerender: true }),
      hasQ ? [grid(2, num("Width", () => scene.square, "width", { min: 1 }), num("Height", () => scene.square, "height", { min: 1 })),
        h("p", { class: "helper" }, scr ? "Used on screens between 3:4 and 4:3 — near-square browser windows and tablets. Wider screens get the desktop layout; taller ones the phone layout."
          : "Only full-screen pieces use it: this piece fits its column, so it's ignored."),
        h("p", { class: "helper" }, "Switch the preview to Square to arrange it. Layers you don't move stay where they are in the desktop design, which sits in the middle of the square.")]
        : h("p", { class: "helper" }, "Without one, screens close to square show the desktop or phone design with bands of background.")));
  }
  return out;
}
function copyDesktopToPhone() {
  const M = scene.mobile, W = scene.canvas.width, H = scene.canvas.height;
  scene.elements.forEach((e) => {
    if (e.type === "group") { const b = groupPhoneBox(scene, { ...e, m: null }); e.m = { ...(e.m || {}), x: round(b.x), y: round(b.y), w: round(b.w), h: round(b.h) }; return; }
    e.m = { ...(e.m || {}), x: round(e.x * M.width / W), y: round(e.y * M.height / H), w: round(e.w * M.width / W), h: round(e.h * M.height / H) };
    if (e.type === "text") { const st = (scene.styles || {})[e.style] || {}; e.m.size = round((e.size ?? st.size ?? 16) * M.width / W); }
  });
  commit(); toast("Copied — now adjust in Phone view");
}

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => ({ value: w, label: String(w) }));
// The client kit's own type values (from its HSE tokens), as one-click choices under the size / weight / spacing fields,
// the way its colours sit beside the colour picker. rows: [{ kind: size|weight|leading|tracking, get, key, units }]
// units: the width of the canvas the size is measured in, so kit sizes come out the same on screen as kit type styles.
const capWord = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function kitTypeChips(rows) {
  if (!kit) return null;
  const options = (r) => {
    if (r.kind === "weight") return Object.entries(kit.weights).map(([n, v]) => ({ label: `${capWord(n)} ${v}`, value: v }));
    if (r.kind === "leading") return Object.entries(kit.leading).map(([n, v]) => ({ label: `${capWord(n)} ${v}`, value: v }));
    if (r.kind === "tracking") return kit.tracking ? [{ label: `Kicker ${kit.tracking}em`, value: kit.tracking }] : [];
    const seen = new Set();
    return Object.entries(kitStyles(kit, r.units)).map(([n, s]) => ({ label: `${capWord(n)} ${s.size}`, value: s.size }))
      .filter((o) => !seen.has(o.value) && seen.add(o.value));
  };
  const NAMES = { size: "Size", weight: "Weight", leading: "Line height", tracking: "Spacing" };
  return h("div", { class: "kit-type" },
    h("span", { class: "kit-type__title" }, `From the ${kit.label} kit`),
    rows.map((r) => {
      const opts = options(r); if (!opts.length) return null;
      const cur = r.get()?.[r.key];
      return h("div", { class: "kit-type__row", role: "group", "aria-label": `${kit.label} ${NAMES[r.kind].toLowerCase()}` },
        h("span", { class: "sw-label" }, NAMES[r.kind]),
        opts.map((o) => h("button", { type: "button", class: `chip${cur === o.value ? " on" : ""}`, "aria-pressed": cur === o.value,
          onclick: () => { r.get()[r.key] = o.value; if (r.after) r.after(); commit(); renderProps(); } }, o.label)));
    }));
}
function styleProps(name) {
  const St = () => scene.styles[name];
  const used = scene.elements.filter((e) => e.style === name).length;
  return [
    h("p", { class: "title" }, `Type style: ${name}`),
    h("p", { class: "sub" }, `How text looks. Used by ${used} layer${used === 1 ? "" : "s"}. What the text is (heading, quote…) is set on each layer.`),
    layoutKey() ? h("p", { class: "phone-flag" }, `${layoutKey() === "m" ? "📱" : "◻︎"} A type style is shared by every layout. To change one layer's size in the ${LAYOUT_NAME[layoutKey()]} layout only, select that layer.`) : null,
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
      kitTypeChips([{ kind: "size", get: St, key: "size", units: scene.canvas.width }, { kind: "weight", get: St, key: "weight" },
        { kind: "leading", get: St, key: "lineHeight" }, { kind: "tracking", get: St, key: "letterSpacing" }]),
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
  const out = [h("p", { class: "title" }, e.type === "group" ? "Placed piece" : `${{ text: "Text", rect: "Box", ellipse: "Circle", line: "Line", image: "Image" }[e.type]} layer`)];
  out.push(text("Layer name", E, "id", { onChangeOnly: true, apply: (v, inp) => {
    const nid = slug(v); if (!nid || (nid !== e.id && elById(nid))) { inp.value = e.id; toast("That name is taken"); return; }
    E().id = nid; sel = { kind: "element", id: nid }; inp.value = nid;
  } }));

  if (e.type === "group") out.push(...[groupFields(e, E), groupTextSection(e), groupShapesSection(e), groupImagesSection(e)].filter(Boolean));
  if (e.type === "text") {
    const st = (scene.styles || {})[e.style] || {};
    const lk = layoutKey();
    const deskSize = e.size ?? st.size;
    const sizeField = lk
      ? num(lk === "m" ? "Size on phones" : "Size in square", () => (E()[lk] ||= {}), "size", { optional: true, step: 0.5,
          cleanup: () => { const el = E(); if (el[lk] && !Object.keys(el[lk]).length) delete el[lk]; },
          placeholder: deskSize != null ? String(round(deskSize * layoutFallback(scene, lk, e).k)) : "" })
      : num("Size", E, "size", { optional: true, step: 0.5, placeholder: st.size ?? "" });
    out.push(section("Text",
      lk ? h("p", { class: "phone-flag" }, `${lk === "m" ? "📱 Size changes here apply to phones only" : "◻︎ Size changes here apply to the square layout only"}. The words, weight, colour and line height are shared with desktop.`) : null,
      richField(E, "Text", "rt-" + e.id),
      grid(2, select("What it is", E, "tag", TAGS, { fallback: "p" }), select("Align", E, "align", ["left", "center", "right"], { fallback: "left", optional: true })),
      select("Type style", E, "style", [{ value: "", label: "(none)" }, ...Object.keys(scene.styles || {})], { optional: true, rerender: true }),
      h("p", { class: "helper" }, "Leave these blank to use the type style."),
      grid(3, sizeField,
        select("Weight", E, "weight", [{ value: "", label: st.weight ? `(${st.weight})` : "(style)" }, ...WEIGHTS], { optional: true, number: false, apply: (v) => { if (v === "") delete E().weight; else E().weight = +v; } }),
        num("Line height", E, "lineHeight", { optional: true, step: 0.05, placeholder: st.lineHeight ?? "" })),
      kitTypeChips([{ kind: "size", get: lk ? () => (E()[lk] ||= {}) : E, key: "size", units: lk ? layoutCanvas(scene, lk).width : scene.canvas.width },
        { kind: "weight", get: E, key: "weight" }, { kind: "leading", get: E, key: "lineHeight" }]),
      num("Stretch sideways (1 = none)", E, "stretch", { optional: true, step: 0.01, min: 0.2, max: 5, placeholder: "1" }),
      check("Keep on one line (never wrap)", E, "nowrap", { optional: true }),
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

  // Position: desktop, phone or square, following the preview toggle
  const lk = layoutKey();
  if (lk) {
    const M = () => { const el = E(); return (el[lk] ||= {}); };
    const tidy = () => { const el = E(); if (el[lk] && !Object.keys(el[lk]).length) delete el[lk]; };
    const fb = e.type === "group" ? groupBoxIn(scene, { ...e, [lk]: null }, lk) : layoutFallback(scene, lk, e);
    const ph = (k) => String(round(fb[k]));
    out.push(section(`Position — ${LAYOUT_NAME[lk]} layout`,
      h("p", { class: "phone-flag" }, lk === "m" ? "📱 Editing the phone layout. Blank = keep the desktop position, scaled." : "◻︎ Editing the square layout. Blank = where it sits in the desktop design."),
      check(lk === "m" ? "Hide on phones" : "Hide in the square layout", M, "hidden", { optional: true, cleanup: tidy, apply: (on) => { if (on) M().hidden = true; else { delete M().hidden; tidy(); } }, rerender: true }),
      e[lk]?.hidden ? null : [grid(2, num("X", M, "x", { optional: true, cleanup: tidy, placeholder: ph("x") }), num("Y", M, "y", { optional: true, cleanup: tidy, placeholder: ph("y") })),
        grid(2, num("Width", M, "w", { optional: true, cleanup: tidy, placeholder: ph("w") }), num("Height", M, "h", { optional: true, cleanup: tidy, placeholder: ph("h") }))]));
  } else {
    out.push(section("Position",
      grid(2, num("X", E, "x"), num("Y", E, "y")),
      grid(2, num("Width", E, "w", { min: 0 }), num("Height", E, "h", { min: 0 })),
      e.type === "group" ? null : grid(2, num("Rotate °", E, "rotate", { optional: true, placeholder: "0" }), num("Opacity", E, "opacity", { optional: true, min: 0, max: 1, step: 0.05, placeholder: "1" })),
      h("p", { class: "helper" }, "Arrow keys nudge the selected layer (Shift = 10).")));
  }
  out.push(stackSection(e.id));
  if (e.type === "group") { out.push(layerActions(e)); return out; }
  out.push(section("Blend",
    select("Blend with what's behind", E, "blend", BLENDS.map((b) => ({ value: b, label: BLEND_LABELS[b] || b })), { fallback: "normal", apply: (v) => { if (v === "normal") delete E().blend; else E().blend = v; } }),
    h("p", { class: "helper" }, "Multiply makes white see-through and darkens what's underneath — right for pencil or ink drawn on white paper.")));

  const A = () => E().animate || {};
  const a = e.animate || {};
  const isFade = /^fade(In|Out)(Up|Down|Left|Right)$/.test(a.name || "");
  out.push(section("Animation",
    animField(),
    a.name ? [grid(2, num("Delay (s)", () => (E().animate ||= {}), "delay", { min: 0, step: 0.1, placeholder: "0" }), num("Duration (s)", () => (E().animate ||= {}), "duration", { min: 0.05, step: 0.1, placeholder: "1" })),
      select("Easing", () => (E().animate ||= {}), "easing", EASINGS, { fallback: "ease", optional: true }),
      isFade ? num("Travel (fraction of its size)", () => (E().animate ||= {}), "distance", { optional: true, min: 0, step: 0.05, placeholder: "0.1" }) : null,
      ANIMATIONS.attention.includes(a.name) ? check("Loop forever", () => (E().animate ||= {}), "loop", { optional: true }) : null,
      a.name === "brushIn" && e.type === "image" ? brushFields(e, E) : null] : null));

  out.push(layerActions(e));
  void A;
  return out;
}
function layerActions(e) {
  return h("div", { class: "actions" },
    h("button", { type: "button", class: "secondary mini", onclick: () => duplicate(e.id) }, "Duplicate"),
    h("button", { type: "button", class: "danger mini", onclick: () => { scene.elements = scene.elements.filter((x) => x.id !== e.id); sel = { kind: "scene" }; commit(); renderProps(); } }, "Delete layer"));
}

// ---------------------------------------------------------------- placed pieces (groups)
function groupFields(e, E) {
  const n = (e.elements || []).length, span = groupSpan(e), gc = e.canvas || {};
  const ratio = gc.width && gc.height ? gc.height / gc.width : null;
  const lk = layoutKey();
  const box = lk ? groupBoxIn(scene, e, lk) : e;
  const off = ratio && Math.abs(box.h - box.w * ratio) > Math.max(1, box.h * 0.01);
  return section("Placed piece",
    h("p", { class: "helper" }, `A copy of “${e.title || e.id}” — ${n} layer${n === 1 ? "" : "s"}, moved and sized as one. Changing the original later won't change this copy.`),
    num("Start after (seconds)", E, "start", { optional: true, min: 0, step: 0.1, placeholder: "0" }),
    h("p", { class: "helper" }, span ? `Delays everything inside it: it plays from ${fmtS(span.from)} to ${fmtS(span.to)}. Give each placed piece a later start to play them in turn.` : "Nothing inside it animates."),
    off ? h("p", { class: "phone-flag" }, `Its ${lk ? LAYOUT_NAME[lk] + " " : ""}box has been stretched out of proportion, which pulls its layers out of line.`) : null,
    h("div", { class: "actions" },
      ratio ? h("button", { type: "button", class: "secondary mini", disabled: !off, onclick: () => { const g = E(); if (lk) { const b = groupBoxIn(scene, g, lk); g[lk] = { ...(g[lk] || {}), x: round(b.x), y: round(b.y), w: round(b.w), h: round(b.w * ratio) }; } else g.h = round(g.w * ratio); commit(); renderProps(); drawOverlay(); } }, "Restore its proportions") : null,
      h("button", { type: "button", class: "secondary mini", title: "Turn it back into separate layers you can edit one by one", onclick: () => ungroup(e.id) }, "Ungroup")));
}
const fmtS = (n) => `${Math.round(n * 100) / 100}s`;

// The images inside a placed piece (and inside pieces placed in it), so each copy can show a different picture
// while keeping the same sequence: brush path, timings, blend and opacity all stay as they are.
function imagesIn(els, path = []) {
  return (els || []).flatMap((c) => c.type === "group" ? imagesIn(c.elements, [...path, c.id])
    : c.type === "image" ? [{ path: [...path, c.id], el: c }] : []);
}
function findInGroup(g, path) {
  let els = g?.elements, hit = null;
  for (const id of path) { hit = (els || []).find((x) => x.id === id); if (!hit) return null; els = hit.elements; }
  return hit;
}
// Take a layer out of a placed piece (this copy, or every copy of the same piece)
function removeInGroup(g, path) {
  const parent = path.length > 1 ? findInGroup(g, path.slice(0, -1)) : g;
  const els = parent?.elements; if (!els) return false;
  const i = els.findIndex((x) => x.id === path[path.length - 1]); if (i < 0) return false;
  els.splice(i, 1); return true;
}
// other placed copies of the same piece that have a layer at the same place
const copiesWith = (g, path) => scene.elements.filter((x) => x.type === "group" && x !== g && x.title === g.title && findInGroup(x, path));
// The text inside a placed piece (and inside pieces placed in it): change the words in this copy, keeping its look and timing
function textsIn(els, path = []) {
  return (els || []).flatMap((c) => c.type === "group" ? textsIn(c.elements, [...path, c.id])
    : c.type === "text" ? [{ path: [...path, c.id], el: c }] : []);
}
// The styling a layer inside a placed piece can have of its own (on top of the piece's type styles)
const TEXT_LOOK = ["size", "weight", "lineHeight", "color", "align", "italic", "letterSpacing"];
const SHAPE_LOOK = ["fill", "stroke", "strokeWidth", "opacity"];
// copy one layer's styling to the same layer in every other copy of the piece
function styleAllCopies(g, path, keys) {
  const src = findInGroup(g, path), others = copiesWith(g, path);
  others.forEach((x) => { const t = findInGroup(x, path); keys.forEach((k) => { if (src[k] === undefined) delete t[k]; else t[k] = src[k]; }); });
  commit(); renderProps(); toast(`Styling copied to ${others.length} other cop${others.length === 1 ? "y" : "ies"}`);
}
function groupTextSection(g) {
  const texts = textsIn(g.elements);
  if (!texts.length) return null;
  const gid = g.id;
  const kitHint = scene.kit ? null : h("p", { class: "phone-flag" }, `This piece has no client kit, so the kit's colours, sizes and weights aren't offered.${g.kit ? ` The placed piece was made with the ${g.kit.label} kit.` : ""} `,
    g.kit ? h("button", { type: "button", class: "link-btn", onclick: () => { scene.kit = { ...g.kit }; commit(); syncKit(); toast(`Using the ${g.kit.label} kit`); } }, `Use the ${g.kit.label} kit`)
      : h("button", { type: "button", class: "link-btn", onclick: () => choose({ kind: "scene" }, { reveal: true }) }, "Choose one in Scene settings"));
  return section("Text inside",
    h("p", { class: "helper" }, "Change the words and look here for this copy only — or double-click the words on the canvas. Position and animation stay as they are. Sizes are in the placed piece's own units."),
    kitHint,
    ...texts.map(({ path, el }) => {
      const G = () => findInGroup(elById(gid), path) || {};
      const st = (findStyles(elById(gid), path) || {})[el.style] || {};
      const others = copiesWith(g, path).length;
      const own = TEXT_LOOK.some((k) => el[k] !== undefined);
      return h("div", { class: "group-img" },
        h("div", { class: "group-img__head" },
          h("b", {}, path.join(" › ")),
          h("button", { type: "button", class: "danger mini", title: "Take this text out of this copy",
            onclick: () => { if (removeInGroup(elById(gid), path)) { commit(); renderProps(); toast(`Removed “${path.join(" › ")}”`); } } }, "Remove")),
        richField(G, "Text", "rt-" + gid + "-" + path.join("-"), (findHolder(elById(gid), path)?.canvas || {}).width || 1000, () => findStyles(elById(gid), path)),
        h("details", { class: "group-look", open: own || null },
          h("summary", {}, own ? "Styling (changed in this copy)" : "Styling"),
          h("p", { class: "helper" }, `Blank = the piece's ${el.style ? `“${el.style}” ` : ""}type style.`),
          grid(3, num("Size", G, "size", { optional: true, step: 0.5, placeholder: st.size ?? "" }),
            select("Weight", G, "weight", [{ value: "", label: st.weight ? `(${st.weight})` : "(style)" }, ...WEIGHTS], { optional: true, apply: (v) => { if (v === "") delete G().weight; else G().weight = +v; } }),
            num("Line height", G, "lineHeight", { optional: true, step: 0.05, placeholder: st.lineHeight ?? "" })),
          kitTypeChips([{ kind: "size", get: G, key: "size", units: (findHolder(elById(gid), path)?.canvas || {}).width || 1000 },
            { kind: "weight", get: G, key: "weight" }, { kind: "leading", get: G, key: "lineHeight" }, { kind: "tracking", get: G, key: "letterSpacing" }]),
          grid(2, select("Align", G, "align", [{ value: "", label: "(as placed)" }, "left", "center", "right"], { optional: true, apply: (v) => { if (v === "") delete G().align; else G().align = v; } }),
            h("div", {}, h("span", { class: "f" }, " "), check("Italic", G, "italic", { optional: true }))),
          colour("Colour", G, "color", { optional: true, placeholder: st.color || "style colour" }),
          h("div", { class: "actions" },
            h("button", { type: "button", class: "secondary mini", disabled: !own, onclick: () => { const t = G(); TEXT_LOOK.forEach((k) => delete t[k]); commit(); renderProps(); } }, "Back to the type style"),
            others ? h("button", { type: "button", class: "secondary mini", onclick: () => styleAllCopies(elById(gid), path, TEXT_LOOK) }, `Use this styling in all ${others + 1} copies`) : null)));
    }));
}
// the type styles that apply to a layer inside a placed piece: those of the innermost piece that holds it
function findHolder(g, path) {
  let holder = g, els = g?.elements;
  for (const id of path.slice(0, -1)) { holder = (els || []).find((x) => x.id === id); els = holder?.elements; }
  return holder;
}
const findStyles = (g, path) => findHolder(g, path)?.styles;
// a drawn layer (".ha-g-piece .ha-e-piece-quote") → the text layer inside the placed piece, as { gid, path }
function groupTextOf(node) {
  const cls = [...node.classList], gk = cls.find((k) => k.startsWith("ha-g-")), ek = cls.find((k) => k.startsWith("ha-e-"));
  if (!gk || !ek) return null;
  const g = scene.elements.find((x) => x.type === "group" && slug(x.id) === gk.slice(5)); if (!g) return null;
  const hit = textsIn(g.elements).find(({ path }) => slug(`${g.id}-${path.join("-")}`) === ek.slice(5));
  return hit ? { gid: g.id, path: hit.path } : null;
}
function shapesIn(els, path = []) {
  return (els || []).flatMap((c) => c.type === "group" ? shapesIn(c.elements, [...path, c.id])
    : ["rect", "ellipse", "line"].includes(c.type) ? [{ path: [...path, c.id], el: c }] : []);
}
function groupShapesSection(g) {
  const shapes = shapesIn(g.elements);
  if (!shapes.length) return null;
  const gid = g.id;
  return section("Shapes inside",
    h("p", { class: "helper" }, "Recolour boxes, circles and lines for this copy only."),
    ...shapes.map(({ path, el }) => {
      const G = () => findInGroup(elById(gid), path) || {};
      const others = copiesWith(g, path).length;
      return h("div", { class: "group-img" },
        h("div", { class: "group-img__head" }, h("b", {}, path.join(" › "))),
        el.type === "line" ? grid(2, colour("Colour", G, "stroke"), num("Thickness", G, "strokeWidth", { min: 0.5, step: 0.5 }))
          : [colour("Fill", G, "fill", { optional: true }), grid(2, colour("Border", G, "stroke", { optional: true }), num("Border width", G, "strokeWidth", { optional: true, min: 0, placeholder: "0" }))],
        num("Opacity", G, "opacity", { optional: true, min: 0, max: 1, step: 0.05, placeholder: "1" }),
        others ? h("div", { class: "actions" }, h("button", { type: "button", class: "secondary mini", onclick: () => styleAllCopies(elById(gid), path, SHAPE_LOOK) }, `Use these colours in all ${others + 1} copies`)) : null);
    }));
}
function groupImagesSection(g) {
  const imgs = imagesIn(g.elements);
  if (!imgs.length) return null;
  const gid = g.id;
  const remove = (path, all) => {
    const gs = [elById(gid), ...(all ? copiesWith(elById(gid), path) : [])];
    const n = gs.filter((x) => removeInGroup(x, path)).length;
    commit(); renderProps();
    toast(n > 1 ? `Removed “${path.join(" › ")}” from ${n} copies` : `Removed “${path.join(" › ")}”`);
  };
  return section("Images inside",
    h("p", { class: "helper" }, "Swap a picture here to change it in this copy only. Everything else about the sequence stays the same."),
    ...imgs.map(({ path, el }) => {
      const G = () => findInGroup(elById(gid), path) || {};
      return h("div", { class: "group-img" },
        h("div", { class: "group-img__head" },
          el.src ? h("img", { class: "img-thumb small", src: el.src, alt: "" }) : null,
          h("b", {}, path.join(" › "), el.src ? null : h("span", { class: "phone-flag inline" }, " no image — replace or remove")),
          h("button", { type: "button", class: "secondary mini", onclick: () => openUploader({ group: gid, path }) }, "Replace…"),
          h("button", { type: "button", class: "danger mini", title: "Take this image out of this copy", onclick: () => remove(path, false) }, "Remove")),
        (() => { const others = copiesWith(g, path).length;
          return others ? h("button", { type: "button", class: "link-btn", onclick: () => remove(path, true) }, `Remove it from all ${others + 1} copies of “${g.title}”`) : null; })(),
        text("Image URL", G, "src", { apply: (v) => { G().src = v.trim(); } }),
        check("Decorative (no alt text needed)", G, "decorative", { optional: true, rerender: true }),
        el.decorative ? null : text("Alt text", G, "alt", { placeholder: "Describe what the image shows" }));
    }));
}

// Place another piece inside this one, as a group: a copy of its layers in one movable, resizable box
function placeScene(src) {
  if (!src?.canvas?.width || !src?.canvas?.height || !Array.isArray(src.elements)) { toast("That isn't a Fluke piece"); return; }
  const W = scene.canvas.width, H = scene.canvas.height, sw = src.canvas.width, sh = src.canvas.height;
  const n = scene.elements.filter((e) => e.type === "group").length;
  let w = W * 0.3, hh = w * sh / sw;
  if (hh > H * 0.8) { hh = H * 0.8; w = hh * sw / sh; }
  // side by side, left to right, each starting a little after the one before
  const x = Math.max(0, Math.min(W - w, W * 0.05 + n * (w + W * 0.03))), y = (H - hh) / 2;
  const z = Math.max(0, ...scene.elements.map((e, i) => e.z ?? i + 1)) + 1;
  const g = { id: uniqueId(src.id || "piece"), type: "group", title: src.title || src.id || "Placed piece",
    x: round(x), y: round(y), w: round(w), h: round(hh), z, start: round(n * 0.6),
    canvas: { width: sw, height: sh }, styles: structuredClone(src.styles || {}), elements: structuredClone(src.elements) };
  if (!g.start) delete g.start;
  if (src.kit?.id) g.kit = { id: src.kit.id, label: src.kit.label };
  const adopt = !scene.kit && g.kit;
  if (adopt) scene.kit = { ...g.kit };
  scene.elements = [...scene.elements, g];
  sel = { kind: "element", id: g.id };
  commit(); renderProps(); if (adopt) syncKit();
  toast(`Placed “${g.title}”${g.start ? ` — starts after ${g.start}s` : ""}${adopt ? ` · using its ${g.kit.label} kit` : ""}`, 3500);
}
// A placed piece back to separate layers, where it sat in the stack and in reading order
function ungroup(id) {
  const g = elById(id); if (!g) return;
  const kids = flattenGroups({ ...scene, elements: [g] }).elements.map(({ group, ...k }) => k);
  kids.forEach((k) => { k.id = uniqueId(k.id); });
  const order = stackOrder().flatMap((e) => (e === g ? [...kids].sort((a, b) => a.z - b.z) : [e]));
  const i = scene.elements.indexOf(g);
  scene.elements.splice(i, 1, ...kids);
  order.forEach((e, k) => { e.z = k + 1; });
  sel = { kind: "scene" }; commit(); renderProps();
  toast(`Ungrouped into ${kids.length} layers`);
}
const BLEND_LABELS = { normal: "Normal", multiply: "Multiply (white disappears)", screen: "Screen (black disappears)", darken: "Darken",
  lighten: "Lighten", overlay: "Overlay", "color-burn": "Colour burn", "soft-light": "Soft light" };
function brushFields(e, E) {
  const B = () => (E().brush ||= {});
  const tidy = () => { const el = E(); if (el.brush && !Object.keys(el.brush).length) delete el.brush; };
  const drawing = isBrushing() === e.id;
  const cur = brushOf(e);
  return [
    h("div", { class: "actions" },
      h("button", { type: "button", class: drawing ? "secondary mini" : "primary mini", onclick: () => (drawing ? stopBrushDraw() : startBrushDraw(e.id)) },
        drawing ? "Done drawing" : e.brush?.points ? "Edit the brush path" : "Draw the brush path"),
      e.brush?.points ? h("button", { type: "button", class: "secondary mini", onclick: () => { delete E().brush.points; tidy(); commit(); renderProps(); drawOverlay(); } }, "Straight across") : null),
    grid(2, num("Brush size (× width)", B, "width", { optional: true, cleanup: tidy, min: 0.02, step: 0.01, placeholder: String(Math.round(cur.width * 100) / 100) }),
      num("Soft edge (0–1)", B, "soft", { optional: true, cleanup: tidy, min: 0, max: 1, step: 0.05, placeholder: "0.25" })),
    h("p", { class: "helper" }, e.brush?.points
      ? "The image is revealed along the path, in the order you drew it. Make the brush wide enough that the band covers the whole stroke."
      : "Without a path the brush sweeps straight across from left to right. Draw one to follow the real stroke: click where the paint starts, then along its route."),
  ];
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
  if (pickTarget && typeof pickTarget === "object") {
    const inner = findInGroup(elById(pickTarget.group), pickTarget.path);
    if (!inner) return toast("That image no longer exists");
    inner.src = d.url; commit(); renderProps();
    return toast(`Image swapped${d.name ? ": " + d.name : ""}${inner.alt || inner.decorative ? " — check the alt text still fits" : " — now add alt text"}`, 3000);
  }
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
function weightOptions(st) {
  const gf = st.source === "google" && st.family ? googleFont(st.family) : null;
  return gf ? gf.weights.map((w) => ({ value: w, label: String(w) })) : WEIGHTS;
}
function fontField(St) {
  const inp = h("input", { type: "text", value: St().family || "", placeholder: "blank = the story's font", "aria-describedby": "fontWhere" });
  inp.addEventListener("input", () => {
    const st = St();
    st.family = inp.value;
    // a name that matches a Google Font becomes a Google Font, so it actually loads
    const gf = googleFont(inp.value);
    if (gf) {
      st.source = "google";
      if (gf.family !== inp.value) st.family = gf.family;
      if (!gf.weights.includes(+st.weight)) st.weight = nearestWeight(gf.weights, +st.weight || 400);
      if (!st.fallback) st.fallback = gf.cat === "r" ? "Georgia, serif" : gf.cat === "m" ? "monospace" : "system-ui, sans-serif";
    } else if (st.source === "google") st.source = "story";
    commit("family");
    const helper = document.getElementById("fontWhere"); if (helper) helper.textContent = fontWhere(st);
  });
  inp.addEventListener("change", () => renderProps()); // refresh the weight list once typing is done
  const btn = h("button", { type: "button", class: "secondary mini", onclick: () => openFontPicker({ current: St().family, kit, onPick: (c) => {
    const st = St();
    st.family = c.family; st.source = c.source;
    if (c.fallback) st.fallback = c.fallback;
    if (c.weights?.length && !c.weights.includes(st.weight)) st.weight = nearestWeight(c.weights, st.weight || 400);
    commit(); renderProps();
  } }) }, "Choose…");
  return h("div", { class: "f-group" }, h("div", { class: "font-row" }, field("Font", inp), btn), h("span", { class: "helper", id: "fontWhere" }, fontWhere(St())));
}
function fontWhere(st) {
  if (!st.family) return "Uses the story's font.";
  if (st.source === "google") return "Google Font — added to the piece automatically.";
  return fontInstalled(st.family)
    ? "The story must already load this font."
    : "The story must already load this font. It isn't installed on this computer, so the preview can't show it.";
}
// Is a font available to this browser (installed, or loaded by the page)? Compares text widths against two fallbacks.
const fontCheckCache = new Map();
function fontInstalled(family) {
  if (fontCheckCache.has(family)) return true;
  // declared by the page (e.g. a kit's own font files) counts, even before it has downloaded
  const want = family.replace(/["']/g, "").toLowerCase();
  if ([...document.fonts].some((f) => f.family.replace(/["']/g, "").toLowerCase() === want)) { fontCheckCache.set(family, true); return true; }
  const c = document.createElement("canvas").getContext("2d"), sample = "mmmmmmmmmmlli1WQ@#";
  let differs = false;
  for (const base of ["monospace", "serif", "sans-serif"]) {
    c.font = `40px ${base}`; const a = c.measureText(sample).width;
    c.font = `40px "${family.replace(/"/g, "")}", ${base}`; const b = c.measureText(sample).width;
    if (Math.abs(a - b) > 0.5) { differs = true; break; }
  }
  if (differs) fontCheckCache.set(family, true); // only remember "found": a font may still arrive later
  return differs;
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

// Infogram pages can't be read from another site, so Harpoon Upload fetches the page and returns its scene data.
const isInfogramLink = (v) => /^https?:\/\/([a-z0-9-]+\.)*infogram\.com\//i.test(String(v).trim());
async function importInfogramLink(link) {
  link = String(link).trim();
  if (!isInfogramLink(link)) throw new Error("That isn't an infogram.com link");
  toast("Fetching from Infogram…");
  let r;
  try { r = await fetch(`${UPLOAD_ORIGIN}/api/infogram?url=${encodeURIComponent(link)}`); }
  catch { throw new Error("Couldn't reach Harpoon Upload to fetch the page — try again, or save the page and choose the file"); }
  if (!r.ok) {
    let msg = `Couldn't fetch that page (${r.status})`;
    try { msg = (await r.json()).error || msg; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  const { scene: s, warnings } = await importInfogram(await r.text());
  setScene(s, warnings);
  toast(`Imported “${s.title}”`);
}
async function importInfogramFile(file) {
  let html;
  if (/\.zip$/i.test(file.name)) {
    if (!window.JSZip) throw new Error("The zip reader didn't load — unzip it and choose index.html instead");
    const zip = await window.JSZip.loadAsync(file);
    const idx = Object.keys(zip.files).filter((n) => /(^|\/)index\.html?$/i.test(n)).sort((a, b) => a.length - b.length)[0];
    if (!idx) throw new Error("No index.html in that zip");
    html = await zip.file(idx).async("string");
  } else html = await file.text();
  const { scene: s, warnings } = await importInfogram(html);
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
  return renderScene(scene, { runtimeCss: runtime.css, runtimeJs: runtime.js, includeRuntime: tab === "piece", embedSource: true, fontInfo: googleFont });
}
function showTab(t) {
  tab = t;
  $$("#exportModal [role=tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === t));
  $("#exportNote").textContent = NOTES[t];
  const txt = exportText();
  $("#exportCode").textContent = txt;
  $("#exportSize").textContent = `${(new Blob([txt]).size / 1024).toFixed(1)} KB`;
}


// ---------------------------------------------------------------- zoom (editor only: the piece itself doesn't change)
// "Fit" is the normal view. Zooming widens the preview and the stage scrolls; the overlay works from screen positions,
// so selecting, dragging and brush drawing carry on working at any zoom.
const ZOOMS = [1, 1.5, 2, 3, 4, 6, 8], ZMAX = 8;
let zoom = 1;
function fitWidth() {
  const st = $("#stage"), cs = getComputedStyle(st);
  return Math.min(st.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), view === "phone" ? 375 : view === "square" ? SQUARE_PREVIEW : 900);
}
function applyZoom() {
  const p = $("#preview"), inner = $("#stageInner");
  $("#stage").classList.toggle("zoomed", zoom > 1);
  if (zoom === 1) { p.style.width = p.style.maxWidth = inner.style.width = ""; }
  else { const w = Math.round(fitWidth() * zoom); p.style.width = w + "px"; p.style.maxWidth = "none"; inner.style.width = w + "px"; }
  $("#zoomLabel").textContent = zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`;
  $("#zoomOut").disabled = zoom <= 1; $("#zoomIn").disabled = zoom >= ZMAX;
}
// at: the screen point that should stay put (or, with `to`, end up at `to`)
function setZoom(z, at = null, to = at) {
  z = Math.max(1, Math.min(ZMAX, Math.round(z * 100) / 100));
  if (z === zoom) return;
  const st = $("#stage"), sr = st.getBoundingClientRect();
  const mid = { x: sr.left + st.clientWidth / 2, y: sr.top + Math.min(st.clientHeight, innerHeight - sr.top) / 2 };
  if (!at) {
    // buttons and keys zoom in on the selected layer, if there is one
    const node = sel.kind === "element" ? $(`#preview .ha-e-${slug(sel.id)}`) : null, r = node?.getBoundingClientRect();
    if (r && r.width) { at = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; to = mid; } else at = to = mid;
  }
  const p0 = $("#preview").getBoundingClientRect();
  const fx = (at.x - p0.left) / p0.width, fy = (at.y - p0.top) / p0.height;
  zoom = z; applyZoom();
  const p1 = $("#preview").getBoundingClientRect();
  st.scrollLeft += p1.left + fx * p1.width - to.x;
  st.scrollTop += p1.top + fy * p1.height - to.y;
  drawOverlay();
}
const zoomStep = (dir) => setZoom(dir > 0 ? ZOOMS.find((z) => z > zoom + 0.01) ?? ZMAX : [...ZOOMS].reverse().find((z) => z < zoom - 0.01) ?? 1);
function wireZoom() {
  const st = $("#stage");
  $("#zoomIn").addEventListener("click", () => zoomStep(1));
  $("#zoomOut").addEventListener("click", () => zoomStep(-1));
  $("#zoomLabel").addEventListener("click", () => setZoom(1));
  // pinch on a trackpad, or Cmd/Ctrl + scroll wheel, zooms around the pointer
  st.addEventListener("wheel", (ev) => {
    if (!ev.ctrlKey && !ev.metaKey) return;
    ev.preventDefault();
    setZoom(zoom * Math.exp(-ev.deltaY * (ev.ctrlKey && !ev.metaKey ? 0.01 : 0.002)), { x: ev.clientX, y: ev.clientY });
  }, { passive: false });
  // hold Space and drag to move around
  let space = false;
  const typingIn = (t) => t instanceof Element && t.closest("input, textarea, select, button, [contenteditable], .anim-pop");
  document.addEventListener("keydown", (ev) => {
    if (ev.code === "Space" && zoom > 1 && !typingIn(ev.target) && !$(".modal.open")) { ev.preventDefault(); if (!space) { space = true; st.classList.add("panning"); } }
  });
  document.addEventListener("keyup", (ev) => { if (ev.code === "Space") { space = false; st.classList.remove("panning"); } });
  st.addEventListener("pointerdown", (ev) => {
    if (!space) return;
    ev.preventDefault(); ev.stopPropagation();
    const x0 = ev.clientX, y0 = ev.clientY, l0 = st.scrollLeft, t0 = st.scrollTop;
    st.setPointerCapture(ev.pointerId); st.classList.add("grabbing");
    const move = (m) => { st.scrollLeft = l0 - (m.clientX - x0); st.scrollTop = t0 - (m.clientY - y0); };
    const up = () => { st.classList.remove("grabbing"); st.removeEventListener("pointermove", move); st.removeEventListener("pointerup", up); st.removeEventListener("pointercancel", up); };
    st.addEventListener("pointermove", move); st.addEventListener("pointerup", up); st.addEventListener("pointercancel", up);
  }, true);
  addEventListener("resize", () => { if (zoom > 1) { applyZoom(); drawOverlay(); } });
  applyZoom();
}

// ---------------------------------------------------------------- wiring
function wire() {
  wireZoom();
  $("#sceneBtn").addEventListener("click", () => choose({ kind: "scene" }, { reveal: true }));
  $("#libStatus").addEventListener("click", () => saveToLibrary());
  $("#addStyleBtn").addEventListener("click", addStyle);
  $$("[data-add]").forEach((b) => b.addEventListener("click", () => addElement(b.dataset.add)));
  $$("[data-view]").forEach((b) => b.addEventListener("click", () => {
    view = b.dataset.view; $$("[data-view]").forEach((x) => x.setAttribute("aria-pressed", x === b)); renderPreview(); applyZoom(); renderProps();
  }));
  $$("[data-frame]").forEach((b) => b.addEventListener("click", () => {
    frame = b.dataset.frame; scrubT = null; hidePlayhead(); $$("[data-frame]").forEach((x) => x.setAttribute("aria-pressed", x === b)); renderPreview();
  }));
  $("#playBtn").addEventListener("click", play);
  $("#undoBtn").addEventListener("click", undo);
  $("#redoBtn").addEventListener("click", redo);
  $("#newBtn").addEventListener("click", () => {
    // the kind picked last time is the default
    openModal("#newModal"); $(`#newModal [data-new="${store.get(LASTKIND_KEY) || "screen"}"]`)?.focus();
  });
  $$("[data-new]").forEach((b) => b.addEventListener("click", async () => {
    closeModals(); store.set(LASTKIND_KEY, b.dataset.new);
    const s = blankScene(b.dataset.new), last = store.get(LASTKIT_KEY);
    if (last) {
      try { const k = await loadKit(last); s.kit = { id: k.id, label: k.label }; s.styles = kitStyles(k, s.canvas.width); toast(`New piece with the ${k.label} kit`); }
      catch { /* kit gone: plain piece */ }
    }
    setScene(s);
  }));
  $("#openBtn").addEventListener("click", () => openModal("#openModal"));
  $("#libraryBtn").addEventListener("click", () => openLibrary());
  $("#placeFromLibrary").addEventListener("click", () => { closeModals(); openLibrary({ place: true }); });
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
  const linkImport = async () => {
    const v = $("#infogramUrl").value;
    if (!v.trim()) return toast("Paste an Infogram link first");
    try { await importInfogramLink(v); $("#infogramUrl").value = ""; closeModals(); } catch (e) { toast(e.message); }
  };
  $("#infogramUrlBtn").addEventListener("click", linkImport);
  $("#infogramUrl").addEventListener("keydown", (ev) => { if (ev.key === "Enter") linkImport(); });
  $("#infogramFile").addEventListener("change", async (ev) => {
    const f = ev.target.files[0]; ev.target.value = ""; if (!f) return;
    try { await importInfogramFile(f); closeModals(); } catch (e) { toast(e.message); }
  });
  $("#placeFile").addEventListener("change", async (ev) => {
    const f = ev.target.files[0]; ev.target.value = ""; if (!f) return;
    try { const txt = await f.text(); const s = /^\s*</.test(txt) ? extractScene(txt) : JSON.parse(txt); closeModals(); placeScene(s); }
    catch (e) { toast("Couldn't read that file: " + e.message); }
  });
  $("#jsonFile").addEventListener("change", async (ev) => {
    const f = ev.target.files[0]; ev.target.value = ""; if (!f) return;
    try { setScene(JSON.parse(await f.text())); closeModals(); } catch (e) { toast("Couldn't read that file: " + e.message); }
  });
  $("#pasteBtn").addEventListener("click", async () => {
    const pasted = $("#pasteHtml").value.trim();
    if (isInfogramLink(pasted)) {
      try { await importInfogramLink(pasted); $("#pasteHtml").value = ""; closeModals(); } catch (e) { toast(e.message); }
      return;
    }
    try { const s = extractScene(pasted); if (!s) return toast("No Fluke piece found in that HTML"); setScene(s); $("#pasteHtml").value = ""; closeModals(); toast("Opened"); }
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
    // Cmd+ / Cmd- / Cmd0 zoom the canvas, not the whole page
    if ((ev.metaKey || ev.ctrlKey) && !typing && !$(".modal.open") && ["=", "+", "-", "_", "0"].includes(ev.key)) {
      ev.preventDefault(); if (ev.key === "0") setZoom(1); else zoomStep(ev.key === "-" || ev.key === "_" ? -1 : 1); return;
    }
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
    const lk = layoutKey();
    const t = lk ? (e[lk] ||= {}) : e;
    if (lk) { const b = e.type === "group" ? groupBoxIn(scene, e, lk) : layoutFallback(scene, lk, e); t.x ??= round(b.x); t.y ??= round(b.y); }
    if (ev.key === "ArrowLeft") t.x = round(t.x - step); if (ev.key === "ArrowRight") t.x = round(t.x + step);
    if (ev.key === "ArrowUp") t.y = round(t.y - step); if (ev.key === "ArrowDown") t.y = round(t.y + step);
    commit("nudge"); renderProps();
  });
}

// ---------------------------------------------------------------- start
const api = {
  get scene() { return scene; }, get sel() { return sel; }, get view() { return view; }, layoutKey, layoutCanvas, layoutFallback, groupBoxIn,
  choose, commit, renderProps, slug, stack, stackPos, toast,
  getScene: () => scene,
  scrubTo, endScrub, getScrub: () => scrubT,
  loadScene: (s) => setScene(s, [], { keepLibrary: true }),
  renderStatic: (s) => previewHtml(s),
  renderPreview, brushOf, brushPathD, placeScene, groupSpan, groupPhoneBox, rtSwatches, rtFonts, rtType, groupTextOf, findInGroup, findHolder,
};
async function start() {
  await loadOptionalParts();
  wire();
  initCanvas(api);
  initTimeline(api, ANIMATIONS);
  try {
    const [c, j] = await Promise.all([fetch("../runtime/ha.css?v=a35c7f4").then((r) => r.text()), fetch("../runtime/ha.js?v=a35c7f4").then((r) => r.text())]);
    runtime.css = c; runtime.js = j; $("#runtimeCss").textContent = c;
  } catch (e) { toast("Couldn't load the animation code: " + e.message); }
  let s = null;
  const draft = store.get(DRAFT_KEY);
  if (draft) { try { s = JSON.parse(draft); } catch { s = null; } }
  if (!s) { try { s = await (await fetch("../scenes/ardalan-quote.json")).json(); } catch { s = blankScene(); } }
  scene = s; current = JSON.stringify(s);
  initLibrary(api); // before the first refresh, which shows the library status
  refreshAll();
  if (failedParts.length) toast(`Some parts didn't load (${failedParts.join(", ")}). Everything else works — reload the page to get them back.`);
  loadFontList().then(() => { if (sel.kind === "style") renderProps(); }).catch(() => {});
}
start();
