// =====================================================================
// portal.js — shared portal-flip transition between decoder and validator
//
// Both pages have a "Validator"/"Decoder" link that triggers a 3D card
// flip: the current page's input-section rotates away while the sibling
// page fades in from the other side. Tab state is carried across via
// a ?from=… &tab=… query string so the user lands on the matching tab.
//
// Usage:
//
//   Portal.init({
//     sourceMarker: 'decoder',        // this page's identity in ?from=
//     otherMarker:  'validator',       // the page we link to
//     applyIncomingTab: function(idx) { ... },   // called on arrival
//     getOutgoingTab:  function()     { ... return idx; },
//     dismissResults:  function(done) { ... done(); },  // optional pre-flip
//     reset:           function() { ... },               // optional
//   });
//
// The animation spine (portal-transit / portal-animating / portal-arriving
// / portal-departing classes and their CSS rules) lives in the pages'
// own CSS — this module only coordinates the timings.
// =====================================================================
var Portal = (function() {
  function init(cfg) {
    cfg = cfg || {};
    var otherMarker = cfg.otherMarker || 'validator';
    var sourceMarker = cfg.sourceMarker || 'decoder';
    var applyIncomingTab = cfg.applyIncomingTab || function() {};
    var getOutgoingTab = cfg.getOutgoingTab || function() { return 0; };
    var dismissResults = cfg.dismissResults || function(done) { done(); };
    var reset = cfg.reset || function() {};

    var container = document.querySelector('.input-section') ||
                    document.querySelector('.container') ||
                    document.body;
    var link = document.getElementById('portalLink');
    if (!link) return;

    // --- Arrival: we were flipped in from the sibling page -----------
    if (location.search.indexOf('from=' + otherMarker) >= 0) {
      var tabMatch = (location.search.match(/tab=(\d)/) || [])[1];
      if (tabMatch) applyIncomingTab(parseInt(tabMatch, 10));

      document.documentElement.classList.remove('portal-transit');
      document.documentElement.classList.add('portal-animating');

      var note = document.querySelector('.note');
      var footer = document.querySelector('.page-footer');
      if (note)   { note.style.transition   = 'opacity 0.5s ease'; note.style.opacity   = '0'; }
      if (footer) { footer.style.transition = 'opacity 0.5s ease'; footer.style.opacity = '0'; }

      container.classList.add('portal-arriving');
      container.addEventListener('animationend', function onArrive() {
        container.classList.remove('portal-arriving');
        container.style.opacity = '';
        container.style.transform = '';
        document.documentElement.classList.remove('portal-animating');
        if (note)   note.style.opacity   = '';
        if (footer) footer.style.opacity = '';
      }, { once: true });

      history.replaceState(null, '', location.pathname);
    }

    // --- Departure: user clicked the link to leave -------------------
    link.addEventListener('click', function(e) {
      e.preventDefault();
      var dest = link.href || '';

      function doFlip() {
        reset();
        window.scrollTo({ top: 0 });
        setTimeout(function() {
          document.documentElement.classList.add('portal-animating');
          container.classList.add('portal-departing');
          container.addEventListener('animationend', function onDepart() {
            var idx = getOutgoingTab();
            var sep = dest.indexOf('?') >= 0 ? '&' : '?';
            window.location.href = dest + sep + 'from=' + sourceMarker + '&tab=' + idx;
          }, { once: true });
        }, 60);
      }

      // Let the page gracefully fade its result panel before we flip.
      dismissResults(doFlip);
    });
  }

  return { init: init };
})();

