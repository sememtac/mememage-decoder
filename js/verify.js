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
//
// Versioned inclusion sets — mirror mememage/core.py's
// _HASH_INCLUDED_BY_VERSION. Verifiers walking historical records must
// use the set that applied when the record was minted, NOT whatever
// the active version says today.
//
// v1 is the launch canon. Pre-launch dev iterations (v2/v3/v4 — yes
// the dev numbering ran higher) are not honored here; any test souls
// of those vintages are artifacts and don't round-trip cleanly.
//
// Adding a new version requires changes in lockstep here AND in
// core.py. JS short version:
//   1. Add a new const HASH_INCLUDED_V{n} = new Set([...]) below.
//   2. Add it to HASH_INCLUDED_BY_VERSION.
//   3. Bump CURRENT_HASH_VERSION (only used by the Attack Lab — real
//      records carry their own version field).
//   4. Don't rename fields silently across versions. Don't change
//      sortKeysDeep / sha256_16 serialization without bumping.

const HASH_INCLUDED_V1 = new Set([
  'identifier',
  // Version dispatch — IN the hash (downgrade defense). Without it, an
  // attacker could change hash_version and dispatch the verifier to a
  // different inclusion set.
  'hash_version',
  // Creator-declared origin metadata — free-form dict (prompt/seed/
  // model for AI gens; camera/lens/ISO for photos; whatever for other
  // workflows). Hashed wholesale so any tampering breaks WITNESSED.
  'origin',
  // Width / height live top-level — physical properties used by the
  // bar encoder + identifier hash.
  'width', 'height',
  'conceived', 'rendered',
  // birth contains celestial + machine (no GPS). GPS lives at
  // top-level: gps_time_locked is hashed; gps_password_locked is
  // added post-hash by access.py and stays out of the set. 'gps'
  // (plaintext [lat,lon]) is hashed too — present only on
  // gps_visibility: "public" chains, absent otherwise (intersection-safe).
  'birth', 'gps_time_locked', 'gps',
  'constellation_hash', 'machine_fingerprint',
  // rarity dict is hashed; rarity_score is the derived sum — readers
  // reconstruct via rarity-helpers.js / RarityScore.fromRecord().
  'rarity',
  // birth_traits are codes; birth_readings/temperament/summary are
  // derived at display time via birth-text.js — not persisted, not hashed.
  'birth_traits',
  'parent_id',
  // 'thumbnail' — post-mint, protected by Ed25519 signature instead
  'constellation_name', 'heart_star_id', 'constellation_index',
  'decoder_hash', 'age',
  // Signer identity — IN the hash (signer-swap defense). Stripping
  // signature+public_key, dropping in an attacker's own key, and
  // re-signing the existing id+hash now breaks WITNESSED instead of
  // succeeding silently. key_fingerprint included for the same reason
  // and so verifiers don't have to re-derive it (async SubtleCrypto).
  'public_key', 'key_fingerprint',
  // Chunk integrity without bulk — SHA-256 over the canonical map
  // of {layer_name: chunk.hash}, first 16 hex. Lightweight verify
  // (no chunk download) catches chunk swaps. Absent on pre-seal
  // records (no chunks → no chunks_root, same shape as gps_time_locked
  // on gps_source: none chains).
  'chunks_root',
  // Visibility tier — int code (0=light_energy public, 1=dark_matter
  // sealed). IN the hash so a record can't be silently re-tiered.
  'chain_visibility',
  // Position in the outer cycle + the chain's outer_total. Stamped at
  // the top level so dark_matter records (encrypted chunks) can still
  // be placed on the Observatory grid. Hashed so position tampering
  // breaks WITNESSED.
  'outer_position', 'outer_total',
  // Creator-access-layer envelopes — hashed when present so tampering
  // with the ciphertext breaks WITNESSED. Hash is computed AFTER
  // encryption (mirrors Python pipeline), so on dark_matter records
  // these blobs are what remains and they're what we hash. On light
  // chains, only gps_password_locked is typically present (when a
  // creator password is set); the other two are absent and skipped.
  'encrypted_soul', 'encrypted_chunks', 'gps_password_locked',
]);

const HASH_INCLUDED_BY_VERSION = {
  1: HASH_INCLUDED_V1,
};

const CURRENT_HASH_VERSION = 1;
const DEFAULT_HASH_VERSION = 1;

function _hashSetForRecord(record) {
  var v = (record && record.hash_version) || DEFAULT_HASH_VERSION;
  return HASH_INCLUDED_BY_VERSION[v] || HASH_INCLUDED_BY_VERSION[DEFAULT_HASH_VERSION];
}

