# Harpoon Quotebox Builder

Animated pull quote for Shorthand, recreated from the UCL Winter Giving Infogram design
(lilac panel wipes out to the left, attribution rises, quote slides in from the right).

## Files
- index.html                 the builder
- runtime/quotebox-1.0.css   hosted once per story
- runtime/quotebox-1.0.js    hosted once per story (plays each quote once, when 25% in view)

## Usage
1. Write the quote and attribution, choose colours, check the preview (Full width / Phone / Replay)
2. "Get the code" → Story setup: add once per story (custom head, or first HTML block)
3. "Get the code" → Quote HTML: paste into a Shorthand HTML block, one per quote
   (or All-in-one: CSS + HTML + JS in one block, no hosting needed)

## Notes
- Typography is inherited from the story (UCL Sans in the UCL stories); weight defaults to 600.
- Reduced motion or no JavaScript: the quote simply shows, no panel.
- Replays by default when the reader scrolls back to it (resets only once fully off screen).
  data-hq-replay="off" plays once; data-hq-motion="off" never animates.
- Runtime files are versioned by filename. Never change a published version in place —
  add quotebox-1.1.* and bump RUNTIME_VERSION in index.html, so live stories don't change underneath.

## Status
v1.0 (2026-11-23)