// =====================================================================
// PanelSwap — unified intro/outro for the right-side panel content.
//
// Single animation path on desktop: every intro plays exactly one
// panel-swap-in, every outro plays exactly one panel-swap-out. Covers:
//
//   - Cold start   (panel was hidden, renderFn reveals it)
//   - Hot swap     (panel stays on screen, contents replace)
//   - Error/dismiss (renderFn leaves panel empty → panel collapses)
//
// The panel is held at opacity 0 across the entire swap window
// (panel-swap-out clamps it during outro + renderFn, panel-swap-in's
// @keyframes frame 0 picks up from 0). That's how we avoid mid-swap
// flashes. The handoff from panel-swap-out → panel-swap-in happens on
// the same frame (two rAFs deep).
//
// Usage:
//   PanelSwap(panelEl, function() { panelEl.innerHTML = newHtml; });
//   PanelSwap(panelEl, function() { renderCert(...); });
//
// Mobile (viewport < 1200px) bypasses PanelSwap entirely — mobile CSS
// on .panel-right.visible carries panelFadeIn for the reveal, and hot
// fetches just swap content in place.
// =====================================================================
var PanelSwap = (function() {
  var OUT_MS = 240;  // matches .panel-swap-out transition
  var IN_MS  = 340;  // matches @keyframes panelSwapIn

  function isDesktopLayout() {
    // Viewport-gated: PanelSwap owns intros on desktop regardless of
    // whether layout-active is already set (it may get set inside
    // renderFn on the very first cold fetch). The 1200px breakpoint
    // matches the two-panel @media rule in layout.css. On narrower
    // viewports, mobile CSS on .panel-right.visible handles the reveal.
    return window.innerWidth >= 1200;
  }

  function hasContent(el) {
    if (!el) return false;
    if (el.children && el.children.length > 0) return true;
    return !!(el.innerHTML && el.innerHTML.trim());
  }

  function intro(panel) {
    panel.classList.add('panel-swap-in');
    var clear = function() { panel.classList.remove('panel-swap-in'); };
    panel.addEventListener('animationend', function h(e) {
      if (e.target !== panel) return;
      panel.removeEventListener('animationend', h);
      clear();
    });
    setTimeout(clear, IN_MS + 50);
  }

  function swap(panel, renderFn) {
    if (typeof renderFn !== 'function') return;
    if (!panel || !isDesktopLayout()) { renderFn(); return; }

    // No prior content or panel not on screen — no outro animation, but
    // we still need to hold the panel at opacity 0 during renderFn and
    // intro it afterward so the reveal matches hot-fetch behavior.
    // Pre-applying panel-swap-out means the instant renderCert flips
    // .visible → display:block, opacity is already clamped to 0 (no
    // pop-in). The intro swaps panel-swap-out → panel-swap-in on the
    // same frame, identical to the hot path.
    if (!hasContent(panel) || !panel.classList.contains('visible')) {
      panel.classList.add('panel-swap-out');
      var coldResult = renderFn();
      var coldIntro = function() {
        if (!hasContent(panel) || !panel.classList.contains('visible')) {
          panel.classList.remove('panel-swap-out');
          return;
        }
        requestAnimationFrame(function() {
          requestAnimationFrame(function() {
            panel.classList.remove('panel-swap-out');
            intro(panel);
          });
        });
      };
      if (coldResult && typeof coldResult.then === 'function') {
        coldResult.then(coldIntro, coldIntro);
      } else {
        coldIntro();
      }
      return;
    }

    panel.classList.add('panel-swap-out');
    var done = false;
    var finish = function() {
      if (done) return;
      done = true;
      panel.removeEventListener('transitionend', onEnd);
      // Keep panel-swap-out applied through renderFn so the panel stays
      // at opacity 0 during the content rebuild. Removing it here would
      // snap opacity back to 1 while the new content mounts, and then
      // panel-swap-in's @keyframes would drop it to 0 again — two
      // flashes. The atomic handoff in runIntro() below removes
      // panel-swap-out the same frame panel-swap-in is added.
      var runIntro = function() {
        // If renderFn produced no content (e.g., an error path that
        // cleared the panel and showed inline error in the left
        // column), or the example dismiss flow, drop the panel
        // entirely — remove .visible and layout-active so the layout
        // collapses back to single-column. The outro's fade-out is
        // the final visual.
        if (!hasContent(panel)) {
          panel.classList.remove('panel-swap-out', 'visible');
          var dm = document.querySelector('.panel-layout');
          if (dm) dm.classList.remove('layout-active');
          return;
        }
        requestAnimationFrame(function() {
          requestAnimationFrame(function() {
            // Atomic swap: drop the opacity-0 holder and start the
            // intro in the same frame. The intro's @keyframes frame 0
            // is also opacity 0, so there's no gap — the panel stays
            // invisible at the class change instant and the animation
            // lifts it to opacity 1.
            panel.classList.remove('panel-swap-out');
            intro(panel);
          });
        });
      };
      // Async renderFn (e.g., fetchAndRender): await the final cert
      // before the intro so the user sees the full cert fade in, not
      // a blank panel. Synchronous renderFn intros immediately.
      var result = renderFn();
      if (result && typeof result.then === 'function') {
        result.then(runIntro, runIntro);
      } else {
        runIntro();
      }
    };
    var onEnd = function(e) {
      if (e.target === panel && e.propertyName === 'opacity') finish();
    };
    panel.addEventListener('transitionend', onEnd);
    // Safety — if transitionend doesn't fire (e.g., reduced motion), still swap.
    setTimeout(finish, OUT_MS + 120);
  }

  return swap;
})();