// Back-compat alias for callers that read the active set directly
// (Attack Lab, debug tools). New code should call _hashSetForRecord
// (record) so it stays version-aware.
const HASH_INCLUDED = HASH_INCLUDED_BY_VERSION[CURRENT_HASH_VERSION];

function sortKeysDeep(obj) {
  if (Array.isArray(obj)) return obj.map(sortKeysDeep);
  if (obj !== null && typeof obj === 'object') {
    const sorted = {};
    for (const k of Object.keys(obj).sort()) sorted[k] = sortKeysDeep(obj[k]);
    return sorted;
  }
  return obj;
}

// Pure-JS SHA-256 fallback for environments where crypto.subtle is
// unavailable. iOS Safari and most browsers gate crypto.subtle to
// "secure contexts" — HTTPS with a publicly-trusted cert, or
// http://localhost. The VPS at 160.153.182.117 with a self-signed
// cert doesn't qualify (Safari treats user-trusted self-signed
// certs as insecure for API-gating purposes), so crypto.subtle is
// undefined there. This fallback keeps the codec working in any
// context: file://, self-signed HTTPS, plain HTTP, etc.
//
// ~60 lines of FIPS 180-4 SHA-256. Returns Uint8Array of 32 bytes.
var _SHA256_K = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
]);
function _sha256_js(bytes) {
  // bytes: Uint8Array
  var H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  var bitLen = bytes.length * 8;
  // Padding: append 0x80, then zeros, then 8-byte big-endian length.
  var padLen = (bytes.length + 9 + 63) & ~63;
  var padded = new Uint8Array(padLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  // 64-bit length BE — for our use case lengths fit in 32 bits.
  padded[padLen - 4] = (bitLen >>> 24) & 0xff;
  padded[padLen - 3] = (bitLen >>> 16) & 0xff;
  padded[padLen - 2] = (bitLen >>> 8)  & 0xff;
  padded[padLen - 1] = bitLen & 0xff;
  var W = new Uint32Array(64);
  for (var block = 0; block < padLen; block += 64) {
    for (var i = 0; i < 16; i++) {
      W[i] = (padded[block + i*4] << 24) | (padded[block + i*4 + 1] << 16) | (padded[block + i*4 + 2] << 8) | padded[block + i*4 + 3];
    }
    for (var i = 16; i < 64; i++) {
      var s0 = ((W[i-15] >>> 7) | (W[i-15] << 25)) ^ ((W[i-15] >>> 18) | (W[i-15] << 14)) ^ (W[i-15] >>> 3);
      var s1 = ((W[i-2] >>> 17) | (W[i-2] << 15)) ^ ((W[i-2] >>> 19) | (W[i-2] << 13)) ^ (W[i-2] >>> 10);
      W[i] = (W[i-16] + s0 + W[i-7] + s1) >>> 0;
    }
    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (var i = 0; i < 64; i++) {
      var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      var ch = (e & f) ^ (~e & g);
      var t1 = (h + S1 + ch + _SHA256_K[i] + W[i]) >>> 0;
      var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      var mj = (a & b) ^ (a & c) ^ (b & c);
      var t2 = (S0 + mj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0]+a)>>>0; H[1] = (H[1]+b)>>>0; H[2] = (H[2]+c)>>>0; H[3] = (H[3]+d)>>>0;
    H[4] = (H[4]+e)>>>0; H[5] = (H[5]+f)>>>0; H[6] = (H[6]+g)>>>0; H[7] = (H[7]+h)>>>0;
  }
  var out = new Uint8Array(32);
  for (var i = 0; i < 8; i++) {
    out[i*4]     = (H[i] >>> 24) & 0xff;
    out[i*4 + 1] = (H[i] >>> 16) & 0xff;
    out[i*4 + 2] = (H[i] >>> 8)  & 0xff;
    out[i*4 + 3] = H[i] & 0xff;
  }
  return out;
}

// Cross-context SHA-256: use crypto.subtle when available (much
// faster, hardware-accelerated on most platforms), fall back to the
// pure-JS implementation when it isn't (self-signed HTTPS on iOS
// Safari, file://, etc.).
async function _sha256_bytes(input) {
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
    try {
      var buf = await crypto.subtle.digest('SHA-256', input);
      return new Uint8Array(buf);
    } catch (e) {
      // Fall through to JS fallback on any SubtleCrypto failure.
    }
  }
  return _sha256_js(input);
}

