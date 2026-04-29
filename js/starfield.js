// =====================================================================
// STAR FIELD — ambient cosmic backdrop, theme-aware.
//
// Auto-initializes on any page with a <canvas id="starfield">. The
// canvas's data-theme attribute picks the palette:
//   data-theme="yin"   — dark ink on a cream background (validator)
//   data-theme="yang"  — light stars on a dark background (decoder)
//
// Backed by js/cosmic-starfield.js — the same 3D engine the planetarium
// uses. In ambient mode the dome projection runs with very slow drift
// (~600s per revolution) and per-star twinkle. When a planetarium
// session opens, it can take over the same engine for full 3D control,
// then hand back to ambient on close — no engine swap, no flash.
// =====================================================================
(function initStarfield() {
  var canvas = document.getElementById('starfield');
  if (!canvas || typeof CosmicStarfield === 'undefined') return;
  var ctx = canvas.getContext('2d');
  var theme = canvas.getAttribute('data-theme') === 'yin' ? 'yin' : 'yang';

  // The decoder/validator pages are a "god view" of the cosmos —
  // visiting them puts you outside, looking in. Stars are the
  // primary atmosphere, not faint backdrop. Generous density,
  // bright per-star alpha (boosted in renderDome below).
  CosmicStarfield.generate('ambient:' + theme, {
    outerCount: 360,
    innerCount: 200,
    warmFreq: theme === 'yin' ? 0 : 0.25 // yin paints in pure ink, no warm tint
  });

  // Cap actual canvas pixel dimensions. On a 4K monitor without DPR
  // scaling the canvas would be 3840x2160 — clearRect alone is ~8M
  // pixels per frame for what is meant to be a quiet ambient
  // backdrop. Capping the long axis at ~1800 keeps it light. Stars
  // are dots; the visual difference is invisible at typical viewing
  // distance.
  var MAX_CANVAS_LONG = 1800;
  var renderScale = 1;
  function resize() {
    var W = window.innerWidth, H = window.innerHeight;
    var longest = Math.max(W, H);
    var s = longest > MAX_CANVAS_LONG ? (MAX_CANVAS_LONG / longest) : 1;
    canvas.width = Math.round(W * s);
    canvas.height = Math.round(H * s);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    renderScale = s;
  }
  window.addEventListener('resize', resize);
  resize();

  var startMs = Date.now();

  function tick() {
    var elapsed = (Date.now() - startMs) / 1000;
    // ~600s for one full Y-axis revolution — slow enough to be subliminal
    var thetaY = (elapsed * Math.PI * 2) / 600;
    var W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    CosmicStarfield.renderDome(ctx, {
      cx: W / 2, cy: H / 2, W: W, H: H,
      scale: Math.min(W, H) * 0.45, // wider spread than planetarium so the
                                    // page doesn't feel like a vignetted hole
      thetaY: thetaY, thetaX: 0,
      theme: theme,
      time: Date.now(),       // drives per-star twinkle
      brightnessBoost: 2.4    // god-view framing — the cosmos is the
                              // subject, not a faint backdrop
    });
    setTimeout(tick, 50); // 20fps — ambient is slow; saves cycles for the
                          // foreground UI while still feeling alive
  }
  tick();
})();