// =====================================================================
// TabBar — shared tab/panel activation. Both pages use .input-tab
// buttons whose data-panel matches a .input-panel id. Decoder wires
// clicks directly; validator wraps in showTab() that also runs
// syncResultsVisibility. Both funnel through activateById() for the
// class toggling so the DOM rules stay in one place.
// =====================================================================
var TabBar = (function() {
  function activateById(panelId) {
    document.querySelectorAll('.input-tab').forEach(function(t) {
      t.classList.toggle('active', t.dataset.panel === panelId);
    });
    document.querySelectorAll('.input-panel').forEach(function(p) {
      p.classList.toggle('active', p.id === panelId);
    });
    return panelId;
  }
  function wire(onChange) {
    document.querySelectorAll('.input-tab').forEach(function(t) {
      t.addEventListener('click', function() {
        var id = t.dataset.panel;
        if (!id) return;
        activateById(id);
        if (typeof onChange === 'function') onChange(id, t);
      });
    });
  }
  return { activateById: activateById, wire: wire };
})();

// =====================================================================
// DropZone — shared drag/drop + click-to-browse wiring. Handles
// dragenter/over/leave/drop visual feedback, file-type filtering via
// accept(), and either a bound <input type=file> or an on-demand one
// created per click (validator's main image dropZone pattern).
//
//   DropZone.attach({
//     zone: element, input: element?, accept: fn(file)→bool,
//     onFiles: fn(fileOrArray), multiple?: bool,
//     fileAccept?: string (for on-demand input)
//   });
//
// Single-file callers receive a File; multiple callers receive Array.
// =====================================================================
var DropZone = (function() {
  function attach(options) {
    var zone = options.zone;
    if (!zone) return;
    var input = options.input || null;
    var accept = options.accept || function() { return true; };
    var multiple = !!options.multiple;
    var onFiles = options.onFiles;
    if (typeof onFiles !== 'function') return;

    function deliver(fileList) {
      var filtered = Array.from(fileList || []).filter(accept);
      if (!filtered.length) return;
      onFiles(multiple ? filtered : filtered[0]);
    }

    ['dragenter', 'dragover'].forEach(function(evt) {
      zone.addEventListener(evt, function(ev) {
        ev.preventDefault();
        zone.classList.add('drag-over');
      });
    });
    ['dragleave', 'drop'].forEach(function(evt) {
      zone.addEventListener(evt, function(ev) {
        ev.preventDefault();
        zone.classList.remove('drag-over');
      });
    });
    zone.addEventListener('drop', function(e) { deliver(e.dataTransfer.files); });

    if (input) {
      zone.addEventListener('click', function() { input.click(); });
      input.addEventListener('change', function() {
        deliver(input.files);
        if (options.clearInput !== false) input.value = '';
      });
    } else {
      zone.addEventListener('click', function() {
        var inp = document.createElement('input');
        inp.type = 'file';
        if (options.fileAccept) inp.accept = options.fileAccept;
        if (multiple) inp.multiple = true;
        inp.onchange = function() { deliver(inp.files); };
        inp.click();
      });
    }
  }
  return { attach: attach };
})();

