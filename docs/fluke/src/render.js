// Fluke — scene JSON → plain HTML for Shorthand / HSE.
// Pure functions, no DOM: runs in Node (tests, HSE builds) and in the browser (the editor).

export const ANIMATIONS = {
  in: ["fadeIn", "fadeInUp", "fadeInDown", "fadeInLeft", "fadeInRight", "slideInUp", "slideInDown", "slideInLeft",
    "slideInRight", "zoomIn", "bounceIn", "wipeInLeft", "wipeInRight", "wipeInUp", "wipeInDown", "brushIn"],
  out: ["fadeOut", "fadeOutUp", "fadeOutDown", "fadeOutLeft", "fadeOutRight", "slideOutUp", "slideOutDown",
    "slideOutLeft", "slideOutRight", "zoomOut", "wipeOutLeft", "wipeOutRight", "wipeOutUp", "wipeOutDown"],
  attention: ["bounce", "flash", "pulse", "shake", "headShake", "wobble"],
};
const ALL_ANIMATIONS = new Set([...ANIMATIONS.in, ...ANIMATIONS.out, ...ANIMATIONS.attention]);
const OUT_ANIMATIONS = new Set(ANIMATIONS.out);
const TEXT_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "blockquote", "figcaption", "span", "decorative"]);
const ROOT_TAGS = new Set(["div", "figure", "section", "header", "h1", "h2", "h3"]);
const HEADING_ROOTS = new Set(["h1", "h2", "h3"]);
const TYPES = new Set(["text", "rect", "ellipse", "line", "image"]);
export const BLENDS = ["normal", "multiply", "screen", "darken", "lighten", "overlay", "color-burn", "soft-light"];
// Image-only animations: the image is drawn as inline SVG and revealed through a moving mask
export const IMAGE_ONLY_ANIMATIONS = new Set(["brushIn"]);
const isBrush = (e) => e.type === "image" && e.animate?.name === "brushIn";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
const num = (n, d = 4) => +(+n).toFixed(d);
// CSS values must never carry a stray ; { } < that could break out of a rule
const cssVal = (v) => String(v ?? "").replace(/[;{}<>]/g, "");

export function validate(scene) {
  const errors = [], warnings = [];
  if (!scene || typeof scene !== "object") return { errors: ["Scene is not an object"], warnings };
  if (!scene.id) errors.push("Scene needs an id");
  const c = scene.canvas || {};
  if (!(c.width > 0 && c.height > 0)) errors.push("canvas.width and canvas.height must be positive numbers");
  if (scene.root && !ROOT_TAGS.has(scene.root)) errors.push(`root must be one of ${[...ROOT_TAGS].join(", ")}`);
  if (scene.mobile && !(scene.mobile.below > 0 && scene.mobile.width > 0 && scene.mobile.height > 0))
    errors.push("mobile needs below, width and height");
  const seen = new Set();
  let h1 = 0;
  (scene.elements || []).forEach((e, i) => {
    const where = `element ${e.id || "#" + (i + 1)}`;
    if (!e.id) errors.push(`${where}: needs an id`);
    else if (seen.has(slug(e.id))) errors.push(`${where}: duplicate id`);
    seen.add(slug(e.id));
    if (!TYPES.has(e.type)) errors.push(`${where}: unknown type "${e.type}"`);
    for (const k of ["x", "y", "w", "h"]) if (typeof e[k] !== "number") errors.push(`${where}: ${k} must be a number`);
    if (e.type === "text") {
      const tag = e.tag || "p";
      if (!TEXT_TAGS.has(tag)) errors.push(`${where}: unknown tag "${tag}"`);
      if (tag === "h1") h1++;
      if (HEADING_ROOTS.has(scene.root) && !["span", "decorative"].includes(tag))
        errors.push(`${where}: inside a heading wrapper, text must be "span" (inline text) or decorative`);
      if (tag === "figcaption" && (scene.root || "div") !== "figure") warnings.push(`${where}: figcaption only means something inside root "figure"`);
      if (e.style && !(scene.styles || {})[e.style]) errors.push(`${where}: unknown style "${e.style}"`);
      if (!String(e.text || "").trim()) warnings.push(`${where}: empty text`);
    }
    if (e.type === "image") {
      if (!e.src) errors.push(`${where}: image needs src`);
      if (!e.decorative && !String(e.alt || "").trim()) errors.push(`${where}: image needs alt text, or decorative: true`);
    }
    if (e.animate && e.animate.name && !ALL_ANIMATIONS.has(e.animate.name)) errors.push(`${where}: unknown animation "${e.animate.name}"`);
    if (e.animate && IMAGE_ONLY_ANIMATIONS.has(e.animate.name) && e.type !== "image") errors.push(`${where}: ${e.animate.name} only works on image layers`);
    if (e.blend && !BLENDS.includes(e.blend)) errors.push(`${where}: unknown blend "${e.blend}"`);
    if (e.brush && e.brush.points !== undefined) {
      const pts = e.brush.points;
      if (!Array.isArray(pts) || pts.length < 2 || !pts.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && isFinite(n))))
        errors.push(`${where}: brush.points must be at least two [x, y] pairs`);
    }
  });
  if (scene.root === "h1") h1++;
  if (h1 > 1) warnings.push(`${h1} H1s in one piece — a page should normally have only one`);
  return { errors, warnings };
}

