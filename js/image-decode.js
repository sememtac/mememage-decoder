// =====================================================================
// decodeImageBar — shared image → bar-decode pipeline for By Sight
// (decoder) and the Image tab (validator). Handles the parts both
// pages need identically:
//
//   1. Load the file as an <img>, draw to a canvas, read pixels.
//   2. Run detectBar on the pixel buffer.
//   3. If detected, try extractBits + decodeFrame at ppb=3 then ppb=2.
//   4. decodePayload on the recovered frame.
//
// Returns a structured result with the canvas + raw pixels so each
// page can run its own post-decode logic (decoder fetches + renders a
// cert; validator builds a forensic report).
//
// Depends on global primitives from js/codec.js: detectBar, extractBits,
// decodeFrame, decodePayload.
//
// Shape of the resolved value:
//   {
//     ok: bool                     — true if decoded payload is usable
//     detected: bool               — true if bar bands were detected
//     frame: {payload, …} | null   — the decoded frame if RS succeeded
//     decoded: {identifier, content_hash} | null
//     ppb: number                  — pixels-per-bit that worked (3 or 2)
//     canvas: HTMLCanvasElement    — the source canvas (for EMBODIED)
//     objUrl: string               — object URL (revoke when done)
//     pixels: Uint8ClampedArray    — raw RGBA data (for forensic work)
//     width, height: number
//     error: string | null         — error string on any failure
//   }
// =====================================================================
async function decodeImageBar(file) {
  var objUrl = URL.createObjectURL(file);
  var img = new Image();
  // Attach handlers BEFORE setting src so a cache-warm image can't
  // fire onload before the Promise wires up (theoretical for blob
  // URLs but harmless either way).
  var loadPromise = new Promise(function(resolve, reject) {
    img.onload = resolve;
    img.onerror = function() { reject(new Error('image load failed')); };
  });
  img.src = objUrl;
  try {
    await loadPromise;
  } catch (e) {
    URL.revokeObjectURL(objUrl);
    console.error('[image-decode] image load failed:', e);
    return { ok: false, detected: false, frame: null, decoded: null, error: 'image load failed' };
  }

  var canvas, px;
  try {
    canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    px = ctx.getImageData(0, 0, img.width, img.height).data;
  } catch (e) {
    URL.revokeObjectURL(objUrl);
    console.error('[image-decode] canvas read failed:', e);
    return { ok: false, detected: false, frame: null, decoded: null, error: 'canvas read failed (' + (e.message || e) + ')' };
  }

  var base = {
    canvas: canvas,
    objUrl: objUrl,
    pixels: px,
    width: img.width,
    height: img.height
  };

  var frame = null, usedPpb = 3, detected = false;

  // Brightness threshold candidates: the per-image Otsu midpoint reads the
  // centered bar (levels hug the dominant brightness — quiet on dark images);
  // RGB_THRESHOLD (128) reads legacy absolute bars and is the always-present
  // fallback. CRC + RS self-select, so a wrong threshold just fails frame
  // validation. Mirrors bar.py:extract_bar / codec.js:extractBarScaleAware.
  var thrs = [];
  var ot = otsuThreshold(px, img.width, img.height);
  if (ot !== null) thrs.push(ot);
  thrs.push(RGB_THRESHOLD);

  // Band detection is threshold-independent — do it once, reuse per candidate.
  var hasBar = detectBar(px, img.width, img.height);
  var bands = detectBarBands(px, img.width, img.height);
  if (hasBar || bands) detected = true;
  var scales = [];
  if (bands) {
    var raw_scale = (bands.m + bands.y + bands.c) / 3 / HEADER_BAND;
    if (Math.abs(raw_scale - 1.0) >= 0.05) {
      for (var off = -8; off <= 8; off++) {
        var s = Math.round((raw_scale + off * 0.01) * 1000) / 1000;
        if (s > 0.3 && s < 3.0 && Math.abs(s - 1.0) >= 0.005 && scales.indexOf(s) < 0) scales.push(s);
      }
    }
  }

  for (var ti = 0; ti < thrs.length && !frame; ti++) {
    var thr = thrs[ti];

    // High-res even-fill layout first (full-width, both-ends anchored).
    var efFrame = decodeEvenFill(px, img.width, img.height, thr);
    if (efFrame) { frame = efFrame; break; }

    // Cheap 1:1 fast path (no resize): ppb=3 then ppb=2.
    if (hasBar) {
      for (var i = 0; i < 2; i++) {
        var ppb = [3, 2][i];
        var f = decodeFrame(extractBits(px, img.width, img.height, ppb, thr));
        if (f) { frame = f; usedPpb = ppb; break; }
      }
    }
    if (frame) break;

    // Scale-aware sweep for resampled images.
    outer:
    for (var si = 0; si < scales.length; si++) {
      for (var pi = 0; pi < 2; pi++) {
        var pb = [3, 2][pi];
        var bits = extractBitsAtScale(px, img.width, img.height, scales[si], pb, thr);
        var fr = decodeFrame(bits);
        if (fr) { frame = fr; usedPpb = pb; break outer; }
      }
    }
  }
  if (!detected) {
    return Object.assign({ ok: false, detected: false, frame: null, decoded: null, error: 'No Mememage bar in this image.' }, base);
  }
  if (!frame) {
    return Object.assign({ ok: false, detected: true, frame: null, decoded: null, error: 'Bar detected but the payload is unreadable.' }, base);
  }

  var decoded = decodePayload(frame.payload);
  if (!decoded) {
    // Friendly nudge: if the payload starts with a band-fragment tag
    // byte (0x01 gen / 0x02 sky / 0x03 machine), it's a saved band
    // PNG, not a full image. Tell the user where to go instead of
    // "unreadable".
    var p = frame.payload;
    if (p && p.length >= 1 && (p[0] === 0x01 || p[0] === 0x02 || p[0] === 0x03)) {
      var fid = p[0] === 0x01 ? 'gen' : p[0] === 0x02 ? 'sky' : 'machine';
      return Object.assign({
        ok: false, detected: true, frame: frame, decoded: null, ppb: usedPpb, fragment: fid,
        error: 'This is the ' + fid + ' band of a saved certificate \u2014 drop it into the validator\u2019s Reliquary to gather the bar.'
      }, base);
    }
    return Object.assign({ ok: false, detected: true, frame: frame, decoded: null, ppb: usedPpb, error: 'Bar detected but the payload is unreadable.' }, base);
  }

  return Object.assign({ ok: true, detected: true, frame: frame, decoded: decoded, ppb: usedPpb, error: null }, base);
}
