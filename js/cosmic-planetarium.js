// =====================================================================
// COSMIC PLANETARIUM — modal 3D constellation viewer.
//
// Public API:
//   CosmicPlanetarium.open({
//     name: 'Tudemul',                   // constellation_name
//     hash: '6903883e84e12184',          // heart's content_hash (seed source)
//     currentStarIndex: 4,               // 0..11 (alpha..mu); -1 to skip pulse
//     heartRarity: 55,                   // 0-100 → spectral class for heart
//     currentRarity: 42,                 // 0-100 → spectral class + tier color
//     meta: certMeta                     // optional, for cosmic player
//   });
//   CosmicPlanetarium.close();
//
// Builds modal DOM on open, removes on close. Same engine the prototype
// uses (CosmicStarfield for bg, mode toggle between cosmic 3D and earth
// dome, drag/pinch/wheel input, radio pulse, etc).
//
// Depends on: cosmic-starfield.js (CosmicStarfield), cosmic-player.js
// (optional CosmicPlayer for music).
// =====================================================================

var CosmicPlanetarium = (function() {
  'use strict';

  // ─── Constants ───
  var GREEK = ['\u03b1','\u03b2','\u03b3','\u03b4','\u03b5','\u03b6','\u03b7','\u03b8','\u03b9','\u03ba','\u03bb','\u03bc'];
  var SPECTRAL = [
    { color: [255, 180, 100], min: 0  }, // K
    { color: [255, 240, 180], min: 20 }, // G
    { color: [255, 250, 230], min: 40 }, // F
    { color: [220, 230, 255], min: 52 }, // A
    { color: [170, 190, 255], min: 64 }, // B
    { color: [130, 160, 255], min: 74 }  // O
  ];
  var RARITY_TIERS = [
    [80, '#d44040'], [70, '#8a6210'], [60, '#5a2a8a'],
    [46, '#2a5090'], [35, '#2a7030'], [0, '#606060']
  ];
  var ZOOM_MIN = 0.5, ZOOM_MAX = 8.0;
  var TRANS_MS = 1500;

  // ─── State ───
  var modal = null, canvas = null, ctx = null;
  var nameEl = null, hintEl = null, modeBtns = null;
  var W = 0, H = 0, dpr = 1;
  var stars = [], edges = [];
  var thetaY = 0, thetaX = 0;
  var velY = 0.00055, velX = 0;
  var zoom = 1.0, zoomTarget = 1.0;
  var viewMode = 'cosmic';
  var transTo = null, transStart = 0, transStartTY = 0, transStartTX = 0;
  var dragging = false;
  var dragX0 = 0, dragY0 = 0, theta0Y = 0, theta0X = 0;
  var activePointers = new Map();
  var pinchStartDist = 0, pinchStartZoom = 1;
  var renderTimer = null;
  var heartRgbCache = [255, 240, 200];
  var currentRgbCache = [245, 245, 250];
  var pulseRgb = [220, 220, 240];
  var spriteHeart = null, spriteCool = null, spriteCurrent = null;
  var currentStarIndex = -1;
  var openOpts = null;
  var playerMinimal = false;

  // ─── Helpers ───
  function makeRng(seed) {
    var s = seed | 0; if (!s) s = 1;
    return function() { s = (s * 1103515245 + 12345) & 0x7FFFFFFF; return s / 0x7FFFFFFF; };
  }
  function strSeed(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0x7FFFFFFF;
    return h || 1;
  }
  function wrapPi(t) {
    var w = ((t + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    return w - Math.PI;
  }
  function rotateX(p, c, s) { return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c }; }
  function rotateY(p, c, s) { return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c }; }
  function spectralFor(score) {
    for (var i = SPECTRAL.length - 1; i >= 0; i--) if (score >= SPECTRAL[i].min) return SPECTRAL[i];
    return SPECTRAL[0];
  }
  function tierColorFor(score) {
    for (var i = 0; i < RARITY_TIERS.length; i++) if (score >= RARITY_TIERS[i][0]) return RARITY_TIERS[i][1];
    return RARITY_TIERS[5][1];
  }
  function brightenHex(hex, amount) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return [
      Math.round(r + (255 - r) * amount),
      Math.round(g + (255 - g) * amount),
      Math.round(b + (255 - b) * amount)
    ];
  }

  // ─── Constellation generation ───
  function generateStars(constellationName, hashSeed) {
    var rng = makeRng(strSeed(constellationName));
    var st = [];
    st.push({ x: (0.3 + rng() * 0.4) - 0.5, y: (0.2 + rng() * 0.6) - 0.5, isHeart: true });
    for (var i = 1; i < 12; i++) {
      var placed = false, x = 0, y = 0;
      for (var attempt = 0; attempt < 50 && !placed; attempt++) {
        var anchor = st[Math.floor(rng() * st.length)];
        var ang = rng() * Math.PI * 2;
        var dist = 0.10 + rng() * 0.20;
        x = anchor.x + Math.cos(ang) * dist;
        y = anchor.y + Math.sin(ang) * dist;
        x = Math.max(-0.45, Math.min(0.45, x));
        y = Math.max(-0.45, Math.min(0.45, y));
        var ok = true;
        for (var j = 0; j < st.length; j++) {
          var dx = x - st[j].x, dy = y - st[j].y;
          if (dx*dx + dy*dy < 0.005) { ok = false; break; }
        }
        if (ok) placed = true;
      }
      st.push({ x: x, y: y, isHeart: false });
    }
    for (var k = 0; k < 12; k++) {
      var perRng = makeRng(strSeed(hashSeed + ':' + k));
      var z = (perRng() - 0.5) * 1.2;
      if (st[k].isHeart) z = 0;
      st[k].z = z;
    }
    return st;
  }

  function buildEdges(cStars) {
    var n = cStars.length;
    function cDst(a, b) { var dx = b.x - a.x, dy = b.y - a.y; return Math.sqrt(dx*dx + dy*dy); }
    var cEdges = [], cInTree = [true];
    for (var i = 1; i < n; i++) cInTree.push(false);
    function cDeg(idx) { var d = 0; for (var i = 0; i < cEdges.length; i++) if (cEdges[i][0] === idx || cEdges[i][1] === idx) d++; return d; }
    function cAngBtw(ax, ay, bx, by) {
      var dot = ax*bx + ay*by;
      var m = Math.sqrt(ax*ax + ay*ay) * Math.sqrt(bx*bx + by*by);
      if (m < 0.001) return 180;
      return Math.acos(Math.max(-1, Math.min(1, dot/m))) * 180 / Math.PI;
    }
    function cAngOk(a, b) {
      var abx = cStars[b].x - cStars[a].x, aby = cStars[b].y - cStars[a].y;
      for (var ei = 0; ei < cEdges.length; ei++) {
        var e0 = cEdges[ei][0], e1 = cEdges[ei][1];
        if (e0 === a || e1 === a) { var o = e0 === a ? e1 : e0; if (cAngBtw(abx, aby, cStars[o].x - cStars[a].x, cStars[o].y - cStars[a].y) < 35) return false; }
        if (e0 === b || e1 === b) { var o2 = e0 === b ? e1 : e0; if (cAngBtw(-abx, -aby, cStars[o2].x - cStars[b].x, cStars[o2].y - cStars[b].y) < 35) return false; }
      }
      return true;
    }
    var cELens = [];
    for (var step = 0; step < n - 1; step++) {
      var cands = [];
      for (var ci = 0; ci < n; ci++) {
        if (!cInTree[ci]) continue;
        for (var cj = 0; cj < n; cj++) {
          if (cInTree[cj]) continue;
          cands.push({ i: ci, j: cj, d: cDst(cStars[ci], cStars[cj]) });
        }
      }
      cands.sort(function(a, b) { return a.d - b.d; });
      var avg = 0;
      if (cELens.length > 0) { for (var cl = 0; cl < cELens.length; cl++) avg += cELens[cl]; avg /= cELens.length; }
      var maxEdge = cELens.length >= 3 ? avg * 3 : Infinity;
      var added = false;
      for (var k0 = 0; k0 < cands.length; k0++) {
        var c0 = cands[k0];
        if (cDeg(c0.i) >= 3) continue;
        if (!cAngOk(c0.i, c0.j)) continue;
        if (c0.d > maxEdge) continue;
        cInTree[c0.j] = true; cEdges.push([c0.i, c0.j]); cELens.push(c0.d); added = true; break;
      }
      if (!added) {
        for (var k1 = 0; k1 < cands.length; k1++) {
          if (cDeg(cands[k1].i) < 3 && cands[k1].d <= maxEdge) {
            cInTree[cands[k1].j] = true; cEdges.push([cands[k1].i, cands[k1].j]); cELens.push(cands[k1].d); added = true; break;
          }
        }
      }
      if (!added && cands.length) {
        cInTree[cands[0].j] = true; cEdges.push([cands[0].i, cands[0].j]); cELens.push(cands[0].d);
      }
    }
    var cAdj = [];
    for (var ai = 0; ai < n; ai++) cAdj.push([]);
    for (var ei2 = 0; ei2 < cEdges.length; ei2++) { cAdj[cEdges[ei2][0]].push(cEdges[ei2][1]); cAdj[cEdges[ei2][1]].push(cEdges[ei2][0]); }
    var rngE = [];
    for (var ri = 0; ri < n; ri++) {
      for (var rj = ri + 1; rj < n; rj++) {
        var dij = cDst(cStars[ri], cStars[rj]);
        var blocked = false;
        for (var rk = 0; rk < n; rk++) {
          if (rk === ri || rk === rj) continue;
          if (cDst(cStars[ri], cStars[rk]) < dij && cDst(cStars[rj], cStars[rk]) < dij) { blocked = true; break; }
        }
        if (!blocked) rngE.push([ri, rj]);
      }
    }
    var extras = [];
    for (var xi = 0; xi < rngE.length; xi++) {
      var a = rngE[xi][0], b = rngE[xi][1];
      var inM = false;
      for (var mi = 0; mi < cEdges.length; mi++) {
        if ((cEdges[mi][0] === a && cEdges[mi][1] === b) || (cEdges[mi][0] === b && cEdges[mi][1] === a)) { inM = true; break; }
      }
      if (!inM) extras.push([a, b]);
    }
    function findPath(f, t, mx) {
      var q = [[f, [f]]]; var v = {}; v[f] = true;
      while (q.length > 0) {
        var cur = q.shift(); var node = cur[0], path = cur[1];
        if (path.length > mx + 1) continue;
        if (node === t && path.length > 1) return path;
        for (var ni = 0; ni < cAdj[node].length; ni++) {
          var nx = cAdj[node][ni];
          if (!v[nx]) { v[nx] = true; q.push([nx, path.concat([nx])]); }
        }
      }
      return null;
    }
    function ptInPoly(px, py, poly) {
      var s = 0;
      for (var i = 0; i < poly.length; i++) {
        var jj = (i + 1) % poly.length;
        var c = (poly[jj].x - poly[i].x) * (py - poly[i].y) - (poly[jj].y - poly[i].y) * (px - poly[i].x);
        if (Math.abs(c) < 0.01) continue;
        if (s === 0) s = c > 0 ? 1 : -1;
        else if ((c > 0 ? 1 : -1) !== s) return false;
      }
      return true;
    }
    var addedExtras = 0;
    for (var ek = 0; ek < extras.length && addedExtras < 2; ek++) {
      var ea = extras[ek][0], eb = extras[ek][1];
      var path2 = findPath(ea, eb, 3);
      if (!path2 || path2.length < 3 || path2.length > 4) continue;
      var poly = path2.map(function(idx) { return cStars[idx]; });
      var enclosed = false;
      for (var csi = 0; csi < n; csi++) {
        var inP = false;
        for (var pi = 0; pi < path2.length; pi++) if (path2[pi] === csi) { inP = true; break; }
        if (inP) continue;
        if (ptInPoly(cStars[csi].x, cStars[csi].y, poly)) { enclosed = true; break; }
      }
      if (enclosed) continue;
      cEdges.push([ea, eb]);
      cAdj[ea].push(eb); cAdj[eb].push(ea);
      addedExtras++;
    }
    return cEdges;
  }

  // ─── Sprite caching ───
  function makeSprite(rgbPrefix, baseSize) {
    var pad = baseSize * 4;
    var s = Math.ceil(pad * 2);
    var spr = document.createElement('canvas');
    spr.width = s; spr.height = s;
    var sx = spr.getContext('2d');
    var cx_ = s / 2, cy_ = s / 2;
    var g = sx.createRadialGradient(cx_, cy_, 0, cx_, cy_, baseSize * 4);
    g.addColorStop(0, rgbPrefix + ',0.25)');
    g.addColorStop(1, rgbPrefix + ',0)');
    sx.fillStyle = g;
    sx.beginPath(); sx.arc(cx_, cy_, baseSize * 4, 0, Math.PI * 2); sx.fill();
    sx.fillStyle = rgbPrefix + ',1)';
    sx.beginPath(); sx.arc(cx_, cy_, baseSize, 0, Math.PI * 2); sx.fill();
    return { canvas: spr, base: baseSize, half: pad };
  }
  function buildStarSprites() {
    spriteHeart = makeSprite('rgba(' + heartRgbCache.join(','), 4.5);
    spriteCool  = makeSprite('rgba(245,245,250', 3.0);
    spriteCurrent = makeSprite('rgba(' + currentRgbCache.join(','), 3.0);
  }

  // ─── DOM ───
  function buildDom() {
    if (modal) return;
    modal = document.createElement('div');
    modal.className = 'planetarium';
    modal.id = 'cosmicPlanetarium';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = ''
      + '<div class="planetarium-name">'
      +   '<div class="planetarium-name-text"></div>'
      + '</div>'
      + '<canvas class="planetarium-canvas"></canvas>'
      + '<div class="planetarium-mode">'
      +   '<button data-mode="cosmic" class="active">Cosmic</button>'
      +   '<button data-mode="earth">Earth</button>'
      + '</div>'
      + '<div class="planetarium-hint">drag to rotate · pinch or scroll to zoom · the destiny shape is one viewpoint</div>'
      + '<button class="planetarium-close" aria-label="Close">&times;</button>';
    document.body.appendChild(modal);
    canvas = modal.querySelector('.planetarium-canvas');
    // desynchronized: true lets Chrome render canvas updates without
    // blocking the main thread on compositor sync, big win on 4K.
    // alpha: true (explicit) keeps the planetarium overlay translucent.
    ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    nameEl = modal.querySelector('.planetarium-name-text');
    hintEl = modal.querySelector('.planetarium-hint');
    modeBtns = modal.querySelectorAll('.planetarium-mode button');
    modal.querySelector('.planetarium-close').addEventListener('click', close);
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
    document.addEventListener('keydown', _onKey);
    modeBtns.forEach(function(b) {
      b.addEventListener('click', function() { setViewMode(b.dataset.mode); });
    });
    bindInput();
    window.addEventListener('resize', resize);
  }
  function _onKey(e) { if (e.key === 'Escape') close(); }

  function destroyDom() {
    if (!modal) return;
    document.removeEventListener('keydown', _onKey);
    window.removeEventListener('resize', resize);
    if (modal.parentElement) modal.parentElement.removeChild(modal);
    modal = null; canvas = null; ctx = null; nameEl = null; hintEl = null; modeBtns = null;
  }

  // ─── Sizing ───
  // Cap actual canvas pixel dimensions. Canvas 2D is CPU-bound; on a
  // 4K monitor (3840x2160) the per-frame trail wash + 740 bg star
  // fillRects swamps even discrete GPUs (the work happens in the
  // browser's compositor thread, not on the GPU). Capping the long
  // axis at ~2000 px keeps the visual effectively identical (stars
  // are dots, lines are 1-2px wide) while reducing pixel work by
  // ~3-4x on high-DPI displays.
  var MAX_CANVAS_LONG = 1600;
  function resize() {
    if (!canvas) return;
    var ratio = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    var pixW = W * ratio, pixH = H * ratio;
    var longest = Math.max(pixW, pixH);
    var capScale = longest > MAX_CANVAS_LONG ? (MAX_CANVAS_LONG / longest) : 1;
    dpr = ratio * capScale;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildStarSprites();
  }

  // ─── Render ───
  function render() {
    if (!ctx) return;
    ctx.fillStyle = 'rgba(2, 2, 4, 0.35)';
    ctx.fillRect(0, 0, W, H);

    // Center the constellation in the viewport's visible region — the
    // bottom is occupied by the cosmic player (~90px expanded, ~24px
    // when collapsed to its drawer pill), so cy shifts up by half the
    // player's height. Without this offset the constellation drifts
    // visually low.
    var playerHeight = playerMinimal ? 24 : 90;
    var cx = W / 2;
    var cy = (H - playerHeight) / 2;
    zoom += (zoomTarget - zoom) * 0.12;
    var scale = Math.min(W, H) * 0.32 * zoom;
    var perspective = 2.4;
    var cy2 = Math.cos(thetaY), sy = Math.sin(thetaY);
    var cx2 = Math.cos(thetaX), sx = Math.sin(thetaX);

    if (viewMode === 'earth') {
      // Full hemisphere FOV (~180°) so the bg starfield covers wherever
      // the constellation slides to as the user pans their gaze. The
      // constellation has no FOV cap; if the dome is narrower the
      // constellation can scroll into empty space.
      CosmicStarfield.renderDome(ctx, {
        cx: cx, cy: cy, W: W, H: H, scale: scale,
        thetaY: thetaY, thetaX: thetaX, invertPan: true,
        fovLimit: Math.PI
      });
    } else {
      CosmicStarfield.renderCosmic(ctx, {
        cx: cx, cy: cy, W: W, H: H, scale: scale,
        thetaY: thetaY, thetaX: thetaX, perspective: perspective
      });
    }

    var projected;
    if (viewMode === 'earth') {
      var visibleY = wrapPi(thetaY);
      var visibleX = thetaX;
      var pxPerRadX = scale * 0.85;
      var pxPerRadY = scale * 0.85;
      var anchorX = cx + visibleY * pxPerRadX;
      var anchorY = cy - visibleX * pxPerRadY;
      var fixedScale = scale * 0.75;
      projected = stars.map(function(p, i) {
        return { i: i, isHeart: p.isHeart,
          x: anchorX + p.x * fixedScale, y: anchorY + p.y * fixedScale,
          z: 0, f: 1.0 };
      });
    } else {
      projected = stars.map(function(p, i) {
        var r1 = rotateY(p, cy2, sy);
        var r2 = rotateX(r1, cx2, sx);
        var f = perspective / (perspective - r2.z);
        return { i: i, isHeart: p.isHeart,
          x: cx + r2.x * scale * f, y: cy + r2.y * scale * f,
          z: r2.z, f: f };
      });
    }

    // Edges (back-to-front)
    var sortedEdges = edges.map(function(e) {
      var a = projected[e[0]], b = projected[e[1]];
      return { a: a, b: b, midZ: (a.z + b.z) * 0.5 };
    }).sort(function(a, b) { return a.midZ - b.midZ; });
    for (var i = 0; i < sortedEdges.length; i++) {
      var e = sortedEdges[i];
      var alpha = Math.max(0.1, Math.min(0.5, 0.35 + e.midZ * 0.25));
      ctx.strokeStyle = 'rgba(220, 220, 240, ' + alpha + ')';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(e.a.x, e.a.y);
      ctx.lineTo(e.b.x, e.b.y);
      ctx.stroke();
    }

    // Stars
    var sortedStars = projected.slice().sort(function(a, b) { return a.z - b.z; });
    ctx.font = '10px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'left';
    for (var s = 0; s < sortedStars.length; s++) {
      var p = sortedStars[s];
      var brightness = 0.7 + p.z * 0.5;
      if (brightness < 0.4) brightness = 0.4; else if (brightness > 1) brightness = 1;
      var isKnown = p.isHeart || p.i === currentStarIndex;
      if (isKnown) {
        var spr = p.isHeart ? spriteHeart : spriteCurrent;
        var sprScale = p.f;
        var drawW = spr.canvas.width * sprScale;
        var drawH = spr.canvas.height * sprScale;
        ctx.globalAlpha = brightness;
        ctx.drawImage(spr.canvas, p.x - drawW * 0.5, p.y - drawH * 0.5, drawW, drawH);
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(220,220,235,' + (0.6 + 0.3 * brightness) + ')';
        ctx.fillText(GREEK[p.i], p.x + spr.base * sprScale + 6, p.y + 3);
      } else {
        var dotR = 1.7 * p.f;
        ctx.fillStyle = 'rgba(170,175,195,' + (brightness * 0.55) + ')';
        ctx.beginPath(); ctx.arc(p.x, p.y, dotR, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Radio pulse around current star
    if (currentStarIndex >= 0 && currentStarIndex < projected.length) {
      var me = projected[currentStarIndex];
      if (me) {
        var pulseDur = 3000;
        var startR = (me.isHeart ? 4.5 : 3.0) * me.f * 1.6;
        var maxR = startR + 70;
        var nowMs = Date.now();
        var pr = pulseRgb[0], pg = pulseRgb[1], pb = pulseRgb[2];
        for (var po = 0; po < 2; po++) {
          var offsetMs = po * pulseDur * 0.5;
          var t = ((nowMs + offsetMs) % pulseDur) / pulseDur;
          var r = startR + t * (maxR - startR);
          var alphaP = (1 - t) * (1 - t) * 0.65;
          if (alphaP < 0.01) continue;
          ctx.strokeStyle = 'rgba(' + pr + ',' + pg + ',' + pb + ',' + alphaP + ')';
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(me.x, me.y, r, 0, Math.PI * 2); ctx.stroke();
        }
      }
    }

    // Camera state update — both 'earth' and 'cosmic' transitions
    // ease angles (and only 'cosmic' eases zoom; that's handled by
    // the existing zoom-easing path against zoomTarget).
    if (transTo) {
      var tt = Math.min(1, (Date.now() - transStart) / TRANS_MS);
      var eased = tt * tt * (3 - 2 * tt);
      var ty = wrapPi(transStartTY);
      thetaY = ty * (1 - eased);
      thetaX = transStartTX * (1 - eased);
      if (tt >= 1) { transTo = null; thetaY = 0; thetaX = 0; }
    } else if (!dragging) {
      thetaY += velY;
      thetaX += velX;
      velX *= 0.998;
    }
  }

  function start() {
    if (renderTimer) return;
    // 40ms tick (~25fps). Auto-rotate and the radio pulse are slow
    // enough that 25 reads as smooth; dropping from 30fps frees
    // ~17% of the per-second compute budget.
    function tick() { render(); renderTimer = setTimeout(tick, 40); }
    tick();
  }
  function stop() { if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; } }

  // ─── Input ───
  function bindInput() {
    canvas.addEventListener('pointerdown', _onPointerDown);
    canvas.addEventListener('pointermove', _onPointerMove);
    canvas.addEventListener('pointerup', _onPointerEnd);
    canvas.addEventListener('pointercancel', _onPointerEnd);
    canvas.addEventListener('wheel', _onWheel, { passive: false });
  }
  function _onPointerDown(e) {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    if (activePointers.size === 1) {
      dragging = true;
      canvas.classList.add('dragging');
      dragX0 = e.clientX; dragY0 = e.clientY;
      theta0Y = thetaY; theta0X = thetaX;
      velY = 0; velX = 0;
    } else if (activePointers.size === 2) {
      dragging = false;
      var pts = []; activePointers.forEach(function(v) { pts.push(v); });
      var dxp = pts[1].x - pts[0].x, dyp = pts[1].y - pts[0].y;
      pinchStartDist = Math.sqrt(dxp * dxp + dyp * dyp);
      pinchStartZoom = zoomTarget;
    }
  }
  function _onPointerMove(e) {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.size === 1 && dragging) {
      var dx = e.clientX - dragX0, dy = e.clientY - dragY0;
      var sens = 0.005 / (zoom > 0.1 ? zoom : 0.1);
      thetaY = theta0Y + dx * sens;
      thetaX = theta0X - dy * sens;
      thetaX = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, thetaX));
    } else if (activePointers.size === 2 && pinchStartDist > 0) {
      var pts2 = []; activePointers.forEach(function(v) { pts2.push(v); });
      var dxp2 = pts2[1].x - pts2[0].x, dyp2 = pts2[1].y - pts2[0].y;
      var dist2 = Math.sqrt(dxp2 * dxp2 + dyp2 * dyp2);
      var nz = pinchStartZoom * (dist2 / pinchStartDist);
      zoomTarget = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, nz));
    }
  }
  function _onPointerEnd(e) {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.delete(e.pointerId);
    if (activePointers.size === 0) {
      if (dragging) {
        dragging = false;
        canvas.classList.remove('dragging');
        velY = (viewMode === 'earth') ? 0.00028 : 0.00055;
        velX = 0;
      }
      pinchStartDist = 0;
    } else if (activePointers.size === 1) {
      pinchStartDist = 0;
      var arr = []; activePointers.forEach(function(v) { arr.push(v); });
      var rem = arr[0];
      dragX0 = rem.x; dragY0 = rem.y;
      theta0Y = thetaY; theta0X = thetaX;
      dragging = true;
      canvas.classList.add('dragging');
    }
  }
  function _onWheel(e) {
    e.preventDefault();
    zoomTarget *= Math.exp(-e.deltaY * 0.0015);
    zoomTarget = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomTarget));
  }

  // ─── View mode ───
  // Clicking Cosmic always re-anchors the constellation to the
  // canonical default view (thetaY = thetaX = 0, zoom = 1) — even
  // if the user was already in cosmic mode. Acts as a "reset / go
  // home" button on top of the mode switch. Same eased reset path
  // as the earth transition.
  function setViewMode(mode) {
    if (mode !== 'cosmic' && mode !== 'earth') return;
    viewMode = mode;
    if (modeBtns) modeBtns.forEach(function(b) { b.classList.toggle('active', b.dataset.mode === mode); });
    transTo = mode;
    transStart = Date.now();
    transStartTY = thetaY;
    transStartTX = thetaX;
    velY = 0; velX = 0;
    if (mode === 'cosmic') {
      // Reset zoom too — full "go home" gesture.
      zoomTarget = 1.0;
      if (canvas) canvas.classList.remove('earth-mode');
      if (hintEl) hintEl.textContent = 'drag to rotate · pinch or scroll to zoom · the destiny shape is one viewpoint';
    } else {
      if (canvas) canvas.classList.add('earth-mode');
      if (hintEl) hintEl.textContent = 'drag to look around · pinch or scroll to zoom · you are standing on Earth';
    }
    setTimeout(function() {
      if (viewMode === 'earth' && !dragging) velY = 0.00028;
      else if (viewMode === 'cosmic' && !dragging) velY = 0.00055;
    }, TRANS_MS);
  }

  // ─── Cosmic player integration ───
  // Track the player's resize observer so we can disconnect on close.
  var playerResizeObserver = null;

  // Recompute the hint's bottom value to ride flush with the top of
  // the music box. Reads the player's actual rendered height and
  // writes inline bottom on the hint directly — bypasses CSS
  // variable indirection so the path is unambiguous.
  function updateHintPosition() {
    if (!modal) return;
    var p = document.querySelector('.cosmic-player');
    if (!p) return;
    var hint = modal.querySelector('.planetarium-hint');
    if (!hint) return;
    // Use getBoundingClientRect.top relative to viewport bottom so we
    // capture the player's actual upper edge in viewport coords —
    // robust to any margin/transform/padding the player picks up.
    var rect = p.getBoundingClientRect();
    if (rect.height < 1) return;
    var distFromBottom = Math.round(window.innerHeight - rect.top);
    // +32 gap for clear breathing room above the music box's top edge.
    hint.style.bottom = (distFromBottom + 32) + 'px';
  }

  function injectPlayer() {
    if (typeof CosmicPlayer === 'undefined' || !openOpts || !openOpts.meta) return;
    if (typeof CosmicPlayer.dismiss === 'function') CosmicPlayer.dismiss();
    if (typeof getRarityTier === 'function') {
      var tier = getRarityTier((openOpts.meta && openOpts.meta.rarity_score) || 0);
      // Player is a body child — set the var on body so it inherits.
      document.body.style.setProperty('--rarity-color', tier.color);
    }
    // Inject as a direct child of <body> rather than the planetarium
    // overlay. The planetarium has backdrop-filter, which creates a
    // containing block for position: fixed descendants — placing the
    // player inside it caused the player to anchor to the planetarium
    // rather than the viewport, which clipped it.
    CosmicPlayer.inject(document.body, openOpts.meta);
    var players = document.body.querySelectorAll(':scope > .cosmic-player');
    var p = players[players.length - 1];
    if (p) {
      p.classList.add('in-planetarium');
      // Keep hint pinned to the music box's top edge. ResizeObserver
      // catches the slide-up + minimal toggle continuously; the
      // setTimeout snapshots are belts + suspenders for browsers
      // where the observer doesn't fire on the display:none → block
      // first-render transition.
      if (typeof ResizeObserver !== 'undefined') {
        playerResizeObserver = new ResizeObserver(updateHintPosition);
        playerResizeObserver.observe(p);
      }
      // Multi-stage snapshots across the player's slide-up animation
      // (CosmicPlayer adds .visible at 800ms, animation runs 0.8s).
      [50, 200, 500, 850, 1200, 1700, 2500].forEach(function(ms) {
        setTimeout(updateHintPosition, ms);
      });
    }
  }
  function dismissPlayer() {
    if (playerResizeObserver) {
      try { playerResizeObserver.disconnect(); } catch (_) {}
      playerResizeObserver = null;
    }
    if (typeof CosmicPlayer !== 'undefined' && typeof CosmicPlayer.dismiss === 'function') CosmicPlayer.dismiss();
    var leftover = document.body.querySelectorAll(':scope > .cosmic-player');
    for (var i = 0; i < leftover.length; i++) {
      if (leftover[i].parentElement) leftover[i].parentElement.removeChild(leftover[i]);
    }
    document.body.style.removeProperty('--rarity-color');
  }

  // ─── Public API ───
  function open(opts) {
    opts = opts || {};
    openOpts = opts;
    var name = opts.name || 'Constellation';
    var hash = opts.hash || '0000000000000000';
    buildDom();
    nameEl.textContent = name;
    stars = generateStars(name, hash);
    edges = buildEdges(stars);
    // Lower density than the engine default (740). The planetarium
    // overlay sits in front of the page-level starfield, so we don't
    // need a dense backdrop in addition. ~360 reads as a present sky
    // without burning fillRects.
    CosmicStarfield.generate(name + ':' + hash, {
      outerCount: 220, innerCount: 140
    });
    thetaY = 0; thetaX = 0; velY = 0.00055; velX = 0;
    zoom = 1.0; zoomTarget = 1.0;
    viewMode = 'cosmic'; transTo = null;
    if (modeBtns) modeBtns.forEach(function(b) { b.classList.toggle('active', b.dataset.mode === 'cosmic'); });
    if (canvas) canvas.classList.remove('earth-mode');
    if (hintEl) hintEl.textContent = 'drag to rotate · pinch or scroll to zoom · the destiny shape is one viewpoint';

    currentStarIndex = (typeof opts.currentStarIndex === 'number') ? opts.currentStarIndex : -1;

    var heartRarity = (typeof opts.heartRarity === 'number') ? opts.heartRarity : 0;
    var curRarity = (typeof opts.currentRarity === 'number') ? opts.currentRarity : 0;
    heartRgbCache = spectralFor(heartRarity).color.slice();
    currentRgbCache = spectralFor(curRarity).color.slice();
    pulseRgb = brightenHex(tierColorFor(curRarity), 0.3);

    resize();
    playerMinimal = false;
    modal.classList.remove('player-minimal');
    modal.classList.add('visible');
    modal.setAttribute('aria-hidden', 'false');
    injectPlayer();
    start();
    document.dispatchEvent(new CustomEvent('cosmic-planetarium-open', { bubbles: true }));
  }

  function close() {
    if (!modal) return;
    modal.classList.remove('visible');
    modal.setAttribute('aria-hidden', 'true');
    dismissPlayer();
    setTimeout(function() {
      stop();
      destroyDom();
      document.dispatchEvent(new CustomEvent('cosmic-planetarium-close', { bubbles: true }));
    }, 700);
  }

  // Listen for player toggle events: mirror minimal class onto modal
  // (so the hint can ride above the player) and track state so the
  // constellation re-centers above the new player height. Also nudge
  // updateHintPosition across the player's transition so the hint
  // tracks the height change beyond what ResizeObserver provides.
  document.addEventListener('cosmic-player-toggle', function(e) {
    var min = !!(e.detail && e.detail.minimal);
    playerMinimal = min;
    if (modal) modal.classList.toggle('player-minimal', min);
    setTimeout(updateHintPosition, 50);
    setTimeout(updateHintPosition, 250);
    setTimeout(updateHintPosition, 600);
  });

  return { open: open, close: close };
})();