// =====================================================================
// LinkClick — delegated click on anchors with a data-id attribute.
// Decoder uses .lookup-link (prefill + switch to By Word); validator
// uses .audit-link (prefill + showTab cert). Callback owns the side
// effects; this helper just handles the delegation boilerplate.
// =====================================================================
var LinkClick = {
  delegate: function(selector, handler) {
    document.addEventListener('click', function(e) {
      var link = e.target.closest(selector);
      if (!link) return;
      e.preventDefault();
      e.stopPropagation();
      var id = link.dataset.id;
      if (id) handler(id, link);
    });
  }
};

// =====================================================================
// DragScroll — scrollbars are hidden for aesthetic; mouse-wheel users
// and trackpad users are fine, but a plain mouse or a trackball can't
// reach the content. Drag-to-scroll ("panning") fills the gap: press
// and drag anywhere non-interactive in the container and the scrollTop
// tracks the pointer. Threshold lets clicks on links/rows still fire.
// Text selection is preserved — if drag doesn't reach threshold, the
// partial selection stands; past threshold we clear it and start
// scrolling. Keyboard fallback (Arrow/Page/Home/End) via tabindex.
// =====================================================================
var DragScroll = (function() {
  // Elements that handle their own pointer gestures — don't start drag
  // on pointerdown against any of these. Click-based rows (like
  // .meta-row in observatory) intentionally aren't here: the threshold
  // + click-cancel on drag lets them coexist with drag-to-scroll.
  // .selectable + the gps-* blocks use user-select: all (single click
  // selects the whole block) — drag would steal that gesture, so they
  // opt out here.
  var IGNORE_SEL = 'a, button, input, textarea, select, canvas, [contenteditable], [data-nodrag], .selectable, .gps-cipher, .gps-modulus';
  var THRESHOLD = 5;

  function attach(el) {
    if (!el || el.__dragScrollAttached) return;
    el.__dragScrollAttached = true;
    el.classList.add('drag-scroll');
    if (!el.hasAttribute('tabindex')) el.tabIndex = -1;

    var startY = 0, startScroll = 0, pointerId = null, dragging = false, wasDragged = false;

    el.addEventListener('pointerdown', function(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest(IGNORE_SEL)) return;
      // Skip if the element isn't actually scrollable right now — either
      // content fits or overflow is hidden/visible. Without this check
      // DragScroll writes scrollTop directly, which *does* move content
      // under an overflow:hidden clip (the attack-lab sample cert was
      // silently scrolling past its own bounds).
      if (el.scrollHeight <= el.clientHeight) return;
      var oy = getComputedStyle(el).overflowY;
      if (oy !== 'auto' && oy !== 'scroll') return;
      startY = e.clientY;
      startScroll = el.scrollTop;
      pointerId = e.pointerId;
      dragging = false;
      wasDragged = false;
    });

    el.addEventListener('pointermove', function(e) {
      if (pointerId !== e.pointerId) return;
      var delta = startY - e.clientY;
      if (!dragging) {
        if (Math.abs(delta) < THRESHOLD) return;
        dragging = true;
        wasDragged = true;
        el.classList.add('is-dragging');
        // Capture the pointer so pointermove/pointerup keep firing on
        // `el` even if the cursor leaves its bounds. Without this, a
        // release outside the container never reaches us and re-entry
        // resumes scrolling as if the drag never ended.
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
        // Drop any selection that started before threshold so the
        // scroll feels clean instead of highlighting a word or two.
        var sel = window.getSelection && window.getSelection();
        if (sel && sel.removeAllRanges) sel.removeAllRanges();
      }
      el.scrollTop = startScroll + delta;
      e.preventDefault();
    });

    function release(e) {
      if (e && pointerId !== null && pointerId !== e.pointerId) return;
      if (dragging) {
        el.classList.remove('is-dragging');
        try { el.releasePointerCapture(pointerId); } catch (_) {}
      }
      pointerId = null;
      dragging = false;
    }
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    // Safety net: if capture is yanked away (e.g., another element
    // claims it, or the window loses the pointer), reset state. Without
    // this the "stuck dragging" bug reappears any time capture drops
    // mid-gesture.
    el.addEventListener('lostpointercapture', release);
    // Window blur / tab hidden — pointerup won't fire if the user
    // alt-tabs away with mouse still held. Reset so re-entry is clean.
    window.addEventListener('blur', function() { if (pointerId !== null) release(); });

    // Capture-phase click swallow so a drag that happened to land on
    // .meta-row, .audit-link, etc. doesn't also fire their onclick.
    el.addEventListener('click', function(e) {
      if (wasDragged) {
        e.preventDefault();
        e.stopPropagation();
        wasDragged = false;
      }
    }, true);

    el.addEventListener('keydown', function(e) {
      var step = 40;
      switch (e.key) {
        case 'ArrowDown': el.scrollTop += step; break;
        case 'ArrowUp':   el.scrollTop -= step; break;
        case 'PageDown':  el.scrollTop += el.clientHeight * 0.9; break;
        case 'PageUp':    el.scrollTop -= el.clientHeight * 0.9; break;
        case 'Home':      el.scrollTop = 0; break;
        case 'End':       el.scrollTop = el.scrollHeight; break;
        default: return;
      }
      e.preventDefault();
    });
  }

  return { attach: attach };
})();

