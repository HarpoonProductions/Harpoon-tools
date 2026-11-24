// Fluke editor — font picker: the current kit's fonts, then every Google Font, previewed in its own face.
// Previews load only the letters of each name (Google Fonts `text=`), so browsing stays light.

const CAT = { s: "Sans serif", r: "Serif", d: "Display", h: "Handwriting", m: "Monospace" };
// Shown first when nothing is typed: dependable editorial choices
const POPULAR = ["Inter", "DM Sans", "DM Serif Display", "Playfair Display", "Montserrat", "Roboto", "Open Sans", "Lato",
  "Source Serif 4", "Libre Baskerville", "Merriweather", "Fraunces", "Work Sans", "IBM Plex Sans", "IBM Plex Serif",
  "Space Grotesk", "Outfit", "Bebas Neue", "Oswald", "Archivo", "Manrope", "Lora", "EB Garamond", "Cormorant Garamond",
  "Poppins", "Raleway", "Nunito Sans", "Barlow", "Barlow Condensed", "Anton", "Abril Fatface", "Syne", "Instrument Serif"];
const MAX_ROWS = 80;

let fonts = null, fontsPromise = null;
export function loadFontList() {
  fontsPromise ||= fetch(new URL("data/google-fonts.json", import.meta.url)).then((r) => r.json()).then((j) => {
    fonts = j.fonts.map(([family, cat, weights, italic]) => ({ family, cat, weights, italic: !!italic }));
    return fonts;
  });
  return fontsPromise;
}
export function googleFont(family) {
  const want = String(family || "").trim().toLowerCase();
  return (fonts || []).find((f) => f.family.toLowerCase() === want) || null;
}
export const fontListLoaded = () => !!fonts;

const previewed = new Set();
function previewFace(family) {
  if (previewed.has(family)) return;
  previewed.add(family);
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}&text=${encodeURIComponent(family + "Aa")}&display=swap`;
  document.head.append(l);
}

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v); else if (k === "value") el.value = v; else el.setAttribute(k, v === true ? "" : v);
  }
  kids.flat().forEach((c) => c != null && el.append(c));
  return el;
}

/**
 * Opens the picker. onPick({ family, source, weights, fallback }) is called with the choice.
 * kit (optional) adds the client's own fonts at the top.
 */
export async function openFontPicker({ current, kit, onPick }) {
  const list = await loadFontList();
  let cat = "", q = "";
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { previewFace(e.target.dataset.family); io.unobserve(e.target); } }));
  const close = () => { io.disconnect(); modal.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const pick = (choice) => { onPick(choice); close(); };

  const results = h("div", { class: "fp-results", role: "listbox", "aria-label": "Fonts" });
  const count = h("p", { class: "helper fp-count" });
  const row = (f) => h("button", { type: "button", role: "option", class: `fp-row${f.family === current ? " current" : ""}`, "data-family": f.family,
      onclick: () => pick({ family: f.family, source: "google", weights: f.weights, fallback: f.cat === "r" ? "Georgia, serif" : f.cat === "m" ? "monospace" : "system-ui, sans-serif" }) },
    h("span", { class: "fp-sample", style: `font-family:"${f.family}", system-ui` }, f.family),
    h("span", { class: "fp-meta" }, `${CAT[f.cat]} · ${f.weights.length === 1 ? f.weights[0] : f.weights[0] + "–" + f.weights[f.weights.length - 1]}${f.italic ? " · italic" : ""}`));

  function render() {
    const words = q.trim().toLowerCase();
    let matches;
    if (!words && !cat) matches = POPULAR.map((n) => list.find((f) => f.family === n)).filter(Boolean);
    else matches = list.filter((f) => (!cat || f.cat === cat) && (!words || f.family.toLowerCase().includes(words)));
    const shown = matches.slice(0, MAX_ROWS);
    results.replaceChildren(...shown.map(row));
    $$(".fp-row", results).forEach((r) => io.observe(r));
    count.textContent = !words && !cat ? `Popular picks · ${list.length} Google Fonts to search` : `${matches.length} match${matches.length === 1 ? "" : "es"}${matches.length > MAX_ROWS ? ` · showing the first ${MAX_ROWS}` : ""}`;
  }
  const $$ = (s, r) => [...r.querySelectorAll(s)];

  const search = h("input", { type: "search", placeholder: "Search Google Fonts…", "aria-label": "Search fonts", oninput: (e) => { q = e.target.value; render(); } });
  const chips = h("div", { class: "fp-chips" }, [["", "All"], ...Object.entries(CAT)].map(([k, label]) =>
    h("button", { type: "button", class: "seg-btn", "aria-pressed": String(k === cat), onclick: (e) => { cat = k; $$(".fp-chips .seg-btn", modal).forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); render(); } }, label)));

  const kitBlock = kit ? h("section", { class: "fp-kit" },
    h("h3", {}, `${kit.label} kit`),
    h("div", { class: "fp-kit-row" }, [kit.fonts.display, kit.fonts.body].filter((f, i, a) => f.family && a.findIndex((x) => x.family === f.family) === i).map((f) =>
      h("button", { type: "button", class: `fp-row${f.family === current ? " current" : ""}`, onclick: () => pick({ family: f.family, source: kit.fontSource(f.family), fallback: f.fallback }) },
        h("span", { class: "fp-sample", style: `font-family:"${f.family}", ${f.fallback}` }, f.family),
        h("span", { class: "fp-meta" }, kit.fontSource(f.family) === "google" ? "Google Font in this kit" : "The client's own font — loaded by the story"))))) : null;

  const storyField = h("input", { type: "text", placeholder: "e.g. UCL Sans", "aria-label": "Font the story already loads" });
  const storyBlock = h("section", { class: "fp-story" },
    h("h3", {}, "A font the story already loads"),
    h("div", { class: "fp-story-row" }, storyField,
      h("button", { type: "button", class: "secondary mini", onclick: () => { const v = storyField.value.trim(); if (v) pick({ family: v, source: "story" }); } }, "Use"),
      h("button", { type: "button", class: "secondary mini", title: "No family: inherit whatever font the story uses", onclick: () => pick({ family: "", source: "story" }) }, "Use the story's font")));

  const modal = h("div", { class: "modal open", "aria-hidden": "false", onclick: (e) => { if (e.target === modal) close(); } },
    h("div", { class: "modal__box fp-box", role: "dialog", "aria-modal": "true", "aria-label": "Choose a font" },
      h("div", { class: "modal__head" }, h("h2", {}, "Choose a font"), h("button", { type: "button", class: "secondary mini", onclick: close }, "Close")),
      h("div", { class: "modal__body" }, kitBlock, storyBlock,
        h("section", {}, h("h3", {}, "Google Fonts"), search, chips, count, results))));
  document.body.append(modal);
  document.addEventListener("keydown", onKey);
  render();
  search.focus();
}
