// Infogram "Download as HTML" export → Fluke scene.
// Reads window.infographicData from the export's index.html. Pure string work: runs in Node or the browser.
//
// What carries over: canvas size, text (content, font, size, weight, colour, line height, alignment),
// rectangles, ellipses, lines, rotation, opacity, stacking and animations.
// What needs a human afterwards (reported as warnings): semantic tags (everything imports as <p>),
// image files (must be uploaded to harpn and the src replaced), alt text, and a phone layout.

const WEIGHT_WORDS = [
  ["extralight", 200], ["ultralight", 200], ["thin", 100], ["light", 300], ["regular", 400], ["book", 400],
  ["medium", 500], ["semibold", 600], ["demibold", 600], ["extrabold", 800], ["ultrabold", 800], ["bold", 700],
  ["black", 900], ["heavy", 900],
];

// "igbr-UCL Sans SemiBold" → { family: "UCL Sans", weight: 600, italic: false }
export function parseFamily(raw) {
  let name = String(raw || "").replace(/^ig[a-z]*-/i, "").trim();
  let weight = null, italic = false;
  if (/\bitalic\b/i.test(name)) { italic = true; name = name.replace(/\s*\bitalic\b/i, ""); }
  for (const [word, w] of WEIGHT_WORDS) {
    const re = new RegExp("\\s*\\b" + word + "\\b\\s*$", "i");
    if (re.test(name)) { weight = w; name = name.replace(re, ""); break; }
  }
  return { family: name.trim(), weight, italic };
}

export function extractData(html) {
  const marker = "window.infographicData=";
  const i = html.indexOf(marker);
  if (i < 0) throw new Error("This doesn't look like an Infogram HTML export (no window.infographicData)");
  const j = html.indexOf(";</script>", i);
  // the export embeds JS Date objects, which aren't JSON
  const json = html.slice(i + marker.length, j).replace(/new Date\(("[^"]*")\)/g, "$1");
  return JSON.parse(json);
}

const rgbaToCss = (v) => {
  if (!v || typeof v !== "string" || v.includes("{{")) return null;
  const m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/i);
  if (!m) return v;
  const hex = "#" + [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, "0")).join("").toUpperCase();
  const a = m[4] === undefined ? 1 : +m[4];
  return a >= 1 ? hex : `rgba(${m[1]},${m[2]},${m[3]},${a})`;
};
const r2 = (n) => Math.round(n * 100) / 100;
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function animationOf(p) {
  const a = p.animation;
  if (!a || !a.name || a.name === "none") return undefined;
  const out = { name: a.name, delay: a.delay ?? 0, duration: a.duration ?? 1 };
  if (a.distance !== undefined) out.distance = a.distance;
  return out;
}

/**
 * @param html  the export's index.html as a string
 * @param opts  { id, fontMap: { "UCL Sans SemiBold": { family, weight, source } }, pageIndex }
 * @returns { scene, warnings }
 */