// =====================================================================
// SourceConfig — single base URL per prefix, persisted to localStorage.
// Platform-agnostic: the URL can reference {id} as a template for
// per-item layouts (e.g. archive.org's `/download/{id}/`) or leave
// it out for flat-directory self-hosts. Template expansion happens
// inside the fetcher, not here.
//
// Instances sharing a prefix mirror changes — typing in one surface's
// Source field updates any other registered with the same prefix
// (e.g. decoder's By Sight and By Word both use prefix 'source').
//
// Usage:
//   SourceConfig.init({
//     prefix: 'source',
//     baseEl: document.getElementById('lookupSource'),
//     defaultUrl: 'https://archive.org/download/{id}/',
//     placeholder: 'https://archive.org/download/{id}/'
//   });
//
// Storage key: mememage-{prefix}-url
// =====================================================================
var SourceConfig = (function() {
  // Instances registered per prefix so changes in one UI mirror to any
  // siblings (same prefix = shared storage + shared state). Needed when
  // the same source config appears in multiple tabs (e.g., decoder's
  // By Sight + By Word) so editing either surface updates the other.
  var registry = {};

  // Mode state keyed by prefix — all SourceConfig instances under the
  // same prefix share the mode (online/offline) via this map.
  var modeState = {};

  function init(opts) {
    var baseEl = opts.baseEl;
    var prefix = opts.prefix;
    var defaultUrl = opts.defaultUrl || '';
    var placeholder = opts.placeholder || '';
    // Optional clickable element (typically the "Base URL" label) that
    // resets the input to defaultUrl. One-click path back to the IA
    // default after a user has explored a custom source URL.
    var resetEl = opts.resetEl || null;
    // Optional <select> for Online/Offline mode. Containers whose
    // `data-source-mode` reflects the current mode hide/show rows via
    // CSS ([data-mode-scope="online|offline"]).
    var modeEl = opts.modeEl || null;
    var modeContainer = opts.modeContainer || null;  // element that carries data-source-mode
    if (!baseEl) return;

    var urlKey = 'mememage-' + prefix + '-url';
    var modeKey = 'mememage-' + prefix + '-mode';
    function load() {
      try { return localStorage.getItem(urlKey) || defaultUrl; }
      catch (e) { return defaultUrl; }
    }
    function save(v) {
      try { localStorage.setItem(urlKey, v); } catch (e) {}
    }
    function loadMode() {
      try { return localStorage.getItem(modeKey) || 'online'; }
      catch (e) { return 'online'; }
    }
    function saveMode(m) {
      try { localStorage.setItem(modeKey, m); } catch (e) {}
    }

    baseEl.value = load();
    if (placeholder) baseEl.setAttribute('placeholder', placeholder);

    var initialMode = modeState[prefix] || loadMode();
    modeState[prefix] = initialMode;
    if (modeEl) modeEl.value = initialMode;
    if (modeContainer) modeContainer.setAttribute('data-source-mode', initialMode);

    var instance = { baseEl: baseEl, modeEl: modeEl, modeContainer: modeContainer };
    registry[prefix] = (registry[prefix] || []);
    registry[prefix].push(instance);

    function mirror(except) {
      (registry[prefix] || []).forEach(function(inst) {
        if (inst === except) return;
        inst.baseEl.value = baseEl.value;
        if (inst.modeEl) inst.modeEl.value = modeState[prefix];
        if (inst.modeContainer) inst.modeContainer.setAttribute('data-source-mode', modeState[prefix]);
      });
    }

    baseEl.addEventListener('input', function() {
      save(baseEl.value);
      mirror(instance);
    });

    if (modeEl) {
      modeEl.addEventListener('change', function() {
        var next = modeEl.value;
        modeState[prefix] = next;
        saveMode(next);
        if (modeContainer) modeContainer.setAttribute('data-source-mode', next);
        mirror(instance);
      });
    }

    if (resetEl) {
      resetEl.style.cursor = 'pointer';
      resetEl.title = 'Reset to default (' + defaultUrl + ')';
      resetEl.addEventListener('click', function() {
        baseEl.value = defaultUrl;
        save(defaultUrl);
        mirror(instance);
        baseEl.focus();
      });
    }
  }

  function getMode(prefix) {
    if (modeState[prefix]) return modeState[prefix];
    try { return localStorage.getItem('mememage-' + prefix + '-mode') || 'online'; }
    catch (e) { return 'online'; }
  }

  return { init: init, getMode: getMode };
})();

