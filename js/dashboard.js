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
// =====================================================================
// CHAIN BADGE — global so all three tab IIFEs (Conceive / Payload /
// Config) render the identical badge. The dot color is the chain's
// readiness (ready/nopayload/pending/notready, from the server's
// _chain_readiness), shown with a word so it's never color-only.
// Mirrors server.py:_chain_badge_html. CSS: .chain-* in mememage.css.
// =====================================================================
window.ChainBadge = (function() {
  var WORD = { ready: 'Ready', nopayload: 'No payload', pending: 'Update pending', notready: 'Not ready' };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function word(st) { return WORD[st] || 'Unknown'; }
  function dot(st) { return '<span class="chain-dot" data-state="' + esc(st) + '"></span>'; }
  function chip(st) { return '<span class="chain-state-chip" data-state="' + esc(st) + '">' + word(st) + '</span>'; }
  // The chain's display title. Default everywhere EXCEPT Config is the
  // friendly name (falling back to the id when there's no separate name) —
  // showing both id + name is confusing; the id lives in Config. Pass
  // idAndName:true (Config only) to show the official id as the primary with
  // the friendly name on a second line.
  function primary(o) {
    return esc((o.name && o.name !== o.id) ? o.name : (o.id || '?'));
  }
  // Full stacked badge — Conceive + Payload banners + Config rows. label is an
  // optional eyebrow (e.g. "Target chain"); extra is HTML for the head row's
  // right cluster (e.g. Payload's lock/build).
  function full(o) {
    o = o || {};
    var vis = (o.visibility === 'dark_matter') ? 'dark' : 'light';
    var label = o.label ? '<span class="chain-badge-label">' + esc(o.label) + '</span>' : '';
    // Config: official id as primary + friendly name below. Elsewhere: friendly
    // name (or id fallback) as primary, no second line.
    var head = o.idAndName ? esc(o.id || '?') : primary(o);
    var sub = (o.idAndName && o.name && o.name !== o.id)
      ? '<span class="chain-badge-friendly">' + esc(o.name) + '</span>' : '';
    return '<div class="chain-badge">' + dot(o.readiness) +
      '<div class="chain-badge-body">' +
        '<div class="chain-badge-head">' +
          '<span class="chain-badge-official">' + head + '</span>' +
          '<span class="chain-badge-right">' +
            (o.extra || '') +
            '<span class="chain-vis">' + vis + '</span>' + chip(o.readiness) +
          '</span>' +
        '</div>' +
        (label ? '<div class="chain-badge-sub">' + label + '</div>' : '') +
        sub +
        (o.below || '') +
      '</div></div>';
  }
  // The chain badge. Bare = a stadium PILL (tickets, conception). When `below`
  // extras are passed (Payload presets, Config status), the SAME badge grows
  // into a rounded CARD that contains the header row + the extras within one
  // background — so the info reads as part of the badge, not floating beneath.
  // Shows the friendly name only; idAndName:true (Config) shows "id · name".
  function compact(o) {
    o = o || {};
    var tip = esc((o.id || '') + (o.name && o.name !== o.id ? ' · ' + o.name : ''));
    var vis = (o.visibility === 'dark_matter') ? 'dark' : 'light';
    var body = (o.idAndName && o.name && o.name !== o.id)
      ? '<span class="chain-badge-official">' + esc(o.id) + '</span>' +
        '<span class="chain-badge-sep">·</span>' +
        '<span class="chain-badge-friendly">' + esc(o.name) + '</span>'
      : '<span class="chain-badge-official">' + primary(o) + '</span>';
    var head =
      '<span class="chain-badge-head">' + dot(o.readiness) +
        '<span class="chain-badge-body">' + body + '</span>' +
        '<span class="chain-vis">' + vis + '</span>' + chip(o.readiness) +
      '</span>';
    var extra = o.below || '';
    var cls = 'chain-badge compact' + (extra ? ' has-extra' : '');
    return '<span class="' + cls + '" title="' + tip + '">' + head + extra + '</span>';
  }
  // Pill/card with an optional eyebrow label above it (e.g. "Target chain").
  function labeled(o) {
    o = o || {};
    var label = o.label ? '<div class="chain-badge-label">' + esc(o.label) + '</div>' : '';
    return '<div class="chain-badge-labeled">' + label + compact(o) + '</div>';
  }
  return { word: word, dot: dot, chip: chip, compact: compact, full: full, labeled: labeled };
})();

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
// Per-section open/closed state for the Config tab. <details> doesn't
// persist its open state across page loads by default. Wire it to
// localStorage so users who collapsed Server (or whichever section
// they rarely touch) get that state back on next reload.
// =====================================================================
(function() {
  var STORAGE_KEY = 'mememage-section-state';
  function _load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function _save(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  var state = _load();
  document.querySelectorAll('.config-section[data-section]').forEach(function(d) {
    var key = d.getAttribute('data-section');
    // Honor stored state if present; otherwise leave the HTML default
    // (every section starts open for fresh users — they should see
    // what's available before deciding to collapse).
    if (Object.prototype.hasOwnProperty.call(state, key)) {
      d.open = !!state[key];
    }
    d.addEventListener('toggle', function() {
      state[key] = d.open;
      _save(state);
    });
  });
})();

// =====================================================================
// Per-section "Advanced" toggles. The dashboard hides power-user
// controls (Scope, Pair, Push, Rotate, TLS paths, raw JSON, etc.)
// behind a per-section checkbox. State persists in localStorage so
// returning users keep their preference. Sections inherit
// data-show-advanced="true" on the parent <details> element, and
// CSS hides anything with .advanced-only unless the parent has it.
// =====================================================================
(function() {
  var STORAGE_KEY = 'mememage-advanced-sections';
  function _load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function _save(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  var state = _load();
  document.querySelectorAll('[data-advanced-toggle]').forEach(function(input) {
    var key = input.getAttribute('data-advanced-toggle');
    var section = input.closest('.config-section');
    if (!section) return;
    var on = !!state[key];
    input.checked = on;
    if (on) section.setAttribute('data-show-advanced', 'true');
    input.addEventListener('change', function() {
      var nowOn = input.checked;
      if (nowOn) section.setAttribute('data-show-advanced', 'true');
      else section.removeAttribute('data-show-advanced');
      state[key] = nowOn;
      _save(state);
    });
  });
})();

if (typeof TabBar !== 'undefined') {
  TabBar.wire(function(panelId) {
    if (panelId === 'tab-payload' && window.__loadPayloadTab) {
      window.__loadPayloadTab();
    }
    if (panelId === 'tab-config') {
      // First visit loads, subsequent tab activations refresh — picks
      // up profile changes pushed by external sources (CLI edits,
      // peers calling our pair endpoint, etc.) without a manual
      // reload.
      if (window.__loadConfigTab) window.__loadConfigTab();
      if (window.__refreshConfigTab) window.__refreshConfigTab();
    }
  });
}

// Window-visibility refresh: when the user tabs back to the dashboard
// and the Config tab is open, refetch. Covers the pair-receive case
// (another machine called our /api/profiles/pair while the user was
// away) and any other out-of-band change.
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState !== 'visible') return;
  var configPanel = document.getElementById('tab-config');
  if (configPanel && configPanel.classList.contains('active') && window.__refreshConfigTab) {
    window.__refreshConfigTab();
  }
});

// =====================================================================
// WELCOME CHECKLIST — first-run gating-step surface.
//
// Auto-shows when essential state is missing. Hides itself when every
// step is green. Returning users can re-open via a tiny "Setup
// checklist" link below the card. Each step row jumps to the right
// tab + scrolls to the relevant section.
// =====================================================================
(function() {
  var card = document.getElementById('welcomeCard');
  var reopen = document.getElementById('welcomeReopen');
  if (!card || !reopen) return;

  var stepsHost = document.getElementById('welcomeSteps');
  var dismissBtn = document.getElementById('welcomeCardDismiss');

  // Persisted: user explicitly closed the card via × — don't auto-pop
  // it back the next page load. The reopen link is still available.
  // Clears itself when everything's green (we no-op anyway in that
  // case) AND when the user opens via the reopen link.
  var DISMISS_KEY = 'mememage-welcome-dismissed';

  function _authHeaders() {
    var t = window._MINT_API_TOKEN || '';
    var h = {'Content-Type': 'application/json'};
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
  }

  function _escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  function _jumpTo(step) {
    // Activate the target tab via TabBar if it isn't already.
    if (typeof TabBar !== 'undefined' && step.tab) {
      var tab = document.querySelector('.input-tab[data-panel="' + step.tab + '"]');
      if (tab) tab.click();
    }
    // Scroll the anchor element into view if there is one. The Config
    // tab loads asynchronously on first visit, so give it a beat.
    if (step.anchor) {
      setTimeout(function() {
        var el = document.getElementById(step.anchor);
        if (el && el.scrollIntoView) {
          el.scrollIntoView({behavior: 'smooth', block: 'center'});
        }
      }, 250);
    }
  }

  function _render(steps, complete) {
    var html = steps.map(function(s) {
      var icon = s.done ? '\u2713' : '\u25CB';
      var rowCls = s.done ? 'welcome-step welcome-step-done' : 'welcome-step';
      return '<a href="#" class="' + rowCls + '" data-step-id="' + _escapeHtml(s.id) + '">' +
        '<span class="welcome-step-icon">' + icon + '</span>' +
        '<span class="welcome-step-label">' + _escapeHtml(s.label) + '</span>' +
        '<span class="welcome-step-detail">' + _escapeHtml(s.detail || '') + '</span>' +
      '</a>';
    }).join('');
    stepsHost.innerHTML = html;
    stepsHost.querySelectorAll('[data-step-id]').forEach(function(el) {
      el.addEventListener('click', function(ev) {
        ev.preventDefault();
        var id = el.getAttribute('data-step-id');
        var match = steps.find(function(s) { return s.id === id; });
        if (match) _jumpTo(match);
      });
    });
    // Show the card when there's anything left to do AND the user
    // hasn't explicitly dismissed it. Show the reopen link whenever
    // the card is hidden but there's still work — gives returning
    // users a way back in without scrolling for it.
    var dismissed = false;
    try { dismissed = localStorage.getItem(DISMISS_KEY) === '1'; } catch (e) {}
    if (complete) {
      card.hidden = true;
      reopen.hidden = true;
      try { localStorage.removeItem(DISMISS_KEY); } catch (e) {}
    } else if (dismissed) {
      card.hidden = true;
      reopen.hidden = false;
    } else {
      card.hidden = false;
      reopen.hidden = true;
    }
  }

  async function _load() {
    try {
      var resp = await fetch('/api/onboarding/status', { headers: _authHeaders() });
      if (!resp.ok) return;
      var data = await resp.json();
      _render(data.steps || [], !!data.complete);
    } catch (e) {
      // Silent — the card just stays hidden. The dashboard works
      // without the checklist.
    }
  }

  dismissBtn.addEventListener('click', function() {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch (e) {}
    card.hidden = true;
    reopen.hidden = false;
  });
  reopen.addEventListener('click', function(ev) {
    ev.preventDefault();
    try { localStorage.removeItem(DISMISS_KEY); } catch (e) {}
    _load();  // refetch in case state changed since last view
  });

  // Initial load.
  _load();

  // Refetch when the user returns to the dashboard tab (visibility) —
  // catches "user generated a key in another window" style cases.
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') _load();
  });

  // Also refetch on a slow cadence while the page is visible — same
  // 20s rhythm as the Config tab background poll. Cheap, catches any
  // state change that happens out-of-band (a peer pushes config, a
  // CLI mint completes).
  setInterval(function() {
    if (document.visibilityState === 'visible') _load();
  }, 20000);
})();

