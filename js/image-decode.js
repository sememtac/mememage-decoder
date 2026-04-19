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

  if (!detectBar(px, img.width, img.height)) {
    return Object.assign({ ok: false, detected: false, frame: null, decoded: null, error: 'No Mememage bar in this image.' }, base);
  }

  var frame = null, usedPpb = 3;
  var ppbCandidates = [3, 2];
  for (var i = 0; i < ppbCandidates.length; i++) {
    var ppb = ppbCandidates[i];
    var f = decodeFrame(extractBits(px, img.width, img.height, ppb));
    if (f) { frame = f; usedPpb = ppb; break; }
  }
  if (!frame) {
    return Object.assign({ ok: false, detected: true, frame: null, decoded: null, error: 'Bar detected but the payload is unreadable.' }, base);
  }

  var decoded = decodePayload(frame.payload);
  if (!decoded) {
    return Object.assign({ ok: false, detected: true, frame: frame, decoded: null, ppb: usedPpb, error: 'Bar detected but the payload is unreadable.' }, base);
  }

  return Object.assign({ ok: true, detected: true, frame: frame, decoded: decoded, ppb: usedPpb, error: null }, base);
}
