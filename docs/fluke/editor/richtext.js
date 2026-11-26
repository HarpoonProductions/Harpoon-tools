// Fluke editor — text with styled words.
// A text box you can type in (contenteditable) plus a small toolbar: select words, then make them bold, italic, another
// colour, another font or another size. The layer keeps `text` (the plain words, used everywhere else) and, only when
// some words are styled, `runs`: the same words in pieces, each with its own look (see RUN_KEYS in src/render.js).

import { RUN_KEYS, runsOf } from "../src/render.js?v=600dd1e";

const SIZES = [0.5, 0.6, 0.75, 0.9, 1, 1.25, 1.5, 2, 2.5, 3];

// ---------------------------------------------------------------- runs
const styleOf = (r) => Object.fromEntries(RUN_KEYS.filter((k) => r[k] != null && r[k] !== false && !(k === "size" && r[k] === 1)).map((k) => [k, r[k]]));
const sameStyle = (a, b) => JSON.stringify(styleOf(a)) === JSON.stringify(styleOf(b));
export function normalise(runs) {
  const out = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = out[out.length - 1];
    if (last && sameStyle(last, r)) last.text += r.text; else out.push({ text: r.text, ...styleOf(r) });
  }
  return out;
}
export const runsFor = (e) => (runsOf(e) ? runsOf(e).map((r) => ({ ...r })) : [{ text: String(e?.text ?? "") }]);
// Store runs on the layer: plain words always; runs only when something is styled
export function writeRuns(e, runs) {
  const n = normalise(runs);
  e.text = n.map((r) => r.text).join("");
  if (n.some((r) => Object.keys(styleOf(r)).length)) e.runs = n; else delete e.runs;
}
// Apply a change of look to the characters start..end (a null value takes that styling off)
export function applyStyle(runs, start, end, patch) {
  const out = []; let at = 0;
  for (const r of runs) {
    const a = at, b = at + r.text.length; at = b;
    const cut = [[a, Math.max(a, Math.min(b, start))], [Math.max(a, start), Math.min(b, end)], [Math.min(b, Math.max(a, end)), b]];
    cut.forEach(([x, y], i) => {
      if (y <= x) return;
      const piece = { ...r, text: r.text.slice(x - a, y - a) };
      if (i === 1) for (const [k, v] of Object.entries(patch)) { if (v == null || v === false) delete piece[k]; else piece[k] = v; }
      out.push(piece);
    });
  }
  return normalise(out);
}
// The look shared by every character in start..end (for showing which buttons are on)
export function styleAt(runs, start, end) {
  const inside = []; let at = 0;
  for (const r of runs) { const a = at, b = at + r.text.length; at = b; if (b > start && a < Math.max(end, start + 1)) inside.push(r); }
  if (!inside.length) return {};
  return Object.fromEntries(RUN_KEYS.map((k) => [k, inside.every((r) => r[k] === inside[0][k]) ? inside[0][k] : undefined]).filter(([, v]) => v != null));
}

// ---------------------------------------------------------------- the editable box
const cssFor = (r) => ({
  fontWeight: r.weight ? String(r.weight) : r.b ? "bold" : "", fontStyle: r.i ? "italic" : "", color: r.color || "",
  fontFamily: r.family ? `"${r.family}", ${r.fallback || "system-ui, sans-serif"}` : "", fontSize: r.size && r.size !== 1 ? r.size + "em" : "",
});
function paint(box, runs) {
  box.replaceChildren(...runs.filter((r) => r.text).map((r) => {
    const s = document.createElement("span");
    s.dataset.run = JSON.stringify(styleOf(r)); s.textContent = r.text; Object.assign(s.style, cssFor(r));
    return s;
  }));
}
// Read the box back into runs: each piece of text takes the look of the styled span it sits in
function read(box) {
  const runs = [];
  let lastLeaf = box; while (lastLeaf.lastChild) lastLeaf = lastLeaf.lastChild; // a <br> here is only the browser keeping an empty line open
  const walk = (node, style) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) runs.push({ text: c.nodeValue, ...style });
      else if (c.nodeName === "BR") { if (c !== lastLeaf) runs.push({ text: "\n", ...style }); }
      else if (c.nodeType === 1) {
        let st = style;
        if (c.dataset?.run) { try { st = JSON.parse(c.dataset.run); } catch { /* keep */ } }
        const block = /^(DIV|P)$/.test(c.nodeName) && runs.length && !runs[runs.length - 1].text.endsWith("\n");
        if (block) runs.push({ text: "\n", ...style });
        walk(c, st);
      }
    }
  };
  walk(box, {});
  return normalise(runs);
}
// anything other than our own spans (the browser adds its own when you delete across styles): redraw it cleanly
const untidy = (box) => [...box.childNodes].some((c) => c.nodeType === 3 || !c.dataset?.run || c.children.length);
function offsets(box) {
  const s = getSelection(); if (!s.rangeCount) return null;
  const r = s.getRangeAt(0); if (!box.contains(r.startContainer) || !box.contains(r.endContainer)) return null;
  const pos = (node, off) => { const pre = document.createRange(); pre.selectNodeContents(box); pre.setEnd(node, off); return pre.toString().length; };
  return [pos(r.startContainer, r.startOffset), pos(r.endContainer, r.endOffset)];
}
function select(box, start, end) {
  const find = (n) => {
    const w = document.createTreeWalker(box, NodeFilter.SHOW_TEXT); let at = 0, t, last = null;
    while ((t = w.nextNode())) { last = t; if (n <= at + t.nodeValue.length) return [t, n - at]; at += t.nodeValue.length; }
    return last ? [last, last.nodeValue.length] : [box, 0];
  };
  const r = document.createRange(); r.setStart(...find(start)); r.setEnd(...find(end));
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  kids.flat().forEach((k) => k != null && el.append(k.nodeType ? k : document.createTextNode(k)));
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v); else if (k === "class") el.className = v; else el.setAttribute(k, v === true ? "" : v);
  }
  return el;
};

