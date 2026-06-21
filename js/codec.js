// =====================================================================
// CODEC — Mememage bar decoder (v4 with RS, v3 fallback)
// =====================================================================
function crc16(d){let c=0xFFFF;for(const b of d){c^=b<<8;for(let i=0;i<8;i++)c=(c&0x8000)?((c<<1)^0x1021)&0xFFFF:(c<<1)&0xFFFF;}return c;}

// =====================================================================
// Identifier grammar — ONE source of truth for both pages (decoder By
// Word + validator Audit both call these).
//
// Canonical identifier = <prefix>-<16 lowercase hex>. The prefix is
// per-chain and case-PRESERVING (archive.org treats different cases as
// different items), [A-Za-z][A-Za-z0-9_-]*[A-Za-z0-9] — it can itself
// contain hyphens, so the trailing 16-hex suffix is what anchors the
// parse. 'mememage' is only the DEFAULT prefix, never an assumption:
// custom chains (dark-, phoenix-, …) must validate too.
// =====================================================================
var DEFAULT_PREFIX = 'mememage';
// Embedded: pull an identifier out of a URL / path / filename.
// Unanchored — the greedy prefix backtracks to the last hyphen before
// the 16-hex suffix.
var _ID_EMBED_RE = /[A-Za-z][A-Za-z0-9_-]*-[0-9a-f]{16}/;
// Strict whole-string: a bare identifier with no surrounding junk, so a
// trailing typo can't silently truncate to a valid record.
var _ID_BARE_RE = /^[A-Za-z][A-Za-z0-9_-]*-[0-9a-f]{16}$/;
var _ID_HEX16_RE = /^[0-9a-f]{16}$/i;

// Extract an identifier embedded in a URL or path; null if none.
function extractIdentifier(text){
  if(!text) return null;
  var m = String(text).match(_ID_EMBED_RE);
  return m ? m[0] : null;
}

// Validate/normalize a BARE user-typed identifier (not a URL). Accepts
// any <prefix>-<16hex>; a pure 16-hex string is sugar for the default
// chain (mememage-<hex>). Returns the canonical identifier or null.
function normalizeIdentifier(text){
  if(!text) return null;
  var s = String(text).trim();
  if(_ID_HEX16_RE.test(s)) s = DEFAULT_PREFIX + '-' + s.toLowerCase();
  return _ID_BARE_RE.test(s) ? s : null;
}

function detectBar(px,w,h){
  // Presence-only check — does the bottom row start with the M/Y/C
  // sequence at the original pixel scale? Cheap; used as a fast
  // gate before the more expensive band-width measurement. For a
  // scale-aware presence + measurement, use detectBarBands().
  if(h<2||w<50)return false;
  const y=h-1;
  const mid=Math.floor(HEADER_BAND/2);
  const im=(y*w+mid)*4;
  if(!(px[im]>130&&px[im+1]<120&&px[im+2]>130))return false;
  const iy=(y*w+HEADER_BAND+mid)*4;
  if(!(px[iy]>130&&px[iy+1]>130&&px[iy+2]<120))return false;
  const ic=(y*w+2*HEADER_BAND+mid)*4;
  if(!(px[ic]<120&&px[ic+1]>130&&px[ic+2]>130))return false;
  return true;
}

