/* Fluke runtime JS v1 — plays view-triggered scenes; safe to include more than once. */
(function (w, d) {
  if (w.HarpoonAnimate) { w.HarpoonAnimate.arm(); return; }
  var io = "IntersectionObserver" in w ? new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      var el = e.target, t = parseFloat(el.getAttribute("data-ha-threshold")) || 0.25;
      var vh = e.rootBounds ? e.rootBounds.height : w.innerHeight;
      if (e.isIntersecting && (e.intersectionRatio >= t || e.intersectionRect.height >= vh * t)) {
        el.classList.add("ha-run");
        if (el.getAttribute("data-ha-replay") === "off") io.unobserve(el);
      } else if (!e.isIntersecting && el.classList.contains("ha-run")) reset(el);
    });
  }, { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] }) : null;
  function reset(el) { el.classList.remove("ha-run"); el.classList.add("ha-reset"); void el.offsetWidth; el.classList.remove("ha-reset"); }
  function play(el) { reset(el); void el.offsetWidth; el.classList.add("ha-run"); }
  function arm(root) {
    (root || d).querySelectorAll(".ha[data-ha-trigger=view]:not(.ha-armed)").forEach(function (el) {
      el.classList.add("ha-armed");
      if (io) io.observe(el); else el.classList.add("ha-run");
    });
  }
  w.HarpoonAnimate = { version: 1, arm: arm, play: play, reset: reset };
  arm();
  d.addEventListener("DOMContentLoaded", function () { arm(); });
  var q = 0;
  if ("MutationObserver" in w) new MutationObserver(function () { if (q) return; q = 1; requestAnimationFrame(function () { q = 0; arm(); }); }).observe(d.documentElement, { childList: true, subtree: true });
})(window, document);
