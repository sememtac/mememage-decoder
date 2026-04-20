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

  function buildStars(w, h) {
    stars = [];
    for (var i = 0; i < COUNT; i++) {
      if (theme === 'yin') {
        // Dark stars on a cream/light background need more ink than
        // light stars on dark need luminance — the eye reads black at
        // low alpha as washed-out gray before it reads as "star". Higher
        // alpha floor + ceiling brings yin stars to the same perceptual
        // weight as yang's soft-blue dots.
        stars.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: 0.5 + Math.random() * 1.5,
          alpha: 0.25 + Math.random() * 0.35,
          phase: Math.random() * Math.PI * 2,
          speed: 0.003 + Math.random() * 0.008
        });
      } else {
        stars.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: Math.random() * 1.2 + 0.2,
          alpha: Math.random() * 0.5 + 0.1,
          phase: Math.random() * Math.PI * 2,
          speed: Math.random() * 0.008 + 0.002
        });
      }
    }
  }

  function resize() {
    var prevW = canvas.width || window.innerWidth;
    var prevH = canvas.height || window.innerHeight;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (stars.length === 0) {
      // First run — seed the field to fit the current viewport.
      buildStars(canvas.width, canvas.height);
    } else {
      // iOS Safari / Chrome fire `resize` when the URL bar or bottom
      // toolbar toggles during scroll — that used to reshuffle every
      // star on every tick, reading as a visible pattern change. Keep
      // the existing field; rescale positions proportionally so stars
      // spread across the new canvas dimensions instead of clumping.
      var sx = prevW ? canvas.width / prevW : 1;
      var sy = prevH ? canvas.height / prevH : 1;
      if (sx !== 1 || sy !== 1) {
        for (var j = 0; j < stars.length; j++) {
          stars[j].x *= sx;
          stars[j].y *= sy;
        }
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