// Scale-aware band-width detector. Mirrors mememage/bar.py:_detect_bar.
// Walks the bottom row left→right looking for magenta → yellow → cyan
// runs, returning each run's pixel width. The widths reveal the scale
// factor — at 1:1 the bands are HEADER_BAND (8) px wide each; at a
// 0.75× resize they're ~6 px each; at 1.5× they're ~12 px each.
// Returns {m,y,c} or null if the M/Y/C sequence isn't present.
function detectBarBands(px,w,h){
  if(h<2||w<20) return null;
  const y=h-1;
  function rgbAt(x){var i=(y*w+x)*4;return [px[i],px[i+1],px[i+2]];}
  function isMagenta(x){var c=rgbAt(x);return c[0]>130&&c[1]<120&&c[2]>130;}
  function isYellow(x){var c=rgbAt(x);return c[0]>130&&c[1]>130&&c[2]<120;}
  function isCyan(x){var c=rgbAt(x);return c[0]<120&&c[1]>130&&c[2]>130;}

  // Scan magenta run from the left edge. The original bar is 8 px;
  // at 2× upscale it can run to 16, at 0.3× downscale to ~3. Stop at
  // 32 — beyond that we'd run into the data section even on a
  // pathologically upscaled image.
  var magenta_w=0;
  for(var x=0;x<Math.min(32,w);x++){
    if(isMagenta(x)) magenta_w++;
    else break;
  }
  if(magenta_w<3) return null;

  // Skip a 1-2px transition zone (JPEG smear / interpolation halo)
  // between bands, then measure yellow.
  var yellow_start=magenta_w;
  for(var x2=magenta_w;x2<Math.min(magenta_w+3,w);x2++){
    if(isYellow(x2)){ yellow_start=x2; break; }
  }
  var yellow_w=0;
  for(var x3=yellow_start;x3<Math.min(yellow_start+32,w);x3++){
    if(isYellow(x3)) yellow_w++;
    else break;
  }
  if(yellow_w<3) return null;

  var cyan_start=yellow_start+yellow_w;
  for(var x4=cyan_start;x4<Math.min(cyan_start+3,w);x4++){
    if(isCyan(x4)){ cyan_start=x4; break; }
  }
  var cyan_w=0;
  for(var x5=cyan_start;x5<Math.min(cyan_start+32,w);x5++){
    if(isCyan(x5)) cyan_w++;
    else break;
  }
  if(cyan_w<3) return null;

  return {m:magenta_w,y:yellow_w,c:cyan_w};
}

// Per-image bit threshold for the centered bar. Otsu over the middle 60% of the
// bottom rows (avoids the M/Y/C bands, scale-robust — no fixed band offsets),
// returned as the MIDPOINT of the two class means rather than the boundary
// index (robust on exact pixels, where a boundary lands on a level). Returns
// null on a flat region. Mirrors mememage/bar.py:_otsu_threshold.
function otsuThreshold(px,w,h){
  if(w<5||h<1)return null;
  var x0=Math.floor(w*0.20),x1=Math.floor(w*0.80);if(x1<=x0)return null;
  var hist=new Array(256).fill(0),total=0,y0=Math.max(0,h-SIG_ROWS);
  for(var y=y0;y<h;y++)for(var x=x0;x<x1;x++){var i=(y*w+x)*4;
    hist[(Math.round((px[i]+px[i+1]+px[i+2])/3))&255]++;total++;}
  if(total===0)return null;
  var sumAll=0;for(var k=0;k<256;k++)sumAll+=k*hist[k];
  var sumB=0,wB=0,best=-1,thr=null;
  for(var t=0;t<256;t++){wB+=hist[t];if(wB===0)continue;var wF=total-wB;if(wF===0)break;
    sumB+=t*hist[t];var mB=sumB/wB,mF=(sumAll-sumB)/wF,v=wB*wF*(mB-mF)*(mB-mF);
    if(v>best){best=v;thr=(mB+mF)/2;}}
  return thr;
}

function extractBits(px,w,h,ppb,thr){
  // 1:1 (native pixel-scale) extraction. Use extractBitsAtScale for
  // scale-aware reading on resized images.
  ppb=ppb||PIXELS_PER_BIT;if(thr===undefined)thr=RGB_THRESHOLD;
  const bits=[],dataPerRow=w-HEADER_PIXELS-FOOTER_PIXELS,bitsPerRow=Math.floor(dataPerRow/ppb);
  for(let row=0;row<SIG_ROWS;row++){const y=h-1-row;
    for(let b=0;b<bitsPerRow;b++){
      const cx=HEADER_PIXELS+b*ppb+Math.floor(ppb/2);
      const i=(y*w+cx)*4;bits.push(((px[i]+px[i+1]+px[i+2])/3)>=thr?1:0);}}
  return bits;
}