// Slow background poll while the Config tab is the active panel AND
// the document is visible. Catches out-of-band changes that visibility
// alone misses: a peer pushing config via /api/sync/accept, a CLI
// edit (mememage profile new from a terminal), a chain rename from
// another browser. 20s cadence is cheap and well below human "I did
// X, why don't I see it" patience.
setInterval(function() {
  if (document.visibilityState !== 'visible') return;
  var configPanel = document.getElementById('tab-config');
  if (configPanel && configPanel.classList.contains('active') && window.__refreshConfigTab) {
    window.__refreshConfigTab();
  }
}, 20000);

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
    resumeDelete:document.getElementById('mintResumeDelete'),
    gpsText:     document.getElementById('mintGpsText'),
    error:       document.getElementById('mintError'),
    globalError: document.getElementById('mintGlobalError'),
    conceive:    document.getElementById('mintConceive'),
    cancel:      document.getElementById('mintCancel'),
    deleteSession: document.getElementById('mintDeleteSession'),
    progressBody:document.getElementById('mintProgressBody'),
    resultHead:    document.getElementById('mintResultHead'),
    resultId:      document.getElementById('mintResultId'),
    resultHash:    document.getElementById('mintResultHash'),
    resultUrl:     document.getElementById('mintResultUrl'),
    resultUrlCopy: document.getElementById('mintResultUrlCopy'),
    resultUrlOpen: document.getElementById('mintResultUrlOpen'),
    resultChannels:     document.getElementById('mintResultChannels'),
    resultChannelsList: document.getElementById('mintResultChannelsList'),
    download:      document.getElementById('mintDownload'),
    downloadSoul:  document.getElementById('mintDownloadSoul'),
    again:         document.getElementById('mintAgain'),
    forecastBlock:    document.getElementById('mintForecastBlock'),
    forecastHeadline: document.getElementById('mintForecastHeadline'),
    forecastBody:     document.getElementById('mintForecastBody'),
    recentBlock:      document.getElementById('mintRecentBlock'),
    recentList:       document.getElementById('mintRecentList'),
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

  // JS-driven download for the Witnessed view's image + soul buttons.
  // Plain <a download> tags are unreliable on Safari (desktop and iOS,
  // especially against the self-signed VPS cert) — Safari often
  // navigates to the URL inline instead of saving. Fetching the bytes
  // and triggering an anchor click against a blob URL is deterministic.
  // Mirror of docs/js/conception.js:_wireBlobDownload; kept in-file
  // (not pulled into a shared util) because dashboard is the only
  // other surface with these buttons and a shared helper would mean
  // a new script load.
  function _wireBlobDownload(btn, srcUrl, filename) {
    if (!btn) return;
    // <a> tags carry their href to native browser action on click —
    // remove it so our onclick is the only path. Keep the visible
    // href for "Open in new tab" right-click affordance via a data attr.
    btn.removeAttribute('href');
    btn.removeAttribute('download');
    btn.setAttribute('role', 'button');
    btn.style.cursor = 'pointer';
    btn.dataset.fetchUrl = srcUrl;
    btn.onclick = async function(e) {
      if (e && e.preventDefault) e.preventDefault();
      var prev = btn.textContent;
      var prevAria = btn.getAttribute('aria-disabled') || '';
      btn.setAttribute('aria-disabled', 'true');
      btn.textContent = 'Preparing\u2026';
      try {
        var r = await fetch(srcUrl);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var blob = await r.blob();
        var ua = navigator.userAgent || '';
        var iosUA = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
        var androidUA = /Android/i.test(ua);
        var isImage = (blob.type || '').indexOf('image/') === 0;
        // Mobile non-iOS: try native share. Desktop and iOS: anchor
        // download (iOS save-to-Files via the download attribute is
        // reliable when the URL is a blob: scheme; the macOS Safari
        // share-sheet WEBP re-encoding only happens via navigator.share,
        // which we skip on desktop).
        if (isImage && androidUA && !iosUA) {
          try {
            var file = new File([blob], filename, { type: blob.type });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
              await navigator.share({ files: [file], title: 'Mememage' });
              btn.textContent = 'Shared';
              setTimeout(function() {
                btn.textContent = prev;
                btn.setAttribute('aria-disabled', prevAria);
              }, 1500);
              return;
            }
          } catch (shareErr) {
            if (shareErr && shareErr.name === 'AbortError') {
              btn.textContent = prev;
              btn.setAttribute('aria-disabled', prevAria);
              return;
            }
          }
        }
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
        setTimeout(function() {
          btn.textContent = prev;
          btn.setAttribute('aria-disabled', prevAria);
        }, 1500);
      } catch (err) {
        btn.textContent = 'Failed: ' + (err.message || err);
        setTimeout(function() {
          btn.textContent = prev;
          btn.setAttribute('aria-disabled', prevAria);
        }, 2500);
      }
    };
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
    // Pre-flight: the server refuses /api/mint/upload with 412 on an
    // unsealed chain (and 4xx on a Dark-no-password chain). Refuse here
    // too so the user doesn't watch a file upload only to fail server
    // side. _refreshMintGuardrails has already shown the explainer.
    if (state.chainSealed === false ||
        (state.chainVisibility === 'dark_matter' && !state.chainPasswordSet) ||
        state.chainNeedsUnlock) {
      _refreshMintGuardrails();
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

  // Click thumbnail → full-size lightbox overlay. Matches the
  // conception page + decoder ui.js:870 pattern so the creator can
  // verify image details before committing.
  if (els.thumb) {
    els.thumb.style.cursor = 'zoom-in';
    els.thumb.addEventListener('click', function() {
      if (!els.thumb.src) return;
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.88);display:flex;align-items:center;justify-content:center;cursor:pointer;padding:1.5rem;';
      var fullImg = document.createElement('img');
      fullImg.src = els.thumb.src;
      fullImg.style.cssText = 'max-width:92vw;max-height:92vh;object-fit:contain;border-radius:8px;box-shadow:0 4px 40px rgba(0,0,0,0.6);';
      overlay.appendChild(fullImg);
      overlay.addEventListener('click', function() { overlay.remove(); });
      document.addEventListener('keydown', function esc(e) {
        if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc); }
      });
      document.body.appendChild(overlay);
    });
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
      // Once the session has a token, swap the FileReader data-URL
      // for the streamed endpoint so the lightbox + thumbnail show
      // the full-resolution staged image instead of holding it all
      // in browser memory as base64. Server allows pending-state
      // image fetches.
      if (state.token) {
        els.thumb.src = '/api/mint/' + encodeURIComponent(state.token) + '/image';
      }
    } else {
      // Resume path — server provided filename + a 256x256 thumb
      // data URI as a fast first paint, but we then swap to the
      // full-res streamed endpoint so the lightbox isn't pixelated.
      els.filename.textContent = data.filename || '(unknown filename)';
      els.size.textContent = '';
      if (data.thumb_data_uri) els.thumb.src = data.thumb_data_uri;
      if (state.token) {
        var fullSrc = '/api/mint/' + encodeURIComponent(state.token) + '/image';
        var hiRes = new Image();
        hiRes.onload = function() { els.thumb.src = fullSrc; };
        hiRes.src = fullSrc;
      }
      renderMetaEditor();
    }
    // Pin the banner to the ticket's BOUND chain (server-stamped at
    // creation). Switching the active chain in Config must not change
    // where this conception lands, and the banner must reflect that.
    state.boundChain = data.chain || null;
    loadActiveChain(state.boundChain);
    applyHandoffUi();    // QR, URL, copy/open, ticket — same for every mode
    setState('reviewing');
    // New session just landed server-side (upload) or we just resumed
    // an existing one; either way the pending list is now stale.
    if (typeof window._mintReloadRecent === 'function') window._mintReloadRecent();
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
    // Local lock: if we know the session is no longer pending,
    // don't bother POSTing. Defends against keystrokes that arrived
    // after the poller flipped state.uiState to minting/completed
    // but before the editor finished disabling.
    if (state.uiState === 'minting' || state.uiState === 'result' || state.uiState === 'failure') {
      return;
    }
    var payload = {};
    var keys = Object.keys(state.metadata);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k === 'width' || k === 'height') continue;
      if (k.charAt(0) === '_') continue;
      payload[k] = state.metadata[k];
    }
    try {
      var resp = await fetch('/api/mint/' + state.token + '/metadata', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({metadata: payload}),
      });
      if (resp.status === 400) {
        // Server rejected the edit because the session already started
        // (phone POSTed GPS, mint pipeline is running). Lock the editor
        // immediately so further keystrokes don't queue up doomed
        // requests, surface a banner so the user understands their
        // late edits won't appear in the mint, and force a status poll
        // so the UI transitions to the minting spinner promptly.
        _lockMetaEditor('Conception started \u2014 late edits won\u2019t be included.');
        if (typeof pollMintStatus === 'function') pollMintStatus();
      }
    } catch (e) {
      console.warn('[mint] metadata sync failed', e);
    }
  }
  function _lockMetaEditor(message) {
    if (!els.metaEditor) return;
    var inputs = els.metaEditor.querySelectorAll('input, button');
    inputs.forEach(function(el) { el.disabled = true; });
    if (els.metaAdd) els.metaAdd.disabled = true;
    if (message) showError(message);
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
  state.chainSealed = null;  // tri-state: null = unknown, true/false once loaded

  // Chain badge helpers are global (window.ChainBadge) \u2014 see top of file \u2014
  // because they're called from three separate tab IIFEs.
  var chainStateWord = ChainBadge.word;
  var chainDotHtml = ChainBadge.dot;
  var chainStateChipHtml = ChainBadge.chip;
  var chainBadgeCompact = ChainBadge.compact;

  async function loadActiveChain(overrideId) {
    try {
      // overrideId pins the banner to a ticket's BOUND chain so it stays
      // correct even if the user switches the active chain in Config.
      var _url = '/api/chain/current' + (overrideId ? ('?chain=' + encodeURIComponent(overrideId)) : '');
      var resp = await fetch(_url, {headers: authHeaders()});
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var data = await resp.json();
      var id = data.id || '';
      var info = data.info || {};
      var name = info.name || '';
      var vis = info.visibility || 'light_energy';
      var pwSet = !!info.password_set;
      state.chainVisibility = vis;
      state.chainPasswordSet = pwSet;
      state.chainUnlocked = !!info.password_unlocked;
      state.chainNeedsUnlock = !!info.password_needs_unlock;
      // Render the chain badge — the at-a-glance "which chain + is it ok"
      // signal. "Target chain" eyebrow keeps the mint context obvious.
      if (els.chainBanner) {
        els.chainBanner.innerHTML = ChainBadge.labeled({
          id: id, name: name, visibility: vis,
          readiness: info.readiness, label: 'Target chain',
        });
      }
    } catch (e) {
      if (els.chainBanner) {
        els.chainBanner.innerHTML = '<div class="chain-badge"><div class="chain-badge-body">' +
          '<span class="chain-badge-official">(could not load active chain)</span></div></div>';
      }
      state.chainVisibility = null;
      state.chainPasswordSet = false;
    }
    // Seal check — the server refuses /api/mint/upload with 412 if no
    // Age has been sealed yet on this chain, so we have to refuse the
    // drop locally too. Tri-state until the fetch returns so we don't
    // flash a false "unsealed" badge on first load.
    try {
      var sealResp = await fetch('/api/site-pack/status', {headers: authHeaders()});
      if (sealResp.ok) {
        var sealInfo = await sealResp.json();
        state.chainSealed = !!(sealInfo && sealInfo.sealed);
      }
    } catch (e) { /* keep prior state; refresh will retry */ }
    _refreshMintGuardrails();
  }

  // Aggregates the pre-flight checks that block a clean mint and writes
  // the result to the mint tab's error slot + drop-zone state. Called
  // after loadActiveChain — any state that changes the answer should
  // call this directly afterwards. Single source of truth so the drop
  // zone and error message never disagree.
  function _refreshMintGuardrails() {
    var blocked = false;
    var msg = '';
    if (state.chainSealed === false) {
      blocked = true;
      msg = 'This chain has no sealed Age yet. Open the <strong>Payload</strong> tab and click <strong>Seal Age</strong> before conceiving — minting against an unsealed chain would produce a record with no Age number, no decoder_hash, and no chunks.';
    } else if (state.chainVisibility === 'dark_matter' && !state.chainPasswordSet) {
      blocked = true;
      msg = 'This chain is Dark but has no stored password — set it in <strong>Config \u2192 Chains</strong> before conceiving.';
    } else if (state.chainNeedsUnlock) {
      // Gated chain (verifier on disk) with no key held this session.
      // Offer an in-memory unlock here; the password is never written
      // to disk and is cleared on chain switch or server restart.
      blocked = true;
      msg = 'Chain is <strong>locked</strong>. Enter the chain password to conceive this session ' +
            '(held in memory only):' +
            '<div style="margin-top:6px;display:flex;gap:6px;align-items:center;max-width:360px;">' +
            '<input id="chainUnlockPw" type="password" autocomplete="off" placeholder="chain password" class="config-input" style="flex:1;min-width:0;">' +
            '<button id="chainUnlockBtn" class="config-btn" type="button">Unlock</button></div>';
    }
    if (els.drop) {
      els.drop.classList.toggle('mint-blocked', blocked);
      // Reuse the busy attr to grey-out + disable pointer events. The
      // existing CSS for [data-busy] already handles this; the only
      // user-visible difference is the cursor and the message below.
      if (blocked) {
        els.drop.setAttribute('aria-disabled', 'true');
      } else {
        els.drop.removeAttribute('aria-disabled');
      }
    }
    if (blocked) {
      showError(msg, {html: true});
      // If the message rendered the inline unlock form, wire it up.
      var ubtn = document.getElementById('chainUnlockBtn');
      if (ubtn) {
        ubtn.addEventListener('click', unlockActiveChain);
        var uinp = document.getElementById('chainUnlockPw');
        if (uinp) uinp.addEventListener('keydown', function(e){
          if (e.key === 'Enter') { e.preventDefault(); unlockActiveChain(); }
        });
      }
    } else {
      showError('');
    }
  }

  // Hold the active chain's password in the server's memory for this session
  // (rung-1 — never written to disk). Validated against the chain's verifier
  // server-side; a wrong password is rejected.
  async function unlockActiveChain() {
    var inp = document.getElementById('chainUnlockPw');
    var pw = inp ? inp.value : '';
    if (!pw) return;
    var btn = document.getElementById('chainUnlockBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Unlocking…'; }
    try {
      await fetchJson('/api/chain/unlock', {
        method: 'POST',
        body: JSON.stringify({password: pw}),
      });
      // Keep the banner pinned to a loaded ticket's bound chain.
      await loadActiveChain(state.token ? state.boundChain : undefined);
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Unlock'; }
      showError('Unlock failed: ' + (e && e.message ? e.message : 'wrong password'));
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
            showFailure(s.error || 'Conception failed');
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
    //
    // Route both buttons through _wireBlobDownload so the download
    // is JS-driven (fetch → blob → anchor click with explicit
    // filename) instead of a raw <a download>. Safari (desktop +
    // iOS, especially against the self-signed VPS cert) often
    // ignores the download attribute on plain anchors and navigates
    // to the URL inline, leaving the user with no actual file. The
    // blob path is deterministic — fetch returns the bytes, anchor
    // click with explicit download attribute saves with the right
    // name. Same fix the conception page uses.
    var imgUrl = s.download_url || ('/api/mint/' + state.token + '/image');
    _wireBlobDownload(els.download, imgUrl, (s.identifier || 'image') + '.png');
    // Soul download — points at our /api/mint/<token>/soul endpoint
    // which streams the local .soul file regardless of whether IA
    // received it. Works for both real mints (records/<id>.soul) and
    // dry-runs (records/dryrun/<id>.soul). Falls back to the IA URL
    // if the server didn't supply download_soul_url (older builds).
    if (els.downloadSoul) {
      els.downloadSoul.classList.remove('mint-action-disabled');
      els.downloadSoul.textContent = 'Download soul';
      els.downloadSoul.title = '';
      var soulUrl = s.download_soul_url || s.url || ('/api/mint/' + state.token + '/soul');
      _wireBlobDownload(els.downloadSoul, soulUrl, (s.identifier || 'soul') + '.soul');
    }
    // Dry-run badge in the Witnessed header
    if (els.resultHead) {
      els.resultHead.setAttribute('data-dry-run', s.dry_run ? '1' : '0');
    }
    // Per-channel blast result. Show the list only when the blast hit
    // more than one channel (or when at least one failed) — for a
    // single-channel mint the soul URL above is the only signal worth
    // surfacing. Failures get a red dot + the server's error text;
    // successes get a green dot + the channel's URL (clickable).
    if (els.resultChannels && els.resultChannelsList) {
      var dist = s.distribution || {};
      var distErr = s.distribution_errors || {};
      var ids = Object.keys(dist).concat(Object.keys(distErr));
      var seen = {};
      var rows = [];
      ids.forEach(function(id) {
        if (seen[id]) return;
        seen[id] = 1;
        if (Object.prototype.hasOwnProperty.call(dist, id)) {
          var url = dist[id];
          rows.push(
            '<li class="mint-result-channel mint-result-channel-ok">' +
            '<span class="mint-result-channel-status" aria-hidden="true">\u2713</span>' +
            '<span class="mint-result-channel-id">' + escapeHtml(id) + '</span>' +
            '<a class="mint-result-channel-url" href="' + escapeHtml(url) +
              '" target="_blank" rel="noopener">' + escapeHtml(url) + '</a>' +
            '</li>'
          );
        } else {
          rows.push(
            '<li class="mint-result-channel mint-result-channel-fail">' +
            '<span class="mint-result-channel-status" aria-hidden="true">\u2717</span>' +
            '<span class="mint-result-channel-id">' + escapeHtml(id) + '</span>' +
            '<span class="mint-result-channel-err" title="' + escapeHtml(distErr[id] || '') +
              '">' + escapeHtml(distErr[id] || 'failed') + '</span>' +
            '</li>'
          );
        }
      });
      var totalRows = rows.length;
      var hasFail = Object.keys(distErr).length > 0;
      // Suppress the block for trivial single-success blasts — the soul
      // URL above conveys it. Show it whenever there's a failure or more
      // than one channel involved.
      if (totalRows > 1 || hasFail) {
        els.resultChannelsList.innerHTML = rows.join('');
        els.resultChannels.hidden = false;
      } else {
        els.resultChannelsList.innerHTML = '';
        els.resultChannels.hidden = true;
      }
    }
    setState('done');
  }

  function showFailure(msg) {
    els.failedBody.textContent = msg;
    setState('failed');
  }

  function reset() {
    if (state.pollTimer) { clearTimeout(state.pollTimer); state.pollTimer = null; }
    // Non-destructive: just clear the local view and return to empty.
    // The server-side session lives on so the user can come back via
    // Resume or the pending list. Explicit Delete is the destructive
    // path (Cancel/× button in reviewing state, or the row × in the
    // pending list).
    state.token = null;
    state.metadata = null;
    state.mintUrl = '';
    state.gpsSource = null;
    state.qrDataUri = '';
    state.ticket = '';
    state.boundChain = null;  // no ticket loaded → banner follows the active chain again
    els.fileInput.value = '';
    if (els.resumeInput) els.resumeInput.value = '';
    if (els.resumeBtn) els.resumeBtn.disabled = false;
    showError('');
    setState('empty');
    // Refresh the pending-sessions list now that we've returned to
    // the empty state (the staged session, if any, is being deleted
    // server-side in the background).
    if (typeof window._mintReloadRecent === 'function') window._mintReloadRecent();
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
  if (els.deleteSession) {
    els.deleteSession.addEventListener('click', async function() {
      if (!state.token) { reset(); return; }
      if (!window.confirm(
        'Permanently delete this pending session? The staged image + ' +
        'metadata will be dropped server-side. This can\u2019t be undone.'
      )) return;
      var tok = state.token;
      els.deleteSession.disabled = true;
      try {
        await fetch('/api/mint/' + encodeURIComponent(tok), {
          method: 'DELETE', headers: authHeaders(),
        });
      } catch (e) {
        showError('Delete request failed: ' + e.message);
        els.deleteSession.disabled = false;
        return;
      }
      els.deleteSession.disabled = false;
      reset();
    });
  }
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
  if (els.resumeDelete) {
    els.resumeDelete.addEventListener('click', async function() {
      var v = els.resumeInput ? els.resumeInput.value : '';
      if (!v || !v.trim()) {
        showError('Paste a ticket to delete (or use the × button on a staged image).');
        return;
      }
      if (!window.confirm('Permanently delete the session for ticket "' +
          v.trim() + '"? The pending image + metadata will be dropped.')) return;
      els.resumeDelete.disabled = true;
      try {
        var resp = await fetch('/api/mint/' + encodeURIComponent(v.trim()), {
          method: 'DELETE', headers: authHeaders(),
        });
        var data = {};
        try { data = await resp.json(); } catch (e) {}
        if (!resp.ok) {
          showError(data.error || ('Delete failed (HTTP ' + resp.status + ')'));
        } else {
          showError('');
          if (els.resumeInput) els.resumeInput.value = '';
        }
      } catch (e) {
        showError('Delete request failed: ' + e.message);
      } finally {
        els.resumeDelete.disabled = false;
      }
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

  // ---- Forecast widget ----
  // Monte-Carlo distribution against current sky + machine state.
  // Tells the creator "if I conceive now, what should I expect?".
  // Refreshes on init and whenever the Mint tab becomes visible
  // again (sky drifts slowly, but a long-paused dashboard catches up).

  function _renderForecast(report) {
    if (!els.forecastHeadline || !els.forecastBody) return;
    var tiers = report.tier_pct || {};
    // Order tiers by displayed weight (descending) so the headline
    // reads "X most likely, then Y…". Zero-percent tiers still show
    // in the breakdown (so Legendary stays visible even when the
    // current conditions can't reach it) — they just sort to the end.
    var ordered = Object.keys(tiers)
      .map(function(k) { return [k, tiers[k]]; })
      .sort(function(a, b) { return b[1] - a[1]; });

    var headlineParts = ordered.filter(function(e) { return e[1] > 0; })
      .slice(0, 3).map(function(e) {
        return e[0] + ' ' + e[1].toFixed(0) + '%';
      });
    els.forecastHeadline.textContent =
      'Forecast: ' + headlineParts.join(' \u00b7 ');

    // Tier colors match the cert plate's rarity palette so the
    // widget reads the same visual language as the conceived cert.
    // Mirrors RARITY_TIERS in cert-renderer.js.
    var TIER_COLORS = {
      'Legendary': '#d44040',
      'Epic':      '#8a6210',
      'Very Rare': '#5a2a8a',
      'Rare':      '#2a5090',
      'Uncommon':  '#2a7030',
      'Common':    '#606060',
    };

    // Full breakdown — tier bars + score range + halo + traits.
    var html = '';
    html += '<div class="mint-forecast-bars">';
    ordered.forEach(function(e) {
      var name = e[0];
      var pct = e[1];
      var color = TIER_COLORS[name] || '#606060';
      // 0% tiers render with no fill width but still show the row so
      // the full tier ladder is always visible.
      var fillWidth = pct > 0 ? Math.max(2, pct) : 0;
      var rowClass = pct > 0 ? 'mint-forecast-bar-row' : 'mint-forecast-bar-row mint-forecast-bar-row-zero';
      html += '<div class="' + rowClass + '">' +
        '<span class="mint-forecast-bar-name" style="color:' + color + '">' + escapeHtml(name) + '</span>' +
        '<span class="mint-forecast-bar-track"><span class="mint-forecast-bar-fill" style="width:' +
          fillWidth + '%;background:' + color + '"></span></span>' +
        '<span class="mint-forecast-bar-pct">' + pct.toFixed(1) + '%</span>' +
        '</div>';
    });
    html += '</div>';

    html += '<div class="mint-forecast-stats">' +
      '<span>score range <strong>' + report.min + '\u2013' + report.max + '</strong></span>' +
      '<span>median <strong>' + report.median + '</strong></span>' +
      '<span>p99 <strong>' + report.p99 + '</strong></span>' +
      '<span>halo <strong>' + (report.halo_pct || 0).toFixed(3) + '%</strong></span>' +
      '</div>';

    function _renderTraits(label, items, fireRates) {
      if (!items || !items.length) return '';
      var rows = items.map(function(c) {
        var obs = (fireRates || {})[c.trait] || 0;
        return '<div class="mint-forecast-trait-row">' +
          '<span class="mint-forecast-trait-value">+' + c.value + '</span>' +
          '<span class="mint-forecast-trait-name">' + escapeHtml(c.trait) + '</span>' +
          '<span class="mint-forecast-trait-gate">gate ' + c.gate_pct.toFixed(0) + '%</span>' +
          '<span class="mint-forecast-trait-obs">observed ' + obs.toFixed(0) + '%</span>' +
          '</div>';
      }).join('');
      return '<div class="mint-forecast-traits"><p class="mint-forecast-traits-label">' +
        label + '</p>' + rows + '</div>';
    }
    html += _renderTraits('Eligible celestial traits',
      report.candidates_celestial, report.fire_rate_celestial);
    html += _renderTraits('Eligible machine traits',
      report.candidates_machine, report.fire_rate_machine);
    if (!(report.candidates_celestial || []).length
        && !(report.candidates_machine || []).length) {
      html += '<p class="mint-forecast-empty">No candidate traits ' +
        'right now \u2014 score will come from machine signature + ' +
        'rare entropy hits only.</p>';
    }
    els.forecastBody.innerHTML = html;
  }

  var _forecastInflight = false;
  async function loadForecast() {
    if (!els.forecastBlock || _forecastInflight) return;
    _forecastInflight = true;
    try {
      var resp = await fetch('/api/forecast', { headers: authHeaders() });
      if (!resp.ok) {
        els.forecastHeadline.textContent = 'Forecast unavailable';
        return;
      }
      var report = await resp.json();
      if (report && report.tier_pct) _renderForecast(report);
    } catch (e) {
      els.forecastHeadline.textContent = 'Forecast unavailable';
    } finally {
      _forecastInflight = false;
    }
  }

  // Initial load. Run async so the tab paint isn't blocked.
  loadForecast();
  // Load chain context so the banner + mint guardrails are populated
  // before the user has a chance to drop a file (no chain banner on
  // cold load before this; the unsealed-chain check would also miss).
  loadActiveChain();

  // ---- Recent pending sessions ----
  // Top 5 by created desc, with Resume / Delete per row. Hidden when
  // the list is empty so the empty state stays clean for fresh users.
  function _formatAge(seconds) {
    if (seconds < 60) return Math.round(seconds) + 's';
    if (seconds < 3600) return Math.round(seconds / 60) + 'm';
    if (seconds < 86400) return Math.round(seconds / 3600) + 'h';
    return Math.round(seconds / 86400) + 'd';
  }
  async function loadRecent() {
    if (!els.recentBlock || !els.recentList) return;
    try {
      var resp = await fetch('/api/mint/sessions?status=pending&limit=5',
        { headers: authHeaders() });
      if (!resp.ok) {
        els.recentBlock.hidden = true;
        return;
      }
      var data = await resp.json();
      var rows = data.sessions || [];
      if (!rows.length) {
        els.recentBlock.hidden = true;
        els.recentList.innerHTML = '';
        return;
      }
      els.recentBlock.hidden = false;
      els.recentList.innerHTML = rows.map(function(r) {
        // Image filename omitted — it truncated to ellipsis on mobile
        // and the ticket alone is enough to identify the session.
        // Filename is kept as a title attribute on the row for desktop
        // hover.
        // Two-row layout so the chain badge (variable width) doesn't squeeze
        // between the ticket and the buttons. Row 1: ticket + age + Resume + \u00d7
        // (all deterministic width). Row 2: the chain badge \u2014 the chain it
        // conceives into (bound at creation, immune to later switches).
        // Row 1: thumbnail + ticket id + chain badge (identity). Row 2: age +
        // Resume + delete (actions). Thumb is served from the token-based image
        // endpoint (/api/mint/<token>/image, which serves pending sessions);
        // hides via onerror if it can't load.
        var tThumb = r.token
          ? '<img class="mint-recent-thumb" src="/api/mint/' + encodeURIComponent(r.token) +
              '/image" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
          : '';
        var tBadge = r.chain
          ? ChainBadge.compact({
              id: r.chain, name: r.chain_name,
              visibility: r.chain_visibility, readiness: r.chain_readiness,
            })
          : '';
        return '<div class="mint-recent-row" data-ticket="' + escapeHtml(r.ticket) + '" title="' + escapeHtml(r.image) + '">' +
          '<div class="mint-recent-head">' +
            tThumb +
            '<span class="mint-recent-ticket">' + escapeHtml(r.ticket) + '</span>' +
            tBadge +
          '</div>' +
          '<div class="mint-recent-actions">' +
            '<span class="mint-recent-age">' + _formatAge(r.age_seconds) +
              (r.dry_run ? ' \u00b7 dry' : '') + '</span>' +
            '<button type="button" class="mint-recent-btn" data-recent-action="resume">Resume</button>' +
            '<button type="button" class="mint-recent-btn mint-recent-btn-danger" data-recent-action="delete">\u00d7</button>' +
          '</div>' +
          '</div>';
      }).join('');
    } catch (e) {
      els.recentBlock.hidden = true;
    }
  }
  if (els.recentList) {
    els.recentList.addEventListener('click', async function(ev) {
      var btn = ev.target.closest('[data-recent-action]');
      if (!btn) return;
      var row = btn.closest('.mint-recent-row');
      if (!row) return;
      var ticket = row.getAttribute('data-ticket');
      var action = btn.getAttribute('data-recent-action');
      if (action === 'resume') {
        if (typeof resumeByTicket === 'function') resumeByTicket(ticket);
      } else if (action === 'delete') {
        if (!window.confirm('Delete pending session ' + ticket + '?')) return;
        btn.disabled = true;
        try {
          await fetch('/api/mint/' + encodeURIComponent(ticket), {
            method: 'DELETE', headers: authHeaders(),
          });
          loadRecent();
        } catch (e) {
          showError('Delete failed: ' + e.message);
          btn.disabled = false;
        }
      }
    });
  }
  loadRecent();

  // Refresh on tab activation. Mint is the default-active tab, so
  // the first activation is the page load (handled above). Subsequent
  // returns to the tab pick up any drift in sky/machine. TabBar.wire
  // appends — doesn't replace — the existing dispatcher hooks.
  if (typeof TabBar !== 'undefined') {
    TabBar.wire(function(panelId) {
      if (panelId === 'tab-mint') {
        loadForecast();
        loadRecent();
        // Re-check chain context — most importantly, the seal state can
        // have flipped (user just sealed in the Payload tab). Refreshes
        // the unsealed-chain guardrail without a full page reload.
        // When a ticket is loaded, keep the banner pinned to its BOUND
        // chain — switching the active chain in Config must not change
        // where this conception lands or the label it shows.
        loadActiveChain(state.token ? state.boundChain : undefined);
      }
    });
  }

  // Expose to the outer reset() so it can refresh the pending list
  // after a cancel/again/retry. reset() also fires the DELETE
  // server-side, so we wait briefly before re-listing.
  window._mintReloadRecent = function() { setTimeout(loadRecent, 200); };
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
    chainBanner:  document.getElementById('payloadChainBanner'),
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
    buildBadge:   document.getElementById('payloadBuildBadge'),
    applyLockBanner: document.getElementById('payloadApplyLockBanner'),
    nux:          document.getElementById('payloadNux'),
    nuxDismiss:   document.getElementById('payloadNuxDismiss'),
    nuxReopen:    document.getElementById('payloadNuxReopen'),
    mInput:       document.getElementById('payloadM'),
    watermarkPresets: document.getElementById('payloadWatermarkPresets'),
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
    chainLockInfo: null,    // {age, age_name, outer_position, outer_total, …}
    lastPresetName: '',   // remembered preset name for the next save prompt
    touched: false,       // user has interacted with the editor since last load/apply/discard
    buildStatus: null,    // {manifest_missing, statuses: {<artifact>: {status, source_path?, error?}}}
                          // populated by /api/payload/status. null = unknown / not yet fetched.
  };

  // ===== Utilities =====
  function authHeaders() {
    var token = window._MINT_API_TOKEN || '';
    var h = {'Content-Type': 'application/json'};
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
  }

  // Returns true iff some entry's sources still references `path`. Used
  // to gate orphan deletion: only nuke the file when no entry/source
  // slot still references it (cross-entry shared paths shouldn't get
  // deleted out from under a still-active reference). Reads state.working
  // — caller must mutate state BEFORE asking.
  function _isPathReferencedInPayload(path) {
    if (!path || !state.working) return false;
    var entries = state.working.entries || {};
    for (var name in entries) {
      if (!Object.prototype.hasOwnProperty.call(entries, name)) continue;
      var srcs = entries[name].sources || [];
      for (var i = 0; i < srcs.length; i++) {
        if (srcs[i] === path) return true;
      }
    }
    return false;
  }

  // Fire-and-forget unlink of a payload upload. Server enforces that
  // the path lives under the active chain's uploads/ — anything else
  // (a user-typed system path, a stale Browse pick) returns 400 and we
  // ignore. Idempotent: missing file is a no-op success.
  function _deletePayloadUpload(path) {
    if (!path) return;
    fetchJson('/api/payload/upload/delete', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({path: path}),
    }).catch(function() { /* best-effort — orphan stays at worst */ });
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
    // Visual marker only shows after the user has actually touched the
    // editor since the last load/apply/discard. Avoids the "you have
    // unsaved changes" warning firing the moment a tab opens with an
    // empty default against a chain that already has applied content.
    els.dirty.hidden = !(dirty && state.touched);
    els.discardBtn.disabled = !dirty;
    // Inline lock banner — visible message when the chain is mid-Age
    // and Apply is therefore disabled. Repaints whenever lock state or
    // cycle progress changes.
    if (els.applyLockBanner) {
      if (state.chainLocked === true) {
        var info = state.chainLockInfo || {};
        var pos = info.outer_position;
        var total = info.outer_total;
        var ageLabel = info.age_name
          ? info.age_name + (info.age ? ' (Age ' + info.age + ')' : '')
          : 'an Age';
        // Use "conception" — each mint advances the outer position by
        // 1, regardless of the chain's layer K values. "chunk" was
        // misleading on chains whose layers have small K (suggested
        // the count should be 0/K, not 0/M).
        var progress = (typeof pos === 'number' && typeof total === 'number')
          ? ' \u00b7 conception ' + pos + '/' + total : '';
        els.applyLockBanner.textContent =
          'Apply is locked: ' + ageLabel + ' in progress' + progress +
          '. Changes commit when this Age completes.';
        els.applyLockBanner.hidden = false;
      } else {
        els.applyLockBanner.hidden = true;
      }
    }
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
    // Uneven tiling — M is not a whole multiple of a layer's K. The
    // chain still works, but the layer's last cycle is partial: its
    // chunks 0..K-1 don't all get the same number of turns across
    // the Age. Demo uses exact tiling on purpose (M=360 / K=12 = 30
    // full cycles). Friendly explanation, no math jargon.
    if (cfg.M && cfg.M > 0) {
      (cfg.layers || []).forEach(function(ly, i) {
        if (!ly.K || ly.K < 1) return;
        if (cfg.M % ly.K !== 0) {
          var fullCycles = Math.floor(cfg.M / ly.K);
          var leftover = cfg.M - fullCycles * ly.K;
          var name = ly.name || ('#' + (i + 1));
          msgs.push({severity: 'warning',
                     text: 'Layer "' + name + '" doesn\u2019t fit evenly into the Age. ' +
                           'With M=' + cfg.M + ' and K=' + ly.K + ', its chunks cycle ' +
                           fullCycles + ' full time(s) and then ' + leftover + ' more position(s) ' +
                           'use chunks 0..' + (leftover - 1) + ' again. Some chunks get one extra turn ' +
                           'than the rest. Pick an M that\u2019s a whole multiple of ' + ly.K +
                           ' for even tiling (e.g. ' + (fullCycles * ly.K) + ' or ' + ((fullCycles + 1) * ly.K) + ').'});
        }
      });
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
  // Identity (id/name/visibility) reflects the active chain — those
  // can't differ between draft and applied. M is rendered as its own
  // input below the chain bar; here we only annotate when the draft's
  // M differs from the chain's applied M (e.g. user loaded a preset
  // with a different M) so the user understands the discrepancy
  // between header / status line.
  // Render the Payload chain banner as the shared chain badge. Readiness is
  // a server signal, fetched cheaply; M-drift annotation rides in .below.
  // Build the payload-specific extras that ride under the chain pill: the
  // loaded + applied preset names, and an M-drift note. Pure function of state.
  function _payloadBadgeBelow() {
    var rows = '';
    var loaded = state.lastPresetName || 'Untitled';
    rows += '<span class="chain-badge-info">Loaded preset: <strong>' +
            escapeHtml(loaded) + '</strong></span>';
    var applied = (state.saved && state.saved.preset_name) || '';
    if (applied) {
      rows += '<span class="chain-badge-info">Applied preset: <strong>' +
              escapeHtml(applied) + '</strong></span>';
    }
    var draftM = state.working && state.working.M;
    var appliedM = state.saved && state.saved.M;
    if (draftM != null && appliedM != null && appliedM !== draftM) {
      rows += '<span class="chain-badge-note">M=' + escapeHtml(String(draftM)) +
              ' (draft, applied: ' + escapeHtml(String(appliedM)) + ')</span>';
    }
    return rows ? '<div class="chain-badge-extra">' + rows + '</div>' : '';
  }

  // Cache the last fetched readiness so re-renders triggered by preset changes
  // don't each fire a network round-trip.
  var _payloadReadiness = '';
  async function _renderPayloadBadge(refetch) {
    var host = els.chainBanner;
    if (!host || !state.working) return;
    var w = state.working;
    if (refetch !== false) {
      try {
        var resp = await fetch('/api/chain/current', { headers: authHeaders() });
        var data = await resp.json();
        _payloadReadiness = (data.info && data.info.readiness) || '';
      } catch (e) { /* keep prior readiness on failure */ }
    }
    host.innerHTML = ChainBadge.labeled({
      id: w.id, name: w.name, visibility: w.visibility,
      readiness: _payloadReadiness, below: _payloadBadgeBelow(),
    });
  }

  function renderChainBar() {
    if (!state.working) return;
    _renderPayloadBadge();  // refetches readiness; badge includes preset info
    var draftM = state.working.M;
    if (els.mInput) {
      els.mInput.value = (draftM != null) ? draftM : '';
      els.mInput.disabled = state.chainLocked === true;
    }
    if (els.watermarkPresets) {
      // Server normalizes "off" → omitted, so absence means off.
      var wmPreset = (state.working.watermark && state.working.watermark.preset) || 'off';
      var radios = els.watermarkPresets.querySelectorAll('input[type="radio"]');
      radios.forEach(function(r) {
        r.checked = (r.value === wmPreset);
        r.disabled = state.chainLocked === true;
      });
    }
  }

  // Two independent facts (presets and chains don't depend on each other's
  // creation order):
  //   loaded  = the preset staged in the editor now (in-memory;
  //             "Untitled" when the draft isn't from a named preset).
  //   applied = the preset committed to this chain (chain.json preset_name,
  //             held in state.saved); the segment hides when there's none.
  function renderPresetStatus() {
    // Preset info lives inside the chain badge now (below the pill). Re-render
    // the badge from cached readiness — no network round-trip for a preset
    // change.
    _renderPayloadBadge(false);
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
      '<span></span><span>Name</span><span>Sources (concatenated in order at build time)</span><span></span></div>';
    var rows = names.map(function(name) {
      var e = state.working.entries[name];
      var sources = e.sources || [];
      var sourceInputs = sources.map(function(src, idx) {
        return '<div class="entry-source-row">' +
          '<input class="payload-edit-input monospace" data-field="source-' + idx + '" type="text" value="' + escapeHtml(src) + '" placeholder="server-relative path \u2014 or click Upload">' +
          '<button class="source-browse" data-action="upload-source" data-source-idx="' + idx + '" title="Upload a file from this computer to the server (saves under the active chain\u2019s uploads/ folder)">Upload\u2026</button>' +
          '<button class="payload-edit-delete" data-action="remove-source" data-source-idx="' + idx + '" title="Remove this source">\u00d7</button>' +
          '</div>';
      }).join('');
      // Per-entry build-status dot. State source: state.buildStatus.statuses[name].
      // Vocabulary: in_sync (green) / drifted (amber) / missing_payload (gray)
      // / missing_source (red) / unknown (transparent — manifest not fetched yet
      // OR this entry isn't an artifact target).
      var entryStat = (state.buildStatus && state.buildStatus.statuses && state.buildStatus.statuses[name]) || null;
      var dotState = entryStat ? (entryStat.status || 'unknown') : 'unknown';
      var dotTitle = entryStat
        ? (dotState === 'in_sync'
            ? 'In sync with source. Ready to use.'
            : (dotState === 'drifted'
              ? 'Source changed since last build. Click Build to refresh.'
              : (dotState === 'missing_source'
                ? ('Source unreadable' + (entryStat.error ? ': ' + entryStat.error : '.'))
                : 'Not built yet. Click Build.')))
        : (state.buildStatus ? 'Not an artifact target yet — applied + built once to track.' : 'Build state unknown.');
      return '<div class="payload-edit-row entry-row" data-entry="' + escapeHtml(name) + '">' +
        '<span class="entry-status-dot" data-state="' + escapeHtml(dotState) + '" title="' + escapeHtml(dotTitle) + '"></span>' +
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
    renderBuildBadge();
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
        // Capture the entry's source paths BEFORE deleting so we can
        // sweep any now-orphaned uploads off disk.
        var orphanCandidates = ((state.working.entries[name] || {}).sources || []).slice();
        delete state.working.entries[name];
        renderAll();
        orphanCandidates.forEach(function(p) {
          if (!_isPathReferencedInPayload(p)) _deletePayloadUpload(p);
        });
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
          var removedPath = (e2.sources || [])[srcIdx];
          e2.sources = (e2.sources || []).filter(function(_, i) { return i !== srcIdx; });
          renderAll();
          if (!_isPathReferencedInPayload(removedPath)) _deletePayloadUpload(removedPath);
        }
      } else if (action === 'upload-source') {
        var entryName3 = row.getAttribute('data-entry');
        var srcIdx3 = parseInt(btn.getAttribute('data-source-idx'), 10);
        showError('');
        var picker = document.createElement('input');
        picker.type = 'file';
        picker.style.display = 'none';
        picker.addEventListener('change', function() {
          var file = picker.files && picker.files[0];
          if (!file) { document.body.removeChild(picker); return; }
          // Hard cap: server enforces 50 MiB too, but reject early for
          // a clearer error and to avoid base64-ing a huge file.
          if (file.size > 50 * 1024 * 1024) {
            showError('Upload failed: file exceeds 50 MiB cap (got ' + Math.round(file.size / 1024 / 1024) + ' MiB).');
            document.body.removeChild(picker);
            return;
          }
          var prevLabel = btn.textContent;
          btn.disabled = true;
          btn.textContent = 'Uploading\u2026';
          // Swap the × button on this source row to a spinner so the user
          // can't accidentally click it mid-upload and so the in-flight
          // state is visible. CSS class .uploading hides × and draws a
          // ring-spinner via ::before. Restored in finally.
          var deleteBtn = btn.parentElement
            ? btn.parentElement.querySelector('.payload-edit-delete[data-action="remove-source"]')
            : null;
          if (deleteBtn) deleteBtn.classList.add('uploading');
          var reader = new FileReader();
          reader.onload = async function() {
            try {
              // FileReader gives us a "data:<mime>;base64,<bytes>"
              // URL — strip the prefix to get the base64 payload the
              // server expects.
              var dataUrl = reader.result || '';
              var b64 = dataUrl.split(',')[1] || '';
              var resp = await fetchJson('/api/payload/upload', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({filename: file.name, content: b64}),
              });
              var ent = state.working.entries[entryName3];
              if (!ent) return;
              ent.sources = ent.sources || [];
              // Capture the previous path BEFORE overwriting so we can
              // sweep it if it's an orphaned upload (re-upload case).
              var prevPath = ent.sources[srcIdx3];
              ent.sources[srcIdx3] = resp.path;
              state.touched = true;
              renderAll();
              if (prevPath && prevPath !== resp.path &&
                  !_isPathReferencedInPayload(prevPath)) {
                _deletePayloadUpload(prevPath);
              }
            } catch (e) {
              showError('Upload failed: ' + e.message);
            } finally {
              btn.disabled = false;
              btn.textContent = prevLabel;
              // renderAll() on success path rebuilt deleteBtn — class on
              // the detached node is harmless. On the error path the row
              // is unchanged, so removing the class restores ×.
              if (deleteBtn) deleteBtn.classList.remove('uploading');
              if (picker.parentNode) picker.parentNode.removeChild(picker);
            }
          };
          reader.onerror = function() {
            showError('Upload failed: could not read file.');
            btn.disabled = false;
            btn.textContent = prevLabel;
            if (picker.parentNode) picker.parentNode.removeChild(picker);
          };
          reader.readAsDataURL(file);
        });
        document.body.appendChild(picker);
        picker.click();
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
      state.touched = false;
      // If the chain advertises a preset_name in its extras, treat
      // this load as a preset load (so Save overwrites that preset).
      // Otherwise clear lastPresetName — Save will prompt for a name.
      state.lastPresetName = cfg.preset_name || '';
      refreshPresetButtonLabel();
      renderAll();
      refreshNuxVisibility();
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
    // Build status — populates the BUILT/DRIFTED/NOT BUILT badge + the
    // per-entry status dots. Independent of chain-config fetch; failure
    // just leaves the badge in its "unknown" state.
    fetchBuildStatus();
  }

  async function onApplyToChain() {
    if (!els.applyBtn || els.applyBtn.disabled) return;
    showError('');
    els.applyBtn.disabled = true;
    var prev = els.applyBtn.textContent;
    els.applyBtn.textContent = 'Applying\u2026';
    try {
      // Stamp the active preset name (or empty string to clear) onto
      // the chain so future sessions / other devices know which
      // preset this chain is using. ChainConfig.extras round-trips it.
      var body = Object.assign({}, state.working, {
        preset_name: state.lastPresetName || '',
      });
      var resp = await fetchJson('/api/chain/config', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      state.saved = deepClone(resp.config || state.working);
      state.working = deepClone(state.saved);
      state.touched = false;
      // Apply persisted preset_name into chain.json (via the body above),
      // which is now the single source of the chain<->preset association.
      renderAll();
      showError('');
      // Apply changed which artifacts the chain expects — re-poll
      // build status so the badge correctly shows NOT BUILT for any
      // newly-added entries until the user clicks Build.
      fetchBuildStatus();
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
    // Sync the preset-button label to whatever the saved baseline
    // claims its preset is. Otherwise loading preset Y, then
    // discarding back to a chain whose preset_name is X leaves the
    // Save button pointing at the wrong preset.
    state.lastPresetName = (state.saved && state.saved.preset_name) || '';
    state.touched = false;
    refreshPresetButtonLabel();
    renderAll();
  }

  function renderAgeStatus(info) {
    if (!info || info.sealed === false) {
      els.ageStatus.textContent = 'No Age sealed yet \u2014 click Seal to begin.';
      state.chainLocked = false;
      state.chainLockInfo = null;
      // Unsealed: Seal is the user's primary path forward. Build-status
      // logic in renderBuildBadge re-gates this on whether the payload
      // is actually built (we can't seal a stale payload).
      if (els.sealBtn) {
        els.sealBtn.textContent = 'Seal';
        els.sealBtn.title = 'Begin Age 1 (irreversible)';
      }
      renderLockBadge();
      refreshDirtyUI();
      return;
    }
    // Build status line, omitting decoder fields for chains that have
    // no decoder layer (inner_total=0 / decoder_hash=null).
    var statusParts = [info.age_name + ' (Age ' + info.age + ')'];
    statusParts.push('outer ' + info.outer_position + '/' + info.outer_total);
    if (info.inner_total) {
      statusParts.push('inner ' + info.inner_position + '/' + info.inner_total);
    }
    if (info.decoder_hash) {
      statusParts.push('decoder hash ' + info.decoder_hash);
    }
    els.ageStatus.textContent = statusParts.join(' \u00b7 ');
    // Cycle complete = ready to advance to next Age — editing is allowed
    // again. Mid-cycle = locked.
    state.chainLocked = !info.cycle_complete;
    state.chainLockedReason = info.cycle_complete
      ? '' : ('Age in progress: outer ' + info.outer_position + '/' + info.outer_total);
    state.chainLockInfo = info.cycle_complete ? null : info;
    // Seal button: hard-disable while an Age is in progress so the user
    // doesn't get the impression they can re-seal at will. The next
    // legitimate Seal only happens when the outer cycle completes (cfg.M
    // mints later — per-chain, not always 365), at which point it advances
    // Age N → Age N+1.
    if (els.sealBtn) {
      if (info.cycle_complete) {
        els.sealBtn.textContent = 'Seal';
        els.sealBtn.disabled = false;
        els.sealBtn.title =
          'Outer cycle complete — Seal advances to Age ' + (info.age + 1) + '.';
      } else {
        els.sealBtn.textContent = 'Sealed';
        els.sealBtn.disabled = true;
        els.sealBtn.title =
          'Already sealed: Age ' + info.age + ' in progress (outer ' +
          info.outer_position + '/' + info.outer_total + '). The next Seal ' +
          'unlocks when this Age\u2019s cycle completes.';
      }
    }
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

  // ===== Build state =====
  //
  // /api/payload/status returns either {manifest_missing: true, statuses: {}}
  // (chain config applied but `mememage build` / payload.build() never ran)
  // or {statuses: {<target>: {status, source_path?, error?}}} where status
  // is one of: in_sync, drifted, missing_payload, missing_source.
  //
  // The aggregate badge collapses per-artifact states to one of four:
  //   built     — all in_sync
  //   drifted   — at least one drifted (and no missing_source)
  //   not_built — manifest missing OR some artifact has no payload yet
  //   missing   — at least one source unreadable (gates Seal)
  //
  // Severity precedence (highest wins): missing > drifted > not_built > built.
  function _aggregateBuildState(s) {
    if (!s) return 'unknown';
    if (s.manifest_missing) return 'not_built';
    var statuses = s.statuses || {};
    var names = Object.keys(statuses);
    if (names.length === 0) return 'not_built';
    var anyMissingSrc = false, anyDrifted = false, anyMissingPayload = false, anyOk = false;
    names.forEach(function(n) {
      var st = (statuses[n] || {}).status;
      if (st === 'missing_source') anyMissingSrc = true;
      else if (st === 'drifted') anyDrifted = true;
      else if (st === 'missing_payload') anyMissingPayload = true;
      else if (st === 'in_sync') anyOk = true;
    });
    if (anyMissingSrc) return 'missing';
    if (anyDrifted) return 'drifted';
    if (anyMissingPayload) return 'not_built';
    if (anyOk) return 'built';
    return 'unknown';
  }

  function _buildBadgeText(stateKey) {
    return ({
      built:     'BUILT',
      drifted:   'DRIFTED',
      not_built: 'NOT BUILT',
      missing:   'MISSING SRC',
      unknown:   'build\u2026',
    })[stateKey] || 'build\u2026';
  }

  function _buildBadgeTooltip(stateKey, s) {
    if (stateKey === 'unknown') return 'Build state not yet known.';
    if (stateKey === 'built') return 'All artifacts in sync with their sources. Ready to seal.';
    if (stateKey === 'not_built' && (s && s.manifest_missing)) {
      return 'No build manifest yet. Click Build to compile Payload/<chain>/ from the current sources.';
    }
    var statuses = (s && s.statuses) || {};
    var lines = [];
    if (stateKey === 'missing') lines.push('Source file(s) unreadable — fix paths or upload, then Build.');
    else if (stateKey === 'drifted') lines.push('Sources changed since last build — click Build to refresh.');
    else if (stateKey === 'not_built') lines.push('Some artifacts not built yet — click Build.');
    Object.keys(statuses).forEach(function(name) {
      var st = statuses[name] || {};
      if (st.status !== 'in_sync') lines.push('  \u2022 ' + name + ': ' + st.status + (st.error ? ' (' + st.error + ')' : ''));
    });
    return lines.join('\n');
  }

  function renderBuildBadge() {
    if (!els.buildBadge) return;
    var key = _aggregateBuildState(state.buildStatus);
    els.buildBadge.textContent = _buildBadgeText(key);
    els.buildBadge.setAttribute('data-state', key);
    els.buildBadge.title = _buildBadgeTooltip(key, state.buildStatus);
    // Build button: reflects current state in its label.
    if (els.buildBtn && !els.buildBtn.disabled) {
      if (key === 'built')       els.buildBtn.textContent = 'Rebuild \u2713';
      else if (key === 'drifted') els.buildBtn.textContent = 'Rebuild \u26a0';
      else if (key === 'missing') els.buildBtn.textContent = 'Rebuild';
      else                        els.buildBtn.textContent = 'Build';
    }
    // Seal: disabled unless built. Stops the user sealing a stale
    // or broken payload. Lock-state still has authority (mid-Age = seal
    // is the wrong action), so we only intercept the not-yet-built case
    // when the chain is EDITABLE (unsealed or cycle complete).
    if (els.sealBtn) {
      var canSeal = (key === 'built');
      if (!state.chainLocked && state.chainLocked !== undefined) {
        els.sealBtn.disabled = !canSeal;
        if (!canSeal) {
          els.sealBtn.title = 'Build the payload first — Seal needs all artifacts in sync.';
        }
        // When canSeal: leave the title alone. renderAgeStatus already
        // set it contextually ("Begin Age 1" for fresh chain, "advances
        // to Age N+1" for a cycle-complete chain). Re-clobbering here
        // would lose that context.
      }
    }
  }

  async function fetchBuildStatus() {
    if (!els.buildBadge) return;
    try {
      state.buildStatus = await fetchJson('/api/payload/status');
    } catch (e) {
      state.buildStatus = null;
    }
    renderBuildBadge();
    // Per-entry dots live inside the entry rows — re-render to refresh them.
    if (typeof renderEntries === 'function') renderEntries();
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
      // Refresh the badge + per-entry dots — they're now BUILT (or
      // MISSING if a source was unreadable).
      fetchBuildStatus();
    } catch (e) {
      showError('Build failed: ' + e.message);
    } finally {
      els.buildBtn.disabled = false;
      els.buildBtn.textContent = prev;
      // Let renderBuildBadge restamp the button label (Build / Rebuild
      // / Rebuild ✓) based on the freshly-fetched state, overriding
      // the saved-prev label.
      renderBuildBadge();
    }
  }
  async function sealAge() {
    // Personalize the prompt to whichever path we're on: first-ever seal
    // (Age 1) vs. cycle-complete advance (Age N → N+1). Less ambiguous
    // than the old "Re-seals if no Age yet, or starts the next Age."
    var info = state.chainLockInfo;
    var head, body;
    if (info && info.cycle_complete) {
      head = 'Advance to Age ' + (info.age + 1) + '?';
      body = 'The current outer cycle is complete. Sealing begins the next Age — irreversible.';
    } else {
      head = 'Begin Age 1?';
      // Outer-cycle length is per-chain (cfg.M), not always the canonical
      // 365. Read it from the loaded config so the count is honest; omit the
      // parenthetical entirely if M is somehow unavailable rather than lie.
      var m = (state.working && state.working.M) || (state.saved && state.saved.M);
      var cycleLen = m ? ' (' + m + ' conception' + (m === 1 ? '' : 's') + ')' : '';
      body = 'This is irreversible. The chain becomes mintable once sealed; the next Seal won\u2019t unlock until this Age\u2019s outer cycle completes' + cycleLen + '.';
    }
    var ok = window.prompt(head + '\n\n' + body + '\n\nType SEAL to confirm:');
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
      // Only mention decoder hash when the chain actually defines a
      // decoder layer — otherwise users see "Decoder hash null" which
      // reads like an error.
      var msg = 'Sealed: ' + resp.info.age_name + ' (Age ' + resp.info.age + ')';
      if (resp.info.decoder_hash) msg += '. Decoder hash ' + resp.info.decoder_hash;
      msg += '.';
      showError(msg);
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
      // Saving names the in-memory draft so future Saves overwrite it.
      // It does NOT associate the preset with the chain — that's Apply to
      // Chain's job alone.
      state.lastPresetName = name;
      refreshPresetButtonLabel();
      renderPresetStatus();
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
    // Always read "Save preset…" — the previous dynamic relabel
    // ("Save to <name>") confused users about which preset would be
    // overwritten. The tooltip still spells out the intent.
    els.presetSavePresetBtn.textContent = 'Save preset\u2026';
    els.presetSavePresetBtn.title = state.lastPresetName
      ? ('Overwrite the loaded preset "' + state.lastPresetName +
         '" with the current draft. Use "Save as new\u2026" in the ' +
         'Presets menu to fork into a different preset.')
      : 'Save the current draft as a new named preset.';
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
      // In-memory only — a loaded preset is a TEMPORARY view. It does not
      // associate with the chain; only Apply to Chain does that (writes
      // chain.json preset_name). Reopening the tab reverts to the applied
      // config.
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
        renderPresetStatus();
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
  // Default state for the Payload tab: restore the chain's APPLIED preset
  // (chain.json preset_name) if it has one, else an empty draft. A merely
  // loaded-not-applied preset is never restored — loading is temporary,
  // and only Apply to Chain writes the chain<->preset association.
  function _emptyConfigFor(identity) {
    // Keep M from the active chain (orbital scaffolding) so a fresh
    // draft validates without prompting the user to set it; everything
    // else starts blank.
    return {
      id: identity.id,
      name: identity.name,
      visibility: identity.visibility,
      M: identity.M,
      layers: [],
      frozen: [],
      entries: {},
    };
  }
  window.__loadPayloadTab = async function() {
    if (state.loaded) return;
    state.loaded = true;
    state.touched = false;
    showError('');
    try {
      var chainCfg = await fetchJson('/api/chain/config');
      // Normalize legacy fields the same way loadConfig does so the
      // saved baseline is comparable to the working draft.
      (chainCfg.layers || []).forEach(function(ly) {
        if ('chunk_type' in ly) delete ly.chunk_type;
        if ('type' in ly) delete ly.type;
      });
      Object.keys(chainCfg.entries || {}).forEach(function(name) {
        var e = chainCfg.entries[name];
        if (!e.sources && e.source) e.sources = [e.source];
        if ('type' in e) delete e.type;
      });
      // state.saved tracks the chain's actually-applied config — the
      // dirty marker compares working vs. saved, so Apply lights up
      // whenever the draft differs from what's committed.
      state.saved = deepClone(chainCfg);
      var identity = {
        id: chainCfg.id, name: chainCfg.name, visibility: chainCfg.visibility,
      };
      // Only the APPLIED association (chain.json preset_name) restores a
      // preset on tab open. A merely-loaded preset is temporary and never
      // persisted, so reopening the tab shows the chain's applied config.
      var presetName = chainCfg.preset_name || '';
      if (presetName) {
        try {
          var pd = await fetchJson('/api/payload/presets/' + encodeURIComponent(presetName));
          var preset = pd.config || {};
          // Preset wins for layers/frozen/entries/M; chain identity
          // wins for id/name/visibility (those are per-chain, not
          // portable). Identity does NOT include M — stamping chain's
          // M onto a preset designed for a different M breaks
          // validation (M-smaller-than-K, frozen-out-of-range).
          state.working = Object.assign({}, preset, identity);
          (state.working.layers || []).forEach(function(ly) {
            if ('chunk_type' in ly) delete ly.chunk_type;
            if ('type' in ly) delete ly.type;
          });
          Object.keys(state.working.entries || {}).forEach(function(n) {
            var e = state.working.entries[n];
            if (!e.sources && e.source) e.sources = [e.source];
            if ('type' in e) delete e.type;
          });
          state.lastPresetName = presetName;
        } catch (e) {
          // Preset gone (deleted on disk) — fall back to empty.
          state.working = _emptyConfigFor({id: identity.id, name: identity.name,
                                            visibility: identity.visibility, M: chainCfg.M});
          state.lastPresetName = '';
        }
      } else {
        state.working = _emptyConfigFor({id: identity.id, name: identity.name,
                                          visibility: identity.visibility, M: chainCfg.M});
        state.lastPresetName = '';
      }
      refreshPresetButtonLabel();
      renderAll();
      refreshDirtyUI();
      refreshNuxVisibility();
    } catch (e) {
      showError('Failed to initialize Payload tab: ' + e.message);
    }
    // Age status (separate, ok if it fails).
    try {
      var age = await fetchJson('/api/site-pack/status');
      renderAgeStatus(age);
    } catch (e) {
      els.ageStatus.textContent = '(site-pack status unavailable: ' + e.message + ')';
    }
  };
  // Called by the Config tab after a chain switch so the next visit to
  // the Payload tab re-initializes against the new chain (and its own
  // remembered preset, if any).
  window.__resetPayloadTab = function() {
    state.loaded = false;
    state.working = null;
    state.saved = null;
    state.lastPresetName = '';
    state.touched = false;
    refreshPresetButtonLabel();
  };

  // Mark the editor "touched" on any user input — text typing, select
  // change, +Add buttons. The visual dirty marker stays hidden until
  // this fires (avoids the warning showing the moment a tab opens
  // with empty default ≠ chain's applied config).
  function markTouched() {
    if (!state.touched) {
      state.touched = true;
      refreshDirtyUI();
    }
  }

  // NUX workflow card — auto-shows for fresh chains, dismissible per
  // browser. Re-openable via the link below the card. Reads/writes
  // localStorage('mememage-payload-nux-dismissed').
  var NUX_KEY = 'mememage-payload-nux-dismissed';
  function _nuxDismissed() {
    try { return localStorage.getItem(NUX_KEY) === '1'; } catch (e) { return false; }
  }
  function _setNuxDismissed(v) {
    try {
      if (v) localStorage.setItem(NUX_KEY, '1');
      else localStorage.removeItem(NUX_KEY);
    } catch (e) {}
  }
  function refreshNuxVisibility() {
    if (!els.nux) return;
    var dismissed = _nuxDismissed();
    var w = state.working || {};
    var hasContent = (w.layers && w.layers.length)
                  || (w.frozen && w.frozen.length)
                  || (w.entries && Object.keys(w.entries).length);
    // Auto-show when: not dismissed AND the chain is in a fresh state
    // (no layers/frozen/entries on disk yet). Once content exists, the
    // user has graduated past the NUX; hide unless they explicitly
    // re-open it.
    var savedHasContent = state.saved && (
      (state.saved.layers && state.saved.layers.length) ||
      (state.saved.frozen && state.saved.frozen.length) ||
      (state.saved.entries && Object.keys(state.saved.entries).length)
    );
    var shouldShow = !dismissed && !savedHasContent;
    els.nux.hidden = !shouldShow;
    if (shouldShow && !els.nux.open) els.nux.open = true;  // expanded on first display
    if (els.nuxReopen) els.nuxReopen.hidden = shouldShow;
  }
  if (els.nuxDismiss) {
    els.nuxDismiss.addEventListener('click', function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      _setNuxDismissed(true);
      if (els.nux) els.nux.hidden = true;
      if (els.nuxReopen) els.nuxReopen.hidden = false;
    });
  }
  if (els.nuxReopen) {
    els.nuxReopen.addEventListener('click', function(ev) {
      ev.preventDefault();
      _setNuxDismissed(false);
      if (els.nux) { els.nux.hidden = false; els.nux.open = true; }
      els.nuxReopen.hidden = true;
    });
  }
  var payloadRoot = document.querySelector('.payload-panel');
  if (payloadRoot) {
    payloadRoot.addEventListener('input', markTouched);
    payloadRoot.addEventListener('change', markTouched);
  }
  [els.addEntryBtn, els.addLayerBtn, els.addFrozenBtn].forEach(function(btn) {
    if (btn) btn.addEventListener('click', markTouched);
  });

  // M editor — first-class field for the chain's Age length. Reads
  // and writes state.working.M directly. Locked while mid-Age (M is
  // part of the seal's snapshot).
  if (els.mInput) {
    els.mInput.addEventListener('input', function() {
      if (!state.working) return;
      var v = parseInt(els.mInput.value, 10);
      if (isNaN(v) || v < 1) return;  // invalid keystroke — refreshDirtyUI revalidates
      state.working.M = v;
      markTouched();
      refreshDirtyUI();
    });
  }

  // Watermark preset — writes state.working.watermark. Omit the key
  // entirely when off so chain.json stays clean. Server validates.
  if (els.watermarkPresets) {
    els.watermarkPresets.addEventListener('change', function(ev) {
      if (!state.working || !ev.target || ev.target.name !== 'payload-watermark') return;
      var preset = ev.target.value;
      if (preset === 'off') {
        delete state.working.watermark;
      } else {
        state.working.watermark = { preset: preset };
      }
      markTouched();
      refreshDirtyUI();
    });
  }

  els.refreshBtn.addEventListener('click', function() {
    // Explicit Refresh = "show me the chain's actual applied config".
    loadConfig();
  });
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
      '  <button class="config-btn advanced-only" id="configRotateBtn">Rotate key\u2026</button>' +
      '  <button class="config-btn config-btn-danger advanced-only" id="configRevokeBtn"' + (hasRevCert ? '' : ' disabled title="No revocation cert on disk"') + '>Revoke key\u2026</button>' +
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
    var resolved = server.domain_resolved || '';
    var cert   = server.cert   || '';
    var keyP   = server.key    || '';
    var tokenSet = !!env.MINT_API_TOKEN;
    // Show what the server is actually using right now. If the user
    // explicitly set a domain, that's the value; otherwise the
    // auto-detected one (MEMEMAGE_SELF_HOST first entry). Never an
    // empty field — empty makes users think the server has no
    // domain, when really it just auto-resolved.
    var domainShown = domain || resolved;
    var domainHint = domain
      ? 'set via server.json (overrides auto-detect)'
      : (resolved ? 'auto-detected at startup' : 'not set');

    els.server.innerHTML =
      '<div class="config-field">' +
      '  <span class="config-field-label">Domain</span>' +
      '  <input class="config-input" id="configServerDomain" type="text" value="' + escapeHtml(domainShown) + '" placeholder="(auto-detect at startup)">' +
      '  <span class="config-channel-field-hint">' + escapeHtml(domainHint) + '</span>' +
      '</div>' +
      '<div class="config-field config-field-with-browse advanced-only">' +
      '  <span class="config-field-label">TLS cert</span>' +
      '  <input class="config-input" id="configServerCert" type="text" value="' + escapeHtml(cert) + '" placeholder="/path/to/cert.pem (or auto-detect)">' +
      '  <button class="config-btn" id="configServerCertBrowse" data-fs-browse>Browse\u2026</button>' +
      '  <button class="config-btn config-btn-subtle" id="configServerCertClear" title="Clear path" ' + (cert ? '' : 'disabled') + '>\u00d7</button>' +
      '</div>' +
      '<div class="config-field config-field-with-browse advanced-only">' +
      '  <span class="config-field-label">TLS key</span>' +
      '  <input class="config-input" id="configServerKey" type="text" value="' + escapeHtml(keyP) + '" placeholder="/path/to/key.pem (or auto-detect)">' +
      '  <button class="config-btn" id="configServerKeyBrowse" data-fs-browse>Browse\u2026</button>' +
      '  <button class="config-btn config-btn-subtle" id="configServerKeyClear" title="Clear path" ' + (keyP ? '' : 'disabled') + '>\u00d7</button>' +
      '</div>' +
      // Dashboard API token. Button-driven: "Generate phrase" produces
      // a fresh word-phrase token, "Save token" commits it. The input
      // is readonly — typing is reserved for the Advanced path (paste
      // a token you generated elsewhere, or restore a known value).
      // Gates /api/* and the dashboard itself; empty = open on
      // localhost (server-side guardrail warns on public-domain bind).
      '<div class="config-field">' +
      '  <span class="config-field-label">API token <span class="config-channel-field-state" data-set="' + (tokenSet ? '1' : '0') + '">' + (tokenSet ? 'set' : 'unset') + '</span></span>' +
      // Token row: input on its own line, the two buttons share a
      // line below it. Wrapper takes column 2 of the .config-field
      // grid so the input gets the full available width.
      '  <div class="config-token-row">' +
      '    <input class="config-input" id="configServerToken" type="text" autocomplete="off" spellcheck="false" readonly placeholder="' + (tokenSet ? '(set \u2014 click Generate phrase to replace)' : '(unset \u2014 click Generate phrase)') + '">' +
      '    <div class="config-token-buttons">' +
      '      <button class="config-btn config-btn-primary" id="configServerTokenGen" title="Generate a readable word-phrase token (~108 bits of entropy)">Generate phrase</button>' +
      '      <button class="config-btn" id="configServerTokenSet" disabled title="Generate or paste a token first">Save token</button>' +
      '    </div>' +
      '  </div>' +
      '</div>' +
      '<p class="config-note" style="margin-top:-0.3rem;">Word-phrase tokens are easier to read and dictate aloud than random characters. Changing the token kicks every other dashboard session.</p>' +
      '<div class="config-row">' +
      '  <button class="config-btn" id="configServerSave" title="Write changes to ~/.mememage/server.json on this host">Save server settings</button>' +
      '  <span class="config-note" id="configServerStatus" style="margin:0;"></span>' +
      '</div>' +
      '<p class="config-note">Cert/key paths use the native file picker — OS-agnostic, no copy-paste of long paths. Empty = auto-detect from <code>~/.mememage/certs/</code> at startup. Cert/key + API token changes require a server restart to take effect for new sessions.</p>' +
      '<div id="configWebhooks" class="config-webhooks"></div>';

    document.getElementById('configServerSave').addEventListener('click', saveServerConfig);
    function _commitNewToken(v) {
      // Updating the token kicks every other session — including the
      // one the user is currently in. Make them confirm with the value
      // visible so they can copy it before hitting OK.
      if (!v) return;
      var ok = window.confirm(
        'About to set MINT_API_TOKEN to:\n\n' + v +
        '\n\nCopy this value FIRST — every dashboard session ' +
        '(including this one) will need it after save.\n\n' +
        'Press OK to commit, Cancel to back out.'
      );
      if (!ok) return;
      setEnvSecretGlobal('MINT_API_TOKEN', v, document.getElementById('configServerToken').closest('.config-field'));
      var inp = document.getElementById('configServerToken');
      if (inp) inp.value = '';
      var saveBtn = document.getElementById('configServerTokenSet');
      if (saveBtn) saveBtn.disabled = true;
    }
    document.getElementById('configServerTokenSet').addEventListener('click', function() {
      var v = (document.getElementById('configServerToken') || {}).value || '';
      _commitNewToken(v);
    });
    var tokenGenBtn = document.getElementById('configServerTokenGen');
    if (tokenGenBtn) {
      tokenGenBtn.addEventListener('click', async function() {
        var inp = document.getElementById('configServerToken');
        var saveBtn = document.getElementById('configServerTokenSet');
        if (!inp) return;
        var prev = tokenGenBtn.textContent;
        tokenGenBtn.disabled = true;
        tokenGenBtn.textContent = 'Generating\u2026';
        try {
          var resp = await fetchJson('/api/config/token/generate', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ words: 12 }),
          });
          inp.value = resp.token || '';
          // Enable Save once we have a value worth committing.
          if (saveBtn) saveBtn.disabled = !inp.value;
        } catch (e) {
          showError('Token generation failed: ' + e.message);
        } finally {
          tokenGenBtn.textContent = prev;
          tokenGenBtn.disabled = false;
        }
      });
    }
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
      btn.disabled = false; btn.textContent = 'Save server settings';
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
          // Mirrors server.py _is_secret_header — names containing
          // any of these keywords get rendered as type=password +
          // eyeball reveal toggle. Plain headers like Content-Type
          // stay type=text.
          function _isSecretHdrName(name) {
            var lower = (name || '').toLowerCase();
            var kws = ['authorization', 'token', 'secret', 'key', 'bearer', 'api-key', 'auth'];
            for (var ki = 0; ki < kws.length; ki++) {
              if (lower.indexOf(kws[ki]) >= 0) return true;
            }
            return false;
          }
          var headersRowsHtml = headerEntries.map(function(hk, hi) {
            var displayKey = _isSentinel(hk) ? '' : hk;
            var rawVal = w.headers[hk];
            var secret = _isSecretHdrName(displayKey);
            var valInput =
              '<input class="config-input config-webhook-hdr-val" data-webhook-hdr-val="' + i + ':' + hi + '" type="' + (secret ? 'password' : 'text') + '" value="' + escapeHtml(rawVal) + '" placeholder="value">';
            var valCell = secret
              ? '<span class="config-password-wrap config-webhook-hdr-val-wrap">' +
                  valInput +
                  '<button type="button" class="config-password-toggle" data-pw-toggle aria-label="Show value" title="Show value">\ud83d\udc41</button>' +
                '</span>'
              : valInput;
            return '<div class="config-webhook-hdr-row">' +
              '<input class="config-input config-webhook-hdr-key" data-webhook-hdr-key="' + i + ':' + hi + '" type="text" value="' + escapeHtml(displayKey) + '" placeholder="Header-Name">' +
              valCell +
              '<button class="config-btn config-webhook-hdr-del" data-webhook-hdr-del="' + i + ':' + hi + '" title="Remove header">\u00d7</button>' +
            '</div>';
          }).join('');
          var attachFiles = !!w.attach_files;
          return '' +
            '<div class="config-webhook-row" data-i="' + i + '">' +
              // URL on its own row — long Discord/Slack URLs need
              // the full width to read; sharing the row with checkboxes
              // crammed everything on narrow widths.
              '<div class="config-webhook-urlrow">' +
                '<input class="config-input config-webhook-url" data-webhook-url="' + i + '" type="url" value="' + escapeHtml(w.url) + '" placeholder="https://…">' +
                '<button class="config-btn config-webhook-del" data-webhook-del="' + i + '" title="Remove webhook">\u00d7</button>' +
              '</div>' +
              '<div class="config-webhook-main">' +
                '<label class="config-webhook-ev"><input type="checkbox" data-webhook-ev="' + i + '" value="conceived" ' + (allEv || hasC ? 'checked' : '') + '> conceived</label>' +
                '<label class="config-webhook-ev"><input type="checkbox" data-webhook-ev="' + i + '" value="ready"     ' + (allEv || hasR ? 'checked' : '') + '> ready</label>' +
                '<label class="config-webhook-ev" title="Send minted image + .soul as Discord-style multipart attachments on conceived events"><input type="checkbox" data-webhook-attach="' + i + '" ' + (attachFiles ? 'checked' : '') + '> attachment</label>' +
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
            // Use is common — needed any time you have >1 profile.
            // Alias / Remove / Scope are advanced (multi-host / privacy
            // concepts most single-machine users won't touch).
            btns += '<button class="config-btn config-profile-use" data-profile-use="' + escapeHtml(p.id) + '">Use</button>';
            btns += '<button class="config-btn config-profile-alias advanced-only" data-profile-alias="' + escapeHtml(p.id) + '">Alias\u2026</button>';
            btns += '<button class="config-btn config-btn-danger config-profile-remove advanced-only" data-profile-remove="' + escapeHtml(p.id) + '">Remove\u2026</button>';
          }
          btns += '<button class="config-btn config-profile-scope advanced-only" data-profile-scope="' + escapeHtml(p.id) + '" title="Restrict which channels this profile publishes to (privacy boundary)">Scope\u2026</button>';
          // Alias chips — one per linked profile. Bidirectional uses
          // ↔ glyph + green tint; one-way uses → + muted tint.
          // Unknown-locally siblings (alias points at a fingerprint
          // not in our local profile list) render with the truncated
          // fingerprint instead of an id.
          // Channel scope chip — only rendered when this profile has
          // narrowed itself to a subset of channels (privacy boundary).
          // Default "all enabled" stays invisible to keep the row tidy.
          var scopeChip = '';
          if (p.channels && p.channels.length) {
            scopeChip = '<div class="config-profile-alias-row">' +
              '<span class="config-profile-alias-label">channels:</span>' +
              p.channels.map(function(c) {
                return '<span class="config-alias-chip config-alias-bi" title="Souls + keychain records from this profile only go to: ' +
                  escapeHtml(p.channels.join(', ')) + '">' +
                  escapeHtml(c) +
                  '</span>';
              }).join('') +
            '</div>';
          }
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
              scopeChip +
              aliasChips +
            '</div>';
        }).join('');

    els.profiles.innerHTML =
      '<div class="config-profile-list">' + listHtml + '</div>' +
      '<div class="config-row" style="margin-top:0.5rem;">' +
      '  <button class="config-btn" id="configProfileNewBtn">+ New profile</button>' +
      '  <button class="config-btn advanced-only" id="configProfileImportBtn">Import existing key\u2026</button>' +
      '  <button class="config-btn advanced-only" id="configProfilePairBtn">Pair with another mememage\u2026</button>' +
      '  <button class="config-btn advanced-only" id="configProfileSyncBtn" title="Push your chains / channels / webhooks to another mememage host (additive — peer keeps anything it already has)">Push config\u2026</button>' +
      '  <button class="config-btn advanced-only" id="configProfileExportBtn" title="Download chains + channels (+ optionally webhooks) as a JSON file. Re-importable on this host or pushable to a peer\u2019s /api/sync/accept.">Export config\u2026</button>' +
      '  <button class="config-btn advanced-only" id="configProfileImportFileBtn" title="Import a previously-exported config file. Additive — existing entries on this host are kept untouched.">Import config\u2026</button>' +
      '</div>' +
      '<div id="configProfileDanger" class="config-danger-zone" style="display:none;"></div>' +
      '<p class="config-note">One profile is active at a time \u2014 that\u2019s the key signing the next conception. Different machines can carry their own profile so a remote host never sees your primary identity. To link two profiles into one human identity, use <strong>Alias</strong> from each side, or <strong>Pair</strong> for a one-click cross-host handshake (each side keeps its private key, only public keys move).</p>';

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
    els.profiles.querySelectorAll('[data-profile-scope]').forEach(function(b) {
      b.addEventListener('click', function() {
        openScopeChannels(b.getAttribute('data-profile-scope'), rows);
      });
    });
    document.getElementById('configProfileNewBtn').addEventListener('click', openNewProfile);
    document.getElementById('configProfileImportBtn').addEventListener('click', openImportProfile);
    document.getElementById('configProfilePairBtn').addEventListener('click', openPairFlow);
    document.getElementById('configProfileSyncBtn').addEventListener('click', openSyncFlow);
    document.getElementById('configProfileExportBtn').addEventListener('click', openExportFlow);
    document.getElementById('configProfileImportFileBtn').addEventListener('click', openImportFlow);
  }

  // Pair-with-another-mememage modal. Cross-host key exchange in one
  // click: this host calls the peer, peer accepts (auto if peer_token
  // matches), both sides save each other's pubkey and sign their own
  // alias to the other. Bidirectional in one round-trip.
  function openSyncFlow() {
    // Push this host's config to a peer. Additive on the receiver
    // side — peer keeps anything it already has, only new entries
    // land. Mirrors the pair-call shape so users who learned that
    // flow have one fewer thing to learn here.
    var host = document.getElementById('configProfileDanger');
    if (!host) return;
    host.style.display = 'block';
    host.innerHTML =
      '<div class="config-pair-form">' +
      '  <p class="config-pair-head">Push config to peer</p>' +
      '  <p class="config-note">Sends your chains + channels (no credentials) to another mememage host. Peer applies additively \u2014 anything it already has is kept untouched, new entries are appended. Private keys, API tokens, and channel credentials NEVER cross the wire.</p>' +
      '  <div class="config-field">' +
      '    <span class="config-field-label">Peer URL</span>' +
      '    <input class="config-input" id="configSyncUrl" type="text" placeholder="https://160.153.182.117:8444">' +
      '  </div>' +
      '  <div class="config-field">' +
      '    <span class="config-field-label">Peer token</span>' +
      '    <input class="config-input" id="configSyncToken" type="text" autocomplete="off" spellcheck="false" placeholder="peer\u2019s MINT_API_TOKEN (the peer\u2019s, not this host\u2019s)">' +
      '  </div>' +
      '  <div class="config-field">' +
      '    <span class="config-field-label">Include</span>' +
      '    <div class="config-sync-categories">' +
      '      <label><input type="checkbox" id="configSyncChains" checked> Chains <span class="config-note" style="margin:0;">(id, name, visibility, gps_source \u2014 no password)</span></label>' +
      '      <label><input type="checkbox" id="configSyncChannels" checked> Channels <span class="config-note" style="margin:0;">(id, type, name, config \u2014 no credentials)</span></label>' +
      '      <label><input type="checkbox" id="configSyncWebhooks"> Webhooks ' +
      '        <span class="config-note" style="margin:0;color:#a65030;">\u26a0 includes Discord/Slack bot tokens embedded in URLs/headers. Only enable if you trust the peer.</span>' +
      '      </label>' +
      '    </div>' +
      '  </div>' +
      '  <label class="config-pair-checkbox">' +
      '    <input type="checkbox" id="configSyncSelfSigned"> Accept self-signed cert (for peers using the bundled tls helper)' +
      '  </label>' +
      '  <div class="config-row" style="margin-top:0.6rem;">' +
      '    <button class="config-btn config-btn-primary" id="configSyncSubmit">Push</button>' +
      '    <button class="config-btn" id="configSyncCancel">Cancel</button>' +
      '  </div>' +
      '  <div class="config-note" id="configSyncStatus" style="margin-top:0.4rem;"></div>' +
      '</div>';
    document.getElementById('configSyncCancel').addEventListener('click', closeProfileDanger);
    document.getElementById('configSyncSubmit').addEventListener('click', submitSync);
  }

  async function submitSync() {
    var url   = (document.getElementById('configSyncUrl').value || '').trim();
    var token = (document.getElementById('configSyncToken').value || '').trim();
    var ssc   = document.getElementById('configSyncSelfSigned').checked;
    var include = {
      chains:   document.getElementById('configSyncChains').checked,
      channels: document.getElementById('configSyncChannels').checked,
      webhooks: document.getElementById('configSyncWebhooks').checked,
    };
    var statusEl = document.getElementById('configSyncStatus');
    var submit = document.getElementById('configSyncSubmit');
    if (!url) { statusEl.textContent = 'Peer URL required.'; statusEl.style.color = '#b04040'; return; }
    if (!include.chains && !include.channels && !include.webhooks) {
      statusEl.textContent = 'Pick at least one category to send.';
      statusEl.style.color = '#b04040';
      return;
    }
    if (include.webhooks) {
      var ok = window.confirm(
        'Webhooks include embedded Discord/Slack bot tokens. The peer ' +
        'will receive those tokens in plaintext and will fire to the ' +
        'same surfaces this host does.\n\nProceed?'
      );
      if (!ok) return;
    }
    submit.disabled = true;
    statusEl.textContent = 'Calling peer\u2026';
    statusEl.style.color = '';
    try {
      var resp = await fetch('/api/sync/call', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          peer_url: url,
          peer_token: token,
          accept_self_signed: ssc,
          include: include,
        }),
      });
      var text = await resp.text();
      var data; try { data = text ? JSON.parse(text) : {}; } catch (e) { data = {}; }
      if (!resp.ok) {
        statusEl.style.color = '#b04040';
        if (data.network_error && data.hint) {
          statusEl.innerHTML =
            '<strong>' + escapeHtml(data.error || 'Peer unreachable.') + '</strong>' +
            '<br><span style="color:#54545c;font-style:italic;">' +
              escapeHtml(data.hint) +
            '</span>';
        } else {
          statusEl.textContent = data.error || ('Sync failed (HTTP ' + resp.status + ').');
        }
        submit.disabled = false;
        return;
      }
      // Render the peer's summary so the user can see what landed.
      var s = data.peer_summary || {};
      var lines = [];
      if (s.chains) {
        lines.push('Chains: ' + s.chains.created.length + ' created' +
          (s.chains.skipped.length ? ', ' + s.chains.skipped.length + ' skipped (already present)' : ''));
      }
      if (s.channels) {
        lines.push('Channels: ' + s.channels.created.length + ' created' +
          (s.channels.skipped.length ? ', ' + s.channels.skipped.length + ' skipped (already present)' : ''));
      }
      if (s.webhooks) {
        lines.push('Webhooks: ' + s.webhooks.created + ' created' +
          (s.webhooks.skipped ? ', ' + s.webhooks.skipped + ' skipped (URL already present)' : ''));
      }
      statusEl.style.color = '#306020';
      statusEl.innerHTML = '<strong>Pushed.</strong><br>' + lines.map(escapeHtml).join('<br>');
    } catch (e) {
      statusEl.textContent = 'Sync request failed: ' + e.message;
      statusEl.style.color = '#b04040';
      submit.disabled = false;
    }
  }

  function openExportFlow() {
    // Download a JSON snapshot of this host's chains + channels
    // (+ optionally webhooks). Same shape /api/sync/accept consumes,
    // so the file can be pushed to a peer OR re-imported here.
    var host = document.getElementById('configProfileDanger');
    if (!host) return;
    host.style.display = 'block';
    host.innerHTML =
      '<div class="config-pair-form">' +
      '  <p class="config-pair-head">Export config to file</p>' +
      '  <p class="config-note">Downloads a JSON snapshot of your chains + channels (no credentials). Re-importable on this host or pushable to a peer via the existing Push flow.</p>' +
      '  <div class="config-field">' +
      '    <span class="config-field-label">Include</span>' +
      '    <div class="config-sync-categories">' +
      '      <label><input type="checkbox" id="configExportChains" checked> Chains</label>' +
      '      <label><input type="checkbox" id="configExportChannels" checked> Channels <span class="config-note" style="margin:0;">(no credentials)</span></label>' +
      '      <label><input type="checkbox" id="configExportWebhooks"> Webhooks ' +
      '        <span class="config-note" style="margin:0;color:#a65030;">\u26a0 includes embedded bot tokens. Only enable for personal backup files.</span>' +
      '      </label>' +
      '    </div>' +
      '  </div>' +
      '  <div class="config-row" style="margin-top:0.6rem;">' +
      '    <button class="config-btn config-btn-primary" id="configExportSubmit">Download</button>' +
      '    <button class="config-btn" id="configExportCancel">Cancel</button>' +
      '  </div>' +
      '  <div class="config-note" id="configExportStatus" style="margin-top:0.4rem;"></div>' +
      '</div>';
    document.getElementById('configExportCancel').addEventListener('click', closeProfileDanger);
    document.getElementById('configExportSubmit').addEventListener('click', submitExport);
  }

  async function submitExport() {
    var include = {
      chains: document.getElementById('configExportChains').checked,
      channels: document.getElementById('configExportChannels').checked,
      webhooks: document.getElementById('configExportWebhooks').checked,
    };
    var statusEl = document.getElementById('configExportStatus');
    var btn = document.getElementById('configExportSubmit');
    if (!include.chains && !include.channels && !include.webhooks) {
      statusEl.textContent = 'Pick at least one category to export.';
      statusEl.style.color = '#b04040';
      return;
    }
    if (include.webhooks) {
      var ok = window.confirm(
        'Webhooks include embedded Discord/Slack bot tokens. The ' +
        'downloaded file will contain those tokens in plaintext.\n\n' +
        'Only download to a location you trust (personal backup).'
      );
      if (!ok) return;
    }
    btn.disabled = true;
    statusEl.textContent = 'Building snapshot\u2026';
    statusEl.style.color = '';
    try {
      var resp = await fetch('/api/sync/export', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ include: include }),
      });
      if (!resp.ok) {
        statusEl.textContent = 'Export failed (HTTP ' + resp.status + ')';
        statusEl.style.color = '#b04040';
        btn.disabled = false;
        return;
      }
      var data = await resp.json();
      var blob = new Blob([JSON.stringify(data, null, 2)],
                         {type: 'application/json'});
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      var stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url;
      a.download = 'mememage-config-' + stamp + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function() {
        URL.revokeObjectURL(url);
        a.remove();
      }, 1000);
      statusEl.style.color = '#306020';
      var counts = [];
      if (data.chains) counts.push(data.chains.length + ' chain(s)');
      if (data.channels) counts.push(data.channels.length + ' channel(s)');
      if (data.webhooks) counts.push(data.webhooks.length + ' webhook(s)');
      statusEl.innerHTML = '<strong>Downloaded.</strong> ' + counts.join(', ') + '.';
      btn.disabled = false;
    } catch (e) {
      statusEl.textContent = 'Export request failed: ' + e.message;
      statusEl.style.color = '#b04040';
      btn.disabled = false;
    }
  }

  function openImportFlow() {
    // File picker + apply to /api/sync/accept (same endpoint peer
    // pushes use — additive on this host).
    var host = document.getElementById('configProfileDanger');
    if (!host) return;
    host.style.display = 'block';
    host.innerHTML =
      '<div class="config-pair-form">' +
      '  <p class="config-pair-head">Import config from file</p>' +
      '  <p class="config-note">Reads a JSON file previously produced by Export config (or a peer\u2019s sync export). Applies additively \u2014 entries this host already has are kept untouched, new ones are appended.</p>' +
      '  <div class="config-field">' +
      '    <span class="config-field-label">File</span>' +
      '    <input class="config-input" type="file" id="configImportFile" accept="application/json,.json">' +
      '  </div>' +
      '  <div class="config-row" style="margin-top:0.6rem;">' +
      '    <button class="config-btn config-btn-primary" id="configImportSubmit">Import</button>' +
      '    <button class="config-btn" id="configImportCancel">Cancel</button>' +
      '  </div>' +
      '  <div class="config-note" id="configImportStatus" style="margin-top:0.4rem;"></div>' +
      '</div>';
    document.getElementById('configImportCancel').addEventListener('click', closeProfileDanger);
    document.getElementById('configImportSubmit').addEventListener('click', submitImport);
  }

  async function submitImport() {
    var fileEl = document.getElementById('configImportFile');
    var statusEl = document.getElementById('configImportStatus');
    var btn = document.getElementById('configImportSubmit');
    if (!fileEl.files || !fileEl.files[0]) {
      statusEl.textContent = 'Pick a JSON file to import.';
      statusEl.style.color = '#b04040';
      return;
    }
    btn.disabled = true;
    statusEl.textContent = 'Applying\u2026';
    statusEl.style.color = '';
    try {
      var text = await fileEl.files[0].text();
      var data;
      try { data = JSON.parse(text); }
      catch (e) {
        statusEl.textContent = 'Invalid JSON: ' + e.message;
        statusEl.style.color = '#b04040';
        btn.disabled = false;
        return;
      }
      // Strip the envelope before forwarding — sync/accept just wants
      // the categories. Forwarding mememage_config_export / exported_at /
      // host wouldn't break anything but reads as noise.
      var payload = {};
      if (Array.isArray(data.chains)) payload.chains = data.chains;
      if (Array.isArray(data.channels)) payload.channels = data.channels;
      if (Array.isArray(data.webhooks)) payload.webhooks = data.webhooks;
      var resp = await fetch('/api/sync/accept', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      var body;
      try { body = await resp.json(); } catch (e) { body = {}; }
      if (!resp.ok) {
        statusEl.textContent = body.error || 'Import failed (HTTP ' + resp.status + ')';
        statusEl.style.color = '#b04040';
        btn.disabled = false;
        return;
      }
      var s = body.summary || {};
      var lines = [];
      if (s.chains) {
        lines.push('Chains: ' + s.chains.created.length + ' created' +
          (s.chains.skipped.length ? ', ' + s.chains.skipped.length + ' skipped' : ''));
      }
      if (s.channels) {
        lines.push('Channels: ' + s.channels.created.length + ' created' +
          (s.channels.skipped.length ? ', ' + s.channels.skipped.length + ' skipped' : ''));
      }
      if (s.webhooks) {
        lines.push('Webhooks: ' + s.webhooks.created + ' created' +
          (s.webhooks.skipped ? ', ' + s.webhooks.skipped + ' skipped' : ''));
      }
      statusEl.style.color = '#306020';
      statusEl.innerHTML = '<strong>Imported.</strong><br>' + lines.map(escapeHtml).join('<br>');
      // Refresh adjacent panels so the new chains/channels appear.
      try { if (typeof loadChannels === 'function') loadChannels(); } catch (e) {}
      try { if (typeof loadChains === 'function') loadChains(); } catch (e) {}
      btn.disabled = false;
    } catch (e) {
      statusEl.textContent = 'Import request failed: ' + e.message;
      statusEl.style.color = '#b04040';
      btn.disabled = false;
    }
  }

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
      '    <input class="config-input" id="configPairToken" type="text" autocomplete="off" spellcheck="false" placeholder="peer\u2019s MINT_API_TOKEN (the peer\u2019s, not this host\u2019s)">' +
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

  async function openScopeChannels(pid, allProfiles) {
    // Editor for the profile's channel allow-list. Fetches the live
    // channel list so users can check boxes against whatever's
    // currently configured (including ones added after this profile).
    var zone = document.getElementById('configProfileDanger');
    zone.style.display = '';
    zone.innerHTML =
      '<h4>Channel scope: ' + escapeHtml(pid) + '</h4>' +
      '<p>Restrict which channels this profile publishes to. Affects souls AND keychain records (succession, revocation, alias) signed by this profile. Leave <em>all unchecked</em> to use every enabled channel (default).</p>' +
      '<p class="config-note">Use case: a VPS-only profile that shouldn\u2019t leak its key rotations / aliases to the public Internet Archive index. Keep the IA box unchecked here and the keychain records will only land on your peer surfaces.</p>' +
      '<div id="configProfileScopeBoxes" class="config-profile-scope-list"><em>Loading channels\u2026</em></div>' +
      '<div class="config-row">' +
      '  <button class="config-btn" id="configProfileScopeGo">Save</button>' +
      '  <button class="config-btn" id="configProfileScopeCancel">Cancel</button>' +
      '</div>' +
      '<div id="configProfileScopeStatus" class="config-note"></div>';
    document.getElementById('configProfileScopeCancel').addEventListener('click', closeProfileDanger);

    var boxesEl = document.getElementById('configProfileScopeBoxes');
    var current = [];
    (allProfiles || []).forEach(function(pp) {
      if (pp.id === pid && Array.isArray(pp.channels)) current = pp.channels;
    });
    try {
      var data = await fetchJson('/api/channels');
      var channels = data.channels || [];
      if (!channels.length) {
        boxesEl.innerHTML = '<em>No channels configured. Add some in the Channels section first.</em>';
        return;
      }
      var rowsHtml = channels.map(function(c) {
        var checked = current.indexOf(c.id) >= 0;
        return '<label class="config-profile-scope-row">' +
          '<input type="checkbox" data-channel-id="' + escapeHtml(c.id) + '"' +
          (checked ? ' checked' : '') + '> ' +
          '<span class="config-profile-scope-id">' + escapeHtml(c.id) + '</span>' +
          '<span class="config-profile-scope-meta">' + escapeHtml(c.type || '') +
            (c.primary ? ' \u00b7 primary' : '') + '</span>' +
          '</label>';
      }).join('');
      boxesEl.innerHTML = rowsHtml;
    } catch (e) {
      boxesEl.innerHTML = 'Failed to load channels: ' + escapeHtml(e.message);
    }

    document.getElementById('configProfileScopeGo').addEventListener('click', async function() {
      var picked = [];
      boxesEl.querySelectorAll('input[type=checkbox]').forEach(function(cb) {
        if (cb.checked) picked.push(cb.getAttribute('data-channel-id'));
      });
      var statusEl = document.getElementById('configProfileScopeStatus');
      var btn = document.getElementById('configProfileScopeGo');
      btn.disabled = true;
      statusEl.textContent = 'Saving\u2026';
      statusEl.style.color = '';
      try {
        await fetchJson('/api/profiles/channels', {
          method: 'POST', headers: authHeaders(),
          body: JSON.stringify({
            profile_id: pid,
            // Empty array clears the override server-side (= "all
            // enabled channels"). User-friendly: unchecking everything
            // means "no restriction" rather than "publish to nothing".
            channels: picked.length ? picked : null,
          }),
        });
        closeProfileDanger();
        await loadProfiles();
      } catch (e) {
        statusEl.textContent = 'Failed: ' + e.message;
        statusEl.style.color = '#b04040';
        btn.disabled = false;
      }
    });
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

  // Keyboard polish: Esc closes whichever inline drawer is open inside
  // configProfileDanger (Pair / Push / Export / Import / Scope / Alias
  // / Remove / New profile / Import key / Rotate / Revoke / Keygen).
  // Cancel buttons stay — Esc is just the extra path.
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    var zone = document.getElementById('configProfileDanger');
    if (!zone || zone.style.display === 'none' || !zone.innerHTML) return;
    // Don't fight with the glossary / palette modals — those have their
    // own Esc handlers and intercept before bubble. If a modal is
    // visible, defer to it.
    if (document.querySelector('.config-modal:not([hidden])')) return;
    closeProfileDanger();
  });

  // Enter submits the primary action when focus is inside a drawer.
  // The drawer's primary submit button always has the
  // .config-btn-primary class and lives inside .config-pair-form (or
  // its sibling shapes — we just look for the first primary button).
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter') return;
    // Skip if the focused element is a textarea / select / type=button
    // — Enter has its own semantics there. We only auto-submit on
    // single-line text / password / search / checkbox / radio inputs.
    var t = e.target;
    if (!t) return;
    var tag = (t.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'select') return;
    if (tag === 'input') {
      var inputType = (t.type || 'text').toLowerCase();
      if (inputType !== 'text' && inputType !== 'password' && inputType !== 'search' &&
          inputType !== 'email' && inputType !== 'number' && inputType !== 'url') {
        return;
      }
    } else if (tag !== 'body') {
      return;
    }
    var zone = document.getElementById('configProfileDanger');
    if (!zone || zone.style.display === 'none' || !zone.contains(t)) return;
    var primary = zone.querySelector('.config-btn-primary');
    if (primary && !primary.disabled) {
      e.preventDefault();
      primary.click();
    }
  });

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

  async function openChannelsRawModal() {
    var existing = document.getElementById('configChannelsRawModal');
    if (existing) existing.remove();

    var modal = document.createElement('div');
    modal.id = 'configChannelsRawModal';
    modal.className = 'config-modal config-modal-channels-raw';
    modal.innerHTML =
      '<div class="config-modal-card">' +
      '  <div class="config-modal-head">' +
      '    <span>channels.json (read-only)</span>' +
      '    <button type="button" class="config-modal-close" aria-label="Close">\u00d7</button>' +
      '  </div>' +
      '  <pre class="config-modal-pre" id="configChannelsRawBody">Loading\u2026</pre>' +
      '  <div class="config-modal-foot">' +
      '    <span class="config-note">Edit through the dashboard fields above. This view is for inspection only \u2014 paste-edits won\u2019t persist.</span>' +
      '    <button type="button" class="config-btn" id="configChannelsRawCopy">Copy</button>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(modal);

    function close() { modal.remove(); }
    modal.querySelector('.config-modal-close').addEventListener('click', close);
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
    });

    var bodyEl = document.getElementById('configChannelsRawBody');
    try {
      var resp = await fetch('/api/channels/raw', { headers: authHeaders() });
      if (!resp.ok) {
        bodyEl.textContent = 'Failed to load (HTTP ' + resp.status + ')';
        return;
      }
      var text = await resp.text();
      bodyEl.textContent = text;
    } catch (e) {
      bodyEl.textContent = 'Failed to load: ' + e.message;
    }

    var copyBtn = document.getElementById('configChannelsRawCopy');
    if (copyBtn) {
      copyBtn.addEventListener('click', async function() {
        try {
          await navigator.clipboard.writeText(bodyEl.textContent);
          var prev = copyBtn.textContent;
          copyBtn.textContent = 'Copied';
          setTimeout(function() { copyBtn.textContent = prev; }, 1200);
        } catch (e) { /* clipboard blocked — ignore */ }
      });
    }
  }

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
      '  <button type="button" class="config-btn config-btn-subtle advanced-only" id="configChannelViewRaw">View raw JSON\u2026</button>' +
      '</div>' +
      '<p class="config-note">The <strong>primary</strong> channel\u2019s URL becomes the bar\u2019s record link and the Discord notification target. Every enabled+configured channel receives a copy of the soul on every mint; at least one must succeed. Credentials always live in <code>.env</code> — fields below name the env var to read.</p>';

    // Wire row controls
    channels.forEach(function(c, i) {
      _wireChannelRow(host, c, i);
    });

    // Wire add-channel button
    var addBtn = document.getElementById('configChannelAddBtn');
    if (addBtn) addBtn.addEventListener('click', addChannel);

    // Wire "View raw JSON" — opens a read-only modal with the
    // current channels.json file contents. Useful for debugging
    // when the dashboard UI doesn't expose a field (legacy keys,
    // hand-edits, etc.).
    var rawBtn = document.getElementById('configChannelViewRaw');
    if (rawBtn) rawBtn.addEventListener('click', openChannelsRawModal);
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
            '<span class="config-password-wrap">' +
              '<input class="config-input config-channel-field-input" data-channel-secret="' + escapeHtml(envVar) + '" type="password" autocomplete="off" ' +
                     'placeholder="' + (isSet ? '(set \u2014 type to replace)' : '(unset)') + '">' +
              '<button type="button" class="config-password-toggle" data-pw-toggle aria-label="Show password" title="Show password">\ud83d\udc41</button>' +
            '</span>' +
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

    // Primary channel gets a row-level marker + star next to its name
    // input so the canonical "this is the URL in the bar" channel is
    // obvious at a glance, not buried in a status pill.
    var primaryClass = c.primary ? ' config-channel-row-primary' : '';
    var primaryStar = c.primary
      ? '<span class="config-channel-primary-star" title="Primary channel — its URL becomes record.url (bar reference, Discord toast)">\u2605</span>'
      : '';
    return '' +
      '<div class="config-channel-row' + primaryClass + '" data-channel-idx="' + idx + '" data-channel-id="' + escapeHtml(c.id) + '">' +
        '<div class="config-channel-head">' +
          '<div class="config-channel-labels">' +
            '<label class="config-channel-label-row">' +
              '<span class="config-channel-label-key">name</span>' +
              '<span class="config-channel-name-wrap">' + primaryStar +
                '<input class="config-input config-channel-name-input" data-channel-name type="text" value="' + escapeHtml(c.name || '') + '" placeholder="' + escapeHtml(displayName) + '">' +
              '</span>' +
              '<span class="config-channel-label-hint">local dashboard label</span>' +
            '</label>' +
            '<label class="config-channel-label-row">' +
              '<span class="config-channel-label-key">id</span>' +
              '<input class="config-input config-channel-id-input" data-channel-id-input type="text" value="' + escapeHtml(c.id) + '" pattern="[A-Za-z0-9_-]+">' +
              '<span class="config-channel-label-hint">appears on viewer certificates</span>' +
            '</label>' +
          '</div>' +
          '<span class="config-channel-type">' + escapeHtml(displayName) + '</span>' +
          '<span class="config-channel-status">' + statusBits.join(' ') + '</span>' +
        '</div>' +
        '<div class="config-channel-controls">' +
          '<label><input type="checkbox" data-channel-enabled' + (c.enabled ? ' checked' : '') + '> enabled</label>' +
          '<label><input type="radio" name="channelPrimary" data-channel-primary' + (c.primary ? ' checked' : '') + '> primary</label>' +
          '<button type="button" class="config-btn config-channel-remove" data-channel-remove>Remove</button>' +
        '</div>' +
        // Credential overrides + non-essential config rows live behind
        // the Advanced toggle — most users don't override env-var names
        // or fiddle with content_type / extra headers / accept_self_signed.
        // The dashboard's default channel set (IA, Zenodo, self-push)
        // works without ever opening these.
        (credFields ? '<div class="config-channel-fields advanced-only">' + credFields + '</div>' : '') +
        (cfgFields ? '<div class="config-channel-fields advanced-only">' + cfgFields + '</div>' : '') +
      '</div>';
  }

  function _wireChannelRow(host, channel, idx) {
    var row = host.querySelector('[data-channel-idx="' + idx + '"]');
    if (!row) return;

    // Inputs that affect channels.json — enabled, primary, config
    // fields (data-channel-cfg), name, and id. Saved via /api/channels
    // on change. Text inputs commit on blur or Enter so users don't
    // round-trip per keystroke.
    var channelInputs = row.querySelectorAll('[data-channel-enabled], [data-channel-primary], [data-channel-cfg]');
    channelInputs.forEach(function(inp) {
      inp.addEventListener('change', function() { saveChannelsFromDom(host); });
    });
    var textCommitInputs = row.querySelectorAll('[data-channel-name], [data-channel-id-input]');
    textCommitInputs.forEach(function(inp) {
      var initial = inp.value;
      inp.addEventListener('blur', function() {
        if (inp.value === initial) return;
        saveChannelsFromDom(host);
        initial = inp.value;
      });
      inp.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          inp.blur();
        }
      });
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
      // Prefer the editable id input if present; fall back to the
      // data-channel-id attribute (the id at render time) so unaffected
      // rows still serialize correctly.
      var idInput = row.querySelector('[data-channel-id-input]');
      var id = (idInput ? idInput.value.trim() : row.getAttribute('data-channel-id'));
      var enabled = !!row.querySelector('[data-channel-enabled]').checked;
      var primary = !!row.querySelector('[data-channel-primary]').checked;
      var nameInput = row.querySelector('[data-channel-name]');
      var displayName = nameInput ? nameInput.value.trim() : id;
      // The type isn't editable inline; recover from the server's last
      // snapshot via _lastChannelsByIdx.
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
          // Password state phrasing surfaces the contract for the user.
          // We say "password set" / "GPS password" rather than "sealed" —
          // "Seal Age" is the other primary use of that verb (site-pack
          // sealing) and people mistake one for the other.
          // The DARK/LIGHT chip in the badge head already carries
          // visibility, so the detail row drops the vis word. Password
          // presence collapses to a lock glyph: lock = password set,
          // no lock = public (instantly recognizable, no prose). The
          // notready dot already flags a dark chain that still NEEDS a
          // password, so absence of a lock there isn't mistaken for
          // "public" \u2014 the red state speaks first.
          var gpsSource = c.gps_source || 'phone';
          var prefix = c.identifier_prefix || 'mememage';
          var metaParts = [];
          if (pwSet) metaParts.push('\ud83d\udd12');  // \ud83d\udd12 password present
          metaParts.push(prefix + '-XXXX');            // namespace shape
          if (c.created_at) metaParts.push(c.created_at.slice(0, 10));
          var meta = metaParts.join(' \u00b7 ');
          var renameBtn = '<button class="config-btn" data-chain-action="rename" data-chain-id="' + escapeHtml(c.id) + '" data-chain-name="' + escapeHtml(c.name || c.id) + '" title="Change display name (visibility is locked at creation)">Rename</button>';
          // Password gating + Remove are advanced — most chains run public
          // (light) without a password, and removing a chain is rare.
          var pwBtn = '<button class="config-btn advanced-only" data-chain-action="password" data-chain-id="' + escapeHtml(c.id) + '" data-chain-vis="' + escapeHtml(vis) + '" data-pw-set="' + (pwSet ? '1' : '0') + '">' + (pwSet ? 'Change password\u2026' : 'Set password\u2026') + '</button>';
          var removeBtn = isActive
            ? '<button class="config-btn advanced-only" data-chain-action="remove" data-chain-id="' + escapeHtml(c.id) + '" disabled title="Switch to a different chain first">Remove</button>'
            : '<button class="config-btn advanced-only" data-chain-action="remove" data-chain-id="' + escapeHtml(c.id) + '">Remove</button>';
          // The leftmost "mark" cell carries the active state for
          // active chains (replaces the ▶ triangle); non-active chains
          // get the Switch button there instead. Pushes Rename / Set
          // password / Remove into a single tight actions row no
          // matter the chain's state.
          var switchBtn = isActive
            ? '<span class="config-chain-active-badge">active</span>'
            : '<button class="config-btn" data-chain-action="switch" data-chain-id="' + escapeHtml(c.id) + '">Switch</button>';
          var actions = switchBtn + renameBtn + pwBtn + removeBtn;
          // GPS source radio: three modes, persisted to chain.json on
          // change. Kept inline with the chain row so the Mint tab can
          // stay "drop image here" — the source decision lives here,
          // once, per chain.
          // advanced-only lives on the outer cell — putting it on
          // .config-chain-gps would trigger display: revert (block)
          // and break the flex layout that stacks the radios on mobile.
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
          // The row LEADS with the shared chain badge (identity +
          // readiness), then the action buttons, then the GPS radios.
          // Chain detail (prefix / created / pw contract) rides in the
          // badge's .below slot.
          var detail = '<span class="config-chain-state" data-vis="' + escapeHtml(vis) +
            '" data-pw-set="' + (pwSet ? '1' : '0') + '">' + escapeHtml(meta) + '</span>';
          var badge = ChainBadge.labeled({
            id: c.id, name: c.name, visibility: vis,
            readiness: c.readiness, below: detail,
            idAndName: true,  // Config is where the id lives — show id · name
          });
          return '<div class="config-chain-row" data-active="' + (isActive ? '1' : '0') + '">' +
            '<div class="config-chain-badge-cell">' + badge + '</div>' +
            '<div class="config-chain-actions">' + actions + '</div>' +
            '<div class="config-chain-gps-cell advanced-only">' + gpsRadio + '</div>' +
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
      '  <div class="config-field advanced-only"><span class="config-field-label">Prefix</span>' +
      '    <input class="config-input" id="configChainNewPrefix" type="text" maxlength="10" placeholder="mememage (default)" pattern="^[A-Za-z][A-Za-z0-9_-]{1,8}[A-Za-z0-9]$"></div>' +
      '  <p class="config-note advanced-only" id="configChainNewPrefixHint" style="margin-top:0;">' +
      '    Optional. Sets the identifier shape for this chain: <code>&lt;prefix&gt;-&lt;16 hex&gt;</code>. ' +
      '    Leave blank to use the default <code>mememage</code>. ' +
      '    Letters (any case), digits, <code>-</code>, <code>_</code>; 3\u201310 chars; ' +
      '    must start with a letter and end with a letter or digit. ' +
      '    Case is preserved \u2014 <code>MeMeMaGe</code> and <code>mememage</code> are distinct on IA. ' +
      '    <strong>Locked at creation.</strong>' +
      '  </p>' +
      '  <div class="config-field advanced-only"><span class="config-field-label">Visibility</span><span>' +
      '    <label style="margin-right:1rem"><input type="radio" name="newChainVis" value="light_energy" checked> light</label>' +
      '    <label><input type="radio" name="newChainVis" value="dark_matter"> dark</label></span></div>' +
      '  <div class="config-field advanced-only"><span class="config-field-label">Password</span>' +
      '    <span class="config-password-wrap">' +
      '      <input class="config-input" id="configChainNewPw" type="password" autocomplete="off" placeholder="(optional for light, required for dark)">' +
      '      <button type="button" class="config-password-toggle" data-pw-toggle aria-label="Show password" title="Show password">\ud83d\udc41</button>' +
      '    </span></div>' +
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
      '<p class="config-note">Switching chains updates the Payload tab and routes new conceptions / seals to the chosen chain immediately \u2014 no restart needed.</p>';

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
      '  <span class="config-password-wrap">' +
      '    <input class="config-input" id="configChainPwInput" type="password" autocomplete="off" placeholder="' + (currentlySet ? 'type new password to change' : 'leave empty to skip') + '">' +
      '    <button type="button" class="config-password-toggle" data-pw-toggle aria-label="Show password" title="Show password">\ud83d\udc41</button>' +
      '  </span>' +
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
              ? 'Conceptions will fail until you set a new one (or pass MEMEMAGE_PASSWORD in env).'
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
        'Conceptions and seals are routed to this chain immediately.'
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
    var idEl     = document.getElementById('configChainNewId');
    var nameEl   = document.getElementById('configChainNewName');
    var visEl    = document.querySelector('input[name="newChainVis"]:checked');
    var pwEl     = document.getElementById('configChainNewPw');
    var prefixEl = document.getElementById('configChainNewPrefix');
    var chainId = idEl ? idEl.value.trim() : '';
    if (!chainId) { showError('Chain ID required.'); return; }
    var visibility = visEl ? visEl.value : 'light_energy';
    var name = nameEl ? nameEl.value.trim() : '';
    var password = pwEl ? pwEl.value : '';
    var prefix = prefixEl ? prefixEl.value.trim() : '';
    // Front-load the contract: Dark chains MUST have a password to
    // function. Catch this in the UI before the round-trip.
    if (visibility === 'dark_matter' && !password) {
      showError('Dark chains require a password. Set one now or pick Light visibility.');
      return;
    }
    // Front-load the prefix format check so the user sees the rule in
    // the form (the server enforces it authoritatively too). Case is
    // preserved — IA treats different cases as different identifiers.
    if (prefix && !/^[A-Za-z][A-Za-z0-9_-]{1,8}[A-Za-z0-9]$/.test(prefix)) {
      showError('Prefix must be 3\u201310 chars: letters/digits/-/_, start with a letter, end with letter or digit.');
      return;
    }
    showError('');
    try {
      var body = {chain_id: chainId, name: name || chainId, visibility: visibility};
      if (prefix) body.identifier_prefix = prefix;
      await fetchJson('/api/chain/new', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify(body),
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

  // ===== Channel cleanup (pre-genesis maintenance) =====
  // Generic over any channel that implements search/hide/purge on its
  // Channel plugin. The /api/channels/capabilities endpoint reports
  // which operations each plugin supports — this UI greys out
  // unsupported actions per channel. IA is the only fully-featured
  // channel today; Zenodo and http_push declare no cleanup support
  // and the action buttons stay disabled for them until they do.
  var _ccChannels = [];   // [{id, type, name, capabilities, enabled, configured}]
  var _ccScanned = [];    // last scan result for the selected channel
  function _ccEl(id) { return document.getElementById(id); }
  function _ccLog(line, isError) {
    var log = _ccEl('configCcLog');
    if (!log) return;
    var div = document.createElement('div');
    div.className = 'config-cc-log-line' + (isError ? ' config-cc-log-err' : '');
    div.textContent = line;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }
  function _ccActiveChannel() {
    var id = (_ccEl('configCcChannel') || {}).value || '';
    return _ccChannels.find(function(c) { return c.id === id; }) || null;
  }
  function _ccSelectedIds() {
    return Array.prototype.slice.call(
      document.querySelectorAll('input[data-cc-select]:checked')
    ).map(function(c) { return c.getAttribute('data-cc-select'); });
  }
  function _ccUpdateActionVisibility() {
    var any = _ccSelectedIds().length > 0;
    var actions = _ccEl('configCcActions');
    if (actions) actions.hidden = !any;
    var ch = _ccActiveChannel();
    var caps = (ch && ch.capabilities) || {};
    var hideBtn = _ccEl('configCcHideBtn');
    var purgeBtn = _ccEl('configCcPurgeBtn');
    if (hideBtn)  hideBtn.disabled  = !(any && caps.hide);
    if (purgeBtn) purgeBtn.disabled = !(any && caps.purge);
  }
  function _ccRenderCaps() {
    var host = _ccEl('configCcCaps');
    var scanBtn = _ccEl('configCcScanBtn');
    if (!host) return;
    var ch = _ccActiveChannel();
    if (!ch) {
      host.innerHTML = '';
      if (scanBtn) scanBtn.disabled = true;
      return;
    }
    var caps = ch.capabilities || {};
    var parts = [];
    parts.push('<span class="config-cc-cap config-cc-cap-' + (caps.search ? 'yes' : 'no') + '">scan ' + (caps.search ? '\u2713' : '\u2717') + '</span>');
    parts.push('<span class="config-cc-cap config-cc-cap-' + (caps.hide ? 'yes' : 'no') + '">hide ' + (caps.hide ? '\u2713' : '\u2717') + '</span>');
    parts.push('<span class="config-cc-cap config-cc-cap-' + (caps.purge ? 'yes' : 'no') + '">purge ' + (caps.purge ? '\u2713' : '\u2717') + '</span>');
    var statusBits = [];
    if (!ch.enabled) statusBits.push('disabled');
    if (!ch.configured) statusBits.push('credentials missing');
    var statusStr = statusBits.length ? ' (' + statusBits.join(', ') + ')' : '';
    host.innerHTML = '<span class="config-cc-cap-label">' +
      escapeHtml(ch.name) + ' [' + escapeHtml(ch.type) + ']' + statusStr + ':</span> ' +
      parts.join(' ');
    // Cleanup only needs credentials, not the route-traffic flag. The
    // `enabled` field decides whether NEW mints fire on this channel —
    // orthogonal to "can we list / hide / purge what's already there".
    // A channel deliberately disabled (e.g. IA off to keep test mints
    // off the public archive) should still be cleanable from this UI.
    if (scanBtn) scanBtn.disabled = !(caps.search && ch.configured);
    _ccUpdateActionVisibility();
  }
  function _ccRenderResults() {
    var host = _ccEl('configCcResults');
    if (!host) return;
    if (!_ccScanned.length) {
      host.innerHTML = '<p class="config-note">No items matched. Try a different filter.</p>';
      _ccEl('configCcSelectAll').disabled = true;
      _ccEl('configCcSelectNone').disabled = true;
      _ccUpdateActionVisibility();
      return;
    }
    var rows = _ccScanned.map(function(it) {
      var size = it.item_size || it.size || 0;
      var sizeStr;
      try {
        var n = parseInt(size, 10);
        if (isNaN(n) || n <= 0) sizeStr = '?';
        else if (n > 1024 * 1024) sizeStr = (n / (1024 * 1024)).toFixed(1) + 'MB';
        else if (n > 1024) sizeStr = (n / 1024).toFixed(1) + 'KB';
        else sizeStr = n + 'B';
      } catch (e) { sizeStr = '?'; }
      var date = (it.publicdate || it.date || '').slice(0, 10);
      var ident = it.identifier || '';
      var url = it.url || '#';
      return (
        '<tr class="config-cc-row">' +
        '<td><input type="checkbox" data-cc-select="' + escapeHtml(ident) + '"></td>' +
        '<td><a href="' + escapeHtml(url) + '" target="_blank" rel="noopener" class="config-cc-ident">' + escapeHtml(ident) + '</a></td>' +
        '<td>' + escapeHtml(date) + '</td>' +
        '<td>' + escapeHtml(sizeStr) + '</td>' +
        '</tr>'
      );
    }).join('');
    host.innerHTML =
      '<table class="config-cc-table">' +
      '<thead><tr><th></th><th>Identifier</th><th>Date</th><th>Size</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';
    _ccEl('configCcSelectAll').disabled = false;
    _ccEl('configCcSelectNone').disabled = false;
    host.querySelectorAll('input[data-cc-select]').forEach(function(c) {
      c.addEventListener('change', _ccUpdateActionVisibility);
    });
    _ccUpdateActionVisibility();
  }
  async function _ccLoadChannels() {
    try {
      var resp = await fetchJson('/api/channels/capabilities');
      _ccChannels = (resp && resp.channels) || [];
    } catch (e) {
      _ccChannels = [];
    }
    var sel = _ccEl('configCcChannel');
    if (sel) {
      if (!_ccChannels.length) {
        sel.innerHTML = '<option value="">(no channels configured)</option>';
      } else {
        sel.innerHTML = _ccChannels.map(function(c) {
          return '<option value="' + escapeHtml(c.id) + '">' +
            escapeHtml(c.name) + ' [' + escapeHtml(c.type) + ']' +
            '</option>';
        }).join('');
      }
    }
    _ccRenderCaps();
  }
  async function _ccScan() {
    var ch = _ccActiveChannel();
    if (!ch) return;
    var btn = _ccEl('configCcScanBtn');
    var summary = _ccEl('configCcSummary');
    var prev = btn.textContent;
    btn.disabled = true; btn.textContent = 'Scanning\u2026';
    if (summary) summary.textContent = '';
    _ccEl('configCcResults').innerHTML = '';
    _ccEl('configCcLog').innerHTML = '';
    try {
      var body = {
        uploader: (_ccEl('configCcUploader').value || '').trim(),
        collection: (_ccEl('configCcCollection').value || '').trim(),
        pattern: (_ccEl('configCcPattern').value || 'mememage-*').trim(),
        limit: parseInt(_ccEl('configCcLimit').value || '100', 10) || 100,
      };
      var resp = await fetchJson('/api/channel/' + encodeURIComponent(ch.id) + '/scan', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      _ccScanned = (resp && resp.items) || [];
      if (summary) {
        summary.textContent = 'Found ' + _ccScanned.length + ' item' +
          (_ccScanned.length === 1 ? '' : 's') + ' on ' + ch.name + '.';
      }
      _ccRenderResults();
    } catch (e) {
      _ccEl('configCcResults').innerHTML =
        '<p class="config-note config-cc-err">Scan failed: ' + escapeHtml(e.message) + '</p>';
    } finally {
      btn.disabled = false; btn.textContent = prev;
    }
  }
  async function _ccAction(kind) {
    var ch = _ccActiveChannel();
    if (!ch) return;
    var ids = _ccSelectedIds();
    if (!ids.length) return;
    var verb = kind === 'hide' ? 'HIDE' : 'PURGE';
    var human = kind === 'hide'
      ? 'HIDE ' + ids.length + ' item(s) on ' + ch.name + ' — invisible to public discovery (channel-specific semantics)'
      : 'PURGE ' + ids.length + ' item(s) on ' + ch.name + ' — irreversible content removal';
    var typed = window.prompt(
      'About to ' + human + '.\n\n' +
      'The identifier may remain reserved on the channel (e.g. IA never releases a namespace).\n\n' +
      'Type ' + verb + ' to confirm:'
    );
    if (typed !== verb) return;
    var route = '/api/channel/' + encodeURIComponent(ch.id) + '/' + kind;
    var btn = _ccEl(kind === 'hide' ? 'configCcHideBtn' : 'configCcPurgeBtn');
    var prev = btn.textContent;
    btn.disabled = true; btn.textContent = (kind === 'hide' ? 'Hiding' : 'Purging') + '\u2026';
    _ccEl('configCcLog').innerHTML = '';
    try {
      var resp = await fetchJson(route, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ identifiers: ids, confirm: verb }),
      });
      if (kind === 'hide') {
        _ccLog('Hide: ' + resp.succeeded + ' / ' + resp.processed + ' succeeded.');
      } else {
        _ccLog('Purge: ' + resp.files_deleted + ' files deleted, ' + resp.files_failed + ' failed.');
      }
      // Track which identifiers came back clean so we can drop them
      // from the local scan cache and re-render — otherwise the user
      // sees stale rows pointing at items that no longer exist on the
      // channel until they manually re-scan.
      var clearedIds = {};
      (resp.results || []).forEach(function(r) {
        if (kind === 'hide') {
          _ccLog((r.ok ? '\u2713 ' : '\u2717 ') + r.identifier + (r.ok ? '' : ' \u2014 ' + (r.error || 'failed')), !r.ok);
          if (r.ok) clearedIds[r.identifier] = true;
        } else {
          var bad = (r.errors || []).length > 0 || r.failed > 0;
          _ccLog((bad ? '\u26a0 ' : '\u2713 ') + r.identifier + ' \u2014 ' +
                 (r.deleted || 0) + '/' + (r.files || 0) + ' files deleted', bad);
          (r.errors || []).slice(0, 3).forEach(function(e) { _ccLog('    ' + e, true); });
          if (!bad) clearedIds[r.identifier] = true;
        }
      });
      if (Object.keys(clearedIds).length) {
        _ccScanned = _ccScanned.filter(function(it) {
          return !clearedIds[it.identifier];
        });
        var summary = _ccEl('configCcSummary');
        if (summary) {
          summary.textContent = _ccScanned.length
            ? _ccScanned.length + ' item' + (_ccScanned.length === 1 ? '' : 's') + ' remaining on ' + ch.name + '.'
            : 'No items remaining on ' + ch.name + '.';
        }
        _ccRenderResults();
      }
    } catch (e) {
      _ccLog(verb + ' failed: ' + e.message, true);
    } finally {
      btn.disabled = false; btn.textContent = prev;
      _ccUpdateActionVisibility();  // re-derive from capabilities
    }
  }
  // Wire once. Lazy-load capabilities the first time the user opens
  // the section (details/summary toggle event).
  (function _wireChannelCleanup() {
    var section = document.querySelector('[data-section="channel-cleanup"]');
    if (section) section.addEventListener('toggle', function() {
      if (section.open && !_ccChannels.length) _ccLoadChannels();
    });
    var sel = _ccEl('configCcChannel');
    if (sel) sel.addEventListener('change', function() {
      // Channel switch wipes any prior channel's scan results and
      // log lines — keeping them visible alongside the new channel's
      // selection misleads (the screenshot from issue: switched to
      // http_push but the table still showed "Found 19 items on IA").
      _ccScanned = [];
      var results = _ccEl('configCcResults');
      var log = _ccEl('configCcLog');
      var summary = _ccEl('configCcSummary');
      if (results) results.innerHTML = '';
      if (log) log.innerHTML = '';
      if (summary) summary.textContent = '';
      _ccEl('configCcSelectAll').disabled = true;
      _ccEl('configCcSelectNone').disabled = true;
      var actions = _ccEl('configCcActions');
      if (actions) actions.hidden = true;
      _ccRenderCaps();
    });
    var scan = _ccEl('configCcScanBtn');
    if (scan) scan.addEventListener('click', _ccScan);
    var selAll = _ccEl('configCcSelectAll');
    if (selAll) selAll.addEventListener('click', function() {
      document.querySelectorAll('input[data-cc-select]').forEach(function(c) { c.checked = true; });
      _ccUpdateActionVisibility();
    });
    var selNone = _ccEl('configCcSelectNone');
    if (selNone) selNone.addEventListener('click', function() {
      document.querySelectorAll('input[data-cc-select]').forEach(function(c) { c.checked = false; });
      _ccUpdateActionVisibility();
    });
    var h = _ccEl('configCcHideBtn');
    if (h) h.addEventListener('click', function() { _ccAction('hide'); });
    var p = _ccEl('configCcPurgeBtn');
    if (p) p.addEventListener('click', function() { _ccAction('purge'); });
  })();

  window.__loadConfigTab = function() {
    if (loaded) return;
    loaded = true;
    refresh();
  };
  // Refetches even if already loaded — for visibilitychange and the
  // pair-receive case: when another machine calls /api/profiles/pair
  // and the user tabs back to this dashboard, the profile list should
  // reflect the new peer profile without a manual reload.
  window.__refreshConfigTab = function() {
    if (!loaded) return;
    // Skip refresh if the user is actively typing in a Config input —
    // refresh() re-renders sections via innerHTML, which would yank focus
    // from the field they're typing in. The 20s background poll just
    // no-ops here; the user's edit completes, they blur, and the next
    // tick picks up.
    var ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) {
      var configPanel = document.getElementById('tab-config');
      if (configPanel && configPanel.contains(ae)) return;
    }
    // Skip refresh while a transient inline form is open. innerHTML
    // re-render would close the form and drop whatever the user typed.
    // The form has its own explicit Cancel/Submit buttons — those are
    // the only legit ways to dismiss it.
    //
    // Detection: + New chain has a dedicated wrapper with `hidden`,
    // while + New profile and Pair render directly into the danger
    // zone (no wrapper). Check for the existence of their first input
    // — present in the DOM iff the form is currently rendered.
    var chainForm = document.getElementById('configChainNewForm');
    if (chainForm && !chainForm.hidden) return;
    var transientInputs = [
      'configProfileNewId',     // + New profile
      'configPairUrl',          // Pair with another server
      'configProfileImportPath', // Import existing key
    ];
    for (var i = 0; i < transientInputs.length; i++) {
      if (document.getElementById(transientInputs[i])) return;
    }
    refresh();
  };
})();


