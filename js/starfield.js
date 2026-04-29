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

  // Sparser than the planetarium's planetary-scale density. Ambient
  // mode is wallpaper, not subject — fewer stars, dimmer, lots of
  // breathing room.
  CosmicStarfield.generate('ambient:' + theme, {
    outerCount: 220,
    innerCount: 110,
    warmFreq: theme === 'yin' ? 0 : 0.2 // yin paints in pure ink, no warm tint
  });

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
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
      brightnessBoost: 1.6    // ambient sits behind UI; needs more weight
                              // than the planetarium's foreground render
    });
    setTimeout(tick, 50); // 20fps — ambient is slow; saves cycles for the
                          // foreground UI while still feeling alive
  }
  tick();
})();
