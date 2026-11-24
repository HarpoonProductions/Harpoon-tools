// Harpoon Animate editor — client kits, read from the HSE token system.
// The Token Generator publishes each client's brand tokens to the (public) harpoon-story-engine repo:
//   tokens/registry.json      list of token sets
//   css/tokens.css            platform base values
//   css/tokens-{id}.css       the client's overrides (canonical brand identity across Harpoon products)
// The editor reads them at edit time only. Pieces never load anything from here when a reader opens a story.

export const HSE_RAW = "https://raw.githubusercontent.com/HarpoonProductions/harpoon-story-engine/main/";

const cache = new Map();
let registryPromise = null;

export function loadRegistry() {
  registryPromise ||= fetch(HSE_RAW + "tokens/registry.json", { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error(`token registry ${r.status}`); return r.json(); })
    .then((j) => j.token_sets || [])
    .catch((e) => { registryPromise = null; throw e; });
  return registryPromise;
}

// --hse-* custom properties declared in :root blocks
export function parseTokens(css) {
  const out = {};
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const block of noComments.matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const m of block[1].matchAll(/--hse-([a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[m[1]] = m[2].trim();
  }
  return out;
}
export function fontFaces(css, base = HSE_RAW) {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...noComments.matchAll(/@font-face\s*\{[^}]*\}/g)].map((m) => m[0].replace(/url\((['"]?)([^'")]+)\1\)/g, (all, q, u) => {
    if (/^(https?:|data:)/.test(u)) return all;
    // token CSS is inlined into story pages, so plain relative paths are relative to the repo root
    return `url('${new URL(u.replace(/^\.\.\//, ""), base).href}')`;
  }));
}
// "'Montserrat', Arial, sans-serif" → { family: "Montserrat", fallback: "Arial, sans-serif" }
export function splitStack(stack) {
  const parts = String(stack || "").split(",").map((s) => s.trim()).filter(Boolean);
  const first = (parts.shift() || "").replace(/^['"]|['"]$/g, "");
  return { family: first, fallback: parts.join(", ") || "system-ui, sans-serif" };
}
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const fullHex = (v) => { v = v.trim(); if (!HEX.test(v)) return null; if (v.length === 4) v = "#" + [...v.slice(1)].map((c) => c + c).join(""); return v.toUpperCase(); };
const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };

const SWATCHES = [["accent", "Accent"], ["accent-2", "Accent 2"], ["ink", "Ink"], ["ink-2", "Ink 2"], ["ink-3", "Ink 3"],
  ["warm", "Warm"], ["warm-2", "Warm 2"], ["warm-3", "Warm 3"]];

export async function loadKit(id) {
  if (cache.has(id)) return cache.get(id);
  const p = (async () => {
    const reg = await loadRegistry();
    const entry = reg.find((t) => t.id === id);
    if (!entry) throw new Error(`No token set called “${id}”`);
    const [baseCss, clientCss] = await Promise.all([
      fetch(HSE_RAW + "css/tokens.css").then((r) => r.text()),
      id === "default" ? Promise.resolve("") : fetch(HSE_RAW + `css/tokens-${id}.css`).then((r) => { if (!r.ok) throw new Error(`tokens-${id}.css ${r.status}`); return r.text(); }),
    ]);
    const t = { ...parseTokens(baseCss), ...parseTokens(clientCss) };
    const swatches = SWATCHES.map(([token, name]) => ({ token, name, hex: fullHex(t[token] || "") })).filter((s) => s.hex);
    const display = splitStack(t["font-display"]), body = splitStack(t["font-body"]);
    const gf = entry.google_fonts_url || "";
    const inGoogle = (fam) => !!fam && gf.includes("family=" + encodeURIComponent(fam).replace(/%20/g, "+"));
    return {
      id, label: entry.label, description: entry.description, logo: entry.logo_url || null, googleFontsUrl: gf || null,
      swatches, tokens: t, fonts: { display, body },
      fontSource: (fam) => (inGoogle(fam) ? "google" : "story"),
      fontFaces: fontFaces(clientCss),
      weights: { light: num(t["font-weight-light"], 300), normal: num(t["font-weight-normal"], 400), medium: num(t["font-weight-medium"], 500), bold: num(t["font-weight-bold"], 700) },
      leading: { tight: num(t["leading-tight"], 1.1), heading: num(t["leading-heading"], 1.15), snug: num(t["leading-snug"], 1.4) },
      tracking: num(t["tracking-sm"], 0.14),
    };
  })();
  cache.set(id, p);
  p.catch(() => cache.delete(id));
  return p;
}

// Type styles built from a kit, in canvas units for a 1000-wide canvas (scaled for other widths)
export function kitStyles(kit, canvasWidth = 1000) {
  const k = canvasWidth / 1000;
  const ink = kit.swatches.find((s) => s.token === "ink"), accent = kit.swatches.find((s) => s.token === "accent");
  const colour = (sw, dflt) => (sw ? `var(--hse-${sw.token}, ${sw.hex})` : dflt);
  const face = (f) => ({ family: f.family, source: kit.fontSource(f.family), fallback: f.fallback });
  const r = (n) => Math.round(n * k * 10) / 10;
  return {
    display: { ...face(kit.fonts.display), weight: kit.weights.bold, size: r(72), lineHeight: kit.leading.tight, color: colour(ink, "#000000") },
    heading: { ...face(kit.fonts.display), weight: kit.weights.bold, size: r(48), lineHeight: kit.leading.heading, color: colour(ink, "#000000") },
    body: { ...face(kit.fonts.body), weight: kit.weights.normal, size: r(28), lineHeight: kit.leading.snug, color: colour(ink, "#000000") },
    caption: { ...face(kit.fonts.body), weight: kit.weights.medium, size: r(20), lineHeight: kit.leading.snug, color: colour(ink, "#000000") },
    kicker: { ...face(kit.fonts.body), weight: kit.weights.bold, size: r(18), lineHeight: 1.2, letterSpacing: kit.tracking, color: colour(accent, "#000000") },
  };
}

// Make the kit's fonts show in the editor preview (Google link + any @font-face the token file carries)
const loadedFonts = new Set();
export function loadKitFonts(kit) {
  if (loadedFonts.has(kit.id)) return;
  loadedFonts.add(kit.id);
  if (kit.googleFontsUrl) {
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = kit.googleFontsUrl; document.head.append(l);
  }
  if (kit.fontFaces.length) {
    const s = document.createElement("style"); s.dataset.kit = kit.id; s.textContent = kit.fontFaces.join("\n"); document.head.append(s);
  }
}
