// Conception page state machine.
//
// Drives /mint/<token>: GPS capture (or skip), POST conceive, poll
// status, render the conceived/failed state. Reads its config from
// the inline <script id="conception-config" type="application/json">
// block so the HTML can be a static file the server token-substitutes
// once at request time.
//
// States: pre → minting → conceived | failed.

(function() {
  'use strict';

  var configEl = document.getElementById('conception-config');
  if (!configEl) {
    console.error('conception-config block missing');
    return;
  }
  var config;
  try {
    config = JSON.parse(configEl.textContent || '{}');
  } catch (e) {
    console.error('conception-config parse failed', e);
    return;
  }

  var token = config.token || '';
  var gpsSource = config.gps_source || 'phone';
  var imageName = config.image_name || '';
  var metadata = config.metadata || {};

  // ===== Element refs =====
  var fileEl = document.getElementById('conceptionFile');
  var gpsLabelEl = document.getElementById('conceptionGpsLabel');
  var gpsValueEl = document.getElementById('conceptionGpsValue');
  var gpsHintEl = document.getElementById('conceptionGpsHint');
  var gpsBoxEl = document.getElementById('conceptionGps');
  var metaCountEl = document.getElementById('conceptionMetaCount');
  var metaBodyEl = document.getElementById('conceptionMetaBody');
  var confirmBtn = document.getElementById('conceptionConfirm');
  var pulseDotsEl = document.getElementById('conceptionPulseDots');
  var imageEl = document.getElementById('conceptionImage');
  var downloadImageBtn = document.getElementById('conceptionDownloadImage');
  var downloadImageMetaEl = document.getElementById('conceptionDownloadImageMeta');
  var factsEl = document.getElementById('conceptionFacts');
  var surfacesEl = document.getElementById('conceptionSurfaces');
  var failBodyEl = document.getElementById('conceptionFailBody');
  var retryBtn = document.getElementById('conceptionRetry');

  // ===== Header populate =====
  if (fileEl) fileEl.textContent = imageName;

  // ===== Staged thumbnail =====
  // Fetch + display the staged image so the creator can verify
  // they're conceiving the right thing before tapping the button.
  // Server allows /api/mint/<token>/image in pending state.
  var thumbBtnEl = document.getElementById('conceptionThumbBtn');
  var thumbEl = document.getElementById('conceptionThumb');
  if (thumbBtnEl && thumbEl && token) {
    thumbEl.addEventListener('load', function() { thumbBtnEl.hidden = false; });
    thumbEl.addEventListener('error', function() { thumbBtnEl.hidden = true; });
    thumbEl.src = '/api/mint/' + encodeURIComponent(token) + '/image';
    // Click → full-size lightbox (mirrors decoder ui.js:870 pattern).
    thumbBtnEl.addEventListener('click', function() {
      if (!thumbEl.src) return;
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.88);display:flex;align-items:center;justify-content:center;cursor:pointer;padding:1.5rem;';
      var fullImg = document.createElement('img');
      fullImg.src = thumbEl.src;
      fullImg.style.cssText = 'max-width:92vw;max-height:92vh;object-fit:contain;border-radius:8px;box-shadow:0 4px 40px rgba(0,0,0,0.6);';
      overlay.appendChild(fullImg);
      overlay.addEventListener('click', function() { overlay.remove(); });
      document.addEventListener('keydown', function esc(e) {
        if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc); }
      });
      document.body.appendChild(overlay);
    });
  }

  // ===== Origin fields render =====
  // Show prompt, seed, dimensions, sampler — anything in the staged
  // metadata. The full JSON would overwhelm a phone screen; pick the
  // commonly-meaningful keys, then dump the rest in a sub-detail.
  var metaKeys = Object.keys(metadata).sort();
  metaCountEl.textContent = metaKeys.length;
  metaKeys.forEach(function(k) {
    var row = document.createElement('div');
    row.className = 'conception-meta-row';
    var kEl = document.createElement('span');
    kEl.className = 'k';
    kEl.textContent = k;
    var vEl = document.createElement('span');
    vEl.className = 'v';
    var raw = metadata[k];
    vEl.textContent = (typeof raw === 'object') ? JSON.stringify(raw) : String(raw);
    row.appendChild(kEl);
    row.appendChild(vEl);
    metaBodyEl.appendChild(row);
  });

  // ===== State transitions =====
  function showState(name) {
    var states = document.querySelectorAll('.conception-state');
    states.forEach(function(s) {
      s.hidden = (s.getAttribute('data-state') !== name);
    });
  }

  // ===== GPS branches =====
  var lat = null;
  var lon = null;
  var bestAcc = Infinity;
  var watchId = null;
  var ACCURACY_THRESHOLD = 20;  // meters — phone-mode gating

  function startGpsPhone() {
    if (!('geolocation' in navigator)) {
      gpsBoxEl.setAttribute('data-mode', 'phone');
      gpsLabelEl.textContent = 'Creator Location';
      gpsValueEl.textContent = 'Geolocation not supported';
      gpsValueEl.classList.add('conception-gps-failed');
      gpsHintEl.textContent = 'Open this page on a device with geolocation, or switch the chain GPS source in the dashboard.';
      return;
    }
    gpsBoxEl.setAttribute('data-mode', 'phone');
    gpsLabelEl.textContent = 'Creator Location';
    gpsValueEl.textContent = 'Acquiring satellite fix\u2026';
    gpsValueEl.classList.add('conception-gps-acquiring');
    gpsHintEl.textContent = 'needs \u00b1' + ACCURACY_THRESHOLD + 'm for phone-mode capture';

    watchId = navigator.geolocation.watchPosition(
      function(pos) {
        var acc = pos.coords.accuracy;
        if (acc < bestAcc) {
          lat = pos.coords.latitude;
          lon = pos.coords.longitude;
          bestAcc = acc;
        }
        if (bestAcc <= ACCURACY_THRESHOLD) {
          gpsValueEl.classList.remove('conception-gps-acquiring');
          gpsValueEl.textContent = lat.toFixed(6) + ', ' + lon.toFixed(6);
          gpsLabelEl.textContent = 'Creator Location (\u00b1' + Math.round(bestAcc) + 'm)';
          gpsHintEl.textContent = 'ready';
          confirmBtn.disabled = false;
        } else {
          gpsValueEl.textContent = 'Refining\u2026 \u00b1' + Math.round(acc) + 'm';
          gpsHintEl.textContent = 'needs \u00b1' + ACCURACY_THRESHOLD + 'm for phone-mode capture';
          confirmBtn.disabled = true;
        }
      },
      function() {
        gpsValueEl.classList.remove('conception-gps-acquiring');
        gpsValueEl.classList.add('conception-gps-failed');
        gpsValueEl.textContent = 'Location unavailable';
        gpsHintEl.textContent = 'Allow location access and reload, or switch this chain to machine/none.';
      },
      { enableHighAccuracy: true, timeout: 60000, maximumAge: 0 }
    );
  }

  function startGpsMachine() {
    gpsBoxEl.setAttribute('data-mode', 'machine');
    gpsLabelEl.textContent = 'Machine GPS (approximate)';
    gpsValueEl.textContent = 'Server will fetch IP geolocation on conceive';
    gpsHintEl.textContent = 'gps_source: machine — coarse location, no phone needed';
    confirmBtn.disabled = false;
  }

  function startGpsNone() {
    gpsBoxEl.setAttribute('data-mode', 'none');
    gpsLabelEl.textContent = 'Birthplace';
    gpsValueEl.textContent = 'Not recorded for this chain';
    gpsHintEl.textContent = 'gps_source: none \u2014 record will carry no time-lock puzzle';
    confirmBtn.disabled = false;
  }

  // ===== Conceive button =====
  confirmBtn.addEventListener('click', async function() {
    if (gpsSource === 'phone' && (lat === null || lon === null)) return;
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    confirmBtn.disabled = true;

    var body = (gpsSource === 'phone') ? JSON.stringify({ lat: lat, lon: lon }) : '{}';
    try {
      var resp = await fetch('/api/mint/' + token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
      });
      var data = await resp.json();
      if (data.error) {
        renderFailed(data.error);
        return;
      }
      showState('minting');
      animateDots();
      pollMintStatus();
    } catch (err) {
      renderFailed('Network error: ' + err.message);
    }
  });

  // Retry button — clears state and reloads the page.
  if (retryBtn) {
    retryBtn.addEventListener('click', function() { window.location.reload(); });
  }

  // ===== Pulse animation =====
  var dotsTimer = null;
  function animateDots() {
    var n = 0;
    dotsTimer = setInterval(function() {
      n = (n + 1) % 4;
      pulseDotsEl.textContent = '.'.repeat(n + 1);
    }, 400);
  }
  function stopDots() {
    if (dotsTimer) { clearInterval(dotsTimer); dotsTimer = null; }
    pulseDotsEl.textContent = '';
  }

  // ===== Poll for completion =====
  function pollMintStatus() {
    var poll = setInterval(async function() {
      try {
        var resp = await fetch('/api/mint/' + token + '/status');
        var data = await resp.json();
        if (data.status === 'completed') {
          clearInterval(poll);
          stopDots();
          renderConceived(data);
        } else if (data.status === 'failed') {
          clearInterval(poll);
          stopDots();
          renderFailed(data.error || 'Unknown error');
        }
      } catch (e) {
        // Network hiccup — keep polling
      }
    }, 1500);
  }

  // ===== Conceived state render =====
  function renderConceived(data) {
    showState('conceived');
    var ident = data.identifier || 'mememage';
    var imgUrl = '/api/mint/' + token + '/image';

    imageEl.src = imgUrl;
    if (downloadImageMetaEl) downloadImageMetaEl.textContent = ident + '.png';

    // Facts list — identifier, hash, GPS, constellation if surfaced.
    factsEl.innerHTML = '';
    function addFact(label, val, opts) {
      opts = opts || {};
      var dt = document.createElement('dt');
      dt.textContent = label;
      var dd = document.createElement('dd');
      if (opts.code) {
        var c = document.createElement('code');
        c.textContent = val;
        dd.appendChild(c);
      } else {
        dd.textContent = val;
      }
      if (opts.dim) dd.className = 'conception-facts-dim';
      factsEl.appendChild(dt);
      factsEl.appendChild(dd);
    }

    addFact('Identifier', ident, { code: true });
    addFact('Content hash', data.content_hash || '(unsigned)', { code: true });

    if (data.gps && typeof data.gps.lat === 'number') {
      addFact('Birthplace', data.gps.lat.toFixed(6) + ', ' + data.gps.lon.toFixed(6) + ' (time-locked)');
    } else if (data.gps_source === 'none') {
      addFact('Birthplace', 'not recorded', { dim: true });
    } else {
      addFact('Birthplace', '\u2014', { dim: true });
    }

    // Image download
    _wireBlobDownload(downloadImageBtn, imgUrl, ident + '.png');

    // Surface buttons — one per channel that accepted the soul.
    // Below the success list, surface any channels that errored
    // mid-blast (partial failure: at least one channel succeeded
    // but others didn't). Lets the user see "IA timed out" without
    // having to scrape server logs. All-channel failures route to
    // the failed state, not here.
    surfacesEl.innerHTML = '';
    var dist = data.distribution || {};
    var distKeys = Object.keys(dist);
    var entries = distKeys.length
      ? distKeys.map(function(k) { return [k, dist[k]]; })
      : [['local', '/api/mint/' + token + '/soul']];

    entries.forEach(function(e) {
      var label = e[0];
      var url = e[1];
      var row = document.createElement('div');
      row.className = 'conception-surface';
      var lab = document.createElement('span');
      lab.className = 'conception-surface-label';
      lab.textContent = label;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'conception-surface-dl';
      btn.textContent = 'Download soul';
      _wireBlobDownload(btn, url, ident + '.soul');
      row.appendChild(lab);
      row.appendChild(btn);
      surfacesEl.appendChild(row);
    });

    var errors = data.distribution_errors || {};
    var errorKeys = Object.keys(errors);
    if (errorKeys.length) {
      errorKeys.forEach(function(eid) {
        var row = document.createElement('div');
        row.className = 'conception-surface conception-surface-error';
        var lab = document.createElement('span');
        lab.className = 'conception-surface-label';
        lab.textContent = eid;
        var msg = document.createElement('span');
        msg.className = 'conception-surface-error-msg';
        msg.textContent = errors[eid] || 'unknown error';
        row.appendChild(lab);
        row.appendChild(msg);
        surfacesEl.appendChild(row);
      });
    }
  }

  // ===== Failed state render =====
  function renderFailed(message) {
    stopDots();
    showState('failed');
    failBodyEl.textContent = message;
  }

  // ===== Blob-download helper =====
  // Used by the image button and per-surface soul buttons. JS-driven
  // (rather than <a download>) because self-signed cert sessions don't
  // honor cert acceptance for programmatic <a download> clicks, and
  // we want consistent behavior across channels regardless of whose
  // cert they're using.
  function _wireBlobDownload(btn, srcUrl, filename) {
    if (!btn) return;
    btn.onclick = async function() {
      var prev = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Preparing\u2026';
      try {
        var r = await fetch(srcUrl);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var blob = await r.blob();
        var bUrl = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = bUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(function() {
          URL.revokeObjectURL(bUrl);
          a.remove();
        }, 1000);
        btn.textContent = 'Downloaded';
        setTimeout(function() { btn.textContent = prev; btn.disabled = false; }, 1500);
      } catch (e) {
        btn.textContent = 'Failed: ' + e.message;
        setTimeout(function() { btn.textContent = prev; btn.disabled = false; }, 2500);
      }
    };
  }

  // ===== Boot =====
  if (gpsSource === 'phone') startGpsPhone();
  else if (gpsSource === 'machine') startGpsMachine();
  else startGpsNone();

  // If revisiting a completed session, jump straight to the result.
  (async function checkInitialStatus() {
    try {
      var resp = await fetch('/api/mint/' + token + '/status');
      var data = await resp.json();
      if (data.status === 'completed') {
        renderConceived(data);
      } else if (data.status === 'failed') {
        renderFailed(data.error || 'Unknown error');
      } else if (data.status === 'minting') {
        showState('minting');
        animateDots();
        pollMintStatus();
      }
    } catch (e) { /* network — let user drive */ }
  })();

})();