// =====================================================================
// GLOSSARY — single source of truth for terminology, surfaced via a
// ? button in the page header and inline data-glossary="<term>"
// buttons throughout the dashboard. Click any of them → modal opens,
// optionally scrolled to the requested entry.
// =====================================================================
(function() {
  var modal = document.getElementById('glossaryModal');
  var listEl = document.getElementById('glossaryList');
  var searchEl = document.getElementById('glossarySearch');
  var openBtn = document.getElementById('glossaryOpenBtn');
  var closeBtn = document.getElementById('glossaryClose');
  if (!modal || !listEl) return;

  // Each entry: {id, label, body}. id is the slug used in
  // data-glossary attributes; label is what shows in the modal;
  // body is rendered as inline HTML (kept short — one paragraph).
  // Order is intentional: most-common terms first within each
  // group so a new user scanning top-down hits the essentials early.
  var ENTRIES = [
    // --- The model ---
    { id: 'soul', label: 'Soul',
      body: 'The metadata record — a structured JSON document carrying every fact about a conception. Stored as <code>.soul</code> files; lives wherever your channels carry it (peer mirror, archive, content-addressed network) plus your local disk. The soul is the meaning; the image is the body.' +
        '<pre class="glossary-snippet">{\n  "identifier":   "mememage-\u2026",\n  "content_hash": "\u2026",\n  "prompt":       "\u2026",\n  "birth":        { /* sky + machine + GPS */ },\n  "signature":    "\u2026",\n  /* \u2026more fields\u2026 */\n}</pre>' },
    { id: 'bar', label: 'Bar',
      body: 'The 2-pixel-tall steganographic strip at the bottom of every conceived image. Carries the identifier (so any decoder can look up the soul) and the content hash (so tampering is detectable). Reed-Solomon FEC + color delimiter bands make it survive JPEG re-encoding and crops down to common social-media sizes.' },
    { id: 'conception', label: 'Conception',
      body: 'The conscious act of binding a body (image) to a soul (metadata): the server hashes the record, signs it with your active key, writes the bar into the image, blasts the soul to your channels. GPS is mandatory by default; chains can opt out via <code>gps_source: none</code>.' },
    { id: 'identifier', label: 'Identifier',
      body: 'The key for finding a soul. Derived from the conception\u2019s essentials (prompt + seed + dimensions + timestamp on AI-gen chains; other inputs on other chain shapes). Lives in the bar; readers use it to fetch the soul from any source. Source-agnostic — no URL in the pixels themselves.' },
    { id: 'content_hash', label: 'Content hash',
      body: 'SHA-256 of the soul\u2019s canonical JSON, first 16 hex chars. Baked into the bar so anyone can verify a soul matches the image even when the file came from a stranger. The integrity authority — independent of where the soul was retrieved from.' },

    // --- Chains + Profiles ---
    { id: 'chain', label: 'Chain',
      body: 'A universe of conceptions. Multiple chains let one host run separate provenance streams (a public art chain, a password-gated private chain, a test chain). Each chain has its own Age cycle, records, visibility setting, and (optionally) password. Chain shape — cycle length, payload layout, GPS contract — is per-chain configuration.' },
    { id: 'chain_badge', label: 'Chain badge',
      body: 'The little badge shown on every chain — in Conceive, Payload, Config, on tickets, and on the conception page — so you always know which chain you’re on. It carries the <strong>official id</strong> (the slug, e.g. <code>watermark</code>) and the <strong>friendly name</strong> you can rename, plus a colored <strong>status dot</strong> that tells you the chain’s readiness at a glance:' +
        '<div class="glossary-badge-legend">' +
          '<div><span class="chain-dot" data-state="ready"></span> <strong>Green — Ready.</strong> Sealed and good to conceive. (Most chains, most of the time.)</div>' +
          '<div><span class="chain-dot" data-state="nopayload"></span> <strong>Yellow — No payload.</strong> Provenance still works; no payload distribution configured. Perfectly fine, just flagged.</div>' +
          '<div><span class="chain-dot" data-state="pending"></span> <strong>Orange (pulsing) — Update pending.</strong> A payload change is staged for the next Age but not yet applied.</div>' +
          '<div><span class="chain-dot" data-state="notready"></span> <strong>Red — Not ready.</strong> Can’t conceive yet: a dark chain needs its password, or the chain has no sealed Age.</div>' +
        '</div>' +
        'The dot always shows the most important state (red beats orange beats yellow beats green), and a matching word sits beside it so it reads without relying on color.' },
    { id: 'age', label: 'Age',
      body: 'A version epoch of a chain. Records minted during an Age share the same decoder, ruleset, and cycle-position counter. Sealing locks the Age in place; the next Age begins fresh. Cycle length is per-chain configuration — the demo chain runs a 365-position year, but any chain can define its own cadence.' },
    { id: 'constellation', label: 'Constellation',
      body: 'A group of conceptions sharing one decoder cycle within an Age. The first conception (the <em>heart star</em>) names the family from its sky and conditions; subsequent stars are lettered in conception order. Family claims (constellation name + heart star id + position) are tamper-evident in the content hash.' },
    { id: 'heart_star', label: 'Heart star',
      body: 'The first conception in a constellation — α. Its identifier names the family; the conditions at its conception (sky, vitals) seed the constellation\u2019s identity. Every subsequent star in the same constellation references back to this anchor.' },
    { id: 'profile', label: 'Profile',
      body: 'One Ed25519 signing identity. A human can carry many — typically one per machine — so a compromised VPS doesn\u2019t expose the laptop\u2019s primary key. Profiles link into one human identity via signed alias records, never via shared key bytes.' },
    { id: 'active_profile', label: 'Active profile',
      body: 'The profile whose key signs the next conception. One profile is active at a time per host. Switching is instant; the bar / notification / cert all reflect the new signer from the next conception onward.' },
    { id: 'alias', label: 'Alias',
      body: 'A signed record naming another profile as a sibling. When both profiles sign matching aliases pointing at each other (bidirectional), verifiers recognize the keys as one human even though they\u2019re different keys.' },
    { id: 'pair', label: 'Pair (cross-host alias handshake)',
      body: 'One-click cross-host pairing: this host calls the peer, both sides sign aliases naming the other, both records get published. Achieves a bidirectional alias in one round-trip without copying private keys.' },
    { id: 'sync', label: 'Sync (config push)',
      body: 'One-shot push of your chains + channels (+ optionally webhooks) to a peer host. Peer applies additively — existing entries are kept untouched. No private keys, no API tokens, no channel credentials cross the wire (webhooks excepted, with explicit opt-in).' },

    // --- Channels ---
    { id: 'channel', label: 'Channel',
      body: 'A pluggable destination for souls. Each enabled+configured channel receives a copy on every conception; at least one must succeed. The framework is type-agnostic — built-in types include <code>internet_archive</code>, <code>http_push</code> (peer host), and <code>zenodo</code>, and authors can register more (S3, IPFS, etc.).' },
    { id: 'primary', label: 'Primary channel',
      body: 'The one channel whose URL becomes <code>record.url</code> — the bar reference and the notification link. Exactly one channel can be primary at a time; promote / demote via the radio button or the Scope flow.' },
    { id: 'channel_scope', label: 'Channel scope (per-profile)',
      body: 'A profile can restrict which channels it publishes to. Privacy boundary: a VPS-only profile that shouldn\u2019t leak its rotations to a public archive marks itself scope=[peer-only]. Affects souls AND keychain records signed by that profile. None / empty = use every enabled channel (default).' },
    { id: 'distribution', label: 'Distribution',
      body: 'The server-side publish-results map (<code>{channel_id \u2192 url}</code>) returned by <code>channels.blast()</code>. Surfaced in webhook templates as <code>{{distribution}}</code> and in the dashboard handoff card after a mint completes. Not written into the soul itself \u2014 the artifact is surface-agnostic; mirror discovery is an operational concern handled by whoever serves the soul. Sovereignty signal lives in the system\u2019s design (any number of mirrors can serve any soul), not in a list baked into every record.' },

    // --- Sessions + Tickets ---
    { id: 'session', label: 'Session',
      body: 'A pending conception not yet confirmed. Created when an image is staged on the dashboard, completes when the conception page POSTs back (with GPS if the chain requires it). Lives 7 days unless explicitly deleted.' },
    { id: 'ticket', label: 'Ticket',
      body: 'Short 8-char prefix of a session token (e.g. <code>E33C9891</code>). Pasteable handle for resuming or deleting a pending session without dealing with the full token.' },

    // --- Verification badges ---
    { id: 'witnessed', label: 'WITNESSED',
      body: 'Hash match: the image\u2019s bar carries the same content_hash the soul claims. Body and soul are joined. Verifiable from any source — the hash is the authority.' },
    { id: 'authenticated', label: 'AUTHENTICATED',
      body: 'Ed25519 signature verifies: only the holder of the signing key could have produced this record. Browser-side TOFU (Trust On First Use) stores the creator name in localStorage; later records under the same fingerprint inherit it.' },
    { id: 'embodied', label: 'EMBODIED',
      body: 'Portrait match via dHash: the image you have IS the original body (not a re-encode that happens to share the bar). Post-conception thumbnail comparison — protected by signature, not by the content hash.' },

    // --- Chain visibility + GPS ---
    { id: 'light_energy', label: 'Light energy (visibility)',
      body: 'Public chain. Records are unencrypted; anyone with the identifier can fetch and verify the soul fully.' },
    { id: 'dark_matter', label: 'Dark matter (visibility)',
      body: 'Password-gated chain. Protected fields (prompt, GPS, designated soul fields) live encrypted; readers need the chain password to unlock. Public fields (identifier, content_hash) stay visible so the bar still verifies.' },
    { id: 'gps_source', label: 'GPS source',
      body: 'Chain-level setting controlling how location gets captured at conception: <code>phone</code> (browser <code>watchPosition</code>), <code>machine</code> (server-side IP geolocation, approximate), or <code>none</code> (no GPS recorded; record carries no time-lock puzzle).' },

    // --- Misc tech ---
    { id: 'halo', label: 'Halo',
      body: 'The name for a rare event: when the kernel\u2019s entropy at conception happens to contain the bar\u2019s magic bytes (<code>AD4E</code>) somewhere in the random hex. The image\u2019s identity radiating unbidden in pure noise. ~0.09% per conception; +10 rarity score when it lands.' },
    { id: 'hash_version', label: 'Hash version',
      body: 'Which inclusion set was used to compute this record\u2019s content_hash. Lets the system evolve which fields are tamper-evident without invalidating older records — verifiers dispatch on the field at hash time.' },
  ];

  // Build a lookup map for deep-linking.
  var BY_ID = {};
  ENTRIES.forEach(function(e) { BY_ID[e.id] = e; });

  function _renderList(filter) {
    var q = (filter || '').trim().toLowerCase();
    var html = '';
    ENTRIES.forEach(function(e) {
      if (q && e.label.toLowerCase().indexOf(q) < 0 && e.body.toLowerCase().indexOf(q) < 0) return;
      html += '<div class="glossary-entry" id="glossary-entry-' + e.id + '">' +
        '<h4 class="glossary-entry-label">' + e.label + '</h4>' +
        '<p class="glossary-entry-body">' + e.body + '</p>' +
      '</div>';
    });
    listEl.innerHTML = html || '<p class="glossary-empty"><em>No matches.</em></p>';
  }

  function open(focusId) {
    modal.hidden = false;
    _renderList('');
    if (searchEl) searchEl.value = '';
    if (focusId && BY_ID[focusId]) {
      // Scroll the entry into view inside the list container.
      var target = document.getElementById('glossary-entry-' + focusId);
      if (target) {
        target.scrollIntoView({behavior: 'smooth', block: 'start'});
        target.classList.add('glossary-entry-highlight');
        setTimeout(function() {
          if (target) target.classList.remove('glossary-entry-highlight');
        }, 1800);
      }
    } else if (searchEl) {
      searchEl.focus();
    }
  }

  function close() { modal.hidden = true; }

  if (openBtn) openBtn.addEventListener('click', function() { open(); });
  if (closeBtn) closeBtn.addEventListener('click', close);
  modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && !modal.hidden) close();
  });
  if (searchEl) {
    searchEl.addEventListener('input', function() { _renderList(searchEl.value); });
  }

  // Delegated handler for every [data-glossary] trigger anywhere in
  // the document. New sections + future inline links light up
  // automatically without per-section wiring.
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-glossary]');
    if (!btn) return;
    e.preventDefault();
    open(btn.getAttribute('data-glossary'));
  });
})();