// =====================================================================
// PanelError — two-slot error helpers (head + body) for the tab-local
// inline error affordance both pages use. Each page declares which
// element IDs belong to which tab, and the helper routes head/body
// content + clears inactive tabs' slots on every write.
//
// Usage:
//   PanelError.configure({
//     imagePanel:  { body: 'imageError' },            // single-slot
//     lookupPanel: { head: 'lookupErrorHead', body: 'lookupErrorBody' },
//     verifyPanel: { body: 'verifyStatus', errorClass: true }
//   });
//   PanelError.set('lookupPanel', 'Invalid identifier.', 'Expected …');
//   PanelError.clearOthers('lookupPanel');
//
// `errorClass: true` adds/removes `.error` on the body element when
// content is present/empty (for tabs styled via a class toggle).
// =====================================================================
var PanelError = (function() {
  var config = {};

  function configure(cfg) { config = cfg || {}; }

  function clearOthers(activeId) {
    Object.keys(config).forEach(function(tabId) {
      if (tabId === activeId) return;
      var slot = config[tabId] || {};
      ['head', 'body'].forEach(function(k) {
        if (!slot[k]) return;
        var el = document.getElementById(slot[k]);
        if (!el) return;
        el.innerHTML = '';
        if (slot.errorClass) el.classList.remove('error');
      });
    });
  }

  function set(activeId, head, body) {
    var slot = config[activeId];
    if (!slot) return;
    clearOthers(activeId);
    var headEl = slot.head ? document.getElementById(slot.head) : null;
    var bodyEl = slot.body ? document.getElementById(slot.body) : null;
    if (headEl) {
      headEl.innerHTML = head || '';
      if (bodyEl) bodyEl.innerHTML = body || '';
    } else if (bodyEl) {
      // Single-slot fallback — combine head + body into the one slot.
      var html = head || '';
      if (body) html += (head ? '<br><span style="color:var(--text-muted);font-size:0.7rem;font-weight:400;">' + body + '</span>' : body);
      bodyEl.innerHTML = html;
    }
    if (slot.errorClass && bodyEl) {
      bodyEl.classList.toggle('error', !!(head || body));
    }
  }

  function clear(activeId) {
    var slot = config[activeId];
    if (!slot) return;
    ['head', 'body'].forEach(function(k) {
      if (!slot[k]) return;
      var el = document.getElementById(slot[k]);
      if (!el) return;
      el.innerHTML = '';
      if (slot.errorClass) el.classList.remove('error');
    });
  }

  return { configure: configure, set: set, clear: clear, clearOthers: clearOthers };
})();