// Scale-aware bit extraction. Mirrors mememage/bar.py:_decode_bits_at_scale.
// Given an assumed scale factor, infer where each bit's center pixel
// would have landed in the original layout, then map back to a pixel
// in the current (scaled) image and read its luminance.
function extractBitsAtScale(px,w,h,scale,ppb,thr){
  ppb=ppb||PIXELS_PER_BIT;if(thr===undefined)thr=RGB_THRESHOLD;
  if(Math.abs(scale-1.0)<0.01) return extractBits(px,w,h,ppb,thr);
  var orig_w=Math.round(w/scale);
  var orig_data_per_row=orig_w-HEADER_PIXELS-FOOTER_PIXELS;
  var orig_bits_per_row=Math.floor(orig_data_per_row/ppb);
  var bits=[];
  for(var row=0;row<SIG_ROWS;row++){
    var y=h-1-row;
    for(var b=0;b<orig_bits_per_row;b++){
      var orig_cx=HEADER_PIXELS+b*ppb+ppb/2;
      var sx=Math.round(orig_cx*scale);
      if(sx<0||sx>=w) break;
      var i=(y*w+sx)*4;
      bits.push(((px[i]+px[i+1]+px[i+2])/3)>=thr?1:0);
    }
  }
  return bits;
}

// Band-edge finders for the high-res even-fill layout. Mirror
// mememage/bar.py:_find_header_end / _find_footer_start. They return the
// inner edges of the flush bilateral bands so the decoder can anchor to both
// ends and even-divide the data region — no scale factor, so no drift.
function findHeaderEnd(px,w,y){
  function rgb(x){var i=(y*w+x)*4;return [px[i],px[i+1],px[i+2]];}
  function isM(x){var c=rgb(x);return c[0]>130&&c[1]<120&&c[2]>130;}
  function isY(x){var c=rgb(x);return c[0]>130&&c[1]>130&&c[2]<120;}
  function isC(x){var c=rgb(x);return c[0]<120&&c[1]>130&&c[2]>130;}
  var x=0,nm=0,ny=0,nc=0;
  while(x<w&&x<40&&!isM(x))x++;
  while(x<w&&isM(x)){x++;nm++;}
  while(x<w&&x<60&&!isY(x))x++;
  while(x<w&&isY(x)){x++;ny++;}
  while(x<w&&x<80&&!isC(x))x++;
  while(x<w&&isC(x)){x++;nc++;}
  if(nm<2||ny<2||nc<2)return null;
  return x;
}
function findFooterStart(px,w,y){
  function rgb(x){var i=(y*w+x)*4;return [px[i],px[i+1],px[i+2]];}
  function isM(x){var c=rgb(x);return c[0]>130&&c[1]<120&&c[2]>130;}
  function isY(x){var c=rgb(x);return c[0]>130&&c[1]>130&&c[2]<120;}
  function isC(x){var c=rgb(x);return c[0]<120&&c[1]>130&&c[2]>130;}
  var x=w-1,nm=0,ny=0,nc=0;
  while(x>=0&&x>w-40&&!isM(x))x--;
  while(x>=0&&isM(x)){x--;nm++;}
  while(x>=0&&x>w-60&&!isY(x))x--;
  while(x>=0&&isY(x)){x--;ny++;}
  while(x>=0&&x>w-80&&!isC(x))x--;
  while(x>=0&&isC(x)){x--;nc++;}
  if(nm<2||ny<2||nc<2)return null;
  return x+1;
}