/**
 * A text box with a styling toolbar.
 *   get()        → the text layer being edited (read fresh each time: the scene may have been replaced by undo)
 *   commit()     → called after every change
 *   swatches()   → [{ value, name }] colours to offer (kit colours first)
 *   fonts()      → [{ family, source, fallback, label }] fonts to offer
 * Returns { el (box + toolbar), box, bar, focus(all) }.
 */
export function richText({ get, commit, swatches = () => [], fonts = () => [], sizes = () => [], baseSize = () => 0, weights = () => [], label = "Text", compact = false }) {
  const box = h("div", { class: "rt-box", contenteditable: "true", role: "textbox", "aria-multiline": "true", "aria-label": label, spellcheck: "true" });
  paint(box, runsFor(get()));
  let last = null; // the selection when the box last had it, for toolbar controls that take focus
  const remember = () => { const o = offsets(box); if (o) last = o; refresh(); };

  const change = () => {
    const runs = read(box);
    if (untidy(box)) { const o = offsets(box); paint(box, runs); if (o) select(box, ...o); }
    writeRuns(get(), runs); commit();
  };
  box.addEventListener("input", change);
  box.addEventListener("beforeinput", (ev) => {
    // the browser's own formatting would add tags we don't keep: route it through the toolbar instead
    if (ev.inputType === "formatBold") { ev.preventDefault(); toggle("b"); }
    else if (ev.inputType === "formatItalic") { ev.preventDefault(); toggle("i"); }
    else if (ev.inputType.startsWith("format") || ev.inputType === "insertFromDrop") ev.preventDefault();
    else if (ev.inputType === "insertParagraph") { ev.preventDefault(); document.execCommand("insertText", false, "\n"); }
  });
  box.addEventListener("keydown", (k) => {
    if ((k.metaKey || k.ctrlKey) && !k.shiftKey && (k.key === "b" || k.key === "i")) { k.preventDefault(); toggle(k.key); }
  });
  box.addEventListener("paste", (ev) => { ev.preventDefault(); document.execCommand("insertText", false, ev.clipboardData.getData("text/plain")); });
  ["keyup", "mouseup", "focus"].forEach((t) => box.addEventListener(t, remember));
  const onSel = () => { if (!box.isConnected) return document.removeEventListener("selectionchange", onSel); if (document.activeElement === box) remember(); };
  document.addEventListener("selectionchange", onSel);

  function apply(patch) {
    const sel = offsets(box) || last;
    if (!sel || sel[0] === sel[1]) { flash("Select some words first"); return; }
    const runs = applyStyle(read(box), sel[0], sel[1], patch);
    writeRuns(get(), runs); paint(box, runsFor(get())); box.focus(); select(box, ...sel); last = sel; commit(); refresh();
  }
  function toggle(k) { const sel = offsets(box) || last; if (!sel) return; const cur = styleAt(read(box), ...sel); apply({ [k]: cur[k] ? null : true }); }

  // ---- toolbar
  const keep = (ev) => ev.preventDefault(); // buttons don't take the selection away from the box
  const btnB = h("button", { type: "button", class: "rt-btn rt-b", title: "Bold (⌘B)", "aria-label": "Bold", onmousedown: keep, onclick: () => toggle("b") }, "B");
  const btnI = h("button", { type: "button", class: "rt-btn rt-i", title: "Italic (⌘I)", "aria-label": "Italic", onmousedown: keep, onclick: () => toggle("i") }, "I");
  const colours = h("span", { class: "rt-colours", role: "group", "aria-label": "Colour of the selected words" });
  const pickColour = h("input", { type: "color", class: "rt-pick", title: "Any colour", "aria-label": "Any colour" });
  pickColour.addEventListener("input", () => apply({ color: pickColour.value.toUpperCase() }));
  const font = h("select", { class: "rt-select", "aria-label": "Font of the selected words", title: "Font" });
  font.addEventListener("change", () => { const f = font.value ? JSON.parse(font.value) : null; apply(f ? { family: f.family, source: f.source, fallback: f.fallback } : { family: null, source: null, fallback: null }); });
  const size = h("select", { class: "rt-select", "aria-label": "Size of the selected words", title: "Size of the selected words" });
  size.addEventListener("change", () => apply({ size: +size.value === 1 ? null : +size.value }));
  const weight = h("select", { class: "rt-select", "aria-label": "Weight of the selected words", title: "Weight of the selected words" });
  weight.addEventListener("change", () => apply({ weight: weight.value ? +weight.value : null }));
  const clear = h("button", { type: "button", class: "rt-btn", title: "Take the styling off the selected words", onmousedown: keep,
    onclick: () => apply(Object.fromEntries(RUN_KEYS.map((k) => [k, null]))) }, "Clear");
  const note = h("span", { class: "rt-note" });
  const bar = h("div", { class: `rt-bar${compact ? " compact" : ""}`, role: "toolbar", "aria-label": "Style the selected words" },
    btnB, btnI, colours, pickColour, font, weight, size, clear, note);

  function fillChoices() {
    colours.replaceChildren(...swatches().map((s) => h("button", { type: "button", class: "sw rt-sw", style: `background:${s.value}`, title: s.name, "aria-label": s.name,
      onmousedown: keep, onclick: () => apply({ color: s.value }) })),
      h("button", { type: "button", class: "rt-btn rt-x", title: "Back to the text's own colour", "aria-label": "Text's own colour", onmousedown: keep, onclick: () => apply({ color: null }) }, "×"));
    font.replaceChildren(h("option", { value: "" }, "Font: as the text"),
      ...fonts().map((f) => h("option", { value: JSON.stringify({ family: f.family, source: f.source || "story", fallback: f.fallback || "" }) }, f.label || f.family)));
    // sizes: the kit's type sizes (shown in canvas units, stored as a multiple of this text's size), then relative ones
    const base = baseSize(), mult = (v) => String(Math.round(v * 1000) / 1000);
    const kitSizes = base > 0 ? sizes().filter((s) => s.size > 0) : [];
    size.replaceChildren(h("option", { value: "1" }, "Size: as the text"),
      kitSizes.length ? h("optgroup", { label: "Kit sizes" }, kitSizes.map((s) => h("option", { value: mult(s.size / base) }, s.label))) : null,
      h("optgroup", { label: "Compared with the text" }, SIZES.filter((v) => v !== 1).map((v) => h("option", { value: mult(v) }, `${Math.round(v * 100)}%`))));
    const ws = weights();
    weight.replaceChildren(h("option", { value: "" }, "Weight: as the text"), ...ws.map((w) => h("option", { value: w.value }, w.label)));
  }
  function refresh() {
    const sel = offsets(box) || last; const st = sel ? styleAt(read(box), sel[0], sel[1]) : {};
    btnB.setAttribute("aria-pressed", !!st.b); btnI.setAttribute("aria-pressed", !!st.i);
    const sv = String(Math.round((st.size || 1) * 1000) / 1000);
    size.value = [...size.querySelectorAll("option")].some((o) => o.value === sv) ? sv : "1";
    weight.value = st.weight && [...weight.options].some((o) => o.value === String(st.weight)) ? String(st.weight) : "";
    const fv = [...font.options].find((o) => o.value && JSON.parse(o.value).family === st.family);
    font.value = st.family ? (fv ? fv.value : "") : "";
  }
  let flashT = 0;
  function flash(msg) { note.textContent = msg; clearTimeout(flashT); flashT = setTimeout(() => { note.textContent = ""; }, 1800); }
  fillChoices(); refresh();

  const el = h("div", { class: "rt" }, bar, box);
  return {
    el, box, bar,
    focus(all = false) { box.focus(); if (all) select(box, 0, box.textContent.length); },
    // put the caret where the screen point is and select the word there (opening by double-click)
    focusAt(x, y) {
      box.focus();
      const pos = document.caretPositionFromPoint ? document.caretPositionFromPoint(x, y) : null;
      const r = pos ? (() => { const q = document.createRange(); q.setStart(pos.offsetNode, pos.offset); return q; })() : document.caretRangeFromPoint?.(x, y);
      if (!r || !box.contains(r.startContainer)) { select(box, box.textContent.length, box.textContent.length); return; }
      const pre = document.createRange(); pre.selectNodeContents(box); pre.setEnd(r.startContainer, r.startOffset);
      const at = pre.toString().length, txt = box.textContent;
      let a = at, b = at; while (a > 0 && /[\p{L}\p{N}'’-]/u.test(txt[a - 1])) a--; while (b < txt.length && /[\p{L}\p{N}'’-]/u.test(txt[b])) b++;
      select(box, a, b); last = [a, b]; refresh();
    },
  };
}