async function sha256_16(obj) {
  var sorted = sortKeysDeep(obj);
  var noSpaces = JSON.stringify(sorted).replace(/[\u0080-\uffff]/g, function(c) {
    return '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0');
  });
  var encoded = new TextEncoder().encode(noSpaces);
  var hash = await _sha256_bytes(encoded);
  var hashArr = Array.from(hash);
  return hashArr.map(function(b) { return b.toString(16).padStart(2, '0'); }).join('').slice(0, 16);
}

async function computeContentHash(record) {
  try {
    var include = _hashSetForRecord(record);
    var hashable = {};
    Object.keys(record).filter(function(k) { return include.has(k); }).sort()
      .forEach(function(k) { hashable[k] = record[k]; });
    return await sha256_16(hashable);
  } catch (e) {
    return null;
  }
}

// ----- Ed25519 signature verification -----

async function _sha256Hex(str) {
  // Full 64-char SHA-256 hex of a UTF-8 string. Used for the
  // thumbnail hash that participates in the signature payload.
  // Uses _sha256_bytes which gracefully falls back to the pure-JS
  // implementation when crypto.subtle is unavailable (iOS Safari on
  // self-signed HTTPS, file://, etc.).
  var bytes = new TextEncoder().encode(str);
  var view = await _sha256_bytes(bytes);
  var hexArr = [];
  for (var i = 0; i < view.length; i++) {
    hexArr.push(view[i].toString(16).padStart(2, '0'));
  }
  return hexArr.join('');
}

async function _thumbnailHashForSig(record) {
  // Mirror of mememage/mint.py post-mint signing block. The hash covers
  // the STORED form of the thumbnail — plaintext string on light chains,
  // canonical-JSON of the encrypted envelope on dark chains. Signing
  // what's actually in the record lets verifiers reproduce the hash
  // without needing the chain's password.
  //
  // The thumbnail-swap defense still holds for dark chains: an attacker
  // can't substitute a different encrypted dict without breaking the
  // signature (they don't have the password to re-encrypt the original
  // plaintext, and any other ciphertext hashes differently).
  if (!record || !record.thumbnail) return '';
  if (typeof record.thumbnail === 'string') {
    return await _sha256Hex(record.thumbnail);
  }
  // Object — encrypted envelope from dark-matter chains. Canonical
  // JSON: sortKeysDeep + JSON.stringify, matching Python's
  // json.dumps(sort_keys=True, separators=(",",":"), ensure_ascii=True).
  // All values in the envelope are hex strings (no non-ASCII), so the
  // ensure_ascii difference between platforms doesn't matter here.
  var canonical = JSON.stringify(sortKeysDeep(record.thumbnail));
  return await _sha256Hex(canonical);
}