// High-res even-fill decode. Mirrors mememage/bar.py:_decode_even_fill.
// Anchors to both band edges, evenly divides [a,b] by the frame bit count
// (swept; CRC self-selects), and reads the two rows averaged (noise immunity)
// then the bottom row alone (survives a 1px bottom crop).
function decodeEvenFill(px,w,h,thr){
  if(thr===undefined)thr=RGB_THRESHOLD;
  if(h<1||w<3*HEADER_PIXELS)return null;
  var y=h-1;
  var a0=findHeaderEnd(px,w,y);
  var b0=findFooterStart(px,w,y);
  if(a0===null||b0===null||(b0-a0)<8)return null;
  var readModes=(h>=2)?[[h-1,h-2],[h-1]]:[[h-1]];
  // Band-edge detection lands on an integer pixel, but after a downscale the
  // true sub-pixel edge can sit a pixel or two away — a shift that moves every
  // bit center the same way and flips enough bits to exceed RS at particular
  // scales (aliasing nulls; e.g. ~0.9x can fail while 0.92x and 0.88x pass).
  // Sweep a few integer phase offsets on each anchor; CRC self-selects. (0,0)
  // is tried first, so a clean image returns immediately and every previously-
  // decodable image still decodes — a strict superset of the single-anchor read.
  var OFF=[0,-1,1,-2,2];
  for(var ia=0;ia<OFF.length;ia++){
    for(var ib=0;ib<OFF.length;ib++){
      var a=a0+OFF[ia],b=b0+OFF[ib],span=b-a;
      if(span<8)continue;
      for(var nBytes=EVENFILL_MIN_BYTES;nBytes<=EVENFILL_MAX_BYTES;nBytes++){
        var n=nBytes*8;
        for(var rm=0;rm<readModes.length;rm++){
          var rows=readModes[rm],bits=[],ok=true;
          for(var i=0;i<n;i++){
            var cx=Math.round(a+(i+0.5)*span/n);
            if(cx<0||cx>=w){ok=false;break;}
            var acc=0;
            for(var r=0;r<rows.length;r++){
              var idx=(rows[r]*w+cx)*4;
              acc+=(px[idx]+px[idx+1]+px[idx+2])/3;
            }
            bits.push((acc/rows.length)>=thr?1:0);
          }
          if(!ok)continue;
          var frame=decodeFrame(bits);
          // Validate via payload (locks the right n_bytes) but return the FRAME
          // so callers get rsErrors/rsCapacity for the forensic display.
          if(frame){var p=decodePayload(frame.payload);if(p)return frame;}
        }
      }
    }
  }
  return null;
}

// Top-level scale-aware extractor. Tries the high-res even-fill layout first
// (both-ends-anchored, drift-free), then 1:1, then sweeps candidate scales
// derived from the measured band widths. Returns the first
// {identifier, content_hash} that decodes cleanly, or null.
// Mirrors mememage/bar.py:extract_bar.
function extractBarScaleAware(px,w,h){
  // Brightness threshold candidates: the per-image Otsu midpoint reads the
  // centered bar (levels hug the dominant brightness); RGB_THRESHOLD (128)
  // reads legacy absolute bars and is always present as a fallback. Otsu is
  // tried first; CRC + RS self-select, so a wrong threshold just fails frame
  // validation and the next candidate is tried. Mirrors bar.py:extract_bar.
  var thrs=[];var ot=otsuThreshold(px,w,h);if(ot!==null)thrs.push(ot);thrs.push(RGB_THRESHOLD);

  // Threshold-independent detection — done once, reused across candidates.
  var hasBar=detectBar(px,w,h);
  var bands=detectBarBands(px,w,h);
  var scaleCands=[];
  if(bands && Math.abs((bands.m+bands.y+bands.c)/3/HEADER_BAND-1.0)>=0.05){
    var raw_scale=(bands.m+bands.y+bands.c)/3/HEADER_BAND;
    // Band-width measurement has ±5% noise from JPEG / interpolation, so sweep
    // ±8% in 1% steps around the estimate. CRC self-selects the right one.
    for(var off=-8;off<=8;off++){
      var s=Math.round((raw_scale+off*0.01)*1000)/1000;
      if(s>0.3 && s<3.0 && Math.abs(s-1.0)>=0.005 && scaleCands.indexOf(s)<0) scaleCands.push(s);
    }
  }

  for(var ti=0;ti<thrs.length;ti++){
    var thr=thrs[ti];
    // High-res even-fill layout — full-width, both-ends anchored.
    var ef=decodeEvenFill(px,w,h,thr);
    if(ef){var efp=decodePayload(ef.payload);if(efp)return efp;}
    // Fast 1:1 path — by far the common case (no resize).
    if(hasBar){
      for(var ppb0 of [PIXELS_PER_BIT,2]){
        var b0=extractBits(px,w,h,ppb0,thr);
        var f0=decodeFrame(b0);
        if(f0){ var p0=decodePayload(f0.payload); if(p0) return p0; }
      }
    }
    // Scale-aware path — sweep candidate scales from the measured band widths.
    for(var ci=0;ci<scaleCands.length;ci++){
      for(var ppb of [PIXELS_PER_BIT,2]){
        var bits=extractBitsAtScale(px,w,h,scaleCands[ci],ppb,thr);
        var frame=decodeFrame(bits);
        if(!frame) continue;
        var p=decodePayload(frame.payload);
        if(p) return p;
      }
    }
  }
  return null;
}

