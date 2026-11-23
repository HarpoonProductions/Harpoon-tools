/* Harpoon Quotebox runtime JS v1.0
   Arms .harpoon-quote elements and plays each one when 25% of it is in view.
   By default it replays when the reader scrolls back to it: it resets only once fully off screen,
   so it never visibly snaps back. data-hq-replay="off" plays once; data-hq-motion="off" never animates. */
(function () {
  if (window.HarpoonQuote) return;
  var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var io = (!still && "IntersectionObserver" in window) ? new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      var el = e.target;
      if (e.intersectionRatio >= 0.25) {
        el.classList.add("hq-in");
        if (el.getAttribute("data-hq-replay") === "off") io.unobserve(el);
      } else if (!e.isIntersecting) {
        el.classList.remove("hq-in");
      }
    });
  }, { threshold: [0, 0.25] }) : null;
  function arm(root) {
    if (!io) return;
    (root || document).querySelectorAll(".harpoon-quote:not(.hq-armed):not([data-hq-motion='off'])").forEach(function (el) {
      el.classList.add("hq-armed"); io.observe(el);
    });
  }
  function replay(el) {
    if (!io || el.getAttribute("data-hq-motion") === "off") return;
    el.classList.remove("hq-in"); el.classList.add("hq-armed"); void el.offsetWidth; el.classList.add("hq-in");
  }
  var queued = 0;
  window.HarpoonQuote = { version: "1.0", arm: arm, replay: replay };
  arm();
  document.addEventListener("DOMContentLoaded", function () { arm(); });
  if ("MutationObserver" in window) new MutationObserver(function () { if (queued) return; queued = 1; requestAnimationFrame(function () { queued = 0; arm(); }); }).observe(document.documentElement, { childList: true, subtree: true });
})();