// =====================================================================
// buildProbeLinks — HTML snippet of clickable anchors to the candidate
// filenames for an identifier. Top-level navigation isn't blocked by
// mixed content or CORS, so clicking opens the file in a new tab
// where the user can save it manually. Mode-scoped to honor the
// contract the Source dropdown advertises:
//   mode='direct' → only {base}/{id}.soul (the canonical self-host
//                   form; suggesting .json would contradict the UX
//                   promise under the dropdown).
//   mode='ia'     → both .soul and .json (+ {id}.{hash}.* if a hash
//                   is known), since IA dual-blasts both extensions.
//   mode default  → both simple forms, plus hashed variants if known.
// =====================================================================
// =====================================================================
// TabScope — tab ownership for elements that live outside the tab
// panels themselves. Each query (By Sight, By Word, By Soul) stamps
// a tab ID on its evidence elements via data-owner; tab switches
// toggle .tab-scope-hidden on everything whose owner isn't active.
// State is preserved — only display is suppressed — so returning to
// a tab brings its evidence back untouched.
//
// Usage:
//   TabScope.configure(['preview', 'barCard', 'status', 'iaLinkBanner']);
//   TabScope.setOwner('imagePanel');   // stamp all scoped elements
//   TabScope.apply('lookupPanel');      // hide non-matching owners
//   TabScope.clear();                   // strip ownership (on resetAll)
// =====================================================================
var TabScope = (function() {
  var ids = [];

  function configure(elementIds) { ids = (elementIds || []).slice(); }

  function setOwner(tabId) {
    ids.forEach(function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.dataset.owner = tabId;
      el.classList.remove('tab-scope-hidden');
    });
  }

  function clear() {
    ids.forEach(function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      delete el.dataset.owner;
      el.classList.remove('tab-scope-hidden');
    });
  }

  function apply(activeId) {
    document.querySelectorAll('[data-owner]').forEach(function(el) {
      el.classList.toggle('tab-scope-hidden', el.dataset.owner !== activeId);
    });
  }

  return { configure: configure, setOwner: setOwner, clear: clear, apply: apply };
})();

function buildProbeLinks(base, identifier, contentHash) {
  if (!base || !identifier) return '';
  // Expand {id} templating the same way fetchFromSource does, then
  // offer the canonical .soul URL as a probe link. Archive.org-style
  // URLs (containing "archive.org") get the /details/ landing page
  // instead, which lists files and confirms existence even when
  // filename discovery would require the /metadata/ API.
  var expanded = base.replace(/\{id\}/g, identifier);
  if (!expanded.endsWith('/')) expanded = expanded + '/';
  var url;
  var iaMatch = base.match(/^(https?:\/\/[^/]*archive\.org)/);
  if (iaMatch) {
    url = iaMatch[1] + '/details/' + identifier;
  } else {
    url = expanded + identifier + '.soul';
  }
  return '<a href="' + url + '" target="_blank" rel="noopener" style="word-break:break-all;">' + url + '</a>';
}

