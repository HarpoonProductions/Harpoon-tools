# Fluke — scene format (v1)

*(Fluke was called Fluke; the format id stays `harpoon-animate/1`.)*

A **scene** is one animated piece (a quotebox, an animated title, a stat panel…). It is stored as JSON
(the editable source, kept in the library) and rendered to plain HTML that is pasted into the story.
Readers only ever receive the rendered HTML — nothing is fetched at read time.

```jsonc
{
  "format": "harpoon-animate/1",
  "id": "ardalan-quote",               // used to scope CSS: #ha-ardalan-quote
  "title": "UCL Winter Giving – Ardalan quote",
  "root": "figure",                    // "div" (default) | "figure" | "section" | "header" | "h1" | "h2" | "h3"
  "label": null,                       // optional aria-label for the whole piece

  "canvas": { "width": 1000, "height": 543, "background": null },
  "mobile": { "below": 560, "width": 375, "height": 520 },   // optional phone layout (see below)

  "trigger": { "on": "view", "threshold": 0.25, "replay": true },  // "view" | "load"

  "styles": {                          // type presets: how text LOOKS (not what it IS)
    "quote": { "family": "UCL Sans", "source": "story", "weight": 600, "size": 56.8, "lineHeight": 1.2, "color": "#000000" }
  },

  "elements": [ /* in READING ORDER — this is the order screen readers follow */ ]
}
```

## Units and responsiveness
All positions and sizes are in **canvas units**. The scene scales with the width of the column it sits in
(container query units), so a 1000-wide canvas shown in a 500px column draws everything at half size.

**Phone layout:** if `mobile` is set, then when the piece is narrower than `mobile.below` px it switches to a
second canvas (`mobile.width` × `mobile.height`). Each element can override its box or text size there with an
`m` object (`{ "x", "y", "w", "h", "size", "hidden" }`) in phone-canvas units. Elements without `m` are scaled
from the desktop layout.

## Elements
Common fields:

| field | meaning |
|---|---|
| `id` | short name, unique in the scene |
| `type` | `text` \| `rect` \| `ellipse` \| `line` \| `image` |
| `x`, `y`, `w`, `h` | box in canvas units |
| `rotate` | degrees (default 0) |
| `opacity` | 0–1 (default 1) |
| `z` | stacking order (default: position in the list). Independent of reading order. |
| `animate` | `{ "name", "delay", "duration", "easing", "distance", "loop" }` (seconds) |
| `m` | phone-layout overrides |

**text** — `tag` is what it IS in the page outline: `h1`–`h6`, `p`, `blockquote`, `figcaption`, `span`,
or `"decorative"` (hidden from screen readers). `style` names a preset; any preset field can be overridden on the
element. `text` is plain text; a newline is a line break. `align`: `left` | `center` | `right`.
`stretch` (optional, default 1) scales the letters sideways relative to their height, as Infogram allows when a text
box is resized unevenly: `1.065` is 6.5% wider. The box still occupies `w`.
If the scene's `root` is a heading (`h1`–`h3`), its text layers must be `span` (or `decorative`): the words are parts of
one heading, read as one ("It's a" + "gut" + "feeling" → "It's a gut feeling").
H1 is allowed (e.g. an animated story title); validation only warns when a scene has more than one.

**rect / ellipse** — `fill`, `stroke`, `strokeWidth`, `radius` (rect). Decorative: hidden from screen readers.

**line** — drawn across the box's width, centred vertically; `stroke`, `strokeWidth`. Rotate for other angles.

**image** — `src` (absolute URL, e.g. on harpn), `alt` (required unless `decorative: true`), `fit`: `contain` | `cover`.

## Client kit and colours
`kit` (optional) records which client kit the piece was made with: `{ "id": "uksi", "label": "UK Sport" }`.
Kits are the HSE token sets published by the Token Generator (`harpoon-story-engine/tokens/registry.json`).
Any colour can be a plain value (`#E6213E`) or a **linked kit colour**: `var(--hse-accent, #E6213E)`. In HSE stories,
which load the client's tokens, it follows the token; everywhere else (Shorthand) the colour after the comma is used.

## Fonts
`source: "story"` — the family is already loaded by the story (e.g. UCL Sans in UCL's Shorthand stories).
`source: "google"` — the renderer adds a Google Fonts link for each family and weight that text in the piece uses.
Fallback stack is always appended so text shows while fonts load.

## Animations
`name` is one of:
- **in:** fadeIn, fadeInUp, fadeInDown, fadeInLeft, fadeInRight, slideInUp, slideInDown, slideInLeft, slideInRight,
  zoomIn, bounceIn, wipeInLeft, wipeInRight, wipeInUp, wipeInDown
- **out:** fadeOut, fadeOutUp, fadeOutDown, fadeOutLeft, fadeOutRight, slideOutUp, slideOutDown, slideOutLeft,
  slideOutRight, zoomOut, wipeOutLeft, wipeOutRight, wipeOutUp, wipeOutDown
- **attention:** bounce, flash, pulse, shake, wobble (set `loop: true` to repeat)

Direction words follow Infogram/Animate.css: `fadeInRight` comes *from* the right; `slideOutLeft` leaves *to* the left.
Wipes reveal with a moving edge: `wipeInLeft` grows from the left edge; `wipeOutLeft` shrinks away towards the left.
`distance` (fade-ins/outs only) is how far it travels as a fraction of its own size (default 0.1; Infogram's
default is 1, which the importer writes in explicitly).
`bounce` and `shake` move in canvas units, like Infogram and Animate.css: bounce rises 30, 15 then 4 units; shake
moves 10 units each way. They scale with the piece.

## Behaviour (runtime)
- **load:** pure CSS. Animations start as soon as the browser paints the element — no script involved.
- **view:** held at the first frame until `threshold` of the piece is visible, then played. With `replay`, it
  resets once fully off screen and plays again next time.
- **Reduced motion:** no animation; elements with an *out* animation are simply not shown.
- **No JavaScript:** a view-triggered piece plays on load instead.
