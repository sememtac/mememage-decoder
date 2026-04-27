// =====================================================================
// CODEC — Mememage bar decoder (v4 with RS, v3 fallback)
// =====================================================================
function crc16(d){let c=0xFFFF;for(const b of d){c^=b<<8;for(let i=0;i<8;i++)c=(c&0x8000)?((c<<1)^0x1021)&0xFFFF:(c<<1)&0xFFFF;}return c;}

function detectBar(px,w,h){
  // 8px-wide M/Y/C bands — sample center of each band
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

function extractBits(px,w,h,ppb){
  ppb=ppb||PIXELS_PER_BIT;
  const bits=[],dataPerRow=w-HEADER_PIXELS-FOOTER_PIXELS,bitsPerRow=Math.floor(dataPerRow/ppb);
  for(let row=0;row<SIG_ROWS;row++){const y=h-1-row;
    for(let b=0;b<bitsPerRow;b++){
      const cx=HEADER_PIXELS+b*ppb+Math.floor(ppb/2);
      const i=(y*w+cx)*4;bits.push(((px[i]+px[i+1]+px[i+2])/3)>=RGB_THRESHOLD?1:0);}}
  return bits;
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
    const m=first.match(/mememage-[a-f0-9]+/);
    identifier=m?m[0]:first;
  }else{
    identifier=first;
  }
  return{identifier,archive_id:identifier,content_hash:contentHash};
}