export function importInfogram(html, opts = {}) {
  const data = extractData(html);
  const warnings = [];
  const content = data.elements?.content;
  if (!content) throw new Error("Export has no elements.content");
  const page = content.pageSize || { width: data.width || 1000, height: 600 };
  const doc = content.content;
  const blockIds = doc.blockOrder || Object.keys(doc.blocks || {});
  if (blockIds.length > 1) warnings.push(`Export has ${blockIds.length} pages; imported page ${(opts.pageIndex || 0) + 1} only`);
  const block = doc.blocks[blockIds[opts.pageIndex || 0]];
  const bg = block?.design?.background?.color;

  const styles = {};
  const styleKey = new Map();
  const elements = [];
  let trigger = null;
  const counts = {};

  (block.entities || []).forEach((eid, zIndex) => {
    const ent = doc.entities[eid];
    if (!ent || ent.hidden) return;
    const p = ent.props || {};
    const base = {
      x: r2(ent.left), y: r2(ent.top), w: r2(ent.width), h: r2(ent.height), z: zIndex + 1,
    };
    if (ent.transform?.rotate) base.rotate = ent.transform.rotate;
    if (p.opacity !== undefined && p.opacity !== 1) base.opacity = p.opacity;
    const anim = animationOf(p);
    if (anim) base.animate = anim;
    if (p.animation && p.animation.regime && !trigger) {
      trigger = { on: p.animation.regime === "onView" ? "view" : "load", threshold: (p.animation.startAt ?? 25) / 100, replay: true };
    }
    const nameFor = (kind) => { counts[kind] = (counts[kind] || 0) + 1; return kind + (counts[kind] > 1 ? "-" + counts[kind] : ""); };

    if (ent.type === "TEXT") {
      const blocks = p.content?.blocks || [];
      const text = blocks.map((b) => b.text).join("\n");
      const d = blocks[0]?.data || {};
      if (blocks.some((b) => (b.inlineStyleRanges || []).some((r) => r.length < b.text.length && /fontWeight|color|fontSize|fontStyle/.test(r.style))))
        warnings.push(`Text "${text.slice(0, 30)}…" has mixed styling inside it; imported with one style`);
      const raw = d["ig:fontFamily"];
      const mapped = (opts.fontMap || {})[String(raw || "").replace(/^ig[a-z]*-/i, "")];
      const fam = mapped || parseFamily(raw);
      const weight = fam.weight ?? (parseInt(d["ig:fontWeight"], 10) || 400);
      const scale = p.scaleX || 1;
      const style = {
        family: fam.family || null, source: fam.source || "story", weight,
        italic: fam.italic || d["ig:fontStyle"] === "italic",
        size: r2(parseFloat(d["ig:fontSize"]) * scale),
        lineHeight: parseFloat(d["ig:lineHeight"]) || 1.2,
        color: rgbaToCss(d["ig:color"]) || "#000000",
      };
      const ls = parseFloat(d["ig:letterSpacing"]);
      if (ls) style.letterSpacing = r2(ls / parseFloat(d["ig:fontSize"]));
      // share identical looks as one preset
      const key = JSON.stringify(style);
      if (!styleKey.has(key)) {
        const name = "text-" + (styleKey.size + 1);
        styleKey.set(key, name); styles[name] = style;
      }
      const align = String(d.align || "").match(/CENTER|RIGHT/i)?.[0]?.toLowerCase() || "left";
      elements.push({ id: nameFor("text"), type: "text", tag: "p", style: styleKey.get(key), text, ...(align !== "left" ? { align } : {}), ...base });
    } else if (ent.type === "SHAPE") {
      const kind = p.type;
      if (kind === "rectangle" || kind === "ellipse" || kind === "circle") {
        const el = { id: nameFor(kind === "rectangle" ? "box" : "ellipse"), type: kind === "rectangle" ? "rect" : "ellipse", ...base };
        const fill = rgbaToCss(p.fill); if (fill) el.fill = fill;
        if (p.strokeWidth) { el.stroke = rgbaToCss(p.stroke) || "#000000"; el.strokeWidth = p.strokeWidth; }
        if (kind === "rectangle" && p.rx) el.radius = p.rx;
        elements.push(el);
      } else if (kind === "line") {
        elements.push({ id: nameFor("line"), type: "line", stroke: rgbaToCss(p.stroke) || "#000000", strokeWidth: p.strokeWidth ?? 2, ...base });
      } else {
        warnings.push(`Shape type "${kind}" isn't supported yet; skipped`);
      }
    } else if (ent.type === "IMAGE") {
      const src = p.url || p.src || p.image?.url || "";
      elements.push({ id: nameFor("image"), type: "image", src, alt: "", fit: "contain", ...base });
      warnings.push(`Image "${src.split("/").pop() || "?"}": upload to harpn, replace src and add alt text (or mark decorative)`);
    } else {
      warnings.push(`Element type ${ent.type} isn't supported yet; skipped`);
    }
  });

  // Reading order: top-to-bottom, then left-to-right. Stacking order is kept separately in z.
  elements.sort((a, b) => (a.y - b.y) || (a.x - b.x));

  if (elements.some((e) => e.type === "text")) warnings.push("All text imported as <p>: set headings, quotes and captions (tag) by hand");
  warnings.push("No phone layout: add one if the text gets too small on narrow screens");

  const scene = {
    format: "harpoon-animate/1",
    id: opts.id || slug(data.title) || "infogram-import",
    title: data.title || "Imported from Infogram",
    root: "div",
    canvas: { width: page.width, height: page.height, background: data.properties?.transparent ? null : rgbaToCss(bg) },
    trigger: trigger || { on: "view", threshold: 0.25, replay: true },
    styles,
    elements,
    source: { from: "infogram", id: data.id, title: data.title, updatedAt: data.updatedAt },
  };
  return { scene, warnings };
}