function decodeFrame(bits){
  const bytes=[];for(let i=0;i+7<bits.length;i+=8){let v=0;for(let j=0;j<8;j++)v=(v<<1)|bits[i+j];bytes.push(v);}
  // Gen I frame: [0xAD4E][gen=1][nsym][payload_len BE][CRC-16][RS codeword]
  if(bytes.length<8||bytes[0]!==0xAD||bytes[1]!==0x4E)return null;
  const gen=bytes[2];
  if(gen!==1)return null;
  const nsym=bytes[3];
  const pLen=(bytes[4]<<8)|bytes[5],crc=(bytes[6]<<8)|bytes[7];
  const cwLen=pLen+nsym;
  if(bytes.length<8+cwLen)return null;
  const codeword=bytes.slice(8,8+cwLen);
  const rsCapacity=Math.floor(nsym/2);
  try{
    const decoded=rsDecode(codeword,nsym);
    // Count payload bytes that RS actually corrected (for forensic display)
    let rsErrors=0;
    for(let i=0;i<pLen;i++)if(codeword[i]!==decoded[i])rsErrors++;
    return{gen:1,payload:new Uint8Array(decoded),rsErrors,rsCapacity};
  }catch(e){
    if(crc16(codeword)!==crc)return null;
    // RS failed; CRC fallback — rsErrors=-1 signals "no correction data available"
    return{gen:1,payload:new Uint8Array(codeword.slice(0,pLen)),rsErrors:-1,rsCapacity};
  }
}

// =====================================================================
// ENCODER — for Save Certificate (encodes bar into composite image)
// =====================================================================
function rsEncodeSimple(data, nsym) {
  // Simple RS encode: append nsym parity bytes. Uses the same GF(2^8) as rs.js.
  // Generator polynomial for nsym symbols
  var gen = [1];
  for (var i = 0; i < nsym; i++) {
    var next = new Array(gen.length + 1).fill(0);
    for (var j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= gfMul(gen[j], gfPow(2, i));
    }
    gen = next;
  }
  // Polynomial division
  var msg = data.slice();
  for (var k = 0; k < nsym; k++) msg.push(0);
  for (var m = 0; m < data.length; m++) {
    var coef = msg[m];
    if (coef !== 0) {
      for (var n = 1; n < gen.length; n++) {
        msg[m + n] ^= gfMul(gen[n], coef);
      }
    }
  }
  return data.concat(msg.slice(data.length));
}

function encodeFrame(payloadBytes) {
  // Gen I frame: [0xAD][0x4E][gen=1][nsym=6][payload_len BE][CRC-16][RS codeword]
  var nsym = 6;
  var pLen = payloadBytes.length;
  var payload = Array.from(payloadBytes);
  var codeword = rsEncodeSimple(payload, nsym);
  var crc = crc16(codeword);
  var header = [0xAD, 0x4E, 1, nsym, (pLen >> 8) & 0xFF, pLen & 0xFF, (crc >> 8) & 0xFF, crc & 0xFF];
  return header.concat(codeword);
}

// =====================================================================
// BAR WRITER — a FAITHFUL port of mememage/bar.py:embed_into. This is the
// single source of truth for writing a bar in the browser (Save Certificate,
// reliquary reconstruct, band-PNG save). It MUST stay byte-for-byte identical
// to the Python writer — enforced by tests/bar_encode_parity.cjs +
// tests/test_bar_js_parity.py. The bar is the technique; when it evolves, both
// sides change in lockstep and the parity test fails on any drift.
// =====================================================================

