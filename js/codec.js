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

function extractBits(px,w,h,ppb){
  // 1:1 (native pixel-scale) extraction. Use extractBitsAtScale for
  // scale-aware reading on resized images.
  ppb=ppb||PIXELS_PER_BIT;
  const bits=[],dataPerRow=w-HEADER_PIXELS-FOOTER_PIXELS,bitsPerRow=Math.floor(dataPerRow/ppb);
  for(let row=0;row<SIG_ROWS;row++){const y=h-1-row;
    for(let b=0;b<bitsPerRow;b++){
      const cx=HEADER_PIXELS+b*ppb+Math.floor(ppb/2);
      const i=(y*w+cx)*4;bits.push(((px[i]+px[i+1]+px[i+2])/3)>=RGB_THRESHOLD?1:0);}}
  return bits;
}

// Scale-aware bit extraction. Mirrors mememage/bar.py:_decode_bits_at_scale.
// Given an assumed scale factor, infer where each bit's center pixel
// would have landed in the original layout, then map back to a pixel
// in the current (scaled) image and read its luminance.
function extractBitsAtScale(px,w,h,scale,ppb){
  ppb=ppb||PIXELS_PER_BIT;
  if(Math.abs(scale-1.0)<0.01) return extractBits(px,w,h,ppb);
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
      bits.push(((px[i]+px[i+1]+px[i+2])/3)>=RGB_THRESHOLD?1:0);
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
function decodeEvenFill(px,w,h){
  if(h<1||w<3*HEADER_PIXELS)return null;
  var y=h-1;
  var a=findHeaderEnd(px,w,y);
  var b=findFooterStart(px,w,y);
  if(a===null||b===null||(b-a)<8)return null;
  var span=b-a;
  var readModes=(h>=2)?[[h-1,h-2],[h-1]]:[[h-1]];
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
        bits.push((acc/rows.length)>=RGB_THRESHOLD?1:0);
      }
      if(!ok)continue;
      var frame=decodeFrame(bits);
      // Validate via payload (locks the right n_bytes) but return the FRAME so
      // callers get rsErrors/rsCapacity for the forensic display.
      if(frame){var p=decodePayload(frame.payload);if(p)return frame;}
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
  // High-res even-fill layout — full-width, both-ends anchored.
  var ef=decodeEvenFill(px,w,h);
  if(ef){var efp=decodePayload(ef.payload);if(efp)return efp;}
  // Fast 1:1 path — by far the common case (no resize).
  if(detectBar(px,w,h)){
    for(var ppb0 of [PIXELS_PER_BIT,2]){
      var b0=extractBits(px,w,h,ppb0);
      var f0=decodeFrame(b0);
      if(f0){ var p0=decodePayload(f0.payload); if(p0) return p0; }
    }
  }
  // Scale-aware path — measure band widths, estimate scale, sweep.
  var bands=detectBarBands(px,w,h);
  if(!bands) return null;
  var avg=(bands.m+bands.y+bands.c)/3;
  var raw_scale=avg/HEADER_BAND;
  var candidates=[];
  if(Math.abs(raw_scale-1.0)>=0.05){
    // Band-width measurement has ±5% noise from JPEG / interpolation,
    // so sweep ±8% in 1% steps around the estimate. CRC self-selects
    // the right one.
    for(var off=-8;off<=8;off++){
      var s=Math.round((raw_scale+off*0.01)*1000)/1000;
      if(s>0.3 && s<3.0 && Math.abs(s-1.0)>=0.005 && candidates.indexOf(s)<0){
        candidates.push(s);
      }
    }
  }
  for(var ci=0;ci<candidates.length;ci++){
    for(var ppb of [PIXELS_PER_BIT,2]){
      var bits=extractBitsAtScale(px,w,h,candidates[ci],ppb);
      var frame=decodeFrame(bits);
      if(!frame) continue;
      var p=decodePayload(frame.payload);
      if(p) return p;
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

function embedBits(px, w, h, frameBytes, ppb) {
  ppb = ppb || 3;
  // Convert frame bytes to bits
  var bits = [];
  for (var i = 0; i < frameBytes.length; i++) {
    for (var j = 7; j >= 0; j--) bits.push((frameBytes[i] >> j) & 1);
  }

  var dataPerRow = w - HEADER_PIXELS - FOOTER_PIXELS;
  var bitsPerRow = Math.floor(dataPerRow / ppb);
  var bitIdx = 0;

  for (var row = 0; row < SIG_ROWS; row++) {
    var y = h - 1 - row;

    // M/Y/C header bands (8px each)
    for (var bx = 0; bx < HEADER_BAND; bx++) {
      var pi = (y * w + bx) * 4;
      px[pi] = 255; px[pi+1] = 0; px[pi+2] = 255; px[pi+3] = 255; // Magenta
    }
    for (var bx2 = HEADER_BAND; bx2 < 2*HEADER_BAND; bx2++) {
      var pi2 = (y * w + bx2) * 4;
      px[pi2] = 255; px[pi2+1] = 255; px[pi2+2] = 0; px[pi2+3] = 255; // Yellow
    }
    for (var bx3 = 2*HEADER_BAND; bx3 < 3*HEADER_BAND; bx3++) {
      var pi3 = (y * w + bx3) * 4;
      px[pi3] = 0; px[pi3+1] = 255; px[pi3+2] = 255; px[pi3+3] = 255; // Cyan
    }

    // Data pixels
    for (var b = 0; b < bitsPerRow && bitIdx < bits.length; b++, bitIdx++) {
      var val = bits[bitIdx] ? 192 : 64;
      for (var p = 0; p < ppb; p++) {
        var dx = HEADER_PIXELS + b * ppb + p;
        var di = (y * w + dx) * 4;
        px[di] = val; px[di+1] = val; px[di+2] = val; px[di+3] = 255;
      }
    }

    // C/Y/M footer bands (mirrored)
    for (var fx = 0; fx < HEADER_BAND; fx++) {
      var fi = (y * w + (w - 1 - fx)) * 4;
      px[fi] = 255; px[fi+1] = 0; px[fi+2] = 255; px[fi+3] = 255; // Magenta (outermost)
    }
    for (var fx2 = HEADER_BAND; fx2 < 2*HEADER_BAND; fx2++) {
      var fi2 = (y * w + (w - 1 - fx2)) * 4;
      px[fi2] = 255; px[fi2+1] = 255; px[fi2+2] = 0; px[fi2+3] = 255; // Yellow
    }
    for (var fx3 = 2*HEADER_BAND; fx3 < 3*HEADER_BAND; fx3++) {
      var fi3 = (y * w + (w - 1 - fx3)) * 4;
      px[fi3] = 0; px[fi3+1] = 255; px[fi3+2] = 255; px[fi3+3] = 255; // Cyan
    }
  }
  return true;
}

// =====================================================================
// CANONICAL BAR GENERATOR — builds a 2-row PNG of the canonical bar
// payload (mememage-XXXX\0<hash>) for the validator's reconstruct flow.
// Returns a Promise<Blob> of the bar PNG. Width is derived from the
// payload size at 2px/bit, plus the 48px M/Y/C bands.
// =====================================================================
function generateCanonicalBarPng(identifier, contentHash) {
  var payload = identifier + '\x00' + contentHash;
  var payloadBytes = new TextEncoder().encode(payload);
  var frame = encodeFrame(payloadBytes);
  var totalBits = frame.length * 8;
  var ppb = 2;
  // Bits split across SIG_ROWS (2). Per-row bits = ceil(totalBits / 2).
  var bitsPerRow = Math.ceil(totalBits / SIG_ROWS);
  // Width: M+Y+C left bands (24) + data + C+Y+M right bands (24).
  var w = HEADER_PIXELS + bitsPerRow * ppb + FOOTER_PIXELS;
  var h = SIG_ROWS;
  var canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  var ctx = canvas.getContext('2d');
  // Fill with mid-gray as a neutral background (the data pixels will
  // overwrite to 64 or 192 so the gray only shows in any unused tail).
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, w, h);
  var img = ctx.getImageData(0, 0, w, h);
  embedBits(img.data, w, h, frame, ppb);
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