// Password eyeball toggle — delegated so it works for any input
// wrapped in .config-password-wrap, including dynamically rendered
// rows (channel secrets, chain password drawer, new-chain form).
document.addEventListener('click', function(e) {
  var btn = e.target.closest('[data-pw-toggle]');
  if (!btn) return;
  e.preventDefault();
  var wrap = btn.closest('.config-password-wrap');
  if (!wrap) return;
  var input = wrap.querySelector('input');
  if (!input) return;
  var showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  // \ud83d\udc41 (eye) when hidden, \ud83d\ude48 (see-no-evil) when shown
  btn.textContent = showing ? '\ud83d\udc41' : '\ud83d\ude48';
  btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
  btn.setAttribute('title', showing ? 'Show password' : 'Hide password');
});


// =====================================================================
// COMMAND PALETTE — ⌘K / Ctrl-K opens a fuzzy search across every
// labeled control in the dashboard. Indexed lazily on first open
// (rebuilt on every open so it picks up controls that were rendered
// after page load — chains, channels, profiles). Enter activates
// the tab, expands the section, scrolls the control into view, and
// flashes it briefly so the user sees where they landed.
// =====================================================================
(function() {
  var modal = document.getElementById('paletteModal');
  var listEl = document.getElementById('paletteList');
  var searchEl = document.getElementById('paletteSearch');
  var closeBtn = document.getElementById('paletteClose');
  if (!modal || !listEl || !searchEl) return;

  // ---- Index build ----
  // Walk the document for labeled controls. We treat as "control":
  //   - <input>, <select>, <textarea>, <button> with an accessible name
  //   - <label>'d controls (label text is the name)
  //   - tab buttons (.input-tab)
  //   - <details> summaries
  // For each, capture: label, optional aria/group context, and the
  // element to scroll-into-view + flash.
  function _accessibleName(el) {
    // Priority: explicit aria-label > title > nearest <label> text >
    // placeholder > inner text > id.
    var name = el.getAttribute('aria-label');
    if (name && name.trim()) return name.trim();
    name = el.getAttribute('title');
    if (name && name.trim()) return name.trim();
    if (el.id) {
      var lbl = document.querySelector('label[for="' + el.id + '"]');
      if (lbl && lbl.textContent.trim()) return lbl.textContent.trim();
    }
    // Walk up to nearest <label> ancestor.
    var anc = el.closest('label');
    if (anc) {
      // Strip the input's own text from the label so we don't double-count.
      var clone = anc.cloneNode(true);
      clone.querySelectorAll('input, select, textarea, button').forEach(function(c) {
        c.remove();
      });
      var t = clone.textContent.trim();
      if (t) return t;
    }
    name = el.getAttribute('placeholder');
    if (name && name.trim()) return name.trim();
    if (el.textContent && el.textContent.trim()) return el.textContent.trim();
    return el.id || '';
  }

  function _sectionContext(el) {
    // Best-effort: read the nearest config-section's summary text +
    // the active tab name so users see WHERE they're jumping to.
    var ctx = [];
    var section = el.closest('.config-section');
    if (section) {
      var summary = section.querySelector(':scope > summary');
      if (summary) {
        var t = summary.cloneNode(true);
        t.querySelectorAll('button').forEach(function(b) { b.remove(); });
        var txt = t.textContent.trim();
        if (txt) ctx.push(txt);
      }
    }
    var panel = el.closest('.input-panel');
    if (panel && panel.id) {
      var tabName = panel.id.replace(/^tab-/, '');
      if (tabName) ctx.unshift(tabName.charAt(0).toUpperCase() + tabName.slice(1));
    }
    return ctx.join(' \u203a ');
  }

  function _buildIndex() {
    var items = [];
    var seen = new Set();
    function _push(el, label, context) {
      if (!el || !label) return;
      if (seen.has(el)) return;
      seen.add(el);
      items.push({ el: el, label: label, context: context || '' });
    }

    // Tab buttons — top-level navigation.
    document.querySelectorAll('.input-tab').forEach(function(t) {
      var label = (t.textContent || '').trim();
      if (label) _push(t, label, 'Tab');
    });

    // <details> summaries — section anchors.
    document.querySelectorAll('.config-section').forEach(function(d) {
      var s = d.querySelector(':scope > summary');
      if (!s) return;
      var t = s.cloneNode(true);
      t.querySelectorAll('button').forEach(function(b) { b.remove(); });
      var label = t.textContent.trim();
      if (label) _push(d, label, 'Section');
    });

    // Labeled controls.
    document.querySelectorAll([
      '.input-panel input',
      '.input-panel select',
      '.input-panel textarea',
      '.input-panel button:not(.glossary-link):not(.config-modal-close)',
    ].join(',')).forEach(function(el) {
      // Skip hidden / advanced-folded elements at index time? No —
      // index everything; the jump will expand sections / toggle
      // Advanced if needed. Lets users discover controls they didn't
      // know existed.
      if (el.closest('.config-modal')) return;  // skip modal contents
      if (el.type === 'hidden') return;
      var label = _accessibleName(el);
      if (!label || label.length > 80) return;
      var ctx = _sectionContext(el);
      _push(el, label, ctx);
    });

    return items;
  }

  // ---- Fuzzy scoring ----
  // Simple subsequence match — characters of the query must appear
  // in order within the label (case-insensitive). Score = length of
  // label (shorter wins) + position of last matched char (earlier
  // wins). Good enough for ~50-100 controls.
  function _score(query, label) {
    if (!query) return label.length;
    var q = query.toLowerCase();
    var l = label.toLowerCase();
    var qi = 0;
    var lastIdx = -1;
    for (var i = 0; i < l.length && qi < q.length; i++) {
      if (l[i] === q[qi]) {
        lastIdx = i;
        qi++;
      }
    }
    if (qi < q.length) return -1;  // not all chars matched
    return label.length + lastIdx;
  }

  var _items = [];
  var _filtered = [];
  var _activeIdx = 0;

  function _render() {
    listEl.innerHTML = _filtered.length === 0
      ? '<p class="palette-empty"><em>No matches.</em></p>'
      : _filtered.map(function(it, i) {
          var cls = 'palette-row' + (i === _activeIdx ? ' palette-row-active' : '');
          return '<div class="' + cls + '" data-palette-idx="' + i + '">' +
            '<span class="palette-label">' + escapeHtml(it.label) + '</span>' +
            (it.context ? '<span class="palette-context">' + escapeHtml(it.context) + '</span>' : '') +
            '</div>';
        }).join('');
    var active = listEl.querySelector('.palette-row-active');
    if (active && active.scrollIntoView) active.scrollIntoView({block: 'nearest'});
  }

  function _filter(q) {
    if (!q) {
      _filtered = _items.slice(0, 50);
    } else {
      _filtered = _items
        .map(function(it) { return { it: it, score: _score(q, it.label) }; })
        .filter(function(x) { return x.score >= 0; })
        .sort(function(a, b) { return a.score - b.score; })
        .slice(0, 50)
        .map(function(x) { return x.it; });
    }
    _activeIdx = 0;
    _render();
  }

  function _jump(it) {
    if (!it || !it.el) return;
    close();
    var el = it.el;
    // If inside a <details> that's closed, open it.
    var details = el.closest('details');
    while (details) {
      if (!details.open) details.open = true;
      details = details.parentElement && details.parentElement.closest ? details.parentElement.closest('details') : null;
    }
    // If inside an advanced-only block, expose it temporarily.
    var advBlock = el.closest('.advanced-only');
    if (advBlock) {
      var section = advBlock.closest('.config-section');
      if (section && !section.hasAttribute('data-show-advanced')) {
        // Flip the toggle so the user can see the control AND adjust
        // anything else in the section's advanced fold.
        var toggle = section.querySelector('[data-advanced-toggle]');
        if (toggle && !toggle.checked) {
          toggle.checked = true;
          toggle.dispatchEvent(new Event('change', {bubbles: true}));
        }
      }
    }
    // If inside an inactive tab panel, click the right tab first.
    var panel = el.closest('.input-panel');
    if (panel && panel.id && !panel.classList.contains('active')) {
      var tab = document.querySelector('.input-tab[data-panel="' + panel.id + '"]');
      if (tab) tab.click();
    }
    // Scroll + flash.
    setTimeout(function() {
      try { el.scrollIntoView({behavior: 'smooth', block: 'center'}); }
      catch (e) { el.scrollIntoView(); }
      el.classList.add('palette-flash');
      setTimeout(function() { el.classList.remove('palette-flash'); }, 1500);
      if (typeof el.focus === 'function') {
        try { el.focus({preventScroll: true}); } catch (e) {}
      }
    }, 150);
  }

  function open() {
    modal.hidden = false;
    searchEl.value = '';
    _items = _buildIndex();
    _filter('');
    setTimeout(function() { searchEl.focus(); }, 0);
  }
  function close() {
    modal.hidden = true;
  }

  if (closeBtn) closeBtn.addEventListener('click', close);
  modal.addEventListener('click', function(e) { if (e.target === modal) close(); });

  // Click affordance — the discoverable surface for users who don't
  // know the hotkey. Lives in the page header next to the glossary.
  var openBtnHeader = document.getElementById('paletteOpenBtn');
  if (openBtnHeader) openBtnHeader.addEventListener('click', open);

  searchEl.addEventListener('input', function() { _filter(searchEl.value); });
  searchEl.addEventListener('keydown', function(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _activeIdx = Math.min(_activeIdx + 1, _filtered.length - 1);
      _render();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      _activeIdx = Math.max(_activeIdx - 1, 0);
      _render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      _jump(_filtered[_activeIdx]);
    }
  });
  listEl.addEventListener('click', function(e) {
    var row = e.target.closest('[data-palette-idx]');
    if (!row) return;
    var idx = parseInt(row.getAttribute('data-palette-idx'), 10);
    _jump(_filtered[idx]);
  });

  // Global keyboard shortcut.
  document.addEventListener('keydown', function(e) {
    var isCmdK = (e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K');
    if (isCmdK) {
      e.preventDefault();
      if (modal.hidden) open();
      else close();
      return;
    }
    if (e.key === 'Escape' && !modal.hidden) close();
  });
})();