// Python round() uses banker's rounding (half-to-even); JS Math.round rounds
// half UP. They diverge at .5 in dominant-color and even-fill math, so the
// port needs this to match Python exactly.
function pyRound(x) {
  var f = Math.floor(x);
  var d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return (f % 2 === 0) ? f : f + 1;  // exactly .5 -> nearest even
}
function _clamp8(v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }
function _setPx(px, w, x, y, rgb) {
  var i = (y * w + x) * 4;
  px[i] = rgb[0]; px[i+1] = rgb[1]; px[i+2] = rgb[2]; px[i+3] = 255;
}

// Mirror bar.py:_dominant_color — mean color of the rows just above the bar
// (last LOCAL_CONTEXT_ROWS), or the whole image when too short.
function _dominantColor(px, w, h) {
  var ce = h - SIG_ROWS;
  var cs = Math.max(0, ce - LOCAL_CONTEXT_ROWS);
  var y0, y1;
  if (ce <= cs) { y0 = 0; y1 = h; } else { y0 = cs; y1 = ce; }
  var tr = 0, tg = 0, tb = 0, count = 0;
  for (var y = y0; y < y1; y++) {
    for (var x = 0; x < w; x++) {
      var i = (y * w + x) * 4;
      tr += px[i]; tg += px[i+1]; tb += px[i+2]; count++;
    }
  }
  if (count === 0) return [128, 128, 128];
  return [pyRound(tr / count), pyRound(tg / count), pyRound(tb / count)];
}

var _HEADER_COLORS = [[255,0,255],[255,255,0],[0,255,255]];   // M, Y, C
var _FOOTER_COLORS = [[0,255,255],[255,255,0],[255,0,255]];   // C, Y, M
function _paintBands(px, w, y) {
  for (var ci = 0; ci < 3; ci++)
    for (var p = 0; p < HEADER_BAND; p++)
      _setPx(px, w, ci * HEADER_BAND + p, y, _HEADER_COLORS[ci]);
  for (var ci2 = 0; ci2 < 3; ci2++)
    for (var p2 = 0; p2 < HEADER_BAND; p2++)
      _setPx(px, w, (w - FOOTER_PIXELS) + ci2 * HEADER_BAND + p2, y, _FOOTER_COLORS[ci2]);
}

// Mirror bar.py:_write_even_fill
function _writeEvenFill(px, w, h, bits, bitRgb) {
  var a = HEADER_PIXELS, b = w - FOOTER_PIXELS, span = b - a, n = bits.length;
  var rows = [h - 1, h - 2];
  for (var r = 0; r < rows.length; r++) {
    var y = rows[r];
    _paintBands(px, w, y);
    for (var i = 0; i < n; i++) {
      var x0 = a + pyRound(i * span / n);
      var x1 = a + pyRound((i + 1) * span / n);
      var rgb = bitRgb(bits[i]);
      for (var x = x0; x < x1; x++) _setPx(px, w, x, y, rgb);
    }
  }
}

// Mirror bar.py:_write_sequential
function _writeSequential(px, w, h, dataWidth, bits, bitRgb, payloadLen) {
  var totalDataPixels = SIG_ROWS * dataWidth;
  var ppb = PIXELS_PER_BIT;
  var capWide = Math.floor(Math.floor(totalDataPixels / PIXELS_PER_BIT) / 8) - 8 - RS_NSYM;
  if (payloadLen > capWide) {
    ppb = PIXELS_PER_BIT_NARROW;
    var capNarrow = Math.floor(Math.floor(totalDataPixels / PIXELS_PER_BIT_NARROW) / 8) - 8 - RS_NSYM;
    if (payloadLen > capNarrow) throw new Error('Bar payload too large for image width');
  }
  var bitsPerRow = Math.floor(dataWidth / ppb);
  for (var ro = 0; ro < SIG_ROWS; ro++) {
    var y = h - 1 - ro;
    _paintBands(px, w, y);
    var rowStart = ro * bitsPerRow;
    for (var bil = 0; bil < bitsPerRow; bil++) {
      var bi = rowStart + bil;
      var baseX = HEADER_PIXELS + bil * ppb;
      if (bi < bits.length) {
        var rgb = bitRgb(bits[bi]);
        for (var p = 0; p < ppb; p++) _setPx(px, w, baseX + p, y, rgb);
      } else {
        var fill = bitRgb(0);
        for (var p2 = 0; p2 < ppb; p2++)
          if (baseX + p2 < w - FOOTER_PIXELS) _setPx(px, w, baseX + p2, y, fill);
      }
    }
  }
}