function textStyle(scene, e) {
  const preset = (scene.styles || {})[e.style] || {};
  return { family: null, source: "story", weight: 400, italic: false, size: 16, lineHeight: 1.2, letterSpacing: 0,
    color: "#000000", fallback: "system-ui, sans-serif", ...preset, ...pick(e, ["family", "source", "weight", "italic", "size", "lineHeight", "letterSpacing", "color", "fallback"]) };
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

// Google Fonts refuses the whole request if it asks for a weight or italic a family doesn't have, and then nothing
// loads. fontInfo(family) → { weights: [...], italic: bool } (the editor passes its Google Fonts list) lets each
// request be snapped to the nearest weight the family really has.
export function nearestWeight(weights, w) {
  return weights.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a), weights[0]);
}
export function googleFontsUrl(scene, fontInfo = null) {
  const fams = new Map();
  const add = (s) => {
    if (s.source !== "google" || !s.family) return;
    const info = fontInfo ? fontInfo(s.family) : null;
    const weight = info?.weights?.length ? nearestWeight(info.weights, +(s.weight || 400)) : +(s.weight || 400);
    const italic = s.italic && (!info || info.italic) ? 1 : 0;
    const f = fams.get(s.family) || new Set();
    f.add(`${italic},${weight}`);
    fams.set(s.family, f);
  };
  // only fonts that text in the piece actually uses (a kit may bring styles nobody uses)
  (scene.elements || []).filter((e) => e.type === "text").forEach((e) => add(textStyle(scene, e)));
  if (!fams.size) return null;
  const parts = [...fams].map(([fam, set]) => {
    const axes = [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return "family=" + encodeURIComponent(fam).replace(/%20/g, "+") + ":ital,wght@" + axes.join(";");
  });
  return "https://fonts.googleapis.com/css2?" + parts.join("&") + "&display=swap";
}

function boxRules(e, W, H, ov = {}) {
  const b = { x: e.x, y: e.y, w: e.w, h: e.h, ...ov };
  // Stretched text is laid out in a narrower (or wider) box and scaled sideways about its centre to fill w.
  const st = e.type === "text" && e.stretch && Math.abs(e.stretch - 1) > 0.001 ? e.stretch : 1;
  if (st !== 1) { const inner = b.w / st; b.x += (b.w - inner) / 2; b.w = inner; }
  const r = [];
  if (e.type === "line") {
    const sw = e.strokeWidth ?? 2;
    r.push(`left:${num(b.x / W * 100)}%`, `top:calc(${num((b.y + b.h / 2) / H * 100)}% - ${num(sw / 2 / W * 100)}cqi)`,
      `width:${num(b.w / W * 100)}%`, `height:max(1px,${num(sw / W * 100)}cqi)`);
  } else {
    r.push(`left:${num(b.x / W * 100)}%`, `top:${num(b.y / H * 100)}%`, `width:${num(b.w / W * 100)}%`, `height:${num(b.h / H * 100)}%`);
  }
  return r;
}

function elementRules(scene, e, i) {
  const W = scene.canvas.width, H = scene.canvas.height;
  const r = boxRules(e, W, H);
  r.push(`z-index:${e.z ?? i + 1}`);
  if (e.rotate) r.push(`rotate:${num(e.rotate)}deg`);
  if (e.opacity !== undefined && e.opacity !== 1) r.push(`opacity:${num(e.opacity)}`, `--ha-o:${num(e.opacity)}`); // fades end at this, not 1
  if (e.blend && e.blend !== "normal" && BLENDS.includes(e.blend)) r.push(`mix-blend-mode:${e.blend}`);
  if (e.type === "text") {
    const s = textStyle(scene, e);
    const fam = s.family ? `"${cssVal(s.family).replace(/"/g, "")}",` : "";
    r.push(`font-family:${fam}${cssVal(s.fallback)}`, `font-weight:${cssVal(s.weight)}`, `font-style:${s.italic ? "italic" : "normal"}`,
      `font-size:${num(s.size / W * 100)}cqi`, `line-height:${num(s.lineHeight)}`, `color:${cssVal(s.color)}`,
      `text-align:${["left", "center", "right"].includes(e.align) ? e.align : "left"}`);
    if (s.letterSpacing) r.push(`letter-spacing:${num(s.letterSpacing)}em`);
    if (e.stretch && Math.abs(e.stretch - 1) > 0.001) r.push(`scale:${num(e.stretch)} 1`);
    if (e.nowrap) r.push("white-space:nowrap");
  } else if (e.type === "rect" || e.type === "ellipse") {
    if (e.fill) r.push(`background:${cssVal(e.fill)}`);
    if (e.strokeWidth && e.stroke) r.push(`border:${num(e.strokeWidth / W * 100)}cqi solid ${cssVal(e.stroke)}`);
    if (e.type === "ellipse") r.push("border-radius:50%");
    else if (e.radius) r.push(`border-radius:${num(e.radius / W * 100)}cqi`);
  } else if (e.type === "line") {
    r.push(`background:${cssVal(e.stroke || "#000")}`);
  } else if (e.type === "image") {
    r.push(`object-fit:${e.fit === "cover" ? "cover" : "contain"}`);
  }
  const a = e.animate;
  if (a && a.name && ALL_ANIMATIONS.has(a.name) && !isBrush(e) && !(IMAGE_ONLY_ANIMATIONS.has(a.name))) {
    r.push(`animation:ha-${a.name} ${num(a.duration ?? 1, 3)}s ${cssVal(a.easing || "ease")} ${num(a.delay ?? 0, 3)}s ${a.loop ? "infinite" : 1} both`);
    if (a.distance !== undefined) r.push(`--ha-d:${num(a.distance * 100, 2)}%`);
  }
  return r;
}

// The brush reveal animates the mask path inside the image's SVG, not the layer itself
function brushRule(e) {
  const a = e.animate;
  return `animation:ha-brushIn ${num(a.duration ?? 1, 3)}s ${cssVal(a.easing || "ease")} ${num(a.delay ?? 0, 3)}s 1 both`;
}

// ---- brush path: points are fractions of the layer's box ([0,0] top-left, [1,1] bottom-right)
export const DEFAULT_BRUSH = { points: [[0, 0.5], [1, 0.5]], width: null, soft: 0.25 };
export function brushOf(e) {
  const b = e.brush || {};
  const drawn = Array.isArray(b.points) && b.points.length >= 2;
  const pts = drawn ? b.points : DEFAULT_BRUSH.points;
  // default size: a drawn path gets a brush about a fifth of the layer's width; the straight sweep covers the whole height
  const width = b.width > 0 ? b.width : drawn ? 0.22 : Math.min(1.5, (e.h / e.w) * 1.15);
  const soft = b.soft >= 0 ? Math.min(1, b.soft) : DEFAULT_BRUSH.soft;
  return { points: pts, width, soft };
}
// A smooth curve through the points (Catmull-Rom as cubic Béziers), in box units w × h
export function brushPathD(points, w, h) {
  const P = points.map(([x, y]) => [x * w, y * h]);
  const f = (n) => num(n, 2);
  let d = `M${f(P[0][0])},${f(P[0][1])}`;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`;
  }
  return d;
}
function brushImageHtml(e, cls, sid, out) {
  const w = num(e.w, 2), h = num(e.h, 2);
  const { points, width, soft } = brushOf(e);
  const sw = width * e.w, blur = soft * sw * 0.25;
  const id = `${sid}-${slug(e.id)}-brush`;
  const par = e.fit === "cover" ? "xMidYMid slice" : "xMidYMid meet";
  const a11y = e.decorative ? ' aria-hidden="true"' : ` role="img" aria-label="${esc(e.alt)}"`;
  return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="${par}"${a11y}${out}>` +
    `<defs>${blur > 0 ? `<filter id="${id}-f" filterUnits="userSpaceOnUse" x="${-w}" y="${-h}" width="${3 * w}" height="${3 * h}"><feGaussianBlur stdDeviation="${num(blur, 2)}"/></filter>` : ""}` +
    `<mask id="${id}" maskUnits="userSpaceOnUse" x="${-w}" y="${-h}" width="${3 * w}" height="${3 * h}">` +
    `<path class="ha-el ha-brush" pathLength="1" fill="none" stroke="#fff" stroke-width="${num(sw, 2)}" stroke-linecap="round" stroke-linejoin="round"${blur > 0 ? ` filter="url(#${id}-f)"` : ""} d="${brushPathD(points, e.w, e.h)}"/>` +
    `</mask></defs><image href="${esc(e.src)}" width="${w}" height="${h}" preserveAspectRatio="${par}" mask="url(#${id})"/></svg>`;
}

function mobileRules(scene, e) {
  const m = e.m;
  if (!m) return null;
  if (m.hidden) return ["display:none"];
  const M = scene.mobile, W = scene.canvas.width, H = scene.canvas.height;
  // anything not set for phones keeps its desktop position, scaled to the phone canvas
  const scaled = { x: e.x * M.width / W, y: e.y * M.height / H, w: e.w * M.width / W, h: e.h * M.height / H };
  const r = boxRules(e, M.width, M.height, { ...scaled, ...pick(m, ["x", "y", "w", "h"]) });
  if (e.type === "text" && m.size) r.push(`font-size:${num(m.size / M.width * 100)}cqi`);
  if (e.type === "line" && m.strokeWidth) r.push(`height:max(1px,${num(m.strokeWidth / M.width * 100)}cqi)`);
  return r;
}

// inline = inside a heading wrapper, where only inline elements are valid HTML
function elementHtml(e, cls, inline = false, sid = "") {
  const box = inline ? "span" : "div";
  const out = e.animate && OUT_ANIMATIONS.has(e.animate.name) ? " data-ha-out" : "";
  if (e.type === "text") {
    const body = esc(e.text).replace(/\r?\n/g, "<br>");
    const tag = e.tag || "p";
    if (tag === "decorative") return `<${box} class="${cls} ha-text" aria-hidden="true"${out}>${body}</${box}>`;
    return `<${tag} class="${cls} ha-text"${out}>${body}</${tag}>`;
  }
  if (isBrush(e) && !inline) return brushImageHtml(e, cls, sid, out);
  if (e.type === "image") {
    const alt = e.decorative ? "" : esc(e.alt);
    return `<img class="${cls}" src="${esc(e.src)}" alt="${alt}" decoding="async"${e.decorative ? ' aria-hidden="true"' : ""}${out}>`;
  }
  return `<${box} class="${cls}" aria-hidden="true"${out}></${box}>`;
}

/**
 * @param scene  scene JSON
 * @param opts   { runtimeCss, runtimeJs } — inline the shared runtime (default when given)
 *               { includeRuntime: false } — the story already carries it
 *               { embedSource: true } — include the scene JSON so the piece can be pasted back into the editor
 *               { allowInvalid: true } — render anyway (editor preview while the scene is half-made)
 *               { fontInfo } — family → { weights, italic } for Google Fonts, so requests match what exists
 */
export function renderScene(scene, opts = {}) {
  const { errors } = validate(scene);
  if (errors.length && !opts.allowInvalid) throw new Error("Scene is invalid:\n- " + errors.join("\n- "));
  if (!(scene.canvas?.width > 0 && scene.canvas?.height > 0)) return "";
  const sid = "ha-" + slug(scene.id);
  const S = `#${sid}`;
  const W = scene.canvas.width, H = scene.canvas.height;
  const els = scene.elements || [];
  const trig = { on: "view", threshold: 0.25, replay: true, ...(scene.trigger || {}) };

  const css = [];
  // --ha-u is one canvas unit, so movements written in canvas units (bounce, shake) scale with the piece
  css.push(`${S} .ha-scene{aspect-ratio:${num(W)}/${num(H)};--ha-u:${num(100 / W, 5)}cqi${scene.canvas.background ? ";background:" + cssVal(scene.canvas.background) : ""}}`);
  els.forEach((e, i) => {
    css.push(`${S} .ha-e-${slug(e.id)}{${elementRules(scene, e, i).join(";")}}`);
    if (isBrush(e) && !HEADING_ROOTS.has(scene.root || "div")) css.push(`${S} .ha-e-${slug(e.id)} .ha-brush{${brushRule(e)}}`);
  });
  if (scene.mobile) {
    const M = scene.mobile;
    const mob = [`${S} .ha-scene{aspect-ratio:${num(M.width)}/${num(M.height)};--ha-u:${num(100 / M.width, 5)}cqi}`];
    els.forEach((e) => { const r = mobileRules(scene, e); if (r) mob.push(`${S} .ha-e-${slug(e.id)}{${r.join(";")}}`); });
    css.push(`@container (max-width:${num(M.below - 0.02, 2)}px){${mob.join("")}}`);
  }

  const include = opts.includeRuntime !== false && opts.runtimeCss && opts.runtimeJs;
  const root = scene.root || "div";
  const label = scene.label ? ` aria-label="${esc(scene.label)}"` : "";
  const attrs = [`class="ha"`, `id="${sid}"`, `data-ha-trigger="${trig.on === "load" ? "load" : "view"}"`];
  if (trig.on !== "load") {
    attrs.push(`data-ha-threshold="${num(trig.threshold, 2)}"`);
    if (!trig.replay) attrs.push(`data-ha-replay="off"`);
  }
  const lines = [];
  lines.push(`<!-- Fluke: ${esc(scene.title || scene.id)} -->`);
  const gf = googleFontsUrl(scene, opts.fontInfo);
  if (gf && opts.includeFonts !== false) lines.push(`<link rel="stylesheet" href="${esc(gf)}">`);
  lines.push(`<div ${attrs.join(" ")}>`);
  lines.push(`<style>${include ? opts.runtimeCss.trim() + "\n" : ""}${css.join("\n")}</style>`);
  lines.push(`<${root} class="ha-scene"${label}>`);
  els.forEach((e) => lines.push("  " + elementHtml(e, `ha-el ha-e-${slug(e.id)}`, HEADING_ROOTS.has(root), sid)));
  lines.push(`</${root}>`);
  if (opts.embedSource) lines.push(`<script type="application/json" data-ha-scene>${JSON.stringify(scene).replace(/</g, "\\u003c")}</script>`);
  lines.push(`</div>`);
  if (include && trig.on !== "load") lines.push(`<script>${opts.runtimeJs.trim()}</script>`);
  return lines.join("\n");
}

// Pull the editable scene back out of a rendered piece (for "paste a piece to edit it").
export function extractScene(html) {
  const m = String(html).match(/<script type="application\/json" data-ha-scene>([\s\S]*?)<\/script>/);
  if (!m) return null;
  return JSON.parse(m[1]);
}
