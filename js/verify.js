// =====================================================================
// CONTENT HASH + Ed25519 SIGNATURE + dHASH PORTRAIT VERIFICATION
// =====================================================================
// Three checks:
//   WITNESSED    — content hash matches (integrity)
//   AUTHENTICATED — Ed25519 signature verifies (authorship)
//   EMBODIED     — thumbnail dHash matches dropped image (correct image)
//
// Ed25519 uses SubtleCrypto (Chrome 113+, Firefox 128+, Safari 17+).
// Graceful degradation: returns null if unavailable (not an error).
//
// TOFU (Trust On First Use): first time a key_fingerprint is seen,
// the user names it. Subsequent records with the same fingerprint
// show the trusted name. Different key for same fingerprint = warning.
// =====================================================================

// ----- Content hash computation -----
// Canonical list of fields that contribute to content_hash. Mirrors
// mememage/core.py's _HASH_INCLUDED. Adding a field to a record does
// NOT add it to the hash — it must be added here.
const HASH_INCLUDED = new Set([
  'prompt', 'seed', 'width', 'height', 'steps', 'cfg', 'guidance',
  'denoise', 'sampler', 'scheduler', 'unet', 'lora', 'lora_strength', 'mode',
  'timestamp', 'conceived', 'rendered',
  'born', 'constellation_hash', 'machine_fingerprint',
  'rarity_score', 'rarity',
  'birth_temperament', 'birth_traits', 'birth_readings', 'birth_summary',
  'parent_id',
  // 'thumbnail' — post-mint, protected by Ed25519 signature instead
  'identifier',
  'constellation_name', 'heart_star_id', 'constellation_star',
  'decoder_hash',
]);

function sortKeysDeep(obj) {
  if (Array.isArray(obj)) return obj.map(sortKeysDeep);
  if (obj !== null && typeof obj === 'object') {
    const sorted = {};
    for (const k of Object.keys(obj).sort()) sorted[k] = sortKeysDeep(obj[k]);
    return sorted;
  }
  return obj;
}

async function sha256_16(obj) {
  var sorted = sortKeysDeep(obj);
  var noSpaces = JSON.stringify(sorted).replace(/[\u0080-\uffff]/g, function(c) {
    return '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0');
  });
  var encoded = new TextEncoder().encode(noSpaces);
  var hashBuf = await crypto.subtle.digest('SHA-256', encoded);
  var hashArr = Array.from(new Uint8Array(hashBuf));
  return hashArr.map(function(b) { return b.toString(16).padStart(2, '0'); }).join('').slice(0, 16);
}

async function computeContentHash(record) {
  try {
    var hashable = {};
    Object.keys(record).filter(function(k) { return HASH_INCLUDED.has(k); }).sort()
      .forEach(function(k) { hashable[k] = record[k]; });
    return await sha256_16(hashable);
  } catch (e) {
    return null;
  }
}

// ----- Ed25519 signature verification -----

async function verifySignature(identifier, contentHash, signatureHex, publicKeyHex) {
  // Returns: true (valid), false (invalid), null (can't verify)
  if (!signatureHex || !publicKeyHex) return null;

  try {
    var pubBytes = hexToBytes(publicKeyHex);
    var sigBytes = hexToBytes(signatureHex);
    var message = new TextEncoder().encode(identifier + '\x00' + contentHash);

    // Try SubtleCrypto Ed25519 (modern browsers)
    try {
      var key = await crypto.subtle.importKey(
        'raw', pubBytes, {name: 'Ed25519'}, false, ['verify']
      );
      return await crypto.subtle.verify('Ed25519', key, sigBytes, message);
    } catch (e) {
      // Ed25519 not supported in this browser's SubtleCrypto
      return null;
    }
  } catch (e) {
    return false;
  }
}

function hexToBytes(hex) {
  var bytes = new Uint8Array(hex.length / 2);
  for (var i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

// ----- TOFU key store -----

function tofuStore() {
  var KEY = 'mememage-tofu-keys';
  var store = {};
  try { store = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch(e) {}

  return {
    get: function(fingerprint) { return store[fingerprint] || null; },
    set: function(fingerprint, name, publicKeyHex) {
      store[fingerprint] = {name: name, publicKey: publicKeyHex, firstSeen: new Date().toISOString()};
      localStorage.setItem(KEY, JSON.stringify(store));
    },
    check: function(fingerprint, publicKeyHex) {
      // Returns: 'trusted' (known key matches), 'new' (never seen), 'conflict' (fingerprint known but different key)
      var entry = store[fingerprint];
      if (!entry) return 'new';
      if (entry.publicKey === publicKeyHex) return 'trusted';
      return 'conflict';
    }
  };
}

// ----- dHash perceptual comparison -----

function computeDHash(imageData, width, height) {
  // Difference hash: area-average downsample to 9x8 grayscale.
  // Each cell averages all source pixels in its region — robust against
  // per-pixel watermark shifts that fool single-pixel nearest-neighbor.
  var dw = 9, dh = 8;
  var gray = new Float32Array(dw * dh);

  for (var y = 0; y < dh; y++) {
    var sy0 = Math.floor(y * height / dh);
    var sy1 = Math.floor((y + 1) * height / dh);
    for (var x = 0; x < dw; x++) {
      var sx0 = Math.floor(x * width / dw);
      var sx1 = Math.floor((x + 1) * width / dw);
      // Average all pixels in this cell
      var sum = 0, count = 0;
      for (var py = sy0; py < sy1; py++) {
        for (var px = sx0; px < sx1; px++) {
          var idx = (py * width + px) * 4;
          sum += imageData[idx] * 0.299 + imageData[idx + 1] * 0.587 + imageData[idx + 2] * 0.114;
          count++;
        }
      }
      gray[y * dw + x] = count > 0 ? sum / count : 0;
    }
  }

  var bits = [];
  for (var y2 = 0; y2 < dh; y2++) {
    for (var x2 = 0; x2 < dw - 1; x2++) {
      bits.push(gray[y2 * dw + x2] > gray[y2 * dw + x2 + 1] ? 1 : 0);
    }
  }
  return bits; // 64 bits
}

function dHashFromCanvas(canvas) {
  // Full image — thumbnail is post-mint (has bar + watermark), so both
  // sides match. Area-average downsample handles watermark noise.
  var ctx = canvas.getContext('2d', {willReadFrequently: true});
  var px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  return computeDHash(px, canvas.width, canvas.height);
}

function dHashFromDataURI(dataURI) {
  return new Promise(function(resolve) {
    var img = new Image();
    img.onload = function() {
      var c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      var ctx = c.getContext('2d', {willReadFrequently: true});
      ctx.drawImage(img, 0, 0);
      resolve(computeDHash(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height));
    };
    img.onerror = function() { resolve(null); };
    img.src = dataURI;
  });
}

function hammingDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  var d = 0;
  for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) d++; }
  return d;
}

