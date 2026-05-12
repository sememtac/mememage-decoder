// Dashboard orchestration.
//
// Phase 1: subtitle rotation + three-tab wiring via TabBar. Per-tab
// behavior (mint flow, payload manager, config) will land in subsequent
// phases — this file is the shared chrome.
//
// Bootstrap order in dashboard.html:
//   theme.js → rng.js → cosmic-starfield.js → starfield.js → portal.js
//   → dashboard.js (this) → typewriter.js
// Starfield self-initializes from #starfield's data-theme attribute
// (yang by default — light stars on dark, like decoder). TabBar lives
// in portal.js and is reused unchanged.

// =====================================================================
// NATIVE FILE PICKER — opens the OS-native file/folder dialog via the
// server's /api/fs/pick endpoint (osascript on macOS, zenity/kdialog on
// Linux). Because the mint server runs on the user's machine, the dialog
// pops up on their screen with their permissions — no in-browser
// surrogate needed.
//
// Usage: window.FilePicker.pick({type: "file"}).then(path => ...)
// Resolves to a path string when the user picks, or to null when they
// cancel. Rejects on errors.
// =====================================================================
window.FilePicker = {
  pick: async function(opts) {
    opts = opts || {};
    var token = window._MINT_API_TOKEN || '';
    var headers = {'Content-Type': 'application/json'};
    if (token) headers['Authorization'] = 'Bearer ' + token;

    var resp;
    try {
      resp = await fetch('/api/fs/pick', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          type: opts.type || 'file',
          init_dir: opts.initDir || '',
        }),
      });
    } catch (e) {
      throw new Error('Network: ' + e.message);
    }
    var text = await resp.text();
    var data;
    try { data = text ? JSON.parse(text) : {}; }
    catch (e) {
      throw new Error('HTTP ' + resp.status + ' (non-JSON body): ' + text.slice(0, 120));
    }
    if (!resp.ok) throw new Error(data.error || ('HTTP ' + resp.status));
    if (data.cancelled) return null;
    return data.path;
  },
};


// =====================================================================
// SUBTITLE ROTATION — picks one entry from Theme.taglines.dashboard
// at page load. Default is one of the entries so it surfaces ~1/N visits.
// =====================================================================
(function _rotateSubtitle() {
  var sub = document.querySelector('.page-header .subtitle');
  var trove = (typeof Theme !== 'undefined') && Theme.taglines && Theme.taglines.dashboard;
  if (!sub || !trove || !trove.length) return;
  sub.textContent = trove[Math.floor(Math.random() * trove.length)];
})();

// =====================================================================
// TAB WIRING — TabBar (from portal.js) handles the class toggling.
// Per-tab callbacks fire on tab change so we can lazy-load data.
// =====================================================================
if (typeof TabBar !== 'undefined') {
  TabBar.wire(function(panelId) {
    if (panelId === 'tab-payload' && window.__loadPayloadTab) {
      window.__loadPayloadTab();
    }
    if (panelId === 'tab-config' && window.__loadConfigTab) {
      window.__loadConfigTab();
    }
  });
}