async function verifySignature(identifier, contentHash, signatureHex, publicKeyHex, thumbnailHash) {
  // Returns: true (valid), false (invalid), null (can't verify)
  // ``thumbnailHash`` is the SHA-256 hex of the record's thumbnail
  // field (empty string if no thumbnail). Use _thumbnailHashForSig()
  // to compute it from a record.
  if (!signatureHex || !publicKeyHex) return null;

  try {
    var pubBytes = hexToBytes(publicKeyHex);
    var sigBytes = hexToBytes(signatureHex);
    var thumbPart = thumbnailHash || '';
    var message = new TextEncoder().encode(
      identifier + '\x00' + contentHash + '\x00' + thumbPart
    );

    // Path 1 — native SubtleCrypto Ed25519. Fastest where supported
    // (Chrome 137+, Safari 17+, Firefox 128+).
    try {
      var key = await crypto.subtle.importKey(
        'raw', pubBytes, {name: 'Ed25519'}, false, ['verify']
      );
      return await crypto.subtle.verify('Ed25519', key, sigBytes, message);
    } catch (e) {
      // Ed25519 not in this browser's SubtleCrypto — fall through.
    }

    // Path 2 — bundled pure-JS Ed25519 (tweetnacl). Keeps the chain
    // self-contained: the decoder reassembled from chunks centuries
    // from now can still verify signatures without depending on
    // whatever crypto API a future browser ships. nacl global is
    // loaded by the script tag in index.html / validator.html
    // before verify.js.
    if (typeof nacl !== 'undefined' && nacl.sign && nacl.sign.detached &&
        typeof nacl.sign.detached.verify === 'function') {
      try {
        return nacl.sign.detached.verify(message, sigBytes, pubBytes);
      } catch (e) {
        return false;
      }
    }

    // No verifier available at all — caller distinguishes this from
    // "no signature data" via record.signature presence.
    return null;
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

// Mirror the thumbnail generator's center-crop-to-square so both sides
// of the dHash comparison see the same framing. Without this, a
// 1216×832 dropped image gets compared to an 832×832 thumbnail crop
// across mismatched grid cells — guaranteed mismatch on any non-square
// source. The thumbnail (mememage/thumbnail.py:generate_thumbnail)
// center-crops then resizes to 80×80; we center-crop the dropped
// pixels to a square before the 9×8 downsample so the grid geometry
// matches.
function _readCenterCroppedSquare(getImageData, srcW, srcH) {
  var sq = Math.min(srcW, srcH);
  var left = (srcW - sq) >> 1;
  var top  = (srcH - sq) >> 1;
  return { data: getImageData(left, top, sq, sq), width: sq, height: sq };
}

function dHashFromCanvas(canvas) {
  // Square-framed dHash: drop-and-verify image gets center-cropped
  // to match the thumbnail's framing before the 9×8 downsample.
  var ctx = canvas.getContext('2d', {willReadFrequently: true});
  var cropped = _readCenterCroppedSquare(
    function(x, y, w, h) { return ctx.getImageData(x, y, w, h).data; },
    canvas.width, canvas.height,
  );
  return computeDHash(cropped.data, cropped.width, cropped.height);
}

function dHashFromDataURI(dataURI) {
  return new Promise(function(resolve) {
    var img = new Image();
    img.onload = function() {
      var c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      var ctx = c.getContext('2d', {willReadFrequently: true});
      ctx.drawImage(img, 0, 0);
      // The stored thumbnail is ALREADY a square (center-cropped by
      // the server), so this is functionally a no-op for it. Going
      // through the same path keeps the geometry handling identical
      // for both sides — and protects against any future thumbnail
      // shape change.
      var cropped = _readCenterCroppedSquare(
        function(x, y, w, h) { return ctx.getImageData(x, y, w, h).data; },
        c.width, c.height,
      );
      resolve(computeDHash(cropped.data, cropped.width, cropped.height));
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

// Derive a peer keychain root from a soul's _source URL. When the
// validator fetches a soul from a non-IA peer (e.g.
// https://X/api/souls/mememage-Y.soul), the same peer's keychain
// lives at https://X/api/keychain/. Returns null if the source URL
// doesn't match the peer pattern (IA souls fall back to the IA
// metadata API as before).
function peerKeychainRoot(sourceUrl) {
  if (!sourceUrl) return null;
  var m = /^(https?:\/\/[^/]+)\/api\/souls\//.exec(sourceUrl);
  if (m) return m[1] + '/api/keychain';
  return null;
}

async function fetchKeychainRecord(fingerprint, filename, peerRoot) {
  // Try IA first (canonical source for chains that publish there),
  // then the peer root derived from the soul's source URL if given.
  // First non-null record wins — both sides should agree on content
  // since records are signed.
  var chainId = keychainIdentifier(fingerprint);
  var urls = [
    'https://archive.org/download/' + chainId + '/' + filename + '?t=' + Date.now(),
    'https://cors.archive.org/download/' + chainId + '/' + filename + '?t=' + Date.now(),
  ];
  if (peerRoot) {
    urls.push(peerRoot + '/' + chainId + '/' + filename + '?t=' + Date.now());
  }
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
  // Verify a keychain record's Ed25519 signature. The signing pubkey
  // field name varies by record type:
  //   - succession: signed by OLD key (old_public_key)
  //   - revocation: signed by the key itself (public_key)
  //   - alias:      signed by the SIGNER profile (signer_public_key)
  if (!record || !record.signature) return null;
  try {
    var pubHex;
    if (record.action === 'succeed') pubHex = record.old_public_key;
    else if (record.action === 'alias') pubHex = record.signer_public_key;
    else pubHex = record.public_key;
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

// ----- Alias discovery ----------------------------------------------------
//
// An alias record (alias-<other_fp_clean>.json in the signer's keychain)
// claims that two profiles belong to the same human. Verifiers discover
// aliases via the IA metadata API — listing the signer's keychain files
// and pulling each alias-*.json. The strongest signal is BIDIRECTIONAL:
// A claims B is its sibling AND B claims A is its sibling. One-way
// aliases are still recognized but rendered with a softer label.

async function fetchKeychainFileList(fingerprint, peerRoot) {
  // IA metadata endpoint returns the file manifest of an item. We use
  // it once per identity to discover any alias-*.json records, rather
  // than guessing fingerprints. When the soul came from a non-IA peer,
  // also probe the peer's /api/keychain/<chain_id> listing endpoint —
  // returns the same {files:[...]} shape so the merged file list
  // catches aliases regardless of where they were published.
  // Returns [] on any failure — alias discovery is a soft enrichment,
  // never blocks the verdict.
  var chainId = keychainIdentifier(fingerprint);
  var urls = [
    'https://archive.org/metadata/' + chainId + '?t=' + Date.now(),
    'https://cors.archive.org/metadata/' + chainId + '?t=' + Date.now(),
  ];
  if (peerRoot) {
    urls.push(peerRoot + '/' + chainId + '?t=' + Date.now());
  }
  var merged = {};
  for (var i = 0; i < urls.length; i++) {
    try {
      var resp = await fetch(urls[i], {cache: 'no-store'});
      if (!resp.ok) continue;
      var data = await resp.json();
      if (data && Array.isArray(data.files)) {
        data.files.forEach(function(f) {
          // IA returns {name: ...}, peer returns plain strings
          var name = (typeof f === 'string') ? f : f.name;
          if (name) merged[name] = true;
        });
      }
    } catch (e) { continue; }
  }
  return Object.keys(merged);
}

async function discoverAliases(fingerprint, peerRoot) {
  // Returns a list of verified alias records the named key has signed.
  // peerRoot is the optional keychain root derived from the soul's
  // _source URL — lets the verifier find aliases on chains that
  // published only to peer surfaces, not IA. Both sides of the
  // bidirectional check probe the same peer too.
  if (!fingerprint) return [];
  var files = await fetchKeychainFileList(fingerprint, peerRoot);
  var aliasFiles = files.filter(function(n) {
    return /^alias-[0-9a-f]{16}\.json$/i.test(n);
  });
  if (!aliasFiles.length) return [];
  var out = [];
  for (var i = 0; i < aliasFiles.length; i++) {
    var rec = await fetchKeychainRecord(fingerprint, aliasFiles[i], peerRoot);
    if (!rec || rec.action !== 'alias') continue;
    var sigOk = await verifyKeychainSignature(rec);
    if (sigOk !== true) continue;
    var bi = false;
    var reverseName = '';
    try {
      var theirFiles = await fetchKeychainFileList(rec.alias_fingerprint, peerRoot);
      var ourClean = (rec.signer_fingerprint || fingerprint).replace(/:/g, '');
      var expectedName = 'alias-' + ourClean + '.json';
      if (theirFiles.indexOf(expectedName) >= 0) {
        var reverse = await fetchKeychainRecord(rec.alias_fingerprint, expectedName, peerRoot);
        if (reverse && reverse.action === 'alias'
            && reverse.alias_fingerprint === (rec.signer_fingerprint || fingerprint)
            && (await verifyKeychainSignature(reverse)) === true) {
          bi = true;
          // The reverse record was signed BY the other side, so its
          // creator_name is that side's own self-declared name —
          // exactly what we want to display. Captures the real name
          // for older records that pre-date alias_creator_name.
          reverseName = reverse.creator_name || '';
        }
      }
    } catch (e) { /* one-way is still useful */ }

    // Name resolution chain (other side's display name):
    //   1. rec.alias_creator_name — new field (2026-05-18+), the
    //      signer's local label for the target. Ideal.
    //   2. reverseName — captured above for bidirectional records,
    //      gives the other side's own self-declared name. Best
    //      fallback for older records.
    //   3. Truncated fingerprint — readable last resort. Beats
    //      showing the signer's own name as if it were the target's.
    var targetName = rec.alias_creator_name || reverseName || '';
    if (!targetName && rec.alias_fingerprint) {
      var fpClean = rec.alias_fingerprint.replace(/:/g, '');
      targetName = 'key ' + fpClean.slice(0, 8);
    }
    out.push({
      alias_fingerprint: rec.alias_fingerprint,
      alias_public_key: rec.alias_public_key,
      // Name of the OTHER key (the sibling we're naming):
      creator_name: targetName,
      // Name of the SIGNER (kept for back-compat / future use):
      signer_name: rec.creator_name || '',
      timestamp: rec.timestamp || '',
      bidirectional: bi,
    });
  }
  return out;
}

async function checkKeychain(fingerprint, publicKeyHex, peerRoot) {
  // Check for revocation or succession of a key. peerRoot is the
  // optional keychain root derived from the soul's _source URL —
  // ensures revocations/rotations on chains that publish only to
  // peer surfaces are still discoverable.
  if (!fingerprint) return {status: 'active', detail: '', successor: null};

  // Check revocation first
  var revocation = await fetchKeychainRecord(fingerprint, 'revocation.json', peerRoot);
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
  var succession = await fetchKeychainRecord(fingerprint, 'succession.json', peerRoot);
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