// ----- Keychain: succession and revocation checks -----

function keychainIdentifier(fingerprint) {
  return 'mememage-keychain-' + fingerprint.replace(/:/g, '');
}

async function fetchKeychainRecord(fingerprint, filename) {
  // Try to fetch a keychain record (succession.json or revocation.json) from IA
  var chainId = keychainIdentifier(fingerprint);
  var urls = [
    'https://archive.org/download/' + chainId + '/' + filename + '?t=' + Date.now(),
    'https://cors.archive.org/download/' + chainId + '/' + filename + '?t=' + Date.now(),
  ];
  for (var i = 0; i < urls.length; i++) {
    try {
      var resp = await fetch(urls[i], {cache: 'no-store'});
      if (resp.ok) {
        var record = await resp.json();
        if (record && record.action) return record;
      }
    } catch (e) { continue; }
  }
  return null;
}

async function verifyKeychainSignature(record) {
  // Verify a keychain record's Ed25519 signature
  if (!record || !record.signature) return null;
  try {
    var pubHex = record.action === 'succeed' ? record.old_public_key : record.public_key;
    var sigHex = record.signature;
    var verifyObj = {};
    Object.keys(record).filter(function(k) { return k !== 'signature'; }).sort()
      .forEach(function(k) { verifyObj[k] = record[k]; });
    var msg = new TextEncoder().encode(JSON.stringify(verifyObj));
    var pubBytes = hexToBytes(pubHex);
    var sigBytes = hexToBytes(sigHex);
    try {
      var key = await crypto.subtle.importKey('raw', pubBytes, {name: 'Ed25519'}, false, ['verify']);
      return await crypto.subtle.verify('Ed25519', key, sigBytes, msg);
    } catch (e) { return null; }
  } catch (e) { return false; }
}

async function checkKeychain(fingerprint, publicKeyHex) {
  // Check for revocation or succession of a key.
  // Returns: {status: 'active'|'revoked'|'rotated', detail: string, successor: object|null}
  if (!fingerprint) return {status: 'active', detail: '', successor: null};

  // Check revocation first
  var revocation = await fetchKeychainRecord(fingerprint, 'revocation.json');
  if (revocation && revocation.action === 'revoke') {
    var revOk = await verifyKeychainSignature(revocation);
    if (revOk === true) {
      return {
        status: 'revoked',
        detail: 'Key revoked on ' + (revocation.created || 'unknown date'),
        successor: null
      };
    }
  }

  // Check succession
  var succession = await fetchKeychainRecord(fingerprint, 'succession.json');
  if (succession && succession.action === 'succeed') {
    var sucOk = await verifyKeychainSignature(succession);
    if (sucOk === true) {
      return {
        status: 'rotated',
        detail: 'Key rotated to ' + (succession.new_fingerprint || 'unknown') + ' on ' + (succession.timestamp || 'unknown date'),
        successor: {fingerprint: succession.new_fingerprint, publicKey: succession.new_public_key}
      };
    }
  }

  return {status: 'active', detail: '', successor: null};
}

// ----- dHash perceptual comparison -----

async function comparePortrait(droppedImageCanvas, thumbnailDataURI) {
  // Compare the dropped image's dHash against the thumbnail stored in the record.
  // Thumbnail is generated post-mint (has bar + watermark), so the dropped minted
  // image and the thumbnail are apples-to-apples. Full canvas, no stripping needed.
  // Returns: {match: true/false/null, distance: number, threshold: number}
  if (!thumbnailDataURI) return {match: null, distance: -1, threshold: 10};

  var imgHash = dHashFromCanvas(droppedImageCanvas);
  var thumbHash = await dHashFromDataURI(thumbnailDataURI);

  if (!imgHash || !thumbHash) return {match: null, distance: -1, threshold: 10};

  var dist = hammingDistance(imgHash, thumbHash);
  // Threshold: 15 out of 64 bits (23.4%) — tight, security-first.
  // Thumbnail is post-mint: both sides have bar + watermark. Area-average
  // downsample dilutes per-pixel watermark noise. Clean separation.
  var threshold = 15;
  return {match: dist <= threshold, distance: dist, threshold: threshold};
}
