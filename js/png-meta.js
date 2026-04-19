// =====================================================================
// PNG Metadata Injection + Canvas Save Interception
//
// Two capabilities:
// 1. Inject tEXt chunks into PNG binary data (standard PNG spec)
// 2. Intercept right-click save on canvas elements to serve
//    metadata-rich PNGs while keeping the canvas animated
//
// Usage:
//   enableCanvasSave(canvas, {generation_params: JSON.stringify(data)})
//
// The user right-clicks, sees native "Save Image As...", and the saved
// PNG carries the metadata as standard tEXt chunks readable by any
// PNG-aware tool (Pillow, ComfyUI, ExifTool, etc).
// =====================================================================

// --- CRC-32 (PNG uses this for chunk checksums) ---
var _crcTable = null;
function _makeCrcTable() {
  _crcTable = new Uint32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    _crcTable[n] = c;
  }
}

function crc32(buf) {
  if (!_crcTable) _makeCrcTable();
  var crc = 0xFFFFFFFF;
  for (var i = 0; i < buf.length; i++) {
    crc = _crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// --- PNG iTXt chunk builder (UTF-8 safe) ---
function buildTextChunk(keyword, text) {
  // iTXt chunk: keyword + \0 + compression_flag(0) + compression_method(0) + language_tag + \0 + translated_keyword + \0 + text
  var keyBytes = new TextEncoder().encode(keyword);
  var textBytes = new TextEncoder().encode(text);
  // keyword \0 0 0 \0 \0 text
  var data = new Uint8Array(keyBytes.length + 1 + 2 + 1 + 1 + textBytes.length);
  var off = 0;
  data.set(keyBytes, off); off += keyBytes.length;
  data[off++] = 0; // null separator after keyword
  data[off++] = 0; // compression flag (uncompressed)
  data[off++] = 0; // compression method
  data[off++] = 0; // language tag (empty, null terminated)
  data[off++] = 0; // translated keyword (empty, null terminated)
  data.set(textBytes, off);

  // Chunk: [4B length][4B type "iTXt"][data][4B CRC]
  var typeBytes = new Uint8Array([0x69, 0x54, 0x58, 0x74]); // "iTXt"
  var crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  var checksum = crc32(crcInput);

  var chunk = new Uint8Array(12 + data.length);
  // Length (big-endian)
  chunk[0] = (data.length >>> 24) & 0xFF;
  chunk[1] = (data.length >>> 16) & 0xFF;
  chunk[2] = (data.length >>> 8) & 0xFF;
  chunk[3] = data.length & 0xFF;
  // Type
  chunk.set(typeBytes, 4);
  // Data
  chunk.set(data, 8);
  // CRC (big-endian)
  chunk[8 + data.length] = (checksum >>> 24) & 0xFF;
  chunk[9 + data.length] = (checksum >>> 16) & 0xFF;
  chunk[10 + data.length] = (checksum >>> 8) & 0xFF;
  chunk[11 + data.length] = checksum & 0xFF;

  return chunk;
}

// --- Inject tEXt chunks into PNG binary ---
function injectPngTextChunks(pngArrayBuffer, metadata) {
  // metadata: {key: value, ...} — each becomes a tEXt chunk
  // Inserts before IEND (last 12 bytes of any valid PNG)
  var src = new Uint8Array(pngArrayBuffer);
  var iendOffset = src.length - 12; // IEND chunk is always last, always 12 bytes

  // Build all text chunks
  var chunks = [];
  var totalLen = 0;
  for (var key in metadata) {
    var chunk = buildTextChunk(key, metadata[key]);
    chunks.push(chunk);
    totalLen += chunk.length;
  }

  // Assemble: [everything before IEND] + [text chunks] + [IEND]
  var result = new Uint8Array(src.length + totalLen);
  result.set(src.subarray(0, iendOffset), 0);
  var offset = iendOffset;
  for (var ci = 0; ci < chunks.length; ci++) {
    result.set(chunks[ci], offset);
    offset += chunks[ci].length;
  }
  result.set(src.subarray(iendOffset), offset);

  return result.buffer;
}

// --- Canvas save interception ---
function enableCanvasSave(canvas, metadata) {
  // On right-click: swap canvas for a metadata-rich PNG img,
  // let the browser's native save dialog work, then swap back.
  if (!canvas || !metadata) return;

  // Pre-generate the metadata-rich PNG and keep it ready
  var _savedBlobUrl = null;
  var _savedImg = null;

  function _prepareSaveImg() {
    canvas.toBlob(function(blob) {
      var reader = new FileReader();
      reader.onload = function() {
        var enriched = injectPngTextChunks(reader.result, metadata);
        var enrichedBlob = new Blob([enriched], {type: 'image/png'});
        if (_savedBlobUrl) URL.revokeObjectURL(_savedBlobUrl);
        _savedBlobUrl = URL.createObjectURL(enrichedBlob);

        if (!_savedImg) {
          _savedImg = document.createElement('img');
          _savedImg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:10;cursor:default;display:none;';
          var parent = canvas.parentElement;
          if (getComputedStyle(parent).position === 'static') {
            parent.style.position = 'relative';
          }
          parent.appendChild(_savedImg);
        }
        _savedImg.src = _savedBlobUrl;
      };
      reader.readAsArrayBuffer(blob);
    }, 'image/png');
  }

  // Refresh the save image periodically so it stays current with the canvas
  _prepareSaveImg();
  setInterval(_prepareSaveImg, 3000);

  canvas.addEventListener('contextmenu', function(e) {
    if (!_savedImg || !_savedBlobUrl) return;

    // Show the pre-rendered img (matches recent canvas state, no flash)
    _savedImg.style.display = 'block';
    canvas.style.visibility = 'hidden';

    function cleanup() {
      canvas.style.visibility = 'visible';
      _savedImg.style.display = 'none';
      document.removeEventListener('click', cleanup);
      document.removeEventListener('keydown', cleanupKey);
    }
    function cleanupKey(ev) { if (ev.key === 'Escape') cleanup(); }
    setTimeout(function() {
      document.addEventListener('click', cleanup);
      document.addEventListener('keydown', cleanupKey);
    }, 100);
  });
}