// Embed a bar carrying `payloadBytes` into the bottom 2 rows of an RGBA pixel
// buffer, IN PLACE. Faithful port of bar.py:embed_into. `payloadBytes` is a
// Uint8Array / array of bytes (e.g. TextEncoder().encode(id + "\0" + hash)).
function embedBarPayload(px, w, h, payloadBytes) {
  var frame = encodeFrame(payloadBytes);
  var bits = [];
  for (var i = 0; i < frame.length; i++)
    for (var j = 7; j >= 0; j--) bits.push((frame[i] >> j) & 1);

  var dom = _dominantColor(px, w, h);
  var domAvg = (dom[0] + dom[1] + dom[2]) / 3;
  var half = BAR_DELTA / 2;
  var center = Math.max(half, Math.min(255 - half, domAvg));
  var lo = center - half, hi = center + half;
  function bitRgb(bit) {
    var off = (bit ? hi : lo) - domAvg;
    return [_clamp8(pyRound(dom[0] + off)), _clamp8(pyRound(dom[1] + off)), _clamp8(pyRound(dom[2] + off))];
  }

  var dataWidth = w - HEADER_PIXELS - FOOTER_PIXELS;
  if (dataWidth >= PIXELS_PER_BIT * bits.length) {
    _writeEvenFill(px, w, h, bits, bitRgb);
  } else {
    _writeSequential(px, w, h, dataWidth, bits, bitRgb, payloadBytes.length);
  }
  return true;
}

// =====================================================================
// CANONICAL BAR GENERATOR — builds a 2-row PNG of the canonical bar
// payload (mememage-XXXX\0<hash>) for the validator's reconstruct flow.
// Returns a Promise<Blob> of the bar PNG. Uses the same writer as everything
// else, so the strip is exactly what Python would produce for a 2-row image.
// =====================================================================
function generateCanonicalBarPng(identifier, contentHash) {
  var payloadBytes = new TextEncoder().encode(identifier + '\x00' + contentHash);
  var frame = encodeFrame(payloadBytes);
  var totalBits = frame.length * 8;
  // Size a 2-row strip at 2px/bit so the writer lands on the sequential layout.
  var bitsPerRow = Math.ceil(totalBits / SIG_ROWS);
  var w = HEADER_PIXELS + bitsPerRow * PIXELS_PER_BIT_NARROW + FOOTER_PIXELS;
  var h = SIG_ROWS;
  var canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  var ctx = canvas.getContext('2d');
  ctx.fillStyle = '#808080';  // neutral background; the bar overwrites it
  ctx.fillRect(0, 0, w, h);
  var img = ctx.getImageData(0, 0, w, h);
  embedBarPayload(img.data, w, h, payloadBytes);
  ctx.putImageData(img, 0, 0);
  return new Promise(function(resolve) {
    canvas.toBlob(function(blob) { resolve(blob); }, 'image/png');
  });
}

function decodePayload(payload){
  const text=new TextDecoder().decode(payload);
  const sep=text.indexOf('\0');
  if(sep<0)return null;
  const first=text.slice(0,sep);
  const contentHash=text.slice(sep+1);
  // New format: bare identifier. Old format: URL (contains /).
  let identifier;
  if(first.includes('/')){
    identifier=extractIdentifier(first)||first;
  }else{
    identifier=first;
  }
  return{identifier,archive_id:identifier,content_hash:contentHash};
}
