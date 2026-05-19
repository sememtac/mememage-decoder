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
  // Cached probe of the server's picker capability. The dashboard
  // can read .available synchronously after FilePicker.checkAvailable()
  // has resolved at least once. Defaults to true so we don't hide UI
  // before the first probe completes — the actual pick call will
  // surface its own error if the server can't pop a dialog.
  available: true,
  unavailableReason: '',
  checkAvailable: async function() {
    var token = window._MINT_API_TOKEN || '';
    var headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;
    try {
      var resp = await fetch('/api/fs/pick/available', {headers: headers});
      if (!resp.ok) return;
      var data = await resp.json();
      this.available = !!data.available;
      this.unavailableReason = data.reason || '';
      // Set an attribute on <html> so CSS can hide [data-fs-browse]
      // buttons regardless of when they're added to the DOM. Without
      // this the hide only catches buttons present at probe time —
      // the Config tab renders lazily and would miss out.
      document.documentElement.setAttribute(
        'data-fs-pick', this.available ? 'ok' : 'none',
      );
      if (this.unavailableReason) {
        document.documentElement.setAttribute(
          'data-fs-pick-reason', this.unavailableReason,
        );
      }
    } catch (e) { /* network blip — leave defaults */ }
  },
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

// Probe the server for native picker availability once at load. On
// headless deployments (no DISPLAY, no zenity/kdialog) all
// [data-fs-browse] buttons get hidden so the user isn't tempted to
// click them — the text inputs are the primary path entry surface
// instead. checkAvailable() is async + idempotent; subsequent
// renderings will pick up the same flag without re-fetching.
(function _probePicker() {
  if (window.FilePicker && typeof window.FilePicker.checkAvailable === 'function') {
    window.FilePicker.checkAvailable();
  }
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
// MINT TAB — desktop trigger for the phone-GPS conception flow.
//
// Flow:
//   empty → user drops PNG → upload (auto-extract metadata)
//        → server fires "ready" webhook with mint URL → Discord/Slack
//          delivers the link to the user's phone
//   awaiting → dashboard shows the mint URL + chain context; user goes
//              to phone, taps the Discord/Slack link, browser captures
//              GPS via watchPosition, POSTs back to /api/mint/<token>
//   minting → server runs mint() (now under the chain's password +
//              visibility), uploads to IA; dashboard polls
//              /api/mint/<token>/status
//   done | failed
//
// The desktop never captures GPS itself — desktop geolocation is
// IP/wifi-based and accurate to ±500m at best. Phone GPS hardware is
// accurate to ±5m, which is what the celestial birth certificate
// needs. Dashboard is purely a TRIGGER.
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
    metaEditor:  document.getElementById('mintMetaEditor'),
    metaAdd:     document.getElementById('mintMetaAdd'),
    chainBanner: document.getElementById('mintChainBanner'),
    chainId:     document.getElementById('mintChainId'),
    chainName:   document.getElementById('mintChainName'),
    chainVis:    document.getElementById('mintChainVis'),
    awaitUrl:    document.getElementById('mintAwaitUrl'),
    awaitCopy:   document.getElementById('mintAwaitCopy'),
    handoffHead: document.getElementById('mintHandoffHead'),
    handoffBody: document.getElementById('mintHandoffBody'),
    handoffQr:   document.getElementById('mintHandoffQr'),
    handoffOpen: document.getElementById('mintHandoffOpen'),
    ticket:      document.getElementById('mintTicket'),
    ticketCopy:  document.getElementById('mintTicketCopy'),
    resumeInput: document.getElementById('mintResumeTicket'),
    resumeBtn:   document.getElementById('mintResumeBtn'),
    gpsText:     document.getElementById('mintGpsText'),
    error:       document.getElementById('mintError'),
    globalError: document.getElementById('mintGlobalError'),
    conceive:    document.getElementById('mintConceive'),
    cancel:      document.getElementById('mintCancel'),
    progressBody:document.getElementById('mintProgressBody'),
    resultHead:    document.getElementById('mintResultHead'),
    resultId:      document.getElementById('mintResultId'),
    resultHash:    document.getElementById('mintResultHash'),
    resultUrl:     document.getElementById('mintResultUrl'),
    resultUrlCopy: document.getElementById('mintResultUrlCopy'),
    resultUrlOpen: document.getElementById('mintResultUrlOpen'),
    download:      document.getElementById('mintDownload'),
    downloadSoul:  document.getElementById('mintDownloadSoul'),
    again:         document.getElementById('mintAgain'),
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

  function setState(s) {
    state.uiState = s;
    panel.setAttribute('data-mint-state', s);
    // When entering reviewing state, surface the mint URL the server
    // returned at upload time so the user can hand it to their phone
    // even if webhook delivery is misconfigured.
    if (s === 'reviewing' && typeof showMintUrl === 'function') showMintUrl();
  }
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
    // Accept any image — JPEG/WebP/PNG all work end-to-end (Pillow
    // handles them and the bar+watermark survive JPEG q70+). HEIC
    // needs pillow-heif on the server; we let the upload through and
    // surface any server-side decode failure rather than gate at the
    // browser, since the user's phone may auto-convert HEIC anyway.
    if (!file || !(file.type || '').startsWith('image/')) {
      showError('Please drop an image file.');
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
      var dryRunEl = document.getElementById('mintDryRun');
      var dryRun = dryRunEl ? dryRunEl.checked : false;
      var resp;
      try {
        resp = await fetch('/api/mint/upload', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            filename: file.name,
            image_data: image_b64,
            metadata: {},
            dry_run: dryRun,
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
      rehydrateFromSession(data, file);
      // The server has fired the "ready" webhook on every upload now
      // (host-awareness signal, not phone-only). Polling watches for
      // the /mint/<token> page's Conceive button → mint() pipeline.
      pollMintStatus();
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

    renderMetaEditor();
  }

  // Shared rehydration path — used by both the fresh-upload flow and
  // the resume-by-ticket flow. The two have slightly different inputs:
  //
  //   - Upload : ``file`` is a File from the picker; thumbnail comes
  //              from FileReader. ``data.filename`` not present.
  //   - Resume : ``file`` is null; ``data`` carries ``filename`` and
  //              ``thumb_data_uri`` from the server-side preview.
  //
  // Everything else is identical between the two paths, so collapse
  // the state mutation here.
  function rehydrateFromSession(data, file) {
    state.token = data.token;
    state.ticket = data.ticket || '';
    state.metadata = data.metadata || {};
    state.mintUrl = data.mint_url_full || data.mint_url || '';
    state.gpsSource = data.gps_source || 'phone';
    state.qrDataUri = data.qr_data_uri || '';
    if (file) {
      renderReview(file);
    } else {
      // Resume path — server provided filename + thumb data URI.
      els.filename.textContent = data.filename || '(unknown filename)';
      els.size.textContent = '';
      if (data.thumb_data_uri) els.thumb.src = data.thumb_data_uri;
      renderMetaEditor();
    }
    loadActiveChain();   // refresh chain banner (may have changed since)
    applyHandoffUi();    // QR, URL, copy/open, ticket — same for every mode
    setState('reviewing');
  }

  async function resumeByTicket(ticket) {
    if (!ticket) return;
    if (els.resumeBtn) els.resumeBtn.disabled = true;
    try {
      var resp = await fetch('/api/mint/resume/' + encodeURIComponent(ticket), {headers: authHeaders()});
      var text = await resp.text();
      var data; try { data = text ? JSON.parse(text) : {}; } catch (e) { data = {}; }
      if (!resp.ok) {
        showError(data.error || ('Resume failed (HTTP ' + resp.status + ').'));
        if (els.resumeBtn) els.resumeBtn.disabled = false;
        return;
      }
      showError('');
      rehydrateFromSession(data, null);
      pollMintStatus();  // pick up if the user conceives elsewhere
    } catch (e) {
      showError('Resume request failed: ' + e.message);
    } finally {
      if (els.resumeBtn) els.resumeBtn.disabled = false;
    }
  }

  // Origin field editor — replaces the read-only metadata grid.
  // Seeded from PNG-extracted fields (Madeline-style flows write
  // prompt/seed/sampler etc. into PNG text chunks). Users can add,
  // edit, or delete fields. width/height are derived from the image
  // and shown read-only since the bar embedding step needs them.
  // The mint pipeline reads whatever's here as the record's "origin"
  // payload — the certificate's Origin panel renders adaptively from
  // these.
  var METADATA_FIXED_KEYS = {width: 1, height: 1};
  function renderMetaEditor() {
    var meta = state.metadata || {};
    var host = document.getElementById('mintMetaEditor');
    if (!host) return;
    host.innerHTML = '';
    // Order: prompt + seed up front when present, then everything else
    // sorted alphabetically. width/height locked at the bottom.
    var keys = Object.keys(meta).filter(function(k) {
      return !k.startsWith('_') && !METADATA_FIXED_KEYS[k];
    });
    var canonical = ['prompt', 'seed', 'sampler', 'scheduler', 'unet', 'mode',
                     'steps', 'cfg', 'guidance', 'denoise', 'lora', 'lora_strength'];
    keys.sort(function(a, b) {
      var ai = canonical.indexOf(a), bi = canonical.indexOf(b);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      return a.localeCompare(b);
    });
    keys.forEach(function(k) { host.appendChild(_metaRow(k, meta[k], false)); });
    // width/height — read-only, derived from the image
    if (meta.width && meta.height) {
      var row = document.createElement('div');
      row.className = 'mint-meta-row mint-meta-row-locked';
      row.innerHTML =
        '<span class="mint-meta-key">Size</span>' +
        '<span class="mint-meta-val">' + meta.width + ' × ' + meta.height + ' (from image)</span>';
      host.appendChild(row);
    }
  }
  // Debounced push of edited Origin fields to the server-side session.
  // 400ms is short enough to feel responsive, long enough to coalesce a
  // burst of typing into a single request. We strip width/height before
  // sending — the server already has the image dimensions and refuses
  // to let edits clobber them.
  var _metaPushTimer = null;
  function scheduleMetadataPush() {
    if (!state.token) return;
    if (_metaPushTimer) clearTimeout(_metaPushTimer);
    _metaPushTimer = setTimeout(pushMetadata, 400);
  }
  async function pushMetadata() {
    if (!state.token || !state.metadata) return;
    var payload = {};
    var keys = Object.keys(state.metadata);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k === 'width' || k === 'height') continue;
      if (k.charAt(0) === '_') continue;
      payload[k] = state.metadata[k];
    }
    try {
      await fetch('/api/mint/' + state.token + '/metadata', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({metadata: payload}),
      });
    } catch (e) {
      console.warn('[mint] metadata sync failed', e);
    }
  }
  function _metaRow(key, value, isNew) {
    var row = document.createElement('div');
    row.className = 'mint-meta-row';
    var keyInp = document.createElement('input');
    keyInp.className = 'mint-meta-key-input';
    keyInp.type = 'text';
    keyInp.placeholder = 'field name';
    keyInp.value = key;
    var valInp = document.createElement('input');
    valInp.className = 'mint-meta-val-input';
    valInp.type = 'text';
    valInp.placeholder = 'value';
    valInp.value = (value == null) ? '' : (typeof value === 'string' ? value : JSON.stringify(value));
    if (isNew) setTimeout(function() { keyInp.focus(); }, 0);
    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'mint-meta-del';
    del.textContent = '×';
    del.title = 'Remove field';
    // Sync to state.metadata on every input + push to server (debounced).
    // The mint pipeline reads the server-side session.metadata, so the
    // client copy isn't enough — without the push, edits would be
    // discarded the moment the phone confirms GPS.
    function sync(prevKey) {
      var newKey = keyInp.value.trim();
      var newVal = valInp.value;
      if (!state.metadata) state.metadata = {};
      if (prevKey && prevKey !== newKey) delete state.metadata[prevKey];
      if (newKey) state.metadata[newKey] = newVal;
      scheduleMetadataPush();
    }
    var lastKey = key;
    keyInp.addEventListener('input', function() {
      sync(lastKey);
      lastKey = keyInp.value.trim();
    });
    valInp.addEventListener('input', function() { sync(lastKey); });
    del.addEventListener('click', function() {
      if (lastKey) delete state.metadata[lastKey];
      row.remove();
      scheduleMetadataPush();
    });
    row.appendChild(keyInp);
    row.appendChild(valInp);
    row.appendChild(del);
    return row;
  }

  // Populate the chain context banner. The mint has zero per-mint
  // settings now — visibility and password are both chain properties
  // configured in the Config tab. The banner tells the user where the
  // mint lands and surfaces three states:
  //
  //   - Light + no password   : every field public (incl. GPS)
  //   - Light + password set  : GPS sealed for personal time-lock,
  //                             soul fields still public
  //   - Dark + password set   : full sealing — soul + chunks encrypted
  //
  // Dark + no password is blocked server-side; we also surface a
  // "Configure password" warning here so the user can fix it without
  // hitting Conceive and getting an error.
  state.chainVisibility = null;
  state.chainPasswordSet = false;
  async function loadActiveChain() {
    try {
      var resp = await fetch('/api/chain/current', {headers: authHeaders()});
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var data = await resp.json();
      var id = data.id || '';
      var info = data.info || {};
      var name = info.name || '';
      var vis = info.visibility || 'light_energy';
      var pwSet = !!info.password_set;
      state.chainVisibility = vis;
      state.chainPasswordSet = pwSet;
      els.chainId.textContent = id;
      els.chainName.textContent = name && name !== id ? ' \u00b7 ' + name : '';
      // Compose the visibility chip text: "Light" / "Light · sealed" /
      // "Dark · sealed" / "Dark · MISSING KEY". Single chip carries
      // the full state so the user doesn't have to scan two indicators.
      var visText;
      if (vis === 'dark_matter') {
        visText = pwSet ? 'Dark · sealed' : 'Dark · NEEDS PASSWORD';
      } else {
        visText = pwSet ? 'Light · GPS sealed' : 'Light · public';
      }
      els.chainVis.textContent = visText;
      els.chainVis.dataset.vis = vis;
      els.chainVis.dataset.pwSet = pwSet ? '1' : '0';
      // Surface the dark-chain-missing-password case inline so the user
      // sees the problem before clicking Conceive.
      if (vis === 'dark_matter' && !pwSet) {
        showError('This chain is Dark but has no stored password — set it in Config → Chains before minting.');
      } else {
        showError('');
      }
    } catch (e) {
      els.chainId.textContent = '(could not load active chain)';
      els.chainName.textContent = '';
      els.chainVis.textContent = '';
      state.chainVisibility = null;
      state.chainPasswordSet = false;
    }
  }
  function humanSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024*1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / (1024*1024)).toFixed(2) + ' MB';
  }

  // ---- Conception handoff UI ----
  // Same shape for every gps_source: drop image → server fires Discord
  // ping → dashboard shows QR + URL + Open button → user opens the
  // conception page on whichever device they prefer. The conception
  // page itself adapts to gps_source (phone watchPosition / machine
  // fetch / none). No Conceive action lives on the dashboard.
  function applyHandoffUi() {
    var src = state.gpsSource || 'phone';
    var head, body;
    if (src === 'phone') {
      head = 'Conception link ready (phone GPS)';
      body = 'Scan the QR with your phone, tap the Discord notification, or open below. The conception page will capture precise GPS via the phone\u2019s sensors.';
    } else if (src === 'machine') {
      head = 'Conception link ready (machine GPS)';
      body = 'Open the conception page on any device — the server will fetch its own approximate GPS (city-level) when you press Conceive. Scan the QR, tap Discord, or click Open below.';
    } else {
      head = 'Conception link ready (no GPS)';
      body = 'Open the conception page on any device and press Conceive — this chain records no GPS, and the cert will show "BIRTHPLACE — NOT RECORDED".';
    }
    if (els.handoffHead) els.handoffHead.textContent = head;
    if (els.handoffBody) els.handoffBody.textContent = body;
    if (els.awaitUrl) els.awaitUrl.value = state.mintUrl || '';
    if (els.handoffOpen) els.handoffOpen.href = state.mintUrl || '#';
    if (els.ticket) els.ticket.textContent = state.ticket || '\u2014';
    if (els.handoffQr) {
      if (state.qrDataUri) {
        els.handoffQr.src = state.qrDataUri;
        els.handoffQr.hidden = false;
      } else {
        els.handoffQr.hidden = true;
      }
    }
  }

  // ---- Mint URL display (phone-capture handoff) ----
  // Replaces the old requestGps() — desktop GPS is unfit for the
  // celestial birth certificate (±1km accuracy) so we show the mint
  // URL and let the phone do the real capture.
  function showMintUrl() {
    var url = state.mintUrl || '';
    if (els.awaitUrl) els.awaitUrl.value = url;
  }

  // Status polling — starts immediately after upload while we await
  // the phone, and continues through the server-side mint() pipeline
  // until status flips to 'completed' / 'failed'.
  function pollMintStatus() {
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
          } else if (s.status === 'minting') {
            // Phone POSTed GPS — server is now in the mint() pipeline
            // (hashing, signing, uploading to IA). Flip the UI from
            // "awaiting phone" to the minting spinner.
            if (state.uiState !== 'minting') setState('minting');
            attempt++;
            var delay = Math.min(3000, 600 + attempt * 200);
            state.pollTimer = setTimeout(tick, delay);
          } else {
            // 'pending' / 'awaiting' / unknown — phone hasn't POSTed yet.
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
    // Soul URL is rendered into a readonly text input (not an anchor)
    // so the user can copy it without right-clicking, and it doesn't
    // get cropped with an ellipsis. Adjacent copy + open buttons cover
    // the two common actions.
    if (els.resultUrl) els.resultUrl.value = s.url || '';
    if (els.resultUrlOpen) els.resultUrlOpen.href = s.url || '#';
    // Prefer the server-built absolute download URL (uses
    // externally-reachable host via _external_host) so the link is
    // shareable across devices on the same tailnet. Fall back to a
    // relative path for any older server that doesn't return it.
    els.download.href = s.download_url || ('/api/mint/' + state.token + '/image');
    // Soul download — points at our /api/mint/<token>/soul endpoint
    // which streams the local .soul file regardless of whether IA
    // received it. Works for both real mints (records/<id>.soul) and
    // dry-runs (records/dryrun/<id>.soul). Falls back to the IA URL
    // if the server didn't supply download_soul_url (older builds).
    if (els.downloadSoul) {
      els.downloadSoul.setAttribute('download', s.identifier + '.soul');
      els.downloadSoul.href = s.download_soul_url || s.url || '#';
      els.downloadSoul.classList.remove('mint-action-disabled');
      els.downloadSoul.textContent = 'Download soul';
      els.downloadSoul.title = '';
    }
    // Dry-run badge in the Witnessed header
    if (els.resultHead) {
      els.resultHead.setAttribute('data-dry-run', s.dry_run ? '1' : '0');
    }
    setState('done');
  }

  function showFailure(msg) {
    els.failedBody.textContent = msg;
    setState('failed');
  }

  function reset() {
    if (state.pollTimer) { clearTimeout(state.pollTimer); state.pollTimer = null; }
    state.token = null;
    state.metadata = null;
    state.mintUrl = '';
    state.gpsSource = null;
    state.qrDataUri = '';
    state.ticket = '';
    els.fileInput.value = '';
    if (els.resumeInput) els.resumeInput.value = '';
    if (els.resumeBtn) els.resumeBtn.disabled = false;
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
  els.cancel.addEventListener('click', reset);
  els.again.addEventListener('click', reset);
  els.retry.addEventListener('click', reset);
  if (els.metaAdd) {
    els.metaAdd.addEventListener('click', function() {
      if (els.metaEditor) els.metaEditor.appendChild(_metaRow('', '', true));
    });
  }
  if (els.resumeBtn) {
    els.resumeBtn.addEventListener('click', function() {
      var v = els.resumeInput ? els.resumeInput.value : '';
      resumeByTicket(v);
    });
  }
  if (els.resumeInput) {
    els.resumeInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        resumeByTicket(els.resumeInput.value);
      }
    });
  }
  if (els.ticketCopy && els.ticket) {
    els.ticketCopy.addEventListener('click', function() {
      var t = els.ticket.textContent || '';
      if (!t || t === '\u2014') return;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(t);
        }
        var prev = els.ticketCopy.textContent;
        els.ticketCopy.textContent = 'copied';
        setTimeout(function() { els.ticketCopy.textContent = prev; }, 1200);
      } catch (e) { /* clipboard may be blocked on http:// — silent */ }
    });
  }

  // Shared clipboard copy helper — wires a button to an input, flashes
  // "copied" briefly. Used for both the await-state mint URL and the
  // done-state soul URL.
  function _wireCopyBtn(btn, input) {
    if (!btn || !input) return;
    btn.addEventListener('click', function() {
      if (!input.value) return;
      input.select(); input.setSelectionRange(0, input.value.length);
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(input.value);
        } else {
          document.execCommand('copy');
        }
        var prev = btn.textContent;
        btn.textContent = 'copied';
        setTimeout(function() { btn.textContent = prev; }, 1200);
      } catch (e) { /* clipboard may be blocked on http:// — silent */ }
    });
  }
  _wireCopyBtn(els.awaitCopy, els.awaitUrl);
  _wireCopyBtn(els.resultUrlCopy, els.resultUrl);
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
    // Soft cap on M. Beyond ~10k, the validator's grid renders sluggishly
    // (no virtualization yet) and per-Age completion takes generations
    // at one mint per day. Warn — don't block — so a sophisticated user
    // who really wants M=50000 can override.
    if (typeof cfg.M === 'number' && cfg.M > 10000) {
      var years = Math.round(cfg.M / 365);
      msgs.push({severity: 'warning',
                 text: 'M=' + cfg.M + ' is large. At one mint per day, completing an Age would take \u2248' + years + ' years; the validator\u2019s orbit grid will also render slowly. Most chains keep M \u2264 1000.'});
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
          '<button class="source-browse" data-action="browse-source" data-source-idx="' + idx + '" data-fs-browse title="Pick a file from the server">Browse</button>' +
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

  // ===== Build / Seal =====
  async function rebuild() {
    showError('');
    els.buildBtn.disabled = true;
    var prev = els.buildBtn.textContent;
    els.buildBtn.textContent = 'Building\u2026';
    try {
      await fetchJson('/api/payload/build', {
        method: 'POST', headers: authHeaders(), body: '{}',
      });
      // Build writes Payload/<chain>/<entry>/ artifacts from sources;
      // it doesn't touch chain.json. Re-rendering from current state
      // (no fresh chain config fetch) preserves whichever preset /
      // draft the user was editing. Previously we called loadConfig()
      // here, which wiped state.working + state.lastPresetName.
      renderAll();
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
    profiles:   document.getElementById('configProfiles'),
    identity:   document.getElementById('configIdentity'),
    server:     document.getElementById('configServer'),
  };
  if (!els.identity) return;

  // Webhooks live in a draft buffer between fetches and the Save call.
  // Mutating server.webhooks directly would lose unsaved adds/deletes
  // every time we re-fetch /api/config (e.g. after keygen). The buffer
  // is replaced whenever the server returns a fresh list.
  var _webhooksDraft = null;
  var _webhooksDirty = false;

  // Webhook template presets. The server renders {{key}} placeholders
  // with JSON-escaped values from the event payload.
  //
  // Event-agnostic keys (server-computed, always present):
  //   {{event}}       — "ready" or "conceived"
  //   {{summary}}     — short human description for this event
  //   {{action_url}}  — the URL the recipient should click:
  //                       ready     → /mint/<token> (GPS capture page)
  //                       conceived → IA record URL
  //
  // Event-specific keys (only on the matching event):
  //   ready:     mint_url, image_name
  //   conceived: identifier, content_hash, url (primary surface),
  //              distribution (multiline "label: url" for every
  //              surface the soul landed on), image_path, soul_path,
  //              dry_run, chain_id, chain_visibility, creator_name,
  //              key_fingerprint, constellation, constellation_star,
  //              rarity_score, rarity_tier, gps_source
  //
  // The presets below use the event-agnostic keys so a single template
  // renders cleanly for both `ready` and `conceived` events; users who
  // want richer per-event formatting can split into two webhook rows
  // with different `events` lists. For multi-surface mints, swap
  // {{action_url}} for {{distribution}} in the conceived template to
  // see every mirror in one message. For narrative templates, mix in
  // {{constellation}} {{constellation_star}} or {{rarity_tier}} —
  // "a Rare β Mecitamul was conceived" reads better than just a URL.
  var WEBHOOK_PRESETS = {
    discord: JSON.stringify({
      content: '\uD83C\uDFA8 {{summary}}\n{{action_url}}'
    }, null, 2),
    slack: JSON.stringify({
      text: ':art: *{{summary}}*\n{{action_url}}'
    }, null, 2),
    raw: '',
  };

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
    var hasRevCert = !!identity.has_revocation_cert;
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
      '  <button class="config-btn" id="configRotateBtn">Rotate key\u2026</button>' +
      '  <button class="config-btn config-btn-danger" id="configRevokeBtn"' + (hasRevCert ? '' : ' disabled title="No revocation cert on disk"') + '>Revoke key\u2026</button>' +
      '</div>' +
      '<div id="configIdentityDanger" class="config-danger-zone" style="display:none;"></div>' +
      '<p class="config-note">Rotation signs a succession record with the OLD key + uploads it to IA so verifiers can follow the keychain. Revocation publishes the pre-signed revocation cert; every record signed by this key will then show a revocation warning. Both are irreversible.</p>';

    document.getElementById('configSaveCreator').addEventListener('click', saveCreatorName);
    document.getElementById('configRotateBtn').addEventListener('click', openRotateConfirm);
    var revokeBtn = document.getElementById('configRevokeBtn');
    if (revokeBtn && !revokeBtn.disabled) revokeBtn.addEventListener('click', openRevokeConfirm);
    els.identity.querySelectorAll('.config-copy-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { copyToClipboard(btn); });
    });
  }

  // Renders an inline confirmation form into #configIdentityDanger.
  // We don't use window.confirm() because the user needs to TYPE the
  // confirmation string (matches the CLI's contract) and we want to
  // show context: what will happen, what's reversible.
  function openRotateConfirm() {
    var zone = document.getElementById('configIdentityDanger');
    if (!zone) return;
    zone.style.display = '';
    zone.innerHTML =
      '<h4>Rotate identity key</h4>' +
      '<p>This generates a new Ed25519 keypair, archives the current key under <code>~/.mememage/keychain/</code>, signs a succession record with the OLD key, and uploads that record to the Internet Archive so verifiers can follow the trail. <strong>Records signed by the old key still verify</strong> — but any record minted after this point is signed by the new key.</p>' +
      '<div class="config-field"><span class="config-field-label">Creator name on the new key</span>' +
      '  <input class="config-input" id="configRotateName" type="text" placeholder="(reuse current name if blank)">' +
      '</div>' +
      '<div class="config-field"><span class="config-field-label">Type <code>ROTATE</code> to confirm</span>' +
      '  <input class="config-input" id="configRotateConfirm" type="text" autocomplete="off">' +
      '</div>' +
      '<div class="config-row">' +
      '  <button class="config-btn config-btn-primary" id="configRotateDo">Rotate</button>' +
      '  <button class="config-btn" id="configRotateCancel">Cancel</button>' +
      '</div>' +
      '<div id="configRotateStatus" class="config-note"></div>';
    document.getElementById('configRotateDo').addEventListener('click', doRotate);
    document.getElementById('configRotateCancel').addEventListener('click', function() {
      zone.style.display = 'none'; zone.innerHTML = '';
    });
  }

  async function doRotate() {
    var confirmEl = document.getElementById('configRotateConfirm');
    var nameEl = document.getElementById('configRotateName');
    var statusEl = document.getElementById('configRotateStatus');
    var btn = document.getElementById('configRotateDo');
    if (!confirmEl || confirmEl.value.trim() !== 'ROTATE') {
      statusEl.textContent = 'Type ROTATE exactly to confirm.';
      statusEl.style.color = '#b04040';
      return;
    }
    statusEl.style.color = '';
    statusEl.textContent = 'Rotating\u2026';
    btn.disabled = true;
    try {
      var res = await fetchJson('/api/identity/rotate', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          name: (nameEl && nameEl.value.trim()) || null,
          confirm: 'ROTATE',
        }),
      });
      var msg = 'New key fingerprint: ' + (res.fingerprint || '(unknown)') + '. ';
      msg += res.succession_uploaded
        ? 'Succession record uploaded to IA.'
        : 'Succession not uploaded (' + (res.upload_error || 'unknown error') + '). Retry via: mememage rotate.';
      statusEl.textContent = msg;
      statusEl.style.color = res.succession_uploaded ? '#1a7a1a' : '#a06010';
      await refresh();
    } catch (e) {
      statusEl.textContent = 'Rotate failed: ' + e.message;
      statusEl.style.color = '#b04040';
      btn.disabled = false;
    }
  }

  function openRevokeConfirm() {
    var zone = document.getElementById('configIdentityDanger');
    if (!zone) return;
    zone.style.display = '';
    zone.innerHTML =
      '<h4 style="color:#b04040;">Revoke identity key</h4>' +
      '<p><strong>Irreversible.</strong> Publishes the pre-signed revocation cert to the Internet Archive. Every record ever signed by this key will display a revocation warning after the cert propagates. Use only if your private key is compromised. The revocation cert was pre-signed at keygen time, so an attacker who steals the key cannot forge a revocation — but neither can you un-revoke.</p>' +
      '<div class="config-field"><span class="config-field-label">Type <code>REVOKE</code> to confirm</span>' +
      '  <input class="config-input" id="configRevokeConfirm" type="text" autocomplete="off">' +
      '</div>' +
      '<div class="config-row">' +
      '  <button class="config-btn config-btn-danger" id="configRevokeDo">Revoke</button>' +
      '  <button class="config-btn" id="configRevokeCancel">Cancel</button>' +
      '</div>' +
      '<div id="configRevokeStatus" class="config-note"></div>';
    document.getElementById('configRevokeDo').addEventListener('click', doRevoke);
    document.getElementById('configRevokeCancel').addEventListener('click', function() {
      zone.style.display = 'none'; zone.innerHTML = '';
    });
  }

  async function doRevoke() {
    var confirmEl = document.getElementById('configRevokeConfirm');
    var statusEl = document.getElementById('configRevokeStatus');
    var btn = document.getElementById('configRevokeDo');
    if (!confirmEl || confirmEl.value.trim() !== 'REVOKE') {
      statusEl.textContent = 'Type REVOKE exactly to confirm.';
      statusEl.style.color = '#b04040';
      return;
    }
    statusEl.style.color = '';
    statusEl.textContent = 'Publishing revocation\u2026';
    btn.disabled = true;
    try {
      var res = await fetchJson('/api/identity/revoke', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({confirm: 'REVOKE'}),
      });
      statusEl.textContent = 'Revoked. Fingerprint ' + (res.fingerprint || '') + ' is now dead. Keychain: ' + (res.keychain_id || '');
      statusEl.style.color = '#b04040';
    } catch (e) {
      statusEl.textContent = 'Revoke failed: ' + e.message;
      statusEl.style.color = '#b04040';
      btn.disabled = false;
    }
  }

  function renderServer(server, env) {
    env = env || {};
    // Adopt the server's webhook list as our draft on every render
    // UNLESS the user has unsaved local edits — those win until they
    // click Save (which flushes) or Cancel (which discards).
    if (!_webhooksDirty) {
      _webhooksDraft = (server.webhooks || []).map(function(w) {
        return {
          url: w.url || '',
          events: (w.events || []).slice(),
          headers: w.headers || {},
          template: w.template || '',
          attach_files: !!w.attach_files,
        };
      });
    }

    var domain = server.domain || '';
    var cert   = server.cert   || '';
    var keyP   = server.key    || '';
    var tokenSet = !!env.MINT_API_TOKEN;

    els.server.innerHTML =
      '<div class="config-field">' +
      '  <span class="config-field-label">Domain</span>' +
      '  <input class="config-input" id="configServerDomain" type="text" value="' + escapeHtml(domain) + '" placeholder="(auto-detect at startup)">' +
      '</div>' +
      '<div class="config-field config-field-with-browse">' +
      '  <span class="config-field-label">TLS cert</span>' +
      '  <input class="config-input" id="configServerCert" type="text" value="' + escapeHtml(cert) + '" placeholder="/path/to/cert.pem (or auto-detect)">' +
      '  <button class="config-btn" id="configServerCertBrowse" data-fs-browse>Browse\u2026</button>' +
      '  <button class="config-btn config-btn-subtle" id="configServerCertClear" title="Clear path" ' + (cert ? '' : 'disabled') + '>\u00d7</button>' +
      '</div>' +
      '<div class="config-field config-field-with-browse">' +
      '  <span class="config-field-label">TLS key</span>' +
      '  <input class="config-input" id="configServerKey" type="text" value="' + escapeHtml(keyP) + '" placeholder="/path/to/key.pem (or auto-detect)">' +
      '  <button class="config-btn" id="configServerKeyBrowse" data-fs-browse>Browse\u2026</button>' +
      '  <button class="config-btn config-btn-subtle" id="configServerKeyClear" title="Clear path" ' + (keyP ? '' : 'disabled') + '>\u00d7</button>' +
      '</div>' +
      // Dashboard API token — write-only, masked. Gates /api/* and the
      // dashboard itself when set. Empty = open on localhost (server-
      // side guardrail warns + delays on public-domain startup).
      '<div class="config-field">' +
      '  <span class="config-field-label">API token <span class="config-channel-field-state" data-set="' + (tokenSet ? '1' : '0') + '">' + (tokenSet ? 'set' : 'unset') + '</span></span>' +
      '  <input class="config-input" id="configServerToken" type="password" autocomplete="off" placeholder="' + (tokenSet ? '(set — type to replace)' : '(unset)') + '">' +
      '  <button class="config-btn" id="configServerTokenSet">Update</button>' +
      '</div>' +
      '<div class="config-row">' +
      '  <button class="config-btn" id="configServerSave">Save server.json</button>' +
      '  <span class="config-note" id="configServerStatus" style="margin:0;"></span>' +
      '</div>' +
      '<p class="config-note">Cert/key paths use the native file picker — OS-agnostic, no copy-paste of long paths. Empty = auto-detect from <code>~/.mememage/certs/</code> at startup. Cert/key + API token changes require a server restart to take effect for new sessions.</p>' +
      '<div id="configWebhooks" class="config-webhooks"></div>';

    document.getElementById('configServerSave').addEventListener('click', saveServerConfig);
    document.getElementById('configServerTokenSet').addEventListener('click', function() {
      var inp = document.getElementById('configServerToken');
      var v = inp ? inp.value : '';
      if (!v) {
        showError('API token: enter a value (or leave empty to keep unchanged).');
        return;
      }
      setEnvSecretGlobal('MINT_API_TOKEN', v, document.getElementById('configServerToken').closest('.config-field'));
      inp.value = '';
    });
    document.getElementById('configServerCertBrowse').addEventListener('click', function() {
      pickCertOrKey('configServerCert', 'configServerCertClear');
    });
    document.getElementById('configServerKeyBrowse').addEventListener('click', function() {
      pickCertOrKey('configServerKey', 'configServerKeyClear');
    });
    document.getElementById('configServerCertClear').addEventListener('click', function() {
      clearCertOrKey('configServerCert', 'configServerCertClear');
    });
    document.getElementById('configServerKeyClear').addEventListener('click', function() {
      clearCertOrKey('configServerKey', 'configServerKeyClear');
    });
    renderWebhooks();
  }

  // Cert/key paths use the native OS picker via /api/fs/pick rather
  // than a free-form text input — paths can be long, easy to mistype,
  // and platform-dependent in their separators. The picker also resolves
  // ~ on the server side so we can store portable ~-prefixed paths.
  async function pickCertOrKey(inputId, clearId) {
    var input = document.getElementById(inputId);
    if (!input) return;
    try {
      var path = await window.FilePicker.pick({
        type: 'file',
        initDir: '~/.mememage/certs',
      });
      if (path) {
        input.value = path;
        var clearBtn = document.getElementById(clearId);
        if (clearBtn) clearBtn.disabled = false;
      }
    } catch (e) {
      showError('File picker failed: ' + e.message);
    }
  }

  function clearCertOrKey(inputId, clearId) {
    var input = document.getElementById(inputId);
    if (input) input.value = '';
    var clearBtn = document.getElementById(clearId);
    if (clearBtn) clearBtn.disabled = true;
  }

  async function saveServerConfig() {
    var domain = (document.getElementById('configServerDomain').value || '').trim();
    var cert = (document.getElementById('configServerCert').value || '').trim();
    var key = (document.getElementById('configServerKey').value || '').trim();
    var statusEl = document.getElementById('configServerStatus');
    var btn = document.getElementById('configServerSave');
    showError('');
    statusEl.textContent = '';
    btn.disabled = true; btn.textContent = 'Saving\u2026';
    try {
      var res = await fetchJson('/api/config/server', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({domain: domain, cert: cert, key: key}),
      });
      statusEl.textContent = res.restart_needed
        ? 'Saved. Restart server to apply cert/key.'
        : 'Saved.';
      statusEl.style.color = res.restart_needed ? '#a06010' : '#1a7a1a';
      setTimeout(function() { statusEl.textContent = ''; }, 4000);
    } catch (e) {
      showError('Server save failed: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Save server.json';
    }
  }

  // Render the webhook editor inside #configWebhooks. The list is
  // driven by _webhooksDraft so the user can stage adds/deletes/edits
  // before committing with Save.
  function renderWebhooks() {
    var host = document.getElementById('configWebhooks');
    if (!host) return;
    var list = _webhooksDraft || [];

    var rowsHtml = list.length === 0
      ? '<p class="config-field-empty">No webhooks configured. Mints will not notify anywhere.</p>'
      : list.map(function(w, i) {
          var hasC = (w.events || []).indexOf('conceived') >= 0;
          var hasR = (w.events || []).indexOf('ready') >= 0;
          var allEv = (w.events || []).length === 0; // empty = all events
          var hCount = w.headers ? Object.keys(w.headers).length : 0;
          var tmpl = w.template || '';
          // Identify which preset (if any) the template matches so the
          // dropdown shows the right active item. Falls back to
          // "custom" when the user has edited a preset or written
          // their own.
          var presetKey = 'raw';
          if (tmpl) {
            presetKey = 'custom';
            for (var pk in WEBHOOK_PRESETS) {
              if (WEBHOOK_PRESETS[pk] === tmpl) { presetKey = pk; break; }
            }
          }
          var headerEntries = w.headers ? Object.keys(w.headers).sort() : [];
          // Newly-added rows use a sentinel key (starts with NBSP +
          // "new-") so the dict-keyed storage stays stable. Render
          // those with empty key/value inputs — user fills in the real
          // name; _syncHeadersForRow rewrites the dict on input.
          function _isSentinel(k) { return typeof k === 'string' && k.indexOf('\u00a0new-') === 0; }
          var headersRowsHtml = headerEntries.map(function(hk, hi) {
            var displayKey = _isSentinel(hk) ? '' : hk;
            return '<div class="config-webhook-hdr-row">' +
              '<input class="config-input config-webhook-hdr-key" data-webhook-hdr-key="' + i + ':' + hi + '" type="text" value="' + escapeHtml(displayKey) + '" placeholder="Header-Name">' +
              '<input class="config-input config-webhook-hdr-val" data-webhook-hdr-val="' + i + ':' + hi + '" type="text" value="' + escapeHtml(w.headers[hk]) + '" placeholder="value">' +
              '<button class="config-btn config-webhook-hdr-del" data-webhook-hdr-del="' + i + ':' + hi + '" title="Remove header">\u00d7</button>' +
            '</div>';
          }).join('');
          var attachFiles = !!w.attach_files;
          return '' +
            '<div class="config-webhook-row" data-i="' + i + '">' +
              '<div class="config-webhook-main">' +
                '<input class="config-input config-webhook-url" data-webhook-url="' + i + '" type="url" value="' + escapeHtml(w.url) + '" placeholder="https://…">' +
                '<label class="config-webhook-ev"><input type="checkbox" data-webhook-ev="' + i + '" value="conceived" ' + (allEv || hasC ? 'checked' : '') + '> conceived</label>' +
                '<label class="config-webhook-ev"><input type="checkbox" data-webhook-ev="' + i + '" value="ready"     ' + (allEv || hasR ? 'checked' : '') + '> ready</label>' +
                '<label class="config-webhook-ev" title="Send minted image + .soul as Discord-style multipart attachments on conceived events"><input type="checkbox" data-webhook-attach="' + i + '" ' + (attachFiles ? 'checked' : '') + '> attach files</label>' +
                '<button class="config-btn config-webhook-del" data-webhook-del="' + i + '" title="Remove webhook">\u00d7</button>' +
              '</div>' +
              '<details class="config-webhook-hdrs-section" ' + (hCount > 0 ? 'open' : '') + '>' +
                '<summary>Headers (' + hCount + ')</summary>' +
                '<div class="config-webhook-hdrs-list">' + headersRowsHtml + '</div>' +
                '<button class="config-btn config-webhook-hdr-add" data-webhook-hdr-add="' + i + '">+ Add header</button>' +
              '</details>' +
              '<div class="config-webhook-tmpl">' +
                '<label class="config-webhook-tmpl-label">Body template:' +
                  ' <select class="config-input config-webhook-preset" data-webhook-preset="' + i + '">' +
                    '<option value="raw"' + (presetKey === 'raw' ? ' selected' : '') + '>Raw (generic JSON)</option>' +
                    '<option value="discord"' + (presetKey === 'discord' ? ' selected' : '') + '>Discord</option>' +
                    '<option value="slack"' + (presetKey === 'slack' ? ' selected' : '') + '>Slack</option>' +
                    '<option value="custom"' + (presetKey === 'custom' ? ' selected' : '') + ' disabled>Custom (edited)</option>' +
                  '</select>' +
                '</label>' +
                '<textarea class="config-input config-webhook-tmpl-input" data-webhook-tmpl="' + i + '" rows="3" placeholder="Empty = raw POST. JSON template with {{event}}, {{identifier}}, {{content_hash}}, {{url}} (primary surface), {{distribution}} (all surfaces, multiline), {{constellation}}, {{constellation_star}}, {{rarity_tier}}, {{rarity_score}}, {{creator_name}}, {{key_fingerprint}}, {{chain_id}}, {{chain_visibility}}, {{gps_source}}, {{mint_url}}, {{image_name}}.">' + escapeHtml(tmpl) + '</textarea>' +
              '</div>' +
            '</div>';
        }).join('');

    host.innerHTML =
      '<div class="config-field-label" style="margin-bottom:0.3rem;">Webhooks (' + list.length + ')</div>' +
      '<div class="config-webhooks-list">' + rowsHtml + '</div>' +
      '<div class="config-row" style="margin-top:0.5rem;">' +
        '<button class="config-btn" id="configWebhookAdd">+ Add webhook</button>' +
        '<button class="config-btn config-btn-primary" id="configWebhookSave" ' + (_webhooksDirty ? '' : 'disabled') + '>Save</button>' +
        '<button class="config-btn" id="configWebhookCancel" ' + (_webhooksDirty ? '' : 'disabled') + '>Cancel</button>' +
      '</div>' +
      '<p class="config-note">Webhooks fire on <code>conceived</code> (image minted) and <code>ready</code> (GPS capture link generated). Custom auth headers (Discord bot token, etc.) require editing <code>~/.mememage/server.json</code> directly — they\u2019re preserved here across saves but not editable from the dashboard.</p>';

    // Wire row controls
    host.querySelectorAll('[data-webhook-url]').forEach(function(inp) {
      inp.addEventListener('input', function() {
        var i = parseInt(inp.getAttribute('data-webhook-url'), 10);
        _webhooksDraft[i].url = inp.value;
        _webhooksDirty = true;
        // Don't re-render — that would steal focus mid-typing. Just
        // mark dirty and update the Save/Cancel button state.
        markWebhooksDirty();
      });
    });
    host.querySelectorAll('[data-webhook-ev]').forEach(function(cb) {
      cb.addEventListener('change', function() {
        var i = parseInt(cb.getAttribute('data-webhook-ev'), 10);
        var ev = cb.value;
        var arr = _webhooksDraft[i].events || [];
        // Treat the canonical event set as the implicit "all". If both
        // boxes are ticked we store [] (matches the firing-loop default
        // and keeps server.json compact).
        var has = arr.indexOf(ev) >= 0;
        if (cb.checked && !has) arr.push(ev);
        else if (!cb.checked && has) arr.splice(arr.indexOf(ev), 1);
        _webhooksDraft[i].events = arr;
        _webhooksDirty = true;
        markWebhooksDirty();
      });
    });
    host.querySelectorAll('[data-webhook-attach]').forEach(function(cb) {
      cb.addEventListener('change', function() {
        var i = parseInt(cb.getAttribute('data-webhook-attach'), 10);
        _webhooksDraft[i].attach_files = cb.checked;
        _webhooksDirty = true;
        markWebhooksDirty();
      });
    });
    host.querySelectorAll('[data-webhook-del]').forEach(function(b) {
      b.addEventListener('click', function() {
        var i = parseInt(b.getAttribute('data-webhook-del'), 10);
        _webhooksDraft.splice(i, 1);
        _webhooksDirty = true;
        renderWebhooks();
      });
    });
    host.querySelectorAll('[data-webhook-tmpl]').forEach(function(ta) {
      ta.addEventListener('input', function() {
        var i = parseInt(ta.getAttribute('data-webhook-tmpl'), 10);
        _webhooksDraft[i].template = ta.value;
        _webhooksDirty = true;
        // Flip the preset dropdown to "Custom" when the user has
        // edited away from the preset — but only if it no longer
        // matches a known preset (so re-typing a preset verbatim
        // still reads as that preset). Same focus-preservation
        // reason as the URL input: don't re-render.
        var sel = host.querySelector('[data-webhook-preset="' + i + '"]');
        if (sel) {
          var match = 'custom';
          if (!ta.value) match = 'raw';
          else for (var pk in WEBHOOK_PRESETS) {
            if (WEBHOOK_PRESETS[pk] === ta.value) { match = pk; break; }
          }
          // The "Custom (edited)" option is disabled in markup so the
          // user can't pick it directly; enable it just-in-time when
          // we need to select it programmatically.
          if (match === 'custom') {
            var customOpt = sel.querySelector('option[value="custom"]');
            if (customOpt) customOpt.disabled = false;
          }
          sel.value = match;
        }
        markWebhooksDirty();
      });
    });
    host.querySelectorAll('[data-webhook-preset]').forEach(function(sel) {
      sel.addEventListener('change', function() {
        var i = parseInt(sel.getAttribute('data-webhook-preset'), 10);
        var key = sel.value;
        if (key === 'custom') return; // disabled, but defensive
        var tmpl = WEBHOOK_PRESETS[key] || '';
        _webhooksDraft[i].template = tmpl;
        _webhooksDirty = true;
        // Re-render this row's textarea content. Full re-render is
        // overkill but cheap, and the preset is a deliberate one-shot
        // action so focus loss is acceptable.
        renderWebhooks();
      });
    });
    // Header editor: key/value inputs, +Add, delete. The draft stores
    // headers as a dict for transport, but the UI renders them in
    // sorted-key order so the row positions match the data-attr index.
    function _syncHeadersForRow(i) {
      var row = host.querySelector('.config-webhook-row[data-i="' + i + '"]');
      if (!row) return;
      var dict = {};
      var keys = row.querySelectorAll('[data-webhook-hdr-key^="' + i + ':"]');
      var vals = row.querySelectorAll('[data-webhook-hdr-val^="' + i + ':"]');
      for (var hi = 0; hi < keys.length; hi++) {
        var k = (keys[hi].value || '').trim();
        var v = (vals[hi] ? vals[hi].value : '');
        if (k) dict[k] = v;
      }
      _webhooksDraft[i].headers = dict;
      _webhooksDirty = true;
      markWebhooksDirty();
    }
    host.querySelectorAll('[data-webhook-hdr-key]').forEach(function(inp) {
      inp.addEventListener('input', function() {
        var i = parseInt(inp.getAttribute('data-webhook-hdr-key').split(':')[0], 10);
        _syncHeadersForRow(i);
      });
    });
    host.querySelectorAll('[data-webhook-hdr-val]').forEach(function(inp) {
      inp.addEventListener('input', function() {
        var i = parseInt(inp.getAttribute('data-webhook-hdr-val').split(':')[0], 10);
        _syncHeadersForRow(i);
      });
    });
    host.querySelectorAll('[data-webhook-hdr-del]').forEach(function(b) {
      b.addEventListener('click', function() {
        var parts = b.getAttribute('data-webhook-hdr-del').split(':');
        var i = parseInt(parts[0], 10);
        var hi = parseInt(parts[1], 10);
        var hdrs = _webhooksDraft[i].headers || {};
        var sortedKeys = Object.keys(hdrs).sort();
        var keyToDelete = sortedKeys[hi];
        if (keyToDelete !== undefined) {
          delete hdrs[keyToDelete];
          _webhooksDirty = true;
          renderWebhooks();
        }
      });
    });
    host.querySelectorAll('[data-webhook-hdr-add]').forEach(function(b) {
      b.addEventListener('click', function() {
        var i = parseInt(b.getAttribute('data-webhook-hdr-add'), 10);
        // Insert a placeholder row using a sentinel key that won't
        // clash with a real header name. _syncHeadersForRow rewrites
        // the dict on first edit and the sentinel disappears.
        _webhooksDraft[i].headers = _webhooksDraft[i].headers || {};
        _webhooksDraft[i].headers['\u00a0new-' + Date.now()] = '';
        _webhooksDirty = true;
        renderWebhooks();
      });
    });
    var addBtn = document.getElementById('configWebhookAdd');
    if (addBtn) addBtn.addEventListener('click', function() {
      _webhooksDraft.push({url: '', events: [], headers: {}});
      _webhooksDirty = true;
      renderWebhooks();
      // Focus the newly-added URL input so the user can start typing.
      var inputs = host.querySelectorAll('[data-webhook-url]');
      if (inputs.length) inputs[inputs.length - 1].focus();
    });
    var saveBtn = document.getElementById('configWebhookSave');
    if (saveBtn) saveBtn.addEventListener('click', saveWebhooks);
    var cancelBtn = document.getElementById('configWebhookCancel');
    if (cancelBtn) cancelBtn.addEventListener('click', function() {
      _webhooksDirty = false;
      _webhooksDraft = null;
      refresh();
    });
  }

  // Toggle Save/Cancel disabled state without re-rendering the whole
  // editor (avoid stealing focus mid-input).
  function markWebhooksDirty() {
    var save = document.getElementById('configWebhookSave');
    var cancel = document.getElementById('configWebhookCancel');
    if (save) save.disabled = !_webhooksDirty;
    if (cancel) cancel.disabled = !_webhooksDirty;
  }

  async function saveWebhooks() {
    // Strip empty-URL rows silently — they're staging artifacts from
    // an "Add" click the user abandoned. Validate the rest.
    var clean = (_webhooksDraft || []).filter(function(w) {
      return w.url && w.url.trim();
    });
    for (var i = 0; i < clean.length; i++) {
      if (!/^https?:\/\//.test(clean[i].url.trim())) {
        showError('Webhook ' + (i + 1) + ': URL must start with http:// or https://');
        return;
      }
    }
    showError('');
    var save = document.getElementById('configWebhookSave');
    if (save) { save.disabled = true; save.textContent = 'Saving\u2026'; }
    try {
      await fetchJson('/api/config/webhooks', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({webhooks: clean.map(function(w) {
          var out = {url: w.url.trim()};
          if (w.events && w.events.length) out.events = w.events;
          // Strip any sentinel placeholder keys left over from a
          // "+ Add header" click the user abandoned without typing.
          if (w.headers) {
            var realHeaders = {};
            Object.keys(w.headers).forEach(function(k) {
              if (typeof k !== 'string') return;
              if (k.indexOf('\u00a0new-') === 0) return;
              realHeaders[k] = w.headers[k];
            });
            if (Object.keys(realHeaders).length) out.headers = realHeaders;
          }
          if (w.template && w.template.trim()) out.template = w.template.trim();
          if (w.attach_files) out.attach_files = true;
          return out;
        })}),
      });
      _webhooksDirty = false;
      _webhooksDraft = null;
      await refresh();
    } catch (e) {
      showError('Webhook save failed: ' + e.message);
      if (save) { save.disabled = false; save.textContent = 'Save'; }
    }
  }

  // Credentials section was removed — channel-specific secrets now
  // live alongside their channels in the Channels section (write
  // directly to .env via the value input there). MINT_API_TOKEN moved
  // to the Server section. Power users who need other env vars
  // (MEMEMAGE_PASSWORD, anything not surfaced) edit .env directly.

  // renderEasterEgg removed: easter eggs are chain-dependent now,
  // configured per-chain via the Payload tab's frozen-entry editor.

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
      renderServer(data.server || {}, data.env || {});
      // Cache env presence so the Channels section's "set"/"unset"
      // dots can be accurate the first time it renders, even if
      // /api/config arrived before loadChannels' own fetch.
      _envPresence = data.env || {};
    } catch (e) {
      showError('Config load failed: ' + e.message);
    }
    // Chains + profiles + channels are separate endpoints; load them
    // after the main config so the identity section's "active profile"
    // label can reflect any switch that just happened.
    await Promise.all([loadChains(), loadProfiles(), loadChannels()]);
  }

  // ----- Profiles section -----------------------------------------------
  //
  // The Profiles section displays every Ed25519 identity living under
  // ~/.mememage/profiles/, marks the active one, and exposes
  // switch / new / import / alias / remove operations. Identity links
  // between profiles (one human, many keys) are forged via signed
  // alias records on IA — not by shared fingerprints. See
  // docs/plans/multi-key-profiles.md for the full design.

  async function loadProfiles() {
    if (!els.profiles) return;
    try {
      var data = await fetchJson('/api/profiles');
      renderProfiles(data.active, data.profiles || []);
    } catch (e) {
      els.profiles.innerHTML = '<p class="config-field-empty">Could not load profiles: ' + escapeHtml(e.message) + '</p>';
    }
  }

  function renderProfiles(activeId, rows) {
    if (!els.profiles) return;
    var listHtml = rows.length === 0
      ? '<p class="config-field-empty">No profiles found.</p>'
      : rows.map(function(p) {
          var active = p.id === activeId;
          var fp = p.fingerprint || '(no key)';
          var name = p.name || '';
          var btns = '';
          if (!active) {
            btns += '<button class="config-btn config-profile-use" data-profile-use="' + escapeHtml(p.id) + '">Use</button>';
            btns += '<button class="config-btn config-profile-alias" data-profile-alias="' + escapeHtml(p.id) + '">Alias\u2026</button>';
            btns += '<button class="config-btn config-btn-danger config-profile-remove" data-profile-remove="' + escapeHtml(p.id) + '">Remove\u2026</button>';
          }
          // Alias chips — one per linked profile. Bidirectional uses
          // ↔ glyph + green tint; one-way uses → + muted tint.
          // Unknown-locally siblings (alias points at a fingerprint
          // not in our local profile list) render with the truncated
          // fingerprint instead of an id.
          var aliasChips = '';
          if (p.aliases && p.aliases.length) {
            aliasChips = '<div class="config-profile-alias-row">' +
              '<span class="config-profile-alias-label">linked:</span>' +
              p.aliases.map(function(a) {
                var label = a.other_id ||
                  (a.other_fingerprint_clean ? a.other_fingerprint_clean.slice(0, 8) + '\u2026' : '?');
                var glyph = a.bidirectional ? '\u2194' : '\u2192';  // ↔ or →
                var cls = a.bidirectional ? 'config-alias-bi' : 'config-alias-oneway';
                var title = a.bidirectional
                  ? 'Bidirectional — both keys have signed the link'
                  : 'One-way — this profile has signed the link; the other side has not signed back';
                return '<span class="config-alias-chip ' + cls + '" title="' + title + '">' +
                  '<span class="config-alias-glyph">' + glyph + '</span>' +
                  escapeHtml(label) +
                '</span>';
              }).join('') +
            '</div>';
          }
          return '' +
            '<div class="config-profile-row" data-active="' + (active ? '1' : '0') + '">' +
              '<span class="config-profile-dot"></span>' +
              '<span class="config-profile-id">' + escapeHtml(p.id) + '</span>' +
              '<span class="config-profile-fp">' + escapeHtml(fp) + '</span>' +
              '<span class="config-profile-name">' + escapeHtml(name) + '</span>' +
              '<span class="config-profile-state">' + (active ? 'active' : '') + '</span>' +
              '<span class="config-profile-actions">' + btns + '</span>' +
              aliasChips +
            '</div>';
        }).join('');

    els.profiles.innerHTML =
      '<div class="config-profile-list">' + listHtml + '</div>' +
      '<div class="config-row" style="margin-top:0.5rem;">' +
      '  <button class="config-btn" id="configProfileNewBtn">+ New profile</button>' +
      '  <button class="config-btn" id="configProfileImportBtn">Import existing key\u2026</button>' +
      '  <button class="config-btn" id="configProfilePairBtn">Pair with another mememage\u2026</button>' +
      '</div>' +
      '<div id="configProfileDanger" class="config-danger-zone" style="display:none;"></div>' +
      '<p class="config-note">One profile is active at a time \u2014 that\u2019s the key signing the next mint. Different machines can carry their own profile so a remote host never sees your primary identity. To link two profiles into one human identity, use <strong>Alias</strong> from each side, or <strong>Pair</strong> for a one-click cross-host handshake (each side keeps its private key, only public keys move).</p>';

    // Wire row actions
    els.profiles.querySelectorAll('[data-profile-use]').forEach(function(b) {
      b.addEventListener('click', function() { switchProfile(b.getAttribute('data-profile-use')); });
    });
    els.profiles.querySelectorAll('[data-profile-alias]').forEach(function(b) {
      b.addEventListener('click', function() { openAliasConfirm(b.getAttribute('data-profile-alias')); });
    });
    els.profiles.querySelectorAll('[data-profile-remove]').forEach(function(b) {
      b.addEventListener('click', function() { openRemoveConfirm(b.getAttribute('data-profile-remove')); });
    });
    document.getElementById('configProfileNewBtn').addEventListener('click', openNewProfile);
    document.getElementById('configProfileImportBtn').addEventListener('click', openImportProfile);
    document.getElementById('configProfilePairBtn').addEventListener('click', openPairFlow);
  }

  // Pair-with-another-mememage modal. Cross-host key exchange in one
  // click: this host calls the peer, peer accepts (auto if peer_token
  // matches), both sides save each other's pubkey and sign their own
  // alias to the other. Bidirectional in one round-trip.
  function openPairFlow() {
    var host = document.getElementById('configProfileDanger');
    if (!host) return;
    host.style.display = 'block';
    host.innerHTML =
      '<div class="config-pair-form">' +
      '  <p class="config-pair-head">Pair with another mememage server</p>' +
      '  <p class="config-note">Enter the peer\u2019s dashboard URL and its API token. Both sides will sign aliases naming each other; the link becomes bidirectional in one round-trip. Neither side\u2019s private key leaves its host.</p>' +
      '  <div class="config-field">' +
      '    <span class="config-field-label">Peer URL</span>' +
      '    <input class="config-input" id="configPairUrl" type="text" placeholder="https://160.153.182.117:8444">' +
      '  </div>' +
      '  <div class="config-field">' +
      '    <span class="config-field-label">Peer token</span>' +
      '    <input class="config-input" id="configPairToken" type="password" autocomplete="off" placeholder="peer\u2019s MINT_API_TOKEN">' +
      '  </div>' +
      '  <div class="config-field">' +
      '    <span class="config-field-label">Save as</span>' +
      '    <input class="config-input" id="configPairId" type="text" placeholder="(optional — peer\u2019s own profile id by default)">' +
      '  </div>' +
      '  <label class="config-pair-checkbox">' +
      '    <input type="checkbox" id="configPairSelfSigned"> Accept self-signed cert (for peers using the bundled tls helper)' +
      '  </label>' +
      '  <div class="config-row" style="margin-top:0.6rem;">' +
      '    <button class="config-btn config-btn-primary" id="configPairSubmit">Pair</button>' +
      '    <button class="config-btn" id="configPairCancel">Cancel</button>' +
      '  </div>' +
      '  <p class="config-note" id="configPairStatus" style="margin-top:0.4rem;"></p>' +
      '</div>';
    document.getElementById('configPairCancel').addEventListener('click', closePairFlow);
    document.getElementById('configPairSubmit').addEventListener('click', submitPair);
  }
  function closePairFlow() {
    var host = document.getElementById('configProfileDanger');
    if (host) { host.style.display = 'none'; host.innerHTML = ''; }
  }
  async function submitPair() {
    var url   = (document.getElementById('configPairUrl').value || '').trim();
    var token = (document.getElementById('configPairToken').value || '').trim();
    var pid   = (document.getElementById('configPairId').value || '').trim();
    var ssc   = document.getElementById('configPairSelfSigned').checked;
    var statusEl = document.getElementById('configPairStatus');
    var submit = document.getElementById('configPairSubmit');
    if (!url) { statusEl.textContent = 'Peer URL required.'; return; }
    submit.disabled = true;
    statusEl.textContent = 'Calling peer…';
    statusEl.style.color = '';
    try {
      var resp = await fetch('/api/profiles/pair-call', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          peer_url: url,
          peer_token: token,
          peer_id: pid || undefined,
          accept_self_signed: ssc,
        }),
      });
      var text = await resp.text();
      var data; try { data = text ? JSON.parse(text) : {}; } catch (e) { data = {}; }
      if (!resp.ok) {
        statusEl.style.color = '#b04040';
        // Network errors carry a richer hint (NAT/Tailscale advice).
        // Render the error + hint as two lines so the actionable
        // guidance reads as guidance, not noise.
        if (data.network_error && data.hint) {
          statusEl.innerHTML =
            '<strong>' + escapeHtml(data.error || 'Peer unreachable.') + '</strong>' +
            '<br><span style="color:#54545c;font-style:italic;">' +
              escapeHtml(data.hint) +
            '</span>';
        } else {
          statusEl.textContent = data.error || ('Pair failed (HTTP ' + resp.status + ').');
        }
        submit.disabled = false;
        return;
      }
      statusEl.style.color = '#155030';
      statusEl.textContent = 'Paired with ' + (data.peer_creator_name || data.peer_profile_id || 'peer') +
                             ' (' + (data.peer_fingerprint || '') + '). Refreshing\u2026';
      setTimeout(function() {
        closePairFlow();
        loadProfiles();
      }, 1200);
    } catch (e) {
      statusEl.style.color = '#b04040';
      statusEl.textContent = 'Pair request failed: ' + e.message;
      submit.disabled = false;
    }
  }

  async function switchProfile(id) {
    showError('');
    try {
      await fetchJson('/api/profiles/active', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({id: id}),
      });
      await refresh();
    } catch (e) {
      showError('Switch failed: ' + e.message);
    }
  }

  // Inline forms render into #configProfileDanger so the user sees
  // them next to the affected profile, not in a modal floating over
  // the page. Same pattern as the identity rotate/revoke danger zone.
  function openNewProfile() {
    var zone = document.getElementById('configProfileDanger');
    zone.style.display = '';
    zone.innerHTML =
      '<h4>Generate new profile</h4>' +
      '<p>Creates a fresh Ed25519 keypair under <code>~/.mememage/profiles/&lt;id&gt;/</code> and switches it active. Identity links between profiles are created later via <strong>Alias</strong> \u2014 nothing crosses over automatically.</p>' +
      '<div class="config-field"><span class="config-field-label">Profile id</span>' +
      '  <input class="config-input" id="configProfileNewId" type="text" placeholder="vps-prod / laptop / scratch" autocomplete="off">' +
      '</div>' +
      '<div class="config-field"><span class="config-field-label">Creator name</span>' +
      '  <input class="config-input" id="configProfileNewName" type="text" placeholder="(embedded in signed records)">' +
      '</div>' +
      '<div class="config-row">' +
      '  <button class="config-btn config-btn-primary" id="configProfileNewGo">Generate</button>' +
      '  <button class="config-btn" id="configProfileNewCancel">Cancel</button>' +
      '</div>' +
      '<div id="configProfileNewStatus" class="config-note"></div>';
    document.getElementById('configProfileNewGo').addEventListener('click', doNewProfile);
    document.getElementById('configProfileNewCancel').addEventListener('click', closeProfileDanger);
  }

  async function doNewProfile() {
    var idEl = document.getElementById('configProfileNewId');
    var nameEl = document.getElementById('configProfileNewName');
    var statusEl = document.getElementById('configProfileNewStatus');
    var btn = document.getElementById('configProfileNewGo');
    var pid = (idEl.value || '').trim();
    if (!pid) {
      statusEl.textContent = 'Profile id required.';
      statusEl.style.color = '#b04040';
      return;
    }
    statusEl.textContent = 'Generating\u2026'; statusEl.style.color = '';
    btn.disabled = true;
    try {
      await fetchJson('/api/profiles', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({id: pid, name: nameEl.value.trim()}),
      });
      closeProfileDanger();
      await refresh();
    } catch (e) {
      statusEl.textContent = 'Failed: ' + e.message;
      statusEl.style.color = '#b04040';
      btn.disabled = false;
    }
  }

  function openImportProfile() {
    var zone = document.getElementById('configProfileDanger');
    zone.style.display = '';
    zone.innerHTML =
      '<h4>Import existing key</h4>' +
      '<p>Imports a standard Ed25519 private key (the same format <code>openssl genpkey -algorithm Ed25519</code> or <code>ssh-keygen -t ed25519</code> produce) as a new profile. The file stays where you point at it \u2014 we read it once and copy it into the profile directory under your selected id. Does NOT switch the active profile.</p>' +
      '<div class="config-field"><span class="config-field-label">Profile id</span>' +
      '  <input class="config-input" id="configProfileImportId" type="text" placeholder="laptop / vps-prod / friend-host" autocomplete="off">' +
      '</div>' +
      '<div class="config-field"><span class="config-field-label">Creator name</span>' +
      '  <input class="config-input" id="configProfileImportName" type="text" placeholder="(embedded in signed records)">' +
      '</div>' +
      '<div class="config-field config-field-with-browse">' +
      '  <span class="config-field-label">Key file</span>' +
      '  <input class="config-input" id="configProfileImportPath" type="text" placeholder="Path to private key on this server">' +
      '  <button class="config-btn" id="configProfileImportBrowse" data-fs-browse>Browse\u2026</button>' +
      '</div>' +
      '<div class="config-row">' +
      '  <button class="config-btn config-btn-primary" id="configProfileImportGo">Import</button>' +
      '  <button class="config-btn" id="configProfileImportCancel">Cancel</button>' +
      '</div>' +
      '<div id="configProfileImportStatus" class="config-note"></div>';
    document.getElementById('configProfileImportBrowse').addEventListener('click', async function() {
      try {
        var path = await window.FilePicker.pick({type: 'file', initDir: '~/.ssh'});
        if (path) document.getElementById('configProfileImportPath').value = path;
      } catch (e) {
        showError('File picker failed: ' + e.message);
      }
    });
    document.getElementById('configProfileImportGo').addEventListener('click', doImportProfile);
    document.getElementById('configProfileImportCancel').addEventListener('click', closeProfileDanger);
  }

  async function doImportProfile() {
    var pid = (document.getElementById('configProfileImportId').value || '').trim();
    var name = (document.getElementById('configProfileImportName').value || '').trim();
    var path = (document.getElementById('configProfileImportPath').value || '').trim();
    var statusEl = document.getElementById('configProfileImportStatus');
    var btn = document.getElementById('configProfileImportGo');
    if (!pid) { statusEl.textContent = 'Profile id required.'; statusEl.style.color = '#b04040'; return; }
    if (!path) { statusEl.textContent = 'Pick a key file first.'; statusEl.style.color = '#b04040'; return; }
    statusEl.textContent = 'Importing\u2026'; statusEl.style.color = '';
    btn.disabled = true;
    try {
      await fetchJson('/api/profiles/import', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({id: pid, name: name || null, key_path: path}),
      });
      closeProfileDanger();
      await refresh();
    } catch (e) {
      statusEl.textContent = 'Failed: ' + e.message;
      statusEl.style.color = '#b04040';
      btn.disabled = false;
    }
  }

  function openAliasConfirm(otherId) {
    var zone = document.getElementById('configProfileDanger');
    zone.style.display = '';
    zone.innerHTML =
      '<h4>Sign alias: active \u2192 ' + escapeHtml(otherId) + '</h4>' +
      '<p>The active profile signs a record naming <code>' + escapeHtml(otherId) + '</code> as a sibling alias, then publishes it to the Internet Archive. Verifiers walking either keychain see the link. <strong>For bidirectional confirmation</strong> (the strongest verifier signal), switch to <code>' + escapeHtml(otherId) + '</code> afterwards and alias back to the current active profile.</p>' +
      '<div class="config-field"><span class="config-field-label">Type <code>ALIAS</code> to confirm</span>' +
      '  <input class="config-input" id="configProfileAliasConfirm" type="text" autocomplete="off">' +
      '</div>' +
      '<div class="config-row">' +
      '  <button class="config-btn config-btn-primary" id="configProfileAliasGo">Sign + publish</button>' +
      '  <button class="config-btn" id="configProfileAliasCancel">Cancel</button>' +
      '</div>' +
      '<div id="configProfileAliasStatus" class="config-note"></div>';
    document.getElementById('configProfileAliasGo').addEventListener('click', function() {
      doAlias(otherId);
    });
    document.getElementById('configProfileAliasCancel').addEventListener('click', closeProfileDanger);
  }

  async function doAlias(otherId) {
    var confirmVal = (document.getElementById('configProfileAliasConfirm').value || '').trim();
    var statusEl = document.getElementById('configProfileAliasStatus');
    var btn = document.getElementById('configProfileAliasGo');
    if (confirmVal !== 'ALIAS') {
      statusEl.textContent = 'Type ALIAS exactly to confirm.';
      statusEl.style.color = '#b04040';
      return;
    }
    statusEl.textContent = 'Signing and publishing\u2026'; statusEl.style.color = '';
    btn.disabled = true;
    try {
      var res = await fetchJson('/api/profiles/alias', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({other_id: otherId, confirm: 'ALIAS'}),
      });
      statusEl.textContent = res.uploaded
        ? 'Alias published to ' + (res.keychain_id || '') + '.'
        : 'Signed locally but upload failed: ' + (res.upload_error || 'unknown error') + '. Retry via: mememage profile alias ' + otherId;
      statusEl.style.color = res.uploaded ? '#1a7a1a' : '#a06010';
    } catch (e) {
      statusEl.textContent = 'Failed: ' + e.message;
      statusEl.style.color = '#b04040';
      btn.disabled = false;
    }
  }

  function openRemoveConfirm(pid) {
    var zone = document.getElementById('configProfileDanger');
    zone.style.display = '';
    zone.innerHTML =
      '<h4 style="color:#b04040;">Remove profile: ' + escapeHtml(pid) + '</h4>' +
      '<p>Archives <code>~/.mememage/profiles/' + escapeHtml(pid) + '/</code> under <code>profiles/.removed/' + escapeHtml(pid) + '-&lt;timestamp&gt;/</code>. Records signed by this profile\u2019s key still verify. To fully delete, remove the archive directory by hand.</p>' +
      '<div class="config-field"><span class="config-field-label">Type <code>REMOVE</code> to confirm</span>' +
      '  <input class="config-input" id="configProfileRemoveConfirm" type="text" autocomplete="off">' +
      '</div>' +
      '<div class="config-row">' +
      '  <button class="config-btn config-btn-danger" id="configProfileRemoveGo">Archive</button>' +
      '  <button class="config-btn" id="configProfileRemoveCancel">Cancel</button>' +
      '</div>' +
      '<div id="configProfileRemoveStatus" class="config-note"></div>';
    document.getElementById('configProfileRemoveGo').addEventListener('click', function() {
      doRemove(pid);
    });
    document.getElementById('configProfileRemoveCancel').addEventListener('click', closeProfileDanger);
  }

  async function doRemove(pid) {
    var confirmVal = (document.getElementById('configProfileRemoveConfirm').value || '').trim();
    var statusEl = document.getElementById('configProfileRemoveStatus');
    var btn = document.getElementById('configProfileRemoveGo');
    if (confirmVal !== 'REMOVE') {
      statusEl.textContent = 'Type REMOVE exactly to confirm.';
      statusEl.style.color = '#b04040';
      return;
    }
    btn.disabled = true;
    try {
      await fetchJson('/api/profiles/remove', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({id: pid, confirm: 'REMOVE'}),
      });
      closeProfileDanger();
      await refresh();
    } catch (e) {
      statusEl.textContent = 'Failed: ' + e.message;
      statusEl.style.color = '#b04040';
      btn.disabled = false;
    }
  }

  function closeProfileDanger() {
    var zone = document.getElementById('configProfileDanger');
    if (zone) { zone.style.display = 'none'; zone.innerHTML = ''; }
  }

  // ----- Channels section ---------------------------------------------
  //
  // Per the GoDaddy mental model: each channel is a type + credentials
  // + config + enabled/primary flags. The dashboard reads each
  // registered type's schema (CREDENTIAL_FIELDS / CONFIG_FIELDS) and
  // renders the form generically — new channel types appear here as
  // soon as the server registers them, no dashboard code change
  // required. Edits write the full list back via POST /api/channels.

  var _channelTypes = null;  // cache of /api/channels/types response
  var _envPresence = {};     // env_var → bool, populated alongside loadChannels

  async function loadChannels() {
    var host = document.getElementById('configChannels');
    if (!host) return;
    try {
      // Load schemas first if not cached — needed to render the
      // per-channel field labels and the "+ Add channel" picker.
      if (!_channelTypes) {
        var typesResp = await fetchJson('/api/channels/types');
        _channelTypes = (typesResp.types || []).reduce(function(acc, t) {
          acc[t.type] = t;
          return acc;
        }, {});
      }
      // Channels section now also surfaces credential VALUES (write-
      // only — we never read them back, only presence). Fetch env
      // presence alongside the channels list so the per-field "set"
      // dots are accurate on first render.
      var data = await fetchJson('/api/channels');
      try {
        var cfg = await fetchJson('/api/config');
        _envPresence = cfg.env || {};
      } catch (_) { _envPresence = {}; }
      renderChannels(host, data.channels || []);
    } catch (e) {
      host.innerHTML = '<p class="config-field-empty">Could not load channels: ' + escapeHtml(e.message) + '</p>';
    }
  }

  function renderChannels(host, channels) {
    // Cache by index so saveChannelsFromDom() can recover each row's
    // type (not editable inline, so the DOM doesn't carry it).
    _lastChannelsByIdx = {};
    channels.forEach(function(c, i) { _lastChannelsByIdx[i] = c; });

    var rows = channels.map(function(c, i) { return _channelRow(c, i); }).join('');
    var addOptions = Object.keys(_channelTypes).map(function(t) {
      return '<option value="' + escapeHtml(t) + '">' + escapeHtml(_channelTypes[t].display_name) + '</option>';
    }).join('');

    host.innerHTML =
      (rows || '<p class="config-field-empty">No channels configured.</p>') +
      '<div class="config-channel-add">' +
      '  <select class="config-input config-channel-add-type" id="configChannelNewType">' +
      addOptions +
      '  </select>' +
      '  <input class="config-input config-channel-add-id" id="configChannelNewId" type="text" placeholder="channel id (e.g. ia-backup)">' +
      '  <button class="config-btn" id="configChannelAddBtn">+ Add channel</button>' +
      '</div>' +
      '<p class="config-note">The <strong>primary</strong> channel\u2019s URL becomes the bar\u2019s record link and the Discord notification target. Every enabled+configured channel receives a copy of the soul on every mint; at least one must succeed. Credentials always live in <code>.env</code> — fields below name the env var to read.</p>';

    // Wire row controls
    channels.forEach(function(c, i) {
      _wireChannelRow(host, c, i);
    });

    // Wire add-channel button
    var addBtn = document.getElementById('configChannelAddBtn');
    if (addBtn) addBtn.addEventListener('click', addChannel);
  }

  function _channelRow(c, idx) {
    var schema = _channelTypes[c.type];
    var displayName = schema ? schema.display_name : c.type;
    var statusBits = [];
    if (!c.type_known) statusBits.push('<span class="config-channel-status-warn">unknown type</span>');
    else if (!c.configured) statusBits.push('<span class="config-channel-status-warn">needs creds</span>');
    else statusBits.push('<span class="config-channel-status-ok">configured</span>');
    if (c.primary) statusBits.push('<span class="config-channel-status-primary">primary</span>');

    // Credential field rows — read-only env var name + override input
    var credFields = '';
    if (schema && schema.credential_fields) {
      credFields = schema.credential_fields.map(function(f) {
        // Resolve the actual env var this field writes to: the channel
        // may override the default name, otherwise fall back to the
        // schema's env_var. Same resolution the server uses.
        var envVar = (c.credentials || {})[f.name] || f.env_var;
        var isSet = !!_envPresence[envVar];
        var helpText = f.help ? ' \u00b7 ' + f.help : '';
        return '' +
          '<div class="config-channel-field">' +
            '<label class="config-channel-field-label">' + escapeHtml(f.label) + (f.secret ? ' \u2022' : '') +
              ' <span class="config-channel-field-state" data-set="' + (isSet ? '1' : '0') + '">' + (isSet ? 'set' : 'unset') + '</span>' +
            '</label>' +
            '<input class="config-input config-channel-field-input" data-channel-secret="' + escapeHtml(envVar) + '" type="password" autocomplete="off" ' +
                   'placeholder="' + (isSet ? '(set \u2014 type to replace)' : '(unset)') + '">' +
            '<span class="config-channel-field-hint">stored in env var <code>' + escapeHtml(envVar) + '</code>' + escapeHtml(helpText) + '</span>' +
          '</div>';
      }).join('');
    }

    // Config field rows — actual editable values, not env var refs.
    // Boolean fields render as a checkbox + inline label inside a
    // single row so the user can see the on/off state at a glance.
    // Text fields keep the stacked label/input layout used for
    // credential overrides.
    var cfgFields = '';
    if (schema && schema.config_fields) {
      cfgFields = schema.config_fields.map(function(f) {
        var val = (c.config || {})[f.name];
        if (val === undefined || val === null) val = (f.default !== undefined ? f.default : '');
        var isBool = (typeof val === 'boolean');
        if (isBool) {
          return '' +
            '<div class="config-channel-field config-channel-field-bool">' +
              '<label class="config-channel-field-checkbox">' +
                '<input type="checkbox" data-channel-cfg="' + escapeHtml(f.name) + '"' + (val ? ' checked' : '') + '>' +
                '<span>' + escapeHtml(f.label) + '</span>' +
              '</label>' +
              (f.help ? '<span class="config-channel-field-hint">' + escapeHtml(f.help) + '</span>' : '') +
            '</div>';
        }
        return '' +
          '<div class="config-channel-field">' +
            '<label class="config-channel-field-label">' + escapeHtml(f.label) + '</label>' +
            '<input class="config-input config-channel-field-input" data-channel-cfg="' + escapeHtml(f.name) + '" type="text" value="' + escapeHtml('' + val) + '">' +
            (f.help ? '<span class="config-channel-field-hint">' + escapeHtml(f.help) + '</span>' : '') +
          '</div>';
      }).join('');
    }

    return '' +
      '<div class="config-channel-row" data-channel-idx="' + idx + '" data-channel-id="' + escapeHtml(c.id) + '">' +
        '<div class="config-channel-head">' +
          '<span class="config-channel-name">' + escapeHtml(c.name || c.id) + '</span>' +
          '<span class="config-channel-type">' + escapeHtml(displayName) + ' \u00b7 id <code>' + escapeHtml(c.id) + '</code></span>' +
          '<span class="config-channel-status">' + statusBits.join(' ') + '</span>' +
        '</div>' +
        '<div class="config-channel-controls">' +
          '<label><input type="checkbox" data-channel-enabled' + (c.enabled ? ' checked' : '') + '> enabled</label>' +
          '<label><input type="radio" name="channelPrimary" data-channel-primary' + (c.primary ? ' checked' : '') + '> primary</label>' +
          '<button type="button" class="config-btn config-channel-remove" data-channel-remove>Remove</button>' +
        '</div>' +
        (credFields ? '<div class="config-channel-fields">' + credFields + '</div>' : '') +
        (cfgFields ? '<div class="config-channel-fields">' + cfgFields + '</div>' : '') +
      '</div>';
  }

  function _wireChannelRow(host, channel, idx) {
    var row = host.querySelector('[data-channel-idx="' + idx + '"]');
    if (!row) return;

    // Inputs that affect channels.json — enabled, primary, config
    // fields (data-channel-cfg). Saved via /api/channels on change.
    var channelInputs = row.querySelectorAll('[data-channel-enabled], [data-channel-primary], [data-channel-cfg]');
    channelInputs.forEach(function(inp) {
      inp.addEventListener('change', function() { saveChannelsFromDom(host); });
    });

    // Credential value inputs — write directly to .env via /api/config/env.
    // Trigger on blur (lose focus) + Enter so users can paste-and-tab.
    var secretInputs = row.querySelectorAll('[data-channel-secret]');
    secretInputs.forEach(function(inp) {
      function commit() {
        var v = inp.value;
        if (v === '') return;  // empty input = no-op (clear is via X button)
        var envVar = inp.getAttribute('data-channel-secret');
        setEnvSecret(envVar, v, row);
        inp.value = '';
      }
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
      });
    });

    var removeBtn = row.querySelector('[data-channel-remove]');
    if (removeBtn) {
      removeBtn.addEventListener('click', function() {
        if (!confirm('Remove channel "' + (channel.name || channel.id) + '"? Existing records that already shipped to it are unaffected; future mints will skip it.')) return;
        row.remove();
        saveChannelsFromDom(host);
      });
    }
  }

  async function setEnvSecret(envVar, value, row) {
    var ok = await _postEnvSecret(envVar, value);
    if (!ok) return;
    var inputEl = row.querySelector('[data-channel-secret="' + envVar + '"]');
    if (!inputEl) return;
    var fieldEl = inputEl.closest('.config-channel-field');
    _flipFieldStateToSet(fieldEl, inputEl);
  }

  async function setEnvSecretGlobal(envVar, value, fieldEl) {
    var ok = await _postEnvSecret(envVar, value);
    if (!ok) return;
    var inputEl = fieldEl && fieldEl.querySelector('input');
    _flipFieldStateToSet(fieldEl, inputEl);
  }

  // Flip the "unset" pill → "set" + refresh the placeholder so the
  // user has a visible confirmation that their secret committed.
  // Reused by both per-channel + global (Server section) flows.
  function _flipFieldStateToSet(fieldEl, inputEl) {
    if (!fieldEl) return;
    var stateEl = fieldEl.querySelector('.config-channel-field-state');
    if (stateEl) {
      stateEl.textContent = 'set';
      stateEl.setAttribute('data-set', '1');
    }
    if (inputEl) {
      inputEl.placeholder = '(set \u2014 type to replace)';
    }
  }

  async function _postEnvSecret(envVar, value) {
    var body = {};
    body[envVar] = value;
    try {
      var resp = await fetch('/api/config/env', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      var data = await resp.json().catch(function() { return {}; });
      if (!resp.ok) {
        showError(data.error || ('Env update failed (HTTP ' + resp.status + ').'));
        return false;
      }
      showError('');
      _envPresence[envVar] = true;
      return true;
    } catch (e) {
      showError('Env update failed: ' + e.message);
      return false;
    }
  }

  function saveChannelsFromDom(host) {
    var rows = host.querySelectorAll('.config-channel-row');
    var channels = [];
    rows.forEach(function(row) {
      var id = row.getAttribute('data-channel-id');
      // Look up the corresponding row's channel data — we re-derive
      // everything from the DOM so the user's in-flight edits are the
      // source of truth, not the last server snapshot.
      var enabled = !!row.querySelector('[data-channel-enabled]').checked;
      var primary = !!row.querySelector('[data-channel-primary]').checked;
      var typeEl = row.querySelector('[data-channel-name]');  // not used
      var displayName = (row.querySelector('.config-channel-name') || {}).textContent || id;
      // The type isn't editable inline; recover it from the previously
      // rendered list. The simplest path: peek at the data-channel-type
      // attribute we'll set below. For now, find it in the server's
      // last snapshot via _lastChannelsByIdx.
      var snapshot = _lastChannelsByIdx[row.getAttribute('data-channel-idx')];
      var type = snapshot ? snapshot.type : '';

      // Credentials map (env-var-name overrides) is preserved from the
      // last server snapshot — it's not editable from the UI anymore
      // (power-user concern; edit ~/.mememage/channels.json directly).
      var credentials = (snapshot && snapshot.credentials) || {};
      var config = {};
      row.querySelectorAll('[data-channel-cfg]').forEach(function(inp) {
        var k = inp.getAttribute('data-channel-cfg');
        if (inp.type === 'checkbox') {
          config[k] = !!inp.checked;
        } else {
          var v = inp.value;
          if (v !== '') config[k] = v;
        }
      });

      channels.push({
        id: id,
        type: type,
        name: displayName,
        enabled: enabled,
        primary: primary,
        credentials: credentials,
        config: config,
      });
    });
    return persistChannels(channels);
  }

  var _lastChannelsByIdx = {};

  async function persistChannels(channels) {
    try {
      var resp = await fetch('/api/channels', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({channels: channels}),
      });
      var text = await resp.text();
      var data; try { data = text ? JSON.parse(text) : {}; } catch (e) { data = {}; }
      if (!resp.ok) {
        showError(data.error || ('Channels save failed (HTTP ' + resp.status + ').'));
        loadChannels();  // revert UI to server truth
        return;
      }
      showError('');
      // Refresh so the configured/primary chips reflect the saved state.
      loadChannels();
    } catch (e) {
      showError('Channels save failed: ' + e.message);
    }
  }

  function addChannel() {
    var typeSel = document.getElementById('configChannelNewType');
    var idInp = document.getElementById('configChannelNewId');
    if (!typeSel || !idInp) return;
    var type = typeSel.value;
    var id = (idInp.value || '').trim();
    if (!id) {
      showError('Channel id required (e.g. "ia-backup", "my-server").');
      return;
    }
    // Build a fresh channel with schema defaults filled in.
    var schema = _channelTypes[type] || {};
    var config = {};
    (schema.config_fields || []).forEach(function(f) {
      if (f.default !== undefined) config[f.name] = f.default;
    });
    var newCh = {
      id: id,
      type: type,
      name: schema.display_name || id,
      enabled: false,    // off by default so the user can fill creds first
      primary: false,
      credentials: {},
      config: config,
    };
    // Append to current channels and persist
    var host = document.getElementById('configChannels');
    var existing = Object.values(_lastChannelsByIdx);
    existing.push(newCh);
    persistChannels(existing);
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
          var vis = c.visibility || 'light_energy';
          var pwSet = !!c.password_set;
          // Password state phrasing surfaces the contract for the user:
          // dark + no password is a configuration error; light + no
          // password is a valid public-everything mode; both with
          // passwords give partial/full sealing as appropriate.
          var pwLabel;
          if (vis === 'dark_matter') {
            pwLabel = pwSet ? '\u00b7 sealed' : '\u00b7 NEEDS PASSWORD';
          } else {
            pwLabel = pwSet ? '\u00b7 GPS sealed' : '\u00b7 public';
          }
          var gpsSource = c.gps_source || 'phone';
          var meta = vis + ' ' + pwLabel + (c.created_at ? ' \u00b7 ' + c.created_at.slice(0, 10) : '');
          var renameBtn = '<button class="config-btn" data-chain-action="rename" data-chain-id="' + escapeHtml(c.id) + '" data-chain-name="' + escapeHtml(c.name || c.id) + '" title="Change display name (visibility is locked at creation)">Rename</button>';
          var pwBtn = '<button class="config-btn" data-chain-action="password" data-chain-id="' + escapeHtml(c.id) + '" data-chain-vis="' + escapeHtml(vis) + '" data-pw-set="' + (pwSet ? '1' : '0') + '">' + (pwSet ? 'Change password\u2026' : 'Set password\u2026') + '</button>';
          var actions = isActive
            ? '<span class="config-chain-active-badge">active</span>' +
              renameBtn + pwBtn +
              '<button class="config-btn" data-chain-action="remove" data-chain-id="' + escapeHtml(c.id) + '" disabled title="Switch to a different chain first">Remove</button>'
            : '<button class="config-btn" data-chain-action="switch" data-chain-id="' + escapeHtml(c.id) + '">Switch</button>' +
              renameBtn + pwBtn +
              '<button class="config-btn" data-chain-action="remove" data-chain-id="' + escapeHtml(c.id) + '">Remove</button>';
          // GPS source radio: three modes, persisted to chain.json on
          // change. Kept inline with the chain row so the Mint tab can
          // stay "drop image here" — the source decision lives here,
          // once, per chain.
          var gpsRadio =
            '<div class="config-chain-gps" data-chain-id="' + escapeHtml(c.id) + '">' +
              '<span class="config-chain-gps-label">GPS source</span>' +
              '<label><input type="radio" name="gps-' + escapeHtml(c.id) + '" value="phone" ' +
                (gpsSource === 'phone' ? 'checked' : '') + ' data-chain-gps-set="' + escapeHtml(c.id) + '"> phone</label>' +
              '<label><input type="radio" name="gps-' + escapeHtml(c.id) + '" value="machine" ' +
                (gpsSource === 'machine' ? 'checked' : '') + ' data-chain-gps-set="' + escapeHtml(c.id) + '"> machine (approximate)</label>' +
              '<label><input type="radio" name="gps-' + escapeHtml(c.id) + '" value="none" ' +
                (gpsSource === 'none' ? 'checked' : '') + ' data-chain-gps-set="' + escapeHtml(c.id) + '"> none</label>' +
            '</div>';
          return '<div class="config-chain-row" data-active="' + (isActive ? '1' : '0') + '">' +
            '<span class="config-chain-active-mark">' + (isActive ? '\u25b6' : '') + '</span>' +
            '<span class="config-chain-id" title="' + escapeHtml(c.id) + '">' + escapeHtml(c.id) + '</span>' +
            '<span class="config-chain-meta" title="' + escapeHtml(c.name || '') + '">' +
              escapeHtml(c.name || '') + '<br><span class="config-chain-state" data-vis="' + escapeHtml(vis) + '" data-pw-set="' + (pwSet ? '1' : '0') + '">' + escapeHtml(meta) + '</span>' +
            '</span>' +
            '<span class="config-chain-actions">' + actions + '</span>' +
            '<span class="config-chain-gps-cell">' + gpsRadio + '</span>' +
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
      '  <div class="config-field"><span class="config-field-label">Password</span>' +
      '    <input class="config-input" id="configChainNewPw" type="password" autocomplete="off" placeholder="(optional for light, required for dark)"></div>' +
      '  <p class="config-note" id="configChainNewPwHint" style="margin-top:0;">' +
      '    Light + no password: every field public, including GPS. ' +
      '    Light + password: GPS sealed for personal time-lock; soul fields stay public. ' +
      '    Dark + password: soul + chunks sealed (viewers need this exact password to decrypt).' +
      '  </p>' +
      '  <p class="config-note config-chain-visibility-warning">\u26a0\ufe0f Visibility is permanent. Once you create the chain, you cannot switch between light and dark \u2014 visibility is baked into every record minted in it. The display name and password can be changed later; the ID and visibility cannot.</p>' +
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

    // Wire switch/remove/rename/password buttons.
    els.chains.querySelectorAll('[data-chain-action]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var action = btn.getAttribute('data-chain-action');
        var cid = btn.getAttribute('data-chain-id');
        if (action === 'switch') switchChain(cid);
        else if (action === 'remove') removeChain(cid);
        else if (action === 'rename') renameChain(cid, btn.getAttribute('data-chain-name') || '');
        else if (action === 'password') openChainPasswordEditor(
          cid,
          btn.getAttribute('data-chain-vis') || 'light_energy',
          btn.getAttribute('data-pw-set') === '1'
        );
      });
    });

    // GPS source radio handler — persist on change, optimistic UI.
    els.chains.querySelectorAll('input[data-chain-gps-set]').forEach(function(input) {
      input.addEventListener('change', function() {
        if (!input.checked) return;
        var cid = input.getAttribute('data-chain-gps-set');
        setChainGpsSource(cid, input.value);
      });
    });
  }

  async function setChainGpsSource(chainId, gpsSource) {
    try {
      var resp = await fetch('/api/chain/gps-source', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({chain_id: chainId, gps_source: gpsSource}),
      });
      var text = await resp.text();
      var data; try { data = text ? JSON.parse(text) : {}; } catch (e) { data = {}; }
      if (!resp.ok) {
        alert(data.error || ('Failed to set GPS source (HTTP ' + resp.status + ')'));
        loadChains();  // revert UI to server truth
      }
    } catch (e) {
      alert('Failed to set GPS source: ' + e.message);
      loadChains();
    }
  }

  // Per-chain password editor — inline form below the chain table.
  // Surfaces what the password does for the chain's visibility class:
  //
  //   Light  : optional. Without it the entire record (incl. GPS) is
  //            public. With it, GPS is sealed for personal time-lock.
  //   Dark   : required. Soul fields and chunks are sealed with it.
  //            Mints fail until configured.
  //
  // Stored under chain.json as `password` (file mode 0600). Never
  // round-tripped via the API — GET returns only `password_set`.
  function openChainPasswordEditor(chainId, visibility, currentlySet) {
    var host = document.getElementById('configChainBanner');
    // We reuse the chain banner slot for the editor; it's right below
    // the chain list and already styled.
    if (!host) return;
    host.hidden = false;
    host.style.background = 'rgba(255,255,255,0.5)';
    host.style.borderLeftColor = 'rgba(0,0,0,0.2)';
    host.style.color = '#1a1a20';
    var nature = visibility === 'dark_matter'
      ? '<strong>Dark chain</strong>: password seals the soul fields (prompt, born, rarity, …) AND the chunks. <strong>Required</strong> — mints fail without it. Viewers need this exact password to decrypt records.'
      : '<strong>Light chain</strong>: password is optional. Without it, every field (including GPS) is public. With it, GPS is sealed for your own time-lock unlock; the rest stays public.';
    host.innerHTML =
      '<h4 style="margin:0 0 0.3rem;font-size:0.78rem;letter-spacing:0.06em;text-transform:uppercase;">' + (currentlySet ? 'Change' : 'Set') + ' password \u2014 ' + escapeHtml(chainId) + '</h4>' +
      '<p style="font-size:0.72rem;margin:0 0 0.5rem;line-height:1.5;">' + nature + '</p>' +
      '<div class="config-field">' +
      '  <span class="config-field-label">New password</span>' +
      '  <input class="config-input" id="configChainPwInput" type="password" autocomplete="off" placeholder="' + (currentlySet ? 'type new password to change' : 'leave empty to skip') + '">' +
      '</div>' +
      '<div class="config-row">' +
      '  <button class="config-btn config-btn-primary" id="configChainPwSave">Save</button>' +
      (currentlySet ? '<button class="config-btn config-btn-danger" id="configChainPwClear">Clear stored password</button>' : '') +
      '  <button class="config-btn" id="configChainPwCancel">Cancel</button>' +
      '</div>' +
      '<p class="config-note" style="margin-top:0.4rem;">Stored locally in <code>~/.mememage/chains/' + escapeHtml(chainId) + '/chain.json</code> at 0600 perms (owner-only). Same threat model as your Ed25519 private key. To keep the password out of files entirely, leave this blank and set <code>MEMEMAGE_PASSWORD</code> in <code>.env</code> instead.</p>';
    var save = document.getElementById('configChainPwSave');
    var clear = document.getElementById('configChainPwClear');
    var cancel = document.getElementById('configChainPwCancel');
    save.addEventListener('click', function() {
      var val = document.getElementById('configChainPwInput').value;
      saveChainPassword(chainId, val);
    });
    if (clear) clear.addEventListener('click', function() {
      if (!window.confirm('Clear the stored password for ' + chainId + '? '
          + (visibility === 'dark_matter'
              ? 'Mints will fail until you set a new one (or pass MEMEMAGE_PASSWORD in env).'
              : 'Future records on this chain will be fully public.'))) return;
      saveChainPassword(chainId, '');
    });
    cancel.addEventListener('click', function() {
      host.hidden = true; host.innerHTML = '';
    });
  }

  async function saveChainPassword(chainId, password) {
    var host = document.getElementById('configChainBanner');
    var save = document.getElementById('configChainPwSave');
    if (save) { save.disabled = true; save.textContent = 'Saving\u2026'; }
    try {
      await fetchJson('/api/chain/password', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({chain_id: chainId, password: password || ''}),
      });
      if (host) { host.hidden = true; host.innerHTML = ''; }
      await loadChains();
    } catch (e) {
      showError('Password save failed: ' + e.message);
      if (save) { save.disabled = false; save.textContent = 'Save'; }
    }
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
    var pwEl   = document.getElementById('configChainNewPw');
    var chainId = idEl ? idEl.value.trim() : '';
    if (!chainId) { showError('Chain ID required.'); return; }
    var visibility = visEl ? visEl.value : 'light_energy';
    var name = nameEl ? nameEl.value.trim() : '';
    var password = pwEl ? pwEl.value : '';
    // Front-load the contract: Dark chains MUST have a password to
    // function. Catch this in the UI before the round-trip.
    if (visibility === 'dark_matter' && !password) {
      showError('Dark chains require a password. Set one now or pick Light visibility.');
      return;
    }
    showError('');
    try {
      await fetchJson('/api/chain/new', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({chain_id: chainId, name: name || chainId, visibility: visibility}),
      });
      // Two-step: create the chain, then set its password if one was
      // provided. Keeps the new-chain endpoint focused and lets us
      // reuse /api/chain/password for later edits.
      if (password) {
        try {
          await fetchJson('/api/chain/password', {
            method: 'POST', headers: authHeaders(),
            body: JSON.stringify({chain_id: chainId, password: password}),
          });
        } catch (e) {
          showError('Chain created but password save failed: ' + e.message + '. Set it via the row\u2019s "Set password\u2026" button.');
          await loadChains();
          return;
        }
      }
      await loadChains();
      showChainBanner('Created chain \u201c' + chainId + '\u201d.' + (password ? ' Password stored.' : ''));
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
