// =====================================================================
// STAR FIELD — ambient twinkling background, theme-aware.
//
// Auto-initializes on any page with a <canvas id="starfield">. The
// canvas's data-theme attribute picks the palette:
//   data-theme="yin"   — dark stars on a light background (validator)
//   data-theme="yang"  — light stars on a dark background (decoder, default)
// =====================================================================
(function initStarfield() {
  var canvas = document.getElementById('starfield');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var theme = canvas.getAttribute('data-theme') === 'yin' ? 'yin' : 'yang';
  // Yang (decoder): soft blue-white stars, 200 of them.
  // Yin (validator): plain black stars, 160 of them — sparser + deeper
  // per-star alpha reads like distant punctuation on a cream page.
  var COUNT = theme === 'yin' ? 160 : 200;
  var stars = [];

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    stars = [];
    for (var i = 0; i < COUNT; i++) {
      if (theme === 'yin') {
        // Dark stars on a cream/light background need more ink than
        // light stars on dark need luminance — the eye reads black at
        // low alpha as washed-out gray before it reads as "star". Higher
        // alpha floor + ceiling brings yin stars to the same perceptual
        // weight as yang's soft-blue dots.
        stars.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          r: 0.5 + Math.random() * 1.5,
          alpha: 0.25 + Math.random() * 0.35,
          phase: Math.random() * Math.PI * 2,
          speed: 0.003 + Math.random() * 0.008
        });
      } else {
        stars.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          r: Math.random() * 1.2 + 0.2,
          alpha: Math.random() * 0.5 + 0.1,
          phase: Math.random() * Math.PI * 2,
          speed: Math.random() * 0.008 + 0.002
        });
      }
    }
  }

  function draw(t) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var flicker, a;
      if (theme === 'yin') {
        flicker = 0.7 + 0.3 * Math.sin(t * s.speed + s.phase);
        a = s.alpha * flicker;
        ctx.fillStyle = 'rgba(0,0,0,' + a + ')';
      } else {
        flicker = Math.sin(t * s.speed + s.phase) * 0.3 + 0.7;
        a = s.alpha * flicker;
        ctx.fillStyle = 'rgba(180,190,220,' + a + ')';
      }
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(draw);
})();