// =====================================================================
// MINT TAB — drag-drop autopilot.
//
// Flow:
//   empty → user drops PNG → upload (auto-extract metadata) → reviewing
//   reviewing → GPS captured + user clicks Conceive → minting
//   minting → poll /api/mint/<token>/status → done | failed
//
// All API calls authenticate via MINT_API_TOKEN if available. The
// /dashboard page itself is unauthenticated (same as /mint/new); the
// token only matters when the server has one configured.
// =====================================================================
(function _mintTab() {
  var panel = document.querySelector('.mint-panel');
  if (!panel) return;

  var els = {
    drop:        document.getElementById('mintDrop'),
    fileInput:   document.getElementById('mintFileInput'),
    review:      document.querySelector('.mint-review'),
    thumb:       document.getElementById('mintThumb'),
    filename:    document.getElementById('mintFilename'),
    size:        document.getElementById('mintSize'),
    metaGrid:    document.getElementById('mintMetaGrid'),
    password:    document.getElementById('mintPassword'),
    gps:         document.getElementById('mintGps'),
    gpsText:     document.getElementById('mintGpsText'),
    error:       document.getElementById('mintError'),
    globalError: document.getElementById('mintGlobalError'),
    conceive:    document.getElementById('mintConceive'),
    cancel:      document.getElementById('mintCancel'),
    progressBody:document.getElementById('mintProgressBody'),
    resultId:    document.getElementById('mintResultId'),
    resultHash:  document.getElementById('mintResultHash'),
    resultUrl:   document.getElementById('mintResultUrl'),
    download:    document.getElementById('mintDownload'),
    again:       document.getElementById('mintAgain'),
    retry:       document.getElementById('mintRetry'),
    failedBody:  document.getElementById('mintFailedBody'),
  };

  // When the dashboard is opened via file:// (double-clicking the HTML),
  // every API call CORS-fails because the origin is null. Surface this
  // immediately so the user knows to load it via the mint server.
  if (location.protocol === 'file:') {
    els.globalError.innerHTML =
      'This dashboard is being loaded from your filesystem (<code>file://</code>), ' +
      'so it can\u2019t reach the mint API. ' +
      'Open it via the mint server instead: ' +
      '<strong>https://localhost:8443/dashboard</strong> ' +
      '(or whatever port your <code>~/.mememage/server.json</code> uses).';
  }

  var state = {
    token: null,
    metadata: null,
    gps: null,
    gpsWatchId: null,
    pollTimer: null,
  };

  function setState(s) { panel.setAttribute('data-mint-state', s); }
  // showError writes to the global slot (visible across all states) AND
  // logs to console so devtools is the second line of diagnostic.
  function showError(msg, opts) {
    var html = (opts && opts.html) ? msg : null;
    if (html) {
      els.globalError.innerHTML = html;
    } else {
      els.globalError.textContent = msg || '';
    }
    if (msg) console.warn('[mint]', msg);
    // Keep the in-review slot in sync for redundancy when we're reviewing.
    if (els.error) els.error.textContent = '';
  }

  // Read the API token from the page — phase 2 takes it from the
  // upload page pattern. If embedded as window._MINT_API_TOKEN, use
  // it; otherwise leave the header empty (server is open on localhost).
  function authHeaders() {
    var token = window._MINT_API_TOKEN || '';
    var h = {'Content-Type': 'application/json'};
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
  }

  // ---- empty → reviewing: handle drop / pick ----
  function fileToBase64(file) {
    return new Promise(function(resolve, reject) {
      var r = new FileReader();
      r.onload = function() {
        var s = r.result;
        var comma = s.indexOf(',');
        resolve(comma >= 0 ? s.slice(comma + 1) : s);
      };
      r.onerror = function() { reject(new Error('Failed to read file')); };
      r.readAsDataURL(file);
    });
  }

  async function handleFile(file) {
    if (!file || file.type !== 'image/png') {
      showError('Only PNG files are accepted.');
      return;
    }
    if (location.protocol === 'file:') {
      // The global-error notice already explains this; bail before
      // attempting the doomed fetch.
      return;
    }
    showError('');
    els.drop.setAttribute('data-busy', '1');
    try {
      var image_b64 = await fileToBase64(file);
      var resp;
      try {
        resp = await fetch('/api/mint/upload', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            filename: file.name,
            image_data: image_b64,
            metadata: {},
          }),
        });
      } catch (netErr) {
        showError(
          'Network error reaching <code>/api/mint/upload</code>: ' + netErr.message +
          '. Is the mint server running? Try <code>launchctl list | grep mememage</code>.',
          {html: true}
        );
        console.error('[mint] fetch failed', netErr);
        return;
      }
      // Parse JSON defensively — a 404 page or HTML error response won't
      // parse and previously failed silently.
      var text = await resp.text();
      var data;
      try { data = text ? JSON.parse(text) : {}; }
      catch (parseErr) {
        showError(
          'Server returned HTTP ' + resp.status + ' with non-JSON body. ' +
          'First 120 chars: <code>' + escapeHtml(text.slice(0, 120)) + '</code>',
          {html: true}
        );
        console.error('[mint] non-JSON response', resp.status, text.slice(0, 500));
        return;
      }
      if (!resp.ok) {
        showError(data.error || ('Upload failed (HTTP ' + resp.status + ').'));
        return;
      }
      state.token = data.token;
      state.metadata = data.metadata || {};
      renderReview(file);
      requestGps();
      setState('reviewing');
    } finally {
      els.drop.removeAttribute('data-busy');
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function(c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  function renderReview(file) {
    els.filename.textContent = file.name;
    els.size.textContent = humanSize(file.size);
    var reader = new FileReader();
    reader.onload = function() { els.thumb.src = reader.result; };
    reader.readAsDataURL(file);

    // Render metadata as a dl grid. Hide noisy keys, prioritize the
    // human-meaningful ones.
    els.metaGrid.innerHTML = '';
    var keysOrdered = ['prompt', 'seed', 'width', 'height', 'steps', 'cfg',
                       'sampler', 'scheduler', 'unet', 'mode'];
    var seen = {};
    var meta = state.metadata || {};
    keysOrdered.forEach(function(k) {
      if (k in meta) { appendMetaRow(k, meta[k]); seen[k] = true; }
    });
    Object.keys(meta).forEach(function(k) {
      if (!seen[k] && meta[k] !== null && meta[k] !== '' && !k.startsWith('_')) {
        appendMetaRow(k, meta[k]);
      }
    });
  }
  function appendMetaRow(k, v) {
    var dt = document.createElement('dt'); dt.textContent = k;
    var dd = document.createElement('dd');
    dd.textContent = (typeof v === 'string') ? v : JSON.stringify(v);
    dd.title = dd.textContent;
    els.metaGrid.appendChild(dt); els.metaGrid.appendChild(dd);
  }
  function humanSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024*1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / (1024*1024)).toFixed(2) + ' MB';
  }

  // ---- GPS capture ----
  function requestGps() {
    state.gps = null;
    els.gps.setAttribute('data-state', 'locating');
    els.gpsText.textContent = 'Requesting location\u2026';
    els.conceive.disabled = true;

    if (!('geolocation' in navigator)) {
      els.gps.setAttribute('data-state', 'denied');
      els.gpsText.textContent = 'Geolocation not available in this browser.';
      return;
    }
    if (state.gpsWatchId !== null) navigator.geolocation.clearWatch(state.gpsWatchId);
    state.gpsWatchId = navigator.geolocation.watchPosition(
      function(pos) {
        state.gps = {lat: pos.coords.latitude, lon: pos.coords.longitude,
                     acc: pos.coords.accuracy};
        els.gps.setAttribute('data-state', 'locked');
        var acc = state.gps.acc ? '\u00b1' + Math.round(state.gps.acc) + 'm' : '';
        els.gpsText.textContent = 'Locked: ' +
          state.gps.lat.toFixed(4) + ', ' + state.gps.lon.toFixed(4) +
          (acc ? ' (' + acc + ')' : '');
        els.conceive.disabled = false;
      },
      function(err) {
        els.gps.setAttribute('data-state', 'denied');
        els.gpsText.textContent = 'GPS denied: ' + err.message;
      },
      {enableHighAccuracy: true, maximumAge: 0, timeout: 20000}
    );
  }

  // ---- reviewing → minting: submit conception ----
  async function submitConception() {
    if (!state.gps) { showError('Waiting for GPS lock.'); return; }
    showError('');
    setState('minting');

    var visibilityEl = document.querySelector('input[name="mintVisibility"]:checked');
    var payload = {
      lat: state.gps.lat,
      lon: state.gps.lon,
      password: (els.password.value || '').trim() || undefined,
      chain_visibility: visibilityEl ? visibilityEl.value : 'light_energy',
    };

    try {
      var resp = await fetch('/api/mint/' + state.token, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      var data = await resp.json();
      if (!resp.ok) {
        showFailure(data.error || ('HTTP ' + resp.status));
        return;
      }
      pollUntilDone();
    } catch (e) {
      showFailure(e.message);
    }
  }

  function pollUntilDone() {
    if (state.pollTimer) clearTimeout(state.pollTimer);
    var attempt = 0;

    function tick() {
      fetch('/api/mint/' + state.token + '/status', {headers: authHeaders()})
        .then(function(r) { return r.json(); })
        .then(function(s) {
          if (s.status === 'completed') {
            showResult(s);
          } else if (s.status === 'failed') {
            showFailure(s.error || 'Mint failed');
          } else {
            attempt++;
            // Vary cadence: fast at first, then back off. Caps at ~3s.
            var delay = Math.min(3000, 600 + attempt * 200);
            state.pollTimer = setTimeout(tick, delay);
          }
        })
        .catch(function(e) {
          showFailure('Lost server connection: ' + e.message);
        });
    }
    tick();
  }

  function showResult(s) {
    els.resultId.textContent = s.identifier;
    els.resultHash.textContent = s.content_hash;
    els.resultUrl.textContent = s.url;
    els.resultUrl.href = s.url;
    els.download.href = '/api/mint/' + state.token + '/image';
    setState('done');
  }

  function showFailure(msg) {
    els.failedBody.textContent = msg;
    setState('failed');
  }

  function reset() {
    if (state.gpsWatchId !== null) {
      navigator.geolocation.clearWatch(state.gpsWatchId);
      state.gpsWatchId = null;
    }
    if (state.pollTimer) { clearTimeout(state.pollTimer); state.pollTimer = null; }
    state.token = null;
    state.metadata = null;
    state.gps = null;
    els.fileInput.value = '';
    els.password.value = '';
    showError('');
    setState('empty');
  }

  // ---- Wiring ----
  els.drop.addEventListener('click', function() { els.fileInput.click(); });
  els.drop.addEventListener('dragover', function(e) {
    e.preventDefault(); els.drop.classList.add('drag-over');
  });
  els.drop.addEventListener('dragleave', function() { els.drop.classList.remove('drag-over'); });
  els.drop.addEventListener('drop', function(e) {
    e.preventDefault(); els.drop.classList.remove('drag-over');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  els.fileInput.addEventListener('change', function(e) {
    if (e.target.files.length) handleFile(e.target.files[0]);
  });
  els.conceive.addEventListener('click', submitConception);
  els.cancel.addEventListener('click', reset);
  els.again.addEventListener('click', reset);
  els.retry.addEventListener('click', reset);
})();


// =====================================================================
// PAYLOAD TAB — chain payload configuration editor.
//
// Reads/writes the active chain's chain.json (entries, layers, frozen
// positions). Operates on a working copy in memory; nothing is persisted
// until the user clicks Save. Refresh re-fetches; Discard reverts to the
// last-saved snapshot.
//
//   GET  /api/chain/current         — active chain ID + metadata
//   GET  /api/chain/config          — current chain's payload config
//   POST /api/chain/config          — replace it (validates, refuses mid-Age)
//   GET  /api/site-pack/status      — current Age + cycle position
//   POST /api/payload/build         — rebuild Payload/ from sources
//   POST /api/site-pack/seal        — begin a new Age (with confirm token)
// =====================================================================
(function _payloadTab() {
  var els = {
    error:        document.getElementById('payloadError'),
    chainId:      document.getElementById('payloadChainId'),
    chainMeta:    document.getElementById('payloadChainMeta'),
    dirty:        document.getElementById('payloadDirty'),
    validation:   document.getElementById('payloadValidation'),
    entries:      document.getElementById('payloadEntries'),
    layers:       document.getElementById('payloadLayersEditor'),
    frozen:       document.getElementById('payloadFrozenEditor'),
    entriesCount: document.getElementById('entriesCount'),
    layersCount:  document.getElementById('layersCount'),
    frozenCount:  document.getElementById('frozenCount'),
    ageStatus:    document.getElementById('payloadAgeStatus'),
    refreshBtn:   document.getElementById('payloadRefreshBtn'),
    buildBtn:     document.getElementById('payloadBuildBtn'),
    applyBtn:     document.getElementById('payloadApplyBtn'),
    discardBtn:   document.getElementById('payloadDiscardBtn'),
    sealBtn:      document.getElementById('payloadSealBtn'),
    lockBadge:    document.getElementById('payloadLockBadge'),
    addEntryBtn:  document.getElementById('addEntryBtn'),
    addLayerBtn:  document.getElementById('addLayerBtn'),
    addFrozenBtn: document.getElementById('addFrozenBtn'),
    modal:        document.getElementById('payloadModal'),
    modalTitle:   document.getElementById('payloadModalTitle'),
    modalMeta:    document.getElementById('payloadModalMeta'),
    modalClose:   document.getElementById('payloadModalClose'),
    presetBtn:    document.getElementById('payloadPresetBtn'),
    presetPanel:  document.getElementById('payloadPresetPanel'),
    presetSavePresetBtn: document.getElementById('payloadSavePresetBtn'),
    presetSaveAsBtn:    document.getElementById('payloadSaveAsNewBtn'),
    presetNewBlankBtn:  document.getElementById('payloadNewBlankBtn'),
    presetList:   document.getElementById('payloadPresetList'),
  };
  if (!els.entries || !els.layers || !els.frozen) return; // panel missing — bail

  // Every layer chunks the same way (gzip → base64 → split). No type knob.

  var loaded = false;

  // ===== State =====
  // working: the live config the user is editing (mutated on every input)
  // saved:   the last server-confirmed snapshot (used for Discard + dirty detection)
  var state = {
    working: null,        // ChainConfig dict — the draft the user is editing
    saved: null,          // last-saved snapshot (chain or preset)
    loaded: false,
    chainLocked: undefined, // true if active chain is mid-Age; refreshed via /api/site-pack/status
    chainLockedReason: '',
    lastPresetName: '',   // remembered preset name for the next save prompt
  };

  // ===== Utilities =====
  function authHeaders() {
    var token = window._MINT_API_TOKEN || '';
    var h = {'Content-Type': 'application/json'};
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
  }
  function showError(msg, html) {
    if (!els.error) return;
    if (html) els.error.innerHTML = msg || '';
    else els.error.textContent = msg || '';
    if (msg) console.warn('[payload]', msg);
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function deepClone(x) { return JSON.parse(JSON.stringify(x)); }

  async function fetchJson(url, opts) {
    var resp;
    try { resp = await fetch(url, opts || {headers: authHeaders()}); }
    catch (e) { throw new Error('Network: ' + e.message); }
    var text = await resp.text();
    var data;
    try { data = text ? JSON.parse(text) : {}; }
    catch (e) {
      throw new Error('HTTP ' + resp.status + ' (non-JSON body): ' + text.slice(0, 100));
    }
    if (!resp.ok) throw new Error(data.error || ('HTTP ' + resp.status));
    return data;
  }

  // ===== Dirty detection =====
  // The editor is conceptually a *draft* of a payload template.
  //   - "Save preset" is ALWAYS available (writes a named preset; never
  //      touches the chain). The button label encodes the action so users
  //      stop confusing it with "save to chain".
  //   - "Apply to chain" commits the draft to the active chain via
  //      POST /api/chain/config. The server refuses this mid-Age (the
  //      distributed chunks would no longer match the new layout); we
  //      mirror that gate in the UI via state.chainLocked.
  function isDirty() {
    if (!state.working || !state.saved) return false;
    return JSON.stringify(state.working) !== JSON.stringify(state.saved);
  }
  function refreshDirtyUI() {
    var errors = validate(state.working);
    var hasErrors = errors.some(function(e) { return e.severity === 'error'; });
    var dirty = isDirty();
    els.dirty.hidden = !dirty;
    els.discardBtn.disabled = !dirty;
    // Apply to chain: needs unsaved edits, no validation errors, the
    // chain to be in EDITABLE state, AND a non-empty template (at least
    // one layer or frozen entry — the server's chain_config.validate()
    // refuses a fully empty one). While the lock state is still loading
    // (undefined), keep the button off so we never invite a click
    // that 409s.
    var w = state.working || {};
    var isIncomplete = (w.layers || []).length === 0 && (w.frozen || []).length === 0;
    if (els.applyBtn) {
      var lockKnown = state.chainLocked !== undefined;
      els.applyBtn.disabled = !dirty || hasErrors || isIncomplete || !lockKnown || state.chainLocked === true;
      if (!lockKnown) {
        els.applyBtn.title = 'Checking chain lock state\u2026';
      } else if (state.chainLocked) {
        els.applyBtn.title =
          'Locked: an Age is in progress on this chain. Applying a new template ' +
          'would invalidate the chunks already distributed. Wait until the cycle ' +
          'completes (or seal the next Age) before applying.';
      } else if (hasErrors) {
        els.applyBtn.title = 'Fix the validation errors below before applying.';
      } else if (isIncomplete) {
        els.applyBtn.title = 'Template needs at least one layer or frozen position before it can be applied.';
      } else if (!dirty) {
        els.applyBtn.title = 'No draft changes to apply.';
      } else {
        els.applyBtn.title = 'Apply this template to the active chain (POST /api/chain/config).';
      }
    }
  }

  // ===== Validation (mirrors chain_config.ChainConfig.validate) =====
  function validate(cfg) {
    var msgs = [];
    if (!cfg) return msgs;
    var nEntries = Object.keys(cfg.entries || {}).length;
    var nLayers = (cfg.layers || []).length;
    var nFrozen = (cfg.frozen || []).length;
    // "No layer/frozen yet" stays informational — the editor lets you
    // build in any order. Apply-to-chain has its own guard that blocks
    // an incomplete template from being committed.
    if (nLayers === 0 && nFrozen === 0) {
      if (nEntries === 0) {
        msgs.push({severity: 'info', text: 'Blank template \u2014 add entries, layers, and frozen positions to build it out.'});
      } else {
        msgs.push({severity: 'info', text: 'Add at least one layer or frozen position before applying to chain.'});
      }
    }
    // M ≥ max(K_i)
    var maxK = 0;
    (cfg.layers || []).forEach(function(ly) { if (ly.K > maxK) maxK = ly.K; });
    if (maxK > (cfg.M || 0)) {
      msgs.push({severity: 'error',
                 text: 'M=' + cfg.M + ' is smaller than the longest layer cycle K=' + maxK + '.'});
    }
    // Entry references
    var entries = cfg.entries || {};
    (cfg.layers || []).forEach(function(ly, i) {
      if (!ly.name) msgs.push({severity:'error', text:'Layer #' + (i+1) + ' missing name.'});
      if (!entries[ly.entry]) {
        msgs.push({severity: 'error',
                   text: 'Layer ' + (ly.name || '#' + (i+1)) + ': entry ' + JSON.stringify(ly.entry) + ' is not defined.'});
      }
      if (ly.reserved != null && (ly.reserved < 0 || ly.reserved >= ly.K)) {
        msgs.push({severity:'error',
                   text: 'Layer ' + ly.name + ': reserved=' + ly.reserved + ' must satisfy 0 <= reserved < K=' + ly.K + '.'});
      }
    });
    var seen = {};
    (cfg.frozen || []).forEach(function(fz, i) {
      if (fz.position < 0 || fz.position >= (cfg.M || 0)) {
        msgs.push({severity:'error',
                   text: 'Frozen #' + (i+1) + ' (role ' + (fz.role||'?') + '): position ' + fz.position + ' out of [0, ' + (cfg.M-1) + '].'});
      }
      var key = fz.position + '/' + (fz.role || '');
      if (seen[key]) msgs.push({severity:'error',
                                 text:'Duplicate frozen at position ' + fz.position + ' role ' + fz.role + '.'});
      seen[key] = true;
      (fz.entries || []).forEach(function(en) {
        if (!entries[en]) {
          msgs.push({severity:'error',
                     text: 'Frozen ' + fz.role + ': entry ' + JSON.stringify(en) + ' not defined.'});
        }
      });
      if (!fz.entries || fz.entries.length === 0) {
        msgs.push({severity:'error',
                   text: 'Frozen ' + (fz.role||'?') + ' has no entries.'});
      }
    });
    return msgs;
  }

  function renderValidation() {
    var msgs = validate(state.working);
    els.validation.innerHTML = msgs.map(function(m) {
      return '<div class="payload-validation-line ' + escapeHtml(m.severity) + '">' +
        escapeHtml(m.text) + '</div>';
    }).join('');
  }

  // ===== Mutations =====
  function setDirty() { refreshDirtyUI(); renderValidation(); }

  function entryNames() {
    if (!state.working || !state.working.entries) return [];
    return Object.keys(state.working.entries);
  }
  // Entries are typeless — every layer chunks the same way (gzip+base64+split).
  function layerCompatibleEntries() {
    return entryNames();
  }
  function renameEntry(oldName, newName) {
    if (oldName === newName) return;
    if (state.working.entries[newName]) {
      showError('An entry named ' + newName + ' already exists.');
      return;
    }
    state.working.entries[newName] = state.working.entries[oldName];
    delete state.working.entries[oldName];
    // Propagate to layers/frozen
    (state.working.layers || []).forEach(function(ly) {
      if (ly.entry === oldName) ly.entry = newName;
    });
    (state.working.frozen || []).forEach(function(fz) {
      fz.entries = (fz.entries || []).map(function(e) { return e === oldName ? newName : e; });
    });
  }

  // ===== Rendering: top chain bar =====
  function renderChainBar() {
    if (!state.working) return;
    els.chainId.textContent = state.working.id || '?';
    var meta = state.working.name || '';
    if (state.working.visibility) meta += (meta ? ' \u00b7 ' : '') + state.working.visibility;
    if (state.working.M != null) meta += (meta ? ' \u00b7 ' : '') + 'M=' + state.working.M;
    els.chainMeta.textContent = meta;
  }

  // ===== Rendering: entries =====
  // Entry rows are multi-line: name on the left, a stacked list of source
  // path inputs on the right (one per source, with + add and ×). The
  // entry's bytes are the concatenation of all its sources at build time.
  function renderEntries() {
    var names = entryNames();
    els.entriesCount.textContent = '(' + names.length + ')';
    if (names.length === 0) {
      els.entries.innerHTML = '<div class="payload-edit-row entry-row">' +
        '<span style="grid-column:1/-1; opacity:0.5; font-style:italic;">No entries defined.</span></div>';
      return;
    }
    var header = '<div class="payload-edit-header entry-header">' +
      '<span>Name</span><span>Sources (concatenated in order at build time)</span><span></span></div>';
    var rows = names.map(function(name) {
      var e = state.working.entries[name];
      var sources = e.sources || [];
      var sourceInputs = sources.map(function(src, idx) {
        return '<div class="entry-source-row">' +
          '<input class="payload-edit-input monospace" data-field="source-' + idx + '" type="text" value="' + escapeHtml(src) + '" placeholder="path/to/file (or click Browse)">' +
          '<button class="source-browse" data-action="browse-source" data-source-idx="' + idx + '" title="Pick a file from the server">Browse</button>' +
          '<button class="payload-edit-delete" data-action="remove-source" data-source-idx="' + idx + '" title="Remove this source">\u00d7</button>' +
          '</div>';
      }).join('');
      return '<div class="payload-edit-row entry-row" data-entry="' + escapeHtml(name) + '">' +
        '<input class="payload-edit-input" data-field="name" type="text" value="' + escapeHtml(name) + '">' +
        '<div class="entry-sources">' +
          sourceInputs +
          '<button class="payload-section-add" data-action="add-source" title="Add a source path to this entry">+ add source</button>' +
        '</div>' +
        '<button class="payload-edit-delete" data-action="delete-entry" title="Delete entry">\u00d7</button>' +
      '</div>';
    }).join('');
    els.entries.innerHTML = header + rows;
  }

  // ===== Rendering: layers =====
  function renderLayers() {
    var layers = state.working.layers || [];
    els.layersCount.textContent = '(' + layers.length + ')';
    var allEntries = entryNames();
    var header = '<div class="payload-edit-header layer-header">' +
      '<span>Name</span><span>K</span><span>Reserved</span><span>Entry</span><span></span></div>';
    if (layers.length === 0) {
      els.layers.innerHTML = header + '<div class="payload-edit-row layer-row">' +
        '<span style="grid-column:1/-1; opacity:0.5; font-style:italic;">No layers defined.</span></div>';
      return;
    }
    var rows = layers.map(function(ly, i) {
      var entryOpts = ['<option value="">(choose entry)</option>'].concat(allEntries.map(function(n) {
        return '<option value="' + n + '"' + (n === ly.entry ? ' selected' : '') + '>' + n + '</option>';
      })).join('');
      if (ly.entry && allEntries.indexOf(ly.entry) < 0) {
        entryOpts = '<option value="' + escapeHtml(ly.entry) + '" selected>' + escapeHtml(ly.entry) + ' (missing)</option>' + entryOpts;
      }
      return '<div class="payload-edit-row layer-row" data-layer="' + i + '">' +
        '<input class="payload-edit-input" data-field="name" type="text" value="' + escapeHtml(ly.name || '') + '">' +
        '<input class="payload-edit-input numeric" data-field="K" type="number" min="1" value="' + (ly.K || 1) + '">' +
        '<input class="payload-edit-input numeric" data-field="reserved" type="number" min="0" value="' + (ly.reserved || 0) + '">' +
        '<select class="payload-edit-select" data-field="entry">' + entryOpts + '</select>' +
        '<button class="payload-edit-delete" data-action="delete-layer" title="Delete layer">\u00d7</button>' +
      '</div>';
    }).join('');
    els.layers.innerHTML = header + rows;
  }

  // ===== Rendering: frozen =====
  function renderFrozen() {
    var frozen = state.working.frozen || [];
    els.frozenCount.textContent = '(' + frozen.length + ')';
    var header = '<div class="payload-edit-header frozen-header">' +
      '<span>Pos</span><span>Role</span><span>Entries (concatenated if multiple)</span><span></span></div>';
    if (frozen.length === 0) {
      els.frozen.innerHTML = header + '<div class="payload-edit-row frozen-row">' +
        '<span style="grid-column:1/-1; opacity:0.5; font-style:italic;">No frozen positions defined.</span></div>';
      return;
    }
    var allEntries = entryNames();
    var rows = frozen.map(function(fz, i) {
      var linked = fz.entries || [];
      // Chips for each linked entry (mark missing ones in red).
      var chips = linked.map(function(name) {
        var missing = allEntries.indexOf(name) < 0;
        var cls = 'chip' + (missing ? ' chip-missing' : '');
        var title = missing ? 'Entry "' + name + '" is not defined' : 'Entry "' + name + '"';
        return '<span class="' + cls + '" title="' + escapeHtml(title) + '">' +
          escapeHtml(name) +
          ' <button class="chip-remove" data-action="remove-frozen-entry" data-frozen="' + i + '" data-entry="' + escapeHtml(name) + '" title="Remove">\u00d7</button>' +
          '</span>';
      }).join('');
      // Picker: lists entries not already linked. Defaults to a placeholder.
      var available = allEntries.filter(function(n) { return linked.indexOf(n) < 0; });
      var pickerOpts = '<option value="">+ add entry</option>' + available.map(function(n) {
        return '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + '</option>';
      }).join('');
      var picker = '<select class="chip-add-select" data-action="add-frozen-entry" data-frozen="' + i + '" title="Add a defined entry to this frozen position">' + pickerOpts + '</select>';

      return '<div class="payload-edit-row frozen-row" data-frozen="' + i + '">' +
        '<input class="payload-edit-input numeric" data-field="position" type="number" min="0" value="' + fz.position + '">' +
        '<input class="payload-edit-input" data-field="role" type="text" value="' + escapeHtml(fz.role || '') + '">' +
        '<div class="chip-container">' + chips + picker + '</div>' +
        '<button class="payload-edit-delete" data-action="delete-frozen" title="Delete frozen">\u00d7</button>' +
      '</div>';
    }).join('');
    els.frozen.innerHTML = header + rows;
  }

  function renderAll() {
    renderChainBar();
    renderEntries();
    renderLayers();
    renderFrozen();
    renderValidation();
    refreshDirtyUI();
  }

  // ===== Event delegation: handle every input/select change in one place =====
  function wireDelegation() {
    function onChange(e) {
      var t = e.target;
      var row = t.closest && t.closest('[data-entry], [data-layer], [data-frozen]');
      if (!row) return;

      if (row.hasAttribute('data-entry')) {
        var oldName = row.getAttribute('data-entry');
        var entry = state.working.entries[oldName];
        if (!entry) return;
        var field = t.getAttribute('data-field');
        if (field === 'name') {
          // Renaming swaps the dict key and rebuilds the row's DOM via
          // renderAll(), which would destroy this input on every
          // keystroke if we fired on the 'input' event. Defer the
          // rename until blur/Enter (the 'change' event), so the user
          // can type freely without losing focus.
          if (e.type !== 'change') return;
          var newName = t.value.trim();
          if (newName && newName !== oldName) {
            renameEntry(oldName, newName);
            renderAll();
          }
          return;
        } else if (field && field.indexOf('source-') === 0) {
          // source-N → update sources[N] in place (no re-render — keeps focus)
          var srcIdx = parseInt(field.slice('source-'.length), 10);
          entry.sources = entry.sources || [];
          entry.sources[srcIdx] = t.value;
          setDirty();
          return;
        }
        setDirty();
      } else if (row.hasAttribute('data-layer')) {
        var idx = parseInt(row.getAttribute('data-layer'), 10);
        var ly = state.working.layers[idx];
        if (!ly) return;
        var field2 = t.getAttribute('data-field');
        if (field2 === 'name') ly.name = t.value;
        else if (field2 === 'K') ly.K = parseInt(t.value, 10) || 0;
        else if (field2 === 'reserved') ly.reserved = parseInt(t.value, 10) || 0;
        else if (field2 === 'entry') ly.entry = t.value;
        setDirty();
      } else if (row.hasAttribute('data-frozen')) {
        var fidx = parseInt(row.getAttribute('data-frozen'), 10);
        var fz = state.working.frozen[fidx];
        if (!fz) return;
        var field3 = t.getAttribute('data-field');
        if (field3 === 'position') fz.position = parseInt(t.value, 10) || 0;
        else if (field3 === 'role') fz.role = t.value;
        // Note: entry add/remove handled by data-action below — not here.
        setDirty();
      }
    }
    els.entries.addEventListener('input', onChange);
    els.entries.addEventListener('change', onChange);
    els.layers.addEventListener('input', onChange);
    els.layers.addEventListener('change', onChange);
    els.frozen.addEventListener('input', onChange);
    els.frozen.addEventListener('change', onChange);

    function onClick(e) {
      var btn = e.target.closest && e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-action');
      var row = btn.closest('[data-entry], [data-layer], [data-frozen]');
      if (action === 'delete-entry') {
        var name = row.getAttribute('data-entry');
        if (!window.confirm('Delete entry "' + name + '"? Any layers/frozen positions that reference it will be invalid.')) return;
        delete state.working.entries[name];
        renderAll();
      } else if (action === 'add-source') {
        var entryName = row.getAttribute('data-entry');
        var e = state.working.entries[entryName];
        if (!e) return;
        e.sources = e.sources || [];
        e.sources.push('');
        renderAll();
      } else if (action === 'remove-source') {
        var entryName2 = row.getAttribute('data-entry');
        var e2 = state.working.entries[entryName2];
        if (!e2) return;
        var srcIdx = parseInt(btn.getAttribute('data-source-idx'), 10);
        if (!isNaN(srcIdx)) {
          e2.sources = (e2.sources || []).filter(function(_, i) { return i !== srcIdx; });
          renderAll();
        }
      } else if (action === 'browse-source') {
        var entryName3 = row.getAttribute('data-entry');
        var srcIdx3 = parseInt(btn.getAttribute('data-source-idx'), 10);
        if (!window.FilePicker) return;
        showError('');
        btn.disabled = true;
        var prevLabel = btn.textContent;
        btn.textContent = 'Picking\u2026';
        window.FilePicker.pick({type: 'file'}).then(function(picked) {
          btn.disabled = false;
          btn.textContent = prevLabel;
          if (picked == null) return; // user cancelled
          var ent = state.working.entries[entryName3];
          if (!ent) return;
          ent.sources = ent.sources || [];
          ent.sources[srcIdx3] = picked;
          renderAll();
        }).catch(function(err) {
          btn.disabled = false;
          btn.textContent = prevLabel;
          showError('Browse failed: ' + err.message);
        });
      } else if (action === 'delete-layer') {
        var idx = parseInt(row.getAttribute('data-layer'), 10);
        state.working.layers.splice(idx, 1);
        renderAll();
      } else if (action === 'delete-frozen') {
        var fidx = parseInt(row.getAttribute('data-frozen'), 10);
        state.working.frozen.splice(fidx, 1);
        renderAll();
      } else if (action === 'remove-frozen-entry') {
        var fidx2 = parseInt(btn.getAttribute('data-frozen'), 10);
        var entryName = btn.getAttribute('data-entry');
        var fz = state.working.frozen[fidx2];
        if (!fz) return;
        fz.entries = (fz.entries || []).filter(function(n) { return n !== entryName; });
        renderAll();
      }
    }
    function onPickerChange(e) {
      var sel = e.target.closest && e.target.closest('[data-action="add-frozen-entry"]');
      if (!sel) return;
      if (!sel.value) return; // placeholder selected
      var fidx = parseInt(sel.getAttribute('data-frozen'), 10);
      var fz = state.working.frozen[fidx];
      if (!fz) return;
      fz.entries = fz.entries || [];
      if (fz.entries.indexOf(sel.value) < 0) fz.entries.push(sel.value);
      renderAll();
      // The new render replaces the select, so no need to reset its value.
    }
    els.entries.addEventListener('click', onClick);
    els.layers.addEventListener('click', onClick);
    els.frozen.addEventListener('click', onClick);
    els.frozen.addEventListener('change', onPickerChange);
  }

  // ===== Add buttons =====
  function newEntryName() {
    var i = 1;
    while (state.working.entries['entry_' + i]) i++;
    return 'entry_' + i;
  }
  function onAddEntry() {
    var name = newEntryName();
    state.working.entries[name] = {sources: ['']};
    renderAll();
  }
  function onAddLayer() {
    var compat = layerCompatibleEntries();
    state.working.layers.push({
      name: 'layer_' + (state.working.layers.length + 1),
      K: 1,
      reserved: 0,
      entry: compat[0] || '',
    });
    renderAll();
  }
  function onAddFrozen() {
    var firstName = entryNames()[0] || '';
    state.working.frozen.push({
      position: 0,
      role: 'frozen_' + (state.working.frozen.length + 1),
      entries: firstName ? [firstName] : [],
      combine: false,
    });
    renderAll();
  }

  // ===== Save / Discard / Refresh =====
  async function loadConfig() {
    showError('');
    try {
      var cfg = await fetchJson('/api/chain/config');
      // Strip any legacy chunk_type/type fields the server might still emit.
      (cfg.layers || []).forEach(function(ly) {
        if ('chunk_type' in ly) delete ly.chunk_type;
        if ('type' in ly) delete ly.type;
      });
      // Entries: older servers carried `source` (single string) and `type`.
      // Normalize to the new shape: sources: [list], no type.
      Object.keys(cfg.entries || {}).forEach(function(name) {
        var e = cfg.entries[name];
        if (!e.sources && e.source) e.sources = [e.source];
        if ('type' in e) delete e.type;
      });
      state.working = cfg;
      state.saved = deepClone(cfg);
      // Loading the chain's own config is not "loading a preset" — clear
      // lastPresetName so the Save button goes back to prompting for a
      // new name on first save.
      state.lastPresetName = '';
      refreshPresetButtonLabel();
      renderAll();
    } catch (e) {
      showError('Failed to load chain config: ' + e.message);
    }
    // Age status (separate, ok if it fails)
    try {
      var age = await fetchJson('/api/site-pack/status');
      renderAgeStatus(age);
    } catch (e) {
      els.ageStatus.textContent = '(site-pack status unavailable: ' + e.message + ')';
    }
  }

  async function onApplyToChain() {
    if (!els.applyBtn || els.applyBtn.disabled) return;
    showError('');
    els.applyBtn.disabled = true;
    var prev = els.applyBtn.textContent;
    els.applyBtn.textContent = 'Applying\u2026';
    try {
      var resp = await fetchJson('/api/chain/config', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(state.working),
      });
      state.saved = deepClone(resp.config || state.working);
      state.working = deepClone(state.saved);
      renderAll();
      showError('');
    } catch (e) {
      showError('Apply to chain failed: ' + e.message);
    } finally {
      els.applyBtn.textContent = prev;
      refreshDirtyUI();
    }
  }

  function onDiscard() {
    if (!state.saved) return;
    if (isDirty() && !window.confirm('Discard your unsaved changes?')) return;
    state.working = deepClone(state.saved);
    renderAll();
  }

  function renderAgeStatus(info) {
    if (!info || info.sealed === false) {
      els.ageStatus.textContent = 'No Age sealed yet \u2014 click Seal Age to begin.';
      state.chainLocked = false;
      renderLockBadge();
      refreshDirtyUI();
      return;
    }
    els.ageStatus.textContent =
      info.age_name + ' (Age ' + info.age + ') \u00b7 ' +
      'outer ' + info.outer_position + '/' + info.outer_total + ' \u00b7 ' +
      'inner ' + info.inner_position + '/' + info.inner_total + ' \u00b7 ' +
      'decoder hash ' + (info.decoder_hash || '?');
    // Cycle complete = ready to advance to next Age — editing is allowed
    // again. Mid-cycle = locked.
    state.chainLocked = !info.cycle_complete;
    state.chainLockedReason = info.cycle_complete
      ? '' : ('Age in progress: outer ' + info.outer_position + '/' + info.outer_total);
    renderLockBadge();
    refreshDirtyUI();
  }

  function renderLockBadge() {
    if (!els.lockBadge) return;
    if (state.chainLocked === undefined) {
      els.lockBadge.textContent = 'checking\u2026';
      els.lockBadge.setAttribute('data-state', 'unknown');
      els.lockBadge.title = '';
    } else if (state.chainLocked) {
      els.lockBadge.textContent = 'LOCKED';
      els.lockBadge.setAttribute('data-state', 'locked');
      els.lockBadge.title = state.chainLockedReason ||
        'The chain is mid-Age — template changes are blocked until the outer cycle completes.';
    } else {
      els.lockBadge.textContent = 'EDITABLE';
      els.lockBadge.setAttribute('data-state', 'editable');
      els.lockBadge.title =
        'No Age in progress on this chain. Applying a new template will commit it ' +
        'as the chain\u2019s next Age starts.';
    }
  }

  // ===== Build / Seal (unchanged from prior phase) =====
  async function rebuild() {
    showError('');
    els.buildBtn.disabled = true;
    var prev = els.buildBtn.textContent;
    els.buildBtn.textContent = 'Building\u2026';
    try {
      await fetchJson('/api/payload/build', {
        method: 'POST', headers: authHeaders(), body: '{}',
      });
      // After Build, reload so any new sources surface in entries
      await loadConfig();
    } catch (e) {
      showError('Build failed: ' + e.message);
    } finally {
      els.buildBtn.disabled = false;
      els.buildBtn.textContent = prev;
    }
  }
  async function sealAge() {
    var ok = window.prompt(
      'Begin a new Age?\n\n' +
      'This is irreversible. Re-seals if no Age yet, or starts the next Age ' +
      'if the current cycle is complete.\n\n' +
      'Type SEAL to confirm:'
    );
    if (ok !== 'SEAL') return;
    showError('');
    els.sealBtn.disabled = true;
    var prev = els.sealBtn.textContent;
    els.sealBtn.textContent = 'Sealing\u2026';
    try {
      var resp = await fetchJson('/api/site-pack/seal', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({confirm: 'SEAL'}),
      });
      await loadConfig();
      showError('Sealed: ' + resp.info.age_name + ' (Age ' + resp.info.age + '). Decoder hash ' + resp.info.decoder_hash);
    } catch (e) {
      showError('Seal failed: ' + e.message);
    } finally {
      els.sealBtn.disabled = false;
      els.sealBtn.textContent = prev;
    }
  }

  // ===== Presets =====
  // Presets are payload templates (entries + layers + frozen + M) without
  // per-chain identity. Saving snapshots the current chain's config;
  // loading stages it in state.working so the user can review + Save it
  // into the active chain. Identity (id/name/visibility) is preserved
  // from the active chain on load.
  async function loadPresetList() {
    if (!els.presetList) return;
    try {
      var data = await fetchJson('/api/payload/presets');
      var items = data.presets || [];
      if (items.length === 0) {
        els.presetList.innerHTML = '<p class="payload-preset-empty">No saved presets yet.</p>';
        return;
      }
      els.presetList.innerHTML = items.map(function(p) {
        var when = p.modified ? p.modified.replace('T', ' ') : '';
        return '<div class="payload-preset-row">' +
          '<span class="payload-preset-name" title="' + escapeHtml(p.name) + '">' + escapeHtml(p.name) + '</span>' +
          '<span class="payload-preset-mtime">' + escapeHtml(when) + '</span>' +
          '<span class="payload-preset-actions">' +
            '<button class="payload-btn payload-preset-load" data-name="' + escapeHtml(p.name) + '">Load</button>' +
            '<button class="payload-btn payload-preset-delete" data-name="' + escapeHtml(p.name) + '">Delete</button>' +
          '</span>' +
        '</div>';
      }).join('');
      els.presetList.querySelectorAll('.payload-preset-load').forEach(function(b) {
        b.addEventListener('click', function() { loadPreset(b.getAttribute('data-name')); });
      });
      els.presetList.querySelectorAll('.payload-preset-delete').forEach(function(b) {
        b.addEventListener('click', function() { deletePreset(b.getAttribute('data-name')); });
      });
    } catch (e) {
      els.presetList.innerHTML = '<p class="payload-preset-empty">Could not load presets: ' + escapeHtml(e.message) + '</p>';
    }
  }

  async function savePreset(opts) {
    // Save the current draft (state.working) as a preset.
    //
    // Two modes:
    //   - A preset is already loaded (state.lastPresetName is set) →
    //     overwrite that preset silently. The button label reflects this
    //     ("Save to <name>") so the user knows what they're writing to.
    //   - No preset loaded (starting from a chain's template) → prompt
    //     for a name. This is "creating a new template."
    //   - Pass opts.forcePrompt=true to always prompt (Save as new...).
    var forcePrompt = !!(opts && opts.forcePrompt);
    var name = state.lastPresetName || '';
    if (forcePrompt || !name) {
      var typed = window.prompt(
        'Name this template preset.\n\n' +
        'Presets are portable: no per-chain identity is stored, so you can ' +
        'load them into any chain later via the Presets menu.',
        name
      );
      if (typed === null) return;
      typed = typed.trim();
      if (!typed) { showError('Preset name cannot be empty.'); return; }
      name = typed;
    }
    showError('');
    try {
      await fetchJson('/api/payload/presets', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({name: name, config: state.working}),
      });
      state.lastPresetName = name;
      refreshPresetButtonLabel();
      // Brief inline confirmation via the dirty marker slot.
      flashSaved(name);
      // Refresh the preset list if the panel happens to be open.
      if (els.presetPanel && !els.presetPanel.hidden) await loadPresetList();
    } catch (e) {
      showError('Save preset failed: ' + e.message);
    }
  }

  function refreshPresetButtonLabel() {
    if (!els.presetSavePresetBtn) return;
    if (state.lastPresetName) {
      els.presetSavePresetBtn.textContent = 'Save to ' + state.lastPresetName;
      els.presetSavePresetBtn.title =
        'Overwrite the loaded preset "' + state.lastPresetName + '" with the current draft. ' +
        'Use "Save as new\u2026" in the Presets menu to create a different preset instead.';
    } else {
      els.presetSavePresetBtn.textContent = 'Save preset\u2026';
      els.presetSavePresetBtn.title =
        'Save the current draft as a new named preset.';
    }
  }

  function flashSaved(label) {
    if (!els.dirty) return;
    var prev = els.dirty.textContent;
    var prevHidden = els.dirty.hidden;
    els.dirty.textContent = '\u2713 saved to ' + label;
    els.dirty.hidden = false;
    els.dirty.style.color = '#1d6f2d';
    setTimeout(function() {
      els.dirty.textContent = prev;
      els.dirty.style.color = '';
      els.dirty.hidden = prevHidden && !isDirty();
      refreshDirtyUI();
    }, 1400);
  }

  async function loadPreset(name) {
    if (!name) return;
    if (isDirty() && !window.confirm(
      'Loading the preset will overwrite your current editor state. ' +
      'Unsaved edits will be lost. Continue?'
    )) return;
    showError('');
    try {
      var data = await fetchJson('/api/payload/presets/' + encodeURIComponent(name));
      var preset = data.config || {};
      // Preset is portable — re-attach the active chain's identity so
      // the editor renders a valid ChainConfig and Save targets the
      // current chain.
      var current = state.working || state.saved || {};
      state.working = Object.assign({}, preset, {
        id: current.id,
        name: current.name,
        visibility: current.visibility,
      });
      // Strip any legacy chunk_type/type fields a preset might carry.
      (state.working.layers || []).forEach(function(ly) {
        if ('chunk_type' in ly) delete ly.chunk_type;
        if ('type' in ly) delete ly.type;
      });
      Object.keys(state.working.entries || {}).forEach(function(n) {
        var e = state.working.entries[n];
        if (!e.sources && e.source) e.sources = [e.source];
        if ('type' in e) delete e.type;
      });
      // Remember which preset is loaded so Save overwrites it silently.
      state.lastPresetName = name;
      refreshPresetButtonLabel();
      renderAll();
      // Loaded preset != saved state → dirty
      refreshDirtyUI();
    } catch (e) {
      showError('Load preset failed: ' + e.message);
    }
  }

  async function deletePreset(name) {
    if (!name) return;
    if (!window.confirm('Delete preset "' + name + '"?')) return;
    showError('');
    try {
      await fetchJson('/api/payload/presets/' + encodeURIComponent(name) + '/delete', {
        method: 'POST', headers: authHeaders(), body: '{}',
      });
      // If the deleted preset was the one we'd Save into, reset.
      if (state.lastPresetName === name) {
        state.lastPresetName = '';
        refreshPresetButtonLabel();
      }
      await loadPresetList();
    } catch (e) {
      showError('Delete preset failed: ' + e.message);
    }
  }

  function togglePresetPanel() {
    if (!els.presetPanel) return;
    var nowOpen = els.presetPanel.hidden;
    els.presetPanel.hidden = !nowOpen;
    if (nowOpen) loadPresetList();
  }

  function newBlankTemplate() {
    // Clear the editor to an empty template — no entries, no layers, no
    // frozen positions. Preserves the active chain's identity (id, name,
    // visibility) and M so the cleared draft is still a valid frame the
    // user can build into.
    if (isDirty() && !window.confirm(
      'Start a blank template? Your current draft will be discarded. ' +
      'Save it as a preset first if you want to keep it.'
    )) return;
    var current = state.working || state.saved || {};
    state.working = {
      id: current.id || '',
      name: current.name || '',
      visibility: current.visibility || 'light_energy',
      M: current.M || 365,
      schema_version: current.schema_version || 2,
      entries: {},
      layers: [],
      frozen: [],
    };
    // Not derived from any preset.
    state.lastPresetName = '';
    refreshPresetButtonLabel();
    renderAll();
    refreshDirtyUI();
  }

  // ===== Initial load + event wiring =====
  window.__loadPayloadTab = function() {
    if (state.loaded) return;
    state.loaded = true;
    loadConfig();
  };
  // Called by the Config tab after a chain switch so the next visit to
  // the Payload tab refetches the new chain's config.
  window.__resetPayloadTab = function() {
    state.loaded = false;
    state.working = null;
    state.saved = null;
    state.lastPresetName = '';
    refreshPresetButtonLabel();
  };

  els.refreshBtn.addEventListener('click', loadConfig);
  els.buildBtn.addEventListener('click', rebuild);
  if (els.applyBtn) els.applyBtn.addEventListener('click', onApplyToChain);
  els.discardBtn.addEventListener('click', onDiscard);
  els.sealBtn.addEventListener('click', sealAge);
  els.addEntryBtn.addEventListener('click', onAddEntry);
  els.addLayerBtn.addEventListener('click', onAddLayer);
  els.addFrozenBtn.addEventListener('click', onAddFrozen);
  if (els.presetBtn) els.presetBtn.addEventListener('click', togglePresetPanel);
  if (els.presetSavePresetBtn) els.presetSavePresetBtn.addEventListener('click', function() { savePreset(); });
  if (els.presetSaveAsBtn) els.presetSaveAsBtn.addEventListener('click', function() { savePreset({forcePrompt: true}); });
  if (els.presetNewBlankBtn) els.presetNewBlankBtn.addEventListener('click', newBlankTemplate);

  // The inspect modal is still in the DOM from earlier phases; close
  // handlers here keep it working (no inspect button surfaces in the
  // editor view but the modal is harmless dormant).
  if (els.modalClose) {
    els.modalClose.addEventListener('click', function() { els.modal.hidden = true; });
    els.modal.addEventListener('click', function(e) {
      if (e.target === els.modal) els.modal.hidden = true;
    });
  }

  wireDelegation();

  // Warn the user before they navigate away with unsaved changes.
  window.addEventListener('beforeunload', function(e) {
    if (isDirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
})();


// =====================================================================
// CONFIG TAB — identity, server, credentials, easter egg.
//
//   GET  /api/config                — scrubbed config snapshot
//   POST /api/config/creator        — update creator.txt
//   POST /api/identity/keygen       — generate Ed25519 key pair
//
// Phase 4 scope: Identity (full read+write), Server/Credentials/Easter egg
// (read-only). Server/env editing through the dashboard is intentionally
// a later iteration so this phase ships safely. For now, sensitive edits
// (rotate, revoke, env writes, webhook editing) stay in the CLI.
// =====================================================================
(function _configTab() {
  var els = {
    error:      document.getElementById('configError'),
    chains:     document.getElementById('configChains'),
    identity:   document.getElementById('configIdentity'),
    server:     document.getElementById('configServer'),
    env:        document.getElementById('configEnv'),
    easterEgg:  document.getElementById('configEasterEgg'),
  };
  if (!els.identity) return;

  var loaded = false;

  function authHeaders() {
    var token = window._MINT_API_TOKEN || '';
    var h = {'Content-Type': 'application/json'};
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
  }

  function showError(msg) {
    if (!els.error) return;
    els.error.textContent = msg || '';
    if (msg) console.warn('[config]', msg);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  async function fetchJson(url, opts) {
    var resp;
    try { resp = await fetch(url, opts || {headers: authHeaders()}); }
    catch (e) { throw new Error('Network: ' + e.message); }
    var text = await resp.text();
    var data;
    try { data = text ? JSON.parse(text) : {}; }
    catch (e) {
      throw new Error('HTTP ' + resp.status + ' (non-JSON body): ' + text.slice(0, 100));
    }
    if (!resp.ok) throw new Error(data.error || ('HTTP ' + resp.status));
    return data;
  }

  function renderIdentity(identity) {
    if (!identity.signing_available) {
      els.identity.innerHTML =
        '<p class="config-note">Signing requires the <code>cryptography</code> ' +
        'library. Install with <code>pip install mememage[sign]</code> and refresh.</p>';
      return;
    }
    if (!identity.has_private_key) {
      // No key yet — show the keygen form.
      els.identity.innerHTML =
        '<p>No identity key found. Generate one to sign your records.</p>' +
        '<div class="config-field">' +
        '  <label class="config-field-label" for="configKeygenName">Creator name</label>' +
        '  <input class="config-input" id="configKeygenName" type="text" placeholder="your name or handle">' +
        '</div>' +
        '<div class="config-row">' +
        '  <button class="config-btn config-btn-primary" id="configKeygenBtn">Generate key</button>' +
        '</div>';
      document.getElementById('configKeygenBtn').addEventListener('click', generateKey);
      return;
    }

    var fp = identity.fingerprint || '(unknown)';
    var pk = identity.public_key || '';
    var name = identity.name || '';
    els.identity.innerHTML =
      '<div class="config-field">' +
      '  <span class="config-field-label">Name</span>' +
      '  <span>' +
      '    <input class="config-input" id="configCreatorName" type="text" value="' + escapeHtml(name) + '">' +
      '  </span>' +
      '</div>' +
      '<div class="config-field">' +
      '  <span class="config-field-label">Fingerprint</span>' +
      '  <span class="config-field-value">' + escapeHtml(fp) + '</span>' +
      '</div>' +
      '<div class="config-field">' +
      '  <span class="config-field-label">Public key</span>' +
      '  <span class="config-field-value">' +
      '    <span style="word-break:break-all">' + escapeHtml(pk) + '</span>' +
      '    <button class="config-copy-btn" data-copy="' + escapeHtml(pk) + '">copy</button>' +
      '  </span>' +
      '</div>' +
      '<div class="config-row">' +
      '  <button class="config-btn" id="configSaveCreator">Save name</button>' +
      '</div>' +
      '<p class="config-note">Key rotation and revocation are CLI-only for safety:' +
      ' <code>mememage rotate</code>, <code>mememage revoke</code>.</p>';

    document.getElementById('configSaveCreator').addEventListener('click', saveCreatorName);
    els.identity.querySelectorAll('.config-copy-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { copyToClipboard(btn); });
    });
  }

  function renderServer(server) {
    var domain = server.domain ? escapeHtml(server.domain) : '<span class="config-field-empty">(unset)</span>';
    var cert   = server.cert   ? escapeHtml(server.cert)   : '<span class="config-field-empty">(unset)</span>';
    var keyP   = server.key    ? escapeHtml(server.key)    : '<span class="config-field-empty">(unset)</span>';

    var webhooksHtml = '<span class="config-field-empty">(none)</span>';
    if (server.webhooks_count > 0) {
      webhooksHtml = server.webhooks.map(function(w) {
        var ev = (w.events || []).join(', ');
        return '<div>' + escapeHtml(w.url) + (ev ? ' \u00b7 <em>' + escapeHtml(ev) + '</em>' : '') + '</div>';
      }).join('');
    }

    els.server.innerHTML =
      '<div class="config-field"><span class="config-field-label">Domain</span><span class="config-field-value">' + domain + '</span></div>' +
      '<div class="config-field"><span class="config-field-label">TLS cert</span><span class="config-field-value">' + cert + '</span></div>' +
      '<div class="config-field"><span class="config-field-label">TLS key</span><span class="config-field-value">' + keyP + '</span></div>' +
      '<div class="config-field"><span class="config-field-label">Webhooks (' + server.webhooks_count + ')</span><span class="config-field-value">' + webhooksHtml + '</span></div>' +
      '<p class="config-note">Edit <code>~/.mememage/server.json</code> directly to change these. Restart the server to pick up changes.</p>';
  }

  function renderEnv(envPresence) {
    var keys = Object.keys(envPresence);
    if (keys.length === 0) {
      els.env.innerHTML = '<span class="config-field-empty">(no credentials)</span>';
      return;
    }
    var rowsHtml = keys.map(function(k) {
      var set = envPresence[k];
      return '<div class="config-env-row" data-set="' + (set ? '1' : '0') + '">' +
        '<span class="config-env-dot"></span>' +
        '<span class="config-env-name">' + escapeHtml(k) + '</span>' +
        '<span class="config-env-state">' + (set ? 'set' : 'unset') + '</span>' +
      '</div>';
    }).join('');
    els.env.innerHTML = rowsHtml +
      '<p class="config-note">Edit <code>.env</code> at the project root to set these. ' +
      'Restart the server to pick up changes. Values are never read or returned via the API.</p>';
  }

  function renderEasterEgg(ee) {
    if (!ee.exists) {
      els.easterEgg.innerHTML =
        '<p class="config-field-empty">No easter egg sealed.</p>' +
        '<p class="config-note">The easter egg is sealed once and reused at position 364 ' +
        'of every Age. Configure yours with the <code>EASTER_EGG_FILE</code> at ' +
        '<code>~/.mememage/madeline_sealed.json</code>.</p>';
      return;
    }
    els.easterEgg.innerHTML =
      '<div class="config-field"><span class="config-field-label">Name</span><span class="config-field-value">' + escapeHtml(ee.name || '') + '</span></div>' +
      '<div class="config-field"><span class="config-field-label">Parent</span><span class="config-field-value">' + escapeHtml(ee.parent_id || '\u2205 (genesis)') + '</span></div>' +
      '<div class="config-field"><span class="config-field-label">Sun</span><span class="config-field-value">' + escapeHtml(ee.born_sun || '') + '</span></div>' +
      '<div class="config-field"><span class="config-field-label">Moon</span><span class="config-field-value">' + escapeHtml(ee.born_moon || '') + '</span></div>' +
      '<div class="config-field"><span class="config-field-label">Image</span><span class="config-field-value">' + escapeHtml(ee.image_format || '') + ' \u00b7 ' + escapeHtml(ee.image_size_bytes || '') + ' bytes</span></div>' +
      '<p class="config-note">Sealed once. Reused forever.</p>';
  }

  async function saveCreatorName() {
    var input = document.getElementById('configCreatorName');
    if (!input) return;
    var name = input.value.trim();
    if (!name) { showError('Name cannot be empty.'); return; }
    showError('');
    try {
      await fetchJson('/api/config/creator', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({name: name}),
      });
      // Quick visual confirmation by tweaking the button label.
      var btn = document.getElementById('configSaveCreator');
      var prev = btn.textContent;
      btn.textContent = 'Saved';
      btn.disabled = true;
      setTimeout(function() { btn.textContent = prev; btn.disabled = false; }, 1500);
    } catch (e) {
      showError('Save failed: ' + e.message);
    }
  }

  async function generateKey() {
    var nameInput = document.getElementById('configKeygenName');
    var name = nameInput ? nameInput.value.trim() : '';
    if (!name) { showError('Choose a creator name first.'); return; }
    showError('');
    var btn = document.getElementById('configKeygenBtn');
    btn.disabled = true; btn.textContent = 'Generating\u2026';
    try {
      var data = await fetchJson('/api/identity/keygen', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({name: name, force: false}),
      });
      await refresh();
      showError('');
      // Brief positive feedback in the now-rerendered identity section.
      console.info('[config] keygen ok — fingerprint', data.fingerprint);
    } catch (e) {
      showError('Keygen failed: ' + e.message);
      btn.disabled = false; btn.textContent = 'Generate key';
    }
  }

  function copyToClipboard(btn) {
    var text = btn.getAttribute('data-copy') || '';
    if (!text || !navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(function() {
      btn.setAttribute('data-copied', '1');
      var prev = btn.textContent;
      btn.textContent = 'copied';
      setTimeout(function() {
        btn.textContent = prev;
        btn.removeAttribute('data-copied');
      }, 1200);
    });
  }

  async function refresh() {
    try {
      var data = await fetchJson('/api/config');
      renderIdentity(data.identity || {});
      renderServer(data.server || {});
      renderEnv(data.env || {});
      renderEasterEgg(data.easter_egg || {});
    } catch (e) {
      showError('Config load failed: ' + e.message);
    }
    // Chains are a separate endpoint; load in parallel-ish.
    await loadChains();
  }

  async function loadChains() {
    if (!els.chains) return;
    try {
      var data = await fetchJson('/api/chain/list');
      renderChains(data.current, data.chains || [], !!data.needs_migration);
    } catch (e) {
      els.chains.innerHTML = '<p class="config-field-empty">Could not load chains: ' + escapeHtml(e.message) + '</p>';
    }
  }

  function renderChains(currentId, chains, needsMigration) {
    var migrateBanner = needsMigration
      ? '<div class="config-chain-migrate-banner">' +
        '  <p><strong>Legacy state detected.</strong> Your existing chain data lives at <code>~/.mememage/</code> and hasn\u2019t been moved into the per-chain layout yet. Migrate now to get this chain listed and editable.</p>' +
        '  <div class="config-field">' +
        '    <span class="config-field-label">Migrate into chain id</span>' +
        '    <input class="config-input" id="configChainMigrateId" type="text" value="aries" placeholder="aries / testing / scratch">' +
        '  </div>' +
        '  <p class="config-note" style="margin-top:0.2rem;">If this was just testing and you want a clean slate, park it under a name like <code>testing</code> and create a fresh <code>aries</code> chain afterward via <em>+ New chain</em>.</p>' +
        '  <div class="config-row">' +
        '    <button class="config-btn config-btn-primary" id="configChainMigrateBtn">Migrate</button>' +
        '  </div>' +
        '  <p class="config-note">Moves <code>sealed_chunks.json</code>, <code>chunk_state.json</code>, <code>records/</code>, <code>mememage.db</code> and <code>last_id.json</code> into <code>~/.mememage/chains/&lt;id&gt;/</code> and writes <code>chain.json</code> metadata. Original location logged to <code>migration.log</code>.</p>' +
        '</div>'
      : '';

    var rows = chains.length === 0
      ? (needsMigration ? '' : '<p class="config-field-empty">No chains found.</p>')
      : '<div class="config-chain-table">' + chains.map(function(c) {
          var isActive = c.id === currentId;
          var meta = (c.visibility || '') + (c.created_at ? ' \u00b7 ' + c.created_at.slice(0, 10) : '');
          var renameBtn = '<button class="config-btn" data-chain-action="rename" data-chain-id="' + escapeHtml(c.id) + '" data-chain-name="' + escapeHtml(c.name || c.id) + '" title="Change display name (visibility is locked at creation)">Rename</button>';
          var actions = isActive
            ? '<span class="config-chain-active-badge">active</span>' +
              renameBtn +
              '<button class="config-btn" data-chain-action="remove" data-chain-id="' + escapeHtml(c.id) + '" disabled title="Switch to a different chain first">Remove</button>'
            : '<button class="config-btn" data-chain-action="switch" data-chain-id="' + escapeHtml(c.id) + '">Switch</button>' +
              renameBtn +
              '<button class="config-btn" data-chain-action="remove" data-chain-id="' + escapeHtml(c.id) + '">Remove</button>';
          return '<div class="config-chain-row" data-active="' + (isActive ? '1' : '0') + '">' +
            '<span class="config-chain-active-mark">' + (isActive ? '\u25b6' : '') + '</span>' +
            '<span class="config-chain-id" title="' + escapeHtml(c.id) + '">' + escapeHtml(c.id) + '</span>' +
            '<span class="config-chain-meta" title="' + escapeHtml(c.name || '') + '">' +
              escapeHtml(c.name || '') + (meta ? '<br><span style="opacity:0.7">' + escapeHtml(meta) + '</span>' : '') +
            '</span>' +
            '<span class="config-chain-actions">' + actions + '</span>' +
            '<span></span>' +
          '</div>';
        }).join('') + '</div>';

    var newForm =
      '<div class="config-row" style="margin-top:0.5rem;">' +
      '  <button class="config-btn" id="configChainShowNew">+ New chain</button>' +
      '</div>' +
      '<div class="config-chain-new-form" id="configChainNewForm" hidden>' +
      '  <div class="config-field"><span class="config-field-label">ID</span>' +
      '    <input class="config-input" id="configChainNewId" type="text" placeholder="aries / private_one / landscapes"></div>' +
      '  <div class="config-field"><span class="config-field-label">Name</span>' +
      '    <input class="config-input" id="configChainNewName" type="text" placeholder="Display name"></div>' +
      '  <div class="config-field"><span class="config-field-label">Visibility</span><span>' +
      '    <label style="margin-right:1rem"><input type="radio" name="newChainVis" value="light_energy" checked> light</label>' +
      '    <label><input type="radio" name="newChainVis" value="dark_matter"> dark</label></span></div>' +
      '  <p class="config-note config-chain-visibility-warning">\u26a0\ufe0f Visibility is permanent. Once you create the chain, you cannot switch between light and dark \u2014 visibility is baked into every record minted in it. The display name can be changed later; the ID and visibility cannot.</p>' +
      '  <div class="config-row">' +
      '    <button class="config-btn config-btn-primary" id="configChainNewCreate">Create</button>' +
      '    <button class="config-btn" id="configChainNewCancel">Cancel</button>' +
      '  </div>' +
      '</div>' +
      '<div class="config-chain-banner" id="configChainBanner" hidden></div>' +
      '<p class="config-note">Switching chains updates the Payload tab and routes new mints / seals to the chosen chain immediately \u2014 no restart needed.</p>';

    els.chains.innerHTML = migrateBanner + rows + newForm;

    // Wire the migrate-legacy button.
    var migrateBtn = document.getElementById('configChainMigrateBtn');
    if (migrateBtn) migrateBtn.addEventListener('click', migrateLegacy);

    // Wire the new-chain form toggle/submit.
    var showBtn = document.getElementById('configChainShowNew');
    var form    = document.getElementById('configChainNewForm');
    var createBtn = document.getElementById('configChainNewCreate');
    var cancelBtn = document.getElementById('configChainNewCancel');
    if (showBtn && form) {
      showBtn.addEventListener('click', function() {
        form.hidden = false; showBtn.hidden = true;
      });
    }
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function() {
        form.hidden = true; if (showBtn) showBtn.hidden = false;
      });
    }
    if (createBtn) createBtn.addEventListener('click', createChain);

    // Wire switch/remove buttons.
    els.chains.querySelectorAll('[data-chain-action]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var action = btn.getAttribute('data-chain-action');
        var cid = btn.getAttribute('data-chain-id');
        if (action === 'switch') switchChain(cid);
        else if (action === 'remove') removeChain(cid);
        else if (action === 'rename') renameChain(cid, btn.getAttribute('data-chain-name') || '');
      });
    });
  }

  function showChainBanner(msg, level) {
    var el = document.getElementById('configChainBanner');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    if (level === 'warning' || level === 'error') {
      el.style.background = 'rgba(220, 80, 80, 0.12)';
      el.style.borderLeftColor = '#b04040';
      el.style.color = '#802020';
    } else {
      el.style.background = 'rgba(60, 200, 220, 0.15)';
      el.style.borderLeftColor = '#3cc8dc';
      el.style.color = '#103060';
    }
  }

  async function migrateLegacy() {
    var idEl = document.getElementById('configChainMigrateId');
    var targetId = (idEl ? idEl.value.trim() : '') || 'aries';
    if (!window.confirm(
      'Migrate legacy state to chains/' + targetId + '/?\n\n' +
      'This moves your existing sealed_chunks.json, chunk_state.json, ' +
      'records/, mememage.db and last_id.json into ' +
      '~/.mememage/chains/' + targetId + '/. The original layout is logged to ' +
      '~/.mememage/migration.log.'
    )) return;
    showError('');
    try {
      var resp = await fetchJson('/api/chain/migrate', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({chain_id: targetId, name: targetId}),
      });
      await loadChains();
      var result = resp.result || {};
      var moved = (result.moved_files || []).length + (result.moved_dirs || []).length;
      showChainBanner(
        'Migrated ' + moved + ' item(s) into chains/' + targetId + '/.'
      );
    } catch (e) {
      showError('Migrate failed: ' + e.message);
    }
  }

  async function switchChain(chainId) {
    showError('');
    try {
      await fetchJson('/api/chain/switch', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({chain_id: chainId}),
      });
      // Invalidate the Payload tab's cached config so its next visit
      // reflects the new chain.
      if (window.__resetPayloadTab) window.__resetPayloadTab();
      await loadChains();
      showChainBanner(
        'Active chain is now \u201c' + chainId + '\u201d. The Payload tab will reload from this chain. ' +
        'Mints and seals are routed to this chain immediately.'
      );
    } catch (e) {
      showError('Switch failed: ' + e.message);
    }
  }

  async function renameChain(chainId, currentName) {
    var newName = window.prompt(
      'Rename chain "' + chainId + '"?\n\n' +
      'Only the display name changes. The chain ID and visibility are ' +
      'permanent.',
      currentName || chainId
    );
    if (newName === null) return;
    newName = newName.trim();
    if (!newName) { showError('Name cannot be empty.'); return; }
    if (newName === currentName) return;
    showError('');
    try {
      await fetchJson('/api/chain/rename', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({chain_id: chainId, name: newName}),
      });
      await loadChains();
      showChainBanner('Renamed \u201c' + chainId + '\u201d to \u201c' + newName + '\u201d.');
    } catch (e) {
      showError('Rename failed: ' + e.message);
    }
  }

  async function removeChain(chainId) {
    if (!window.confirm(
      'Archive chain "' + chainId + '"?\n\n' +
      'Its directory will be moved to ~/.mememage/archive/chains/. ' +
      'You can recover it manually later if needed.'
    )) return;
    showError('');
    try {
      var resp = await fetchJson('/api/chain/remove', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({chain_id: chainId, archive: true}),
      });
      await loadChains();
      showChainBanner('Archived to: ' + (resp.archived_to || 'unknown location'));
    } catch (e) {
      showError('Remove failed: ' + e.message);
    }
  }

  async function createChain() {
    var idEl   = document.getElementById('configChainNewId');
    var nameEl = document.getElementById('configChainNewName');
    var visEl  = document.querySelector('input[name="newChainVis"]:checked');
    var chainId = idEl ? idEl.value.trim() : '';
    if (!chainId) { showError('Chain ID required.'); return; }
    var visibility = visEl ? visEl.value : 'light_energy';
    var name = nameEl ? nameEl.value.trim() : '';
    showError('');
    try {
      await fetchJson('/api/chain/new', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({chain_id: chainId, name: name || chainId, visibility: visibility}),
      });
      await loadChains();
      showChainBanner('Created chain \u201c' + chainId + '\u201d. Switch to it to start editing its config.');
    } catch (e) {
      showError('Create failed: ' + e.message);
    }
  }

  window.__loadConfigTab = function() {
    if (loaded) return;
    loaded = true;
    refresh();
  };
})();