// =====================================================================
// OfflineRecords — in-memory cache of .soul records keyed by identifier.
// Populated by Observatory drops + folder-picker loads; consulted by
// Audit and By Word before any network fetch. Enables full offline
// verification once the user has supplied the files, with graceful
// network fallback for records not in the cache.
//
// Records get stamped with _source = 'local:<filename>' so the Audit
// "Source" link shows provenance (and renderCert's Download Soul button
// can work against it).
// =====================================================================
var OfflineRecords = (function() {
  var cache = {};

  function add(record, filename) {
    if (!record || typeof record !== 'object' || !record.identifier) return;
    record._source = 'local:' + (filename || (record.identifier + '.soul'));
    record._identifier = record.identifier;
    cache[record.identifier] = record;
    dispatchChange();
  }

  function get(identifier) { return identifier && cache[identifier] ? cache[identifier] : null; }
  function count() { return Object.keys(cache).length; }
  function clear() { cache = {}; dispatchChange(); }

  var listeners = [];
  function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }
  function dispatchChange() { listeners.forEach(function(fn) { try { fn(count()); } catch (e) {} }); }

  // Parse a File object as a .soul record and add it to the cache.
  // Returns a promise resolving to the record on success, null on fail.
  function loadFile(file) {
    return new Promise(function(resolve) {
      var reader = new FileReader();
      reader.onload = function(e) {
        try {
          var record = JSON.parse(e.target.result);
          add(record, file.name);
          resolve(record);
        } catch (err) { resolve(null); }
      };
      reader.onerror = function() { resolve(null); };
      reader.readAsText(file);
    });
  }

  // Auto-wire any `[data-offline-pick]` button on the page:
  //   - Click the button → opens the adjacent file input (hidden,
  //     webkitdirectory). User picks a folder.
  //   - Each .soul file is parsed and added to the cache.
  //   - `[data-offline-count]` elements update with the live count.
  // Call bindUI() once on DOMContentLoaded (or after the elements
  // exist in the DOM).
  function bindUI() {
    var buttons = document.querySelectorAll('[data-offline-pick]');
    buttons.forEach(function(btn) {
      if (btn.__offlineBound) return;
      btn.__offlineBound = true;
      // Find the sibling file input — same parent (.offline-row).
      var row = btn.parentElement;
      var input = row ? row.querySelector('input[type="file"]') : null;
      if (!input) return;
      btn.addEventListener('click', function() { input.click(); });
      input.addEventListener('change', async function() {
        var files = Array.from(input.files || []).filter(function(f) {
          return /\.(soul|json)$/i.test(f.name);
        });
        for (var i = 0; i < files.length; i++) {
          await loadFile(files[i]);
        }
        input.value = '';  // allow re-selecting same folder
      });
    });
    var counts = document.querySelectorAll('[data-offline-count]');
    function refreshCounts(n) {
      counts.forEach(function(el) {
        el.textContent = n === 1 ? '1 record offline' : (n + ' records offline');
      });
    }
    refreshCounts(count());
    onChange(refreshCounts);
  }

  return { add: add, get: get, count: count, clear: clear, onChange: onChange, loadFile: loadFile, bindUI: bindUI };
})();

// =====================================================================
// ButtonLoading — contextual spinner feedback for async-driven buttons
// (Fetch, Audit, etc.). Swaps the button's label for a CSS spinner,
// disables clicks, and restores on completion — success or failure.
//
// Usage:
//   ButtonLoading.run(btnEl, async function() { await fetchThing(); });
//
// Falls back to plain invocation if btnEl is missing so callers can
// guard less and trust the helper to do the right thing.
// =====================================================================
var ButtonLoading = (function() {
  // start(btn) → returns a stop() function. Use this when the async
  // work is buried inside a helper (like PanelSwap) that doesn't
  // propagate a promise to wrap around. Callers put stop() in a
  // try/finally to guarantee the button restores on any path.
  function start(btn) {
    if (!btn) return function() {};
    var originalHtml = btn.innerHTML;
    var originalDisabled = btn.disabled;
    btn.disabled = true;
    btn.classList.add('btn-loading');
    btn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span>';
    return function stop() {
      btn.innerHTML = originalHtml;
      btn.disabled = originalDisabled;
      btn.classList.remove('btn-loading');
    };
  }

  // run(btn, asyncFn) — convenience: start spinner, run asyncFn,
  // stop on settle (resolve or reject). Use when you can pass a
  // single promise-returning function.
  function run(btn, asyncFn) {
    if (typeof asyncFn !== 'function') return;
    var stop = start(btn);
    var p;
    try { p = asyncFn(); }
    catch (e) { stop(); throw e; }
    if (!p || typeof p.then !== 'function') { stop(); return Promise.resolve(p); }
    return p.then(function(v) { stop(); return v; },
                  function(e) { stop(); throw e; });
  }
  return { start: start, run: run };
})();

// =====================================================================
// Mobile: collapse Source disclosure at load. The input-section should
// fit on one screen on phones — scrolling kicks in only when a result
// renders below. The Source details is `open` in HTML so desktop users
// see the URL template immediately; on narrow viewports we close it so
// the panel stays compact. Users can still expand it with one tap.
// =====================================================================
(function closeSourceOnMobile() {
  if (window.innerWidth > 1199) return;
  function apply() {
    document.querySelectorAll('details.lookup-source[open]').forEach(function(d) {
      d.removeAttribute('open');
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }
})();
