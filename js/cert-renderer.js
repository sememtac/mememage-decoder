// =====================================================================
// RENDER CERTIFICATE (HTML/CSS + Canvas sky band)
//
// Layout order (trading card style):
//   1. Header: Portrait, Brand, Title, Rarity Badge, Verification, Timestamp, Prompt, Lineage
//   2. Generation Parameters: grid
//   3. Birth Temperament: name, summary, traits
//   4. Sky Die: celestial rarity traits, skyband visualization, GPS time-lock
//   5. Machine Die: machine vitals grid, fingerprint, machine rarity traits
//   6. Entropy Die: kernel entropy hex, entropy rarity traits
//   7. Footer
// =====================================================================

// --- Rarity tier lookup (Age of Aries thresholds) ---
var RARITY_TIERS = [[80,'Legendary','#d44040'],[70,'Epic','#8a6210'],[60,'Very Rare','#5a2a8a'],[46,'Rare','#2a5090'],[35,'Uncommon','#2a7030'],[0,'Common','#606068']];

function getRarityTier(score) {
  for (var i = 0; i < RARITY_TIERS.length; i++) {
    if (score >= RARITY_TIERS[i][0]) return {name: RARITY_TIERS[i][1], color: RARITY_TIERS[i][2]};
  }
  return {name: 'Common', color: '#a0a0a0'};
}

// --- Bar reconstruction spec (embedded in every band's save metadata) ---
var BAR_SPEC = {
  bar_version: 1,
  magic: '0xAD4E',
  rs_parity_bytes: 6,
  band_width_px: 8,
  bands: ['magenta', 'yellow', 'cyan'],
  pixels_per_bit: {wide: 3, narrow: 2, width_threshold: 1024},
  brightness: {zero: 64, one: 192, threshold: 128},
  payload_format: 'url\\0content_hash_16hex',
  rows: 2
};

// --- Helpers ---
function _hexToRgb(hex) { return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)]; }
function _div(cls) { var d = document.createElement('div'); if (cls) d.className = cls; return d; }
function _divider() { return _div('plate-divider'); }

// Set up a canvas for hi-DPI rendering. Canvas CSS width stays
// fluid (the caller sets style.width: 100%); we measure the actual
// rendered width at init time and allocate a DPR-scaled buffer for
// crisp text at any viewport. Band init functions draw in logical
// coordinates — this wrapper pre-scales the context so they stay
// agnostic to DPR. Call AFTER the canvas is attached to the DOM so
// clientWidth is accurate.
function _setupHiDpi(canvas, fallbackW, heightForWidth) {
  var dpr = window.devicePixelRatio || 1;
  var cssW = canvas.clientWidth || fallbackW;
  var cssH = typeof heightForWidth === 'function'
    ? heightForWidth(cssW)
    : heightForWidth;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.height = cssH + 'px';
  canvas.getContext('2d').scale(dpr, dpr);
  return { w: cssW, h: cssH };
}
function _sectionLabel(text) { var d = _div('plate-section-label'); d.textContent = text; return d; }
function _copyable(el, text) {
  el.title = 'Click to copy';
  el.style.cursor = 'pointer';
  el.addEventListener('click', function() {
    navigator.clipboard.writeText(text).then(function() {
      el.style.borderColor = 'rgba(74,154,74,0.3)';
      setTimeout(function() { el.style.borderColor = ''; }, 800);
    });
  });
}

function _renderDieTraits(plate, dieData, tierColor) {
  if (!dieData || !dieData.length) return;
  var traits = _div('rarity-traits');
  traits.textContent = dieData.map(function(t) { return t.trait; }).join(' \u00b7 ');
  plate.appendChild(traits);
}

function _renderHalo(plate, halo, tierColor) {
  if (!halo) return;
  var haloDiv = _div('rarity-traits');
  haloDiv.style.cssText = 'margin-top:6px;color:' + tierColor + ';font-style:italic;';
  haloDiv.textContent = '\u2728 Halo \u2014 0xAD4E found in entropy';
  plate.appendChild(haloDiv);
}

function renderCert(meta, options) {
  // options: { target: Element, activateLayout: bool, injectPlayer: bool }
  // Defaults preserve the decoder's original behavior — render into #certWrap,
  // activate the two-panel sidebar, inject the music player.
  options = options || {};
  var certWrap = options.target || document.getElementById('certWrap');
  var activateLayout = options.activateLayout !== false;
  var injectPlayer = options.injectPlayer !== false;

  // Fade out any playing audio before destroying the certificate
  if (typeof CosmicPlayer !== 'undefined') CosmicPlayer.dismiss();

  // If the panel is already visible (e.g., PanelSwap is driving the
  // swap animation), don't toggle .visible — re-adding it re-triggers
  // @keyframes panelFadeIn and stacks with PanelSwap's intro, showing
  // as a double fade-in. Swap content in place and let PanelSwap own
  // the animation.
  var wasVisible = certWrap.classList.contains('visible');
  certWrap.innerHTML = '';
  if (!wasVisible) {
    // First reveal — clear only transient animation state; preserve
    // structural classes (panel-right, panel-right-has-player, etc.).
    certWrap.classList.remove('visible', 'dismissing');
  }

  var born = meta.born || {};
  var m = born.machine || {};
  var rarity = meta.rarity || {};

  // --- Build data arrays from meta ---
  var PROMPT = meta.prompt || '';
  var TIMESTAMP = meta.conceived || meta.timestamp || '';

  var GEN_PARAMS = [];
  // span: 3 = full width, 2 = two-thirds, 1 = one-third of the grid.
  // Order below builds the desired layout:
  //   [ SEED            full ]
  //   [ SIZE            full ]
  //   [ MODE            full ]
  //   [ STEPS | CFG | GUIDANCE ]      numeric row
  //   [ DENOISE | SAMPLER | SCHEDULER ] numeric/label row
  //   [ MODEL           full ]
  //   [ LoRA            full ]
  if (meta.seed !== undefined) GEN_PARAMS.push({l: 'Seed', v: '' + meta.seed, span: 3});
  if (meta.width && meta.height) GEN_PARAMS.push({l: 'Size', v: meta.width + ' \u00d7 ' + meta.height, span: 3});
  if (meta.mode) GEN_PARAMS.push({l: 'Mode', v: meta.mode, span: 3});
  // Numeric row (keep Steps / CFG / Guidance together visually)
  if (meta.steps !== undefined) GEN_PARAMS.push({l: 'Steps', v: '' + meta.steps});
  if (meta.cfg !== undefined) GEN_PARAMS.push({l: 'CFG', v: '' + meta.cfg});
  if (meta.guidance !== undefined) GEN_PARAMS.push({l: 'Guidance', v: '' + meta.guidance});
  // Second short row
  if (meta.denoise !== undefined) GEN_PARAMS.push({l: 'Denoise', v: '' + meta.denoise});
  if (meta.sampler) GEN_PARAMS.push({l: 'Sampler', v: meta.sampler});
  if (meta.scheduler) GEN_PARAMS.push({l: 'Scheduler', v: meta.scheduler});
  if (meta.unet) GEN_PARAMS.push({l: 'Model', v: meta.unet, span: 3});
  if (meta.lora) GEN_PARAMS.push({l: 'LoRA', v: meta.lora, span: 3});
  if (meta.lora_strength !== undefined) GEN_PARAMS.push({l: 'LoRA Str', v: '' + meta.lora_strength});

  // Build PLANET_DATA from born
  var planetSymbols = {sun:'\u2609', moon:'\u263D', mercury:'\u263F', venus:'\u2640', mars:'\u2642', jupiter:'\u2643', saturn:'\u2644'};
  var planetLabels = {sun:'Sun', moon:'Moon', mercury:'Mercury', venus:'Venus', mars:'Mars', jupiter:'Jupiter', saturn:'Saturn'};
  var PLANET_DATA = [];
  for (var bi = 0; bi < BODIES.length; bi++) {
    var bk = BODIES[bi].k;
    var val = born[bk];
    if (!val) continue;
    var parts = val.split(' ');
    var sign = parts[0];
    var deg = parseFloat(parts[1]) || 0;
    var lon = parseDegrees(val);
    if (lon === null) continue;
    var pd = {name: bk, sym: planetSymbols[bk] || '', label: planetLabels[bk] || bk, sign: sign, deg: deg, lon: lon};
    if (bk === 'moon' && born.moon_phase) pd.phase = born.moon_phase;
    PLANET_DATA.push(pd);
  }
  var hasSky = PLANET_DATA.length > 0;

  // Build MACHINE from born.machine. `span` controls the grid layout
  // downstream in machine-band — 3 = full width, 1.5 = half row,
  // 1 = one of three. Row totals must sum to 3.
  //   [ CPU                           ] span 3
  //   [ Cores | Active | GPU          ] 1|1|1
  //   [ RAM | Compressed | Free       ] 1|1|1
  //   [ Load                          ] span 3
  //   [ Power | Speculative | Purgeable ] 1|1|1
  //   [ Disk I/O                      ] span 3
  //   [ Net ↑ | Net ↓                 ] 1.5|1.5
  var MACHINE = [];
  var machineFields = [
    {k:'cpu', l:'CPU', span: 3},
    {k:'cores', l:'Cores'},
    {k:'mem_active', l:'Active'},
    {k:'gpu_cores', l:'GPU', fmt: function(v){return v + ' cores';}},
    {k:'ram', l:'RAM'},
    {k:'mem_compressed', l:'Compressed'},
    {k:'mem_free', l:'Free'},
    {k:'load', l:'Load', span: 3},
    {k:'power', l:'Power'},
    {k:'speculative_pages', l:'Speculative'},
    {k:'purgeable_pages', l:'Purgeable'},
    {k:'disk_io', l:'Disk I/O', span: 3},
    {k:'net_tx', l:'Net \u2191', span: 1.5},
    {k:'net_rx', l:'Net \u2193', span: 1.5}
  ];
  for (var fi = 0; fi < machineFields.length; fi++) {
    var f = machineFields[fi];
    var v = m[f.k];
    if (v === undefined || v === null) continue;
    MACHINE.push({l: f.l, v: f.fmt ? f.fmt(v) : '' + v, span: f.span || 1});
  }

  var KERNEL_ENTROPY = m.entropy || '';

  // Build SKY_READING from READINGS
  var skyReadings = [];
  for (var pi = 0; pi < PLANET_DATA.length; pi++) {
    var p = PLANET_DATA[pi];
    var r = '';
    if (p.name === 'moon') {
      var pn = (p.phase || '').split('(')[0].trim();
      r = READINGS.moon[pn] || '';
    } else {
      r = (READINGS[p.name] || {})[p.sign] || '';
    }
    if (r) skyReadings.push(r);
  }
  var SKY_READING = '';
  if (skyReadings.length > 0) SKY_READING = skyReadings[0];
  if (skyReadings.length > 1) SKY_READING += ' ' + skyReadings[1];

  // GPS data
  var GPS_CIPHER = '';
  var GPS_MODULUS = '';
  if (born.gps_locked) {
    GPS_CIPHER = born.gps_locked.ct || born.gps_locked.ciphertext || '';
    if (born.gps_locked.N) GPS_MODULUS = born.gps_locked.N;
  }

  // ===================================================================
  // TIME DECAY — compute age tier
  // ===================================================================
  var ageSecs = 0;
  var ageTier = 'fresh';
  var ageLabel = 'Fresh';
  if (TIMESTAMP) {
    ageSecs = (Date.now() - new Date(TIMESTAMP).getTime()) / 1000;
    if (ageSecs > 31536000) { ageTier = 'ancient'; ageLabel = 'Ancient'; }
    else if (ageSecs > 2592000) { ageTier = 'vintage'; ageLabel = 'Vintage'; }
    else if (ageSecs > 604800) { ageTier = 'aged'; ageLabel = 'Aged'; }
    else if (ageSecs > 86400) { ageTier = 'young'; ageLabel = 'Young'; }
    else { ageTier = 'fresh'; ageLabel = 'Fresh'; }
  }

  // Rarity tier
  var rarityScore = meta.rarity_score || 0;
  var tier = getRarityTier(rarityScore);
  var tierName = tier.name;
  var tierColor = tier.color;
  var rarityTier = tierName.toLowerCase().replace(' ', '');

  // Bar payload fragments for triptych reconstruction
  var barId = meta._identifier || '';
  var barHash = meta._content_hash || '';
  var barFragments = {
    gen:     'archive.org/download/' + barId,
    sky:     '/metadata.json\0',
    machine: barHash
  };

  // ===================================================================
  // 1. HEADER: Portrait, Brand, Title, Rarity, Verification, Time, Prompt, Lineage
  // ===================================================================
  var plate = document.createElement('div');
  plate.className = 'plate plate-age-' + ageTier + ' plate-rarity-' + rarityTier;

  var plateBg = _div('plate-bg');
  plate.appendChild(plateBg);

  // Brushed metal grain — drawn after plate is in the DOM so we know its size
  var _grainCanvas = document.createElement('canvas');
  _grainCanvas.className = 'plate-grain';
  plate.appendChild(_grainCanvas);

  // Deferred: draw grain after plate is rendered and has real dimensions
  setTimeout(function() {
    var rect = plate.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var GW = Math.round(rect.width * dpr);
    var GH = Math.round(rect.height * dpr);
    _grainCanvas.width = GW;
    _grainCanvas.height = GH;
    var gc = _grainCanvas.getContext('2d');

    // Draw horizontal hairlines
    var spacing = Math.max(2, Math.round(2 * dpr));
    for (var gy = 0; gy < GH; gy += spacing) {
      gc.fillStyle = 'rgba(255,255,255,0.15)';
      gc.fillRect(0, gy, GW, 0.5 * dpr);
      gc.fillStyle = 'rgba(0,0,0,0.10)';
      gc.fillRect(0, gy + dpr, GW, 0.5 * dpr);
    }

    // Erase center — large ellipse, grain only in the narrow edge margins
    gc.globalCompositeOperation = 'destination-out';
    gc.save();
    gc.translate(GW / 2, GH * 0.45);
    gc.scale(1, GH / GW * 1.1);  // stretch to tall ellipse matching plate aspect
    var maxR = GW * 0.56;
    var grad = gc.createRadialGradient(0, 0, 0, 0, 0, maxR);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(0.9, 'rgba(0,0,0,1)');
    grad.addColorStop(0.97, 'rgba(0,0,0,0.5)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    gc.fillStyle = grad;
    gc.fillRect(-GW, -GH, GW * 2, GH * 2);
    gc.restore();
    gc.globalCompositeOperation = 'source-over';
  }, 100);

  // plate-inner-highlight removed — was drawing a white line across the top

  // Constellation pattern — destiny map behind the header
  // Constellation pattern seed: constellation_hash (SHA-256 of celestial state, 64 bits)
  // The sky that witnessed the birth shapes the pattern. Every few minutes of real time
  // produces a different celestial snapshot, so every constellation is unique.
  // Fallback chain: constellation_hash → constellation_name → content_hash (legacy)
  var conSeed = meta.constellation_hash || meta.constellation_name || meta.content_hash || meta._content_hash || '';
  // Read decoder chunk index from new nested shape, fall back to flat
  // (legacy records pre-chunks-spec migration).
  var _dec = (meta.chunks && meta.chunks.decoder) || null;
  var myChunkIdx = _dec && _dec.index !== undefined ? _dec.index
                 : (meta.decoder_chunk_index !== undefined ? meta.decoder_chunk_index : -1);
  var isHeartStar = meta.heart_star_id && meta.heart_star_id === meta._identifier;
  if (isHeartStar) myChunkIdx = 0;

  if (conSeed) {
    var CON_W = 500, CON_H = 180;
    var conCanvas = document.createElement('canvas');
    conCanvas.width = CON_W; conCanvas.height = CON_H;
    // sqrt(2) scale — celestial dimension overflows the mortal plate
    conCanvas.style.cssText = 'position:absolute;top:10px;left:-5%;width:110%;height:auto;opacity:0.35;pointer-events:none;z-index:1';
    var conCtx = conCanvas.getContext('2d');

    // Seeded PRNG from constellation_hash — the sky shapes the pattern
    var cSeed = 0;
    for (var ci = 0; ci < conSeed.length; ci++) cSeed = (cSeed * 31 + conSeed.charCodeAt(ci)) & 0x7FFFFFFF;
    function cRng() { cSeed = (cSeed * 1103515245 + 12345) & 0x7FFFFFFF; return cSeed / 0x7FFFFFFF; }
    function cDst(a, b) { var dx = b.x - a.x, dy = b.y - a.y; return Math.sqrt(dx * dx + dy * dy); }

    // Place 12 stars in normalized [0,1]×[0,1] space, then scale to canvas
    var cPad = 0.08, cMinSep = 0.08;
    var cNorm = []; // normalized positions
    cNorm.push({ x: 0.3 + cRng() * 0.4, y: 0.2 + cRng() * 0.6 });
    for (var csi = 1; csi < 12; csi++) {
      var cnx, cny, cPlaced = false;
      for (var cAtt = 0; cAtt < 60; cAtt++) {
        if (cRng() < 0.55) {
          var cAnc = cNorm[Math.floor(cRng() * cNorm.length)];
          var cAng = cRng() * 6.2832, cDi = 0.12 + cRng() * 0.22;
          cnx = cAnc.x + Math.cos(cAng) * cDi; cny = cAnc.y + Math.sin(cAng) * cDi;
        } else { cnx = cPad + cRng() * (1 - cPad * 2); cny = cPad + cRng() * (1 - cPad * 2); }
        if (cnx < cPad || cnx > 1 - cPad || cny < cPad || cny > 1 - cPad) continue;
        var cOk = true;
        for (var cci = 0; cci < cNorm.length; cci++) if (cDst(cNorm[cci], {x:cnx,y:cny}) < cMinSep) { cOk = false; break; }
        if (cOk) { cPlaced = true; break; }
      }
      if (!cPlaced) { cnx = cPad + cRng() * (1 - cPad * 2); cny = cPad + cRng() * (1 - cPad * 2); }
      cNorm.push({ x: cnx, y: cny });
    }
    // Center the constellation — compute bounding box midpoint and shift to (0.5, 0.5)
    var cMinX = 1, cMaxX = 0, cMinY = 1, cMaxY = 0;
    for (var csi = 0; csi < cNorm.length; csi++) {
      if (cNorm[csi].x < cMinX) cMinX = cNorm[csi].x;
      if (cNorm[csi].x > cMaxX) cMaxX = cNorm[csi].x;
      if (cNorm[csi].y < cMinY) cMinY = cNorm[csi].y;
      if (cNorm[csi].y > cMaxY) cMaxY = cNorm[csi].y;
    }
    var cShiftX = 0.5 - (cMinX + cMaxX) / 2;
    var cShiftY = 0.5 - (cMinY + cMaxY) / 2;
    for (var csi = 0; csi < cNorm.length; csi++) {
      cNorm[csi].x += cShiftX;
      cNorm[csi].y += cShiftY;
    }

    var cStars = [];
    for (var csi = 0; csi < cNorm.length; csi++) cStars.push({ x: cNorm[csi].x * CON_W, y: cNorm[csi].y * CON_H });

    // MST from heart star (Prim's, 35° min angle, max degree 3, length regularity)
    var cEdges = [], cInTree = [true];
    for (var ci = 1; ci < 12; ci++) cInTree.push(false);
    function cDeg(idx) { var d = 0; for (var i = 0; i < cEdges.length; i++) if (cEdges[i][0] === idx || cEdges[i][1] === idx) d++; return d; }
    function cAngBtw(ax, ay, bx, by) { var dot = ax*bx+ay*by, m = Math.sqrt(ax*ax+ay*ay)*Math.sqrt(bx*bx+by*by); if (m < 0.001) return 180; return Math.acos(Math.max(-1, Math.min(1, dot/m))) * 180 / Math.PI; }
    function cAngOk(a, b) {
      var abx = cStars[b].x-cStars[a].x, aby = cStars[b].y-cStars[a].y;
      for (var ei = 0; ei < cEdges.length; ei++) {
        var e0 = cEdges[ei][0], e1 = cEdges[ei][1];
        if (e0===a||e1===a) { var o=e0===a?e1:e0; if (cAngBtw(abx,aby,cStars[o].x-cStars[a].x,cStars[o].y-cStars[a].y)<35) return false; }
        if (e0===b||e1===b) { var o=e0===b?e1:e0; if (cAngBtw(-abx,-aby,cStars[o].x-cStars[b].x,cStars[o].y-cStars[b].y)<35) return false; }
      }
      return true;
    }
    var cELens = [];
    for (var cStep = 0; cStep < 11; cStep++) {
      var cCands = [];
      for (var ci = 0; ci < 12; ci++) { if (!cInTree[ci]) continue; for (var cj = 0; cj < 12; cj++) { if (cInTree[cj]) continue; cCands.push({i:ci,j:cj,d:cDst(cStars[ci],cStars[cj])}); }}
      cCands.sort(function(a,b) { return a.d - b.d; });
      var cAvg = 0; if (cELens.length > 0) { for (var cl = 0; cl < cELens.length; cl++) cAvg += cELens[cl]; cAvg /= cELens.length; }
      var cAdded = false;
      var cMaxEdge = cELens.length >= 3 ? cAvg * 3 : 9999;
      for (var cci = 0; cci < cCands.length; cci++) { var cc = cCands[cci]; if (cDeg(cc.i)>=3) continue; if (!cAngOk(cc.i,cc.j)) continue; if (cc.d>cMaxEdge) continue; cInTree[cc.j]=true; cEdges.push([cc.i,cc.j]); cELens.push(cc.d); cAdded=true; break; }
      if (!cAdded) { for (var cci=0;cci<cCands.length;cci++) { if(cDeg(cCands[cci].i)<3&&cCands[cci].d<=cMaxEdge){cInTree[cCands[cci].j]=true;cEdges.push([cCands[cci].i,cCands[cci].j]);cELens.push(cCands[cci].d);cAdded=true;break;} } }
      if (!cAdded && cCands.length) { cInTree[cCands[0].j]=true; cEdges.push([cCands[0].i,cCands[0].j]); cELens.push(cCands[0].d); } // always connect — constellation must be whole
    }

    // RNG closures (tri/quad, max 2)
    var cAdj = []; for (var ci=0;ci<12;ci++) cAdj.push([]); for (var ci=0;ci<cEdges.length;ci++){cAdj[cEdges[ci][0]].push(cEdges[ci][1]);cAdj[cEdges[ci][1]].push(cEdges[ci][0]);}
    var cRngE = [];
    for (var ci=0;ci<12;ci++) for(var cj=ci+1;cj<12;cj++){var dij=cDst(cStars[ci],cStars[cj]);var bl=false;for(var ck=0;ck<12;ck++){if(ck===ci||ck===cj)continue;if(cDst(cStars[ci],cStars[ck])<dij&&cDst(cStars[cj],cStars[ck])<dij){bl=true;break;}}if(!bl)cRngE.push([ci,cj]);}
    var cExtras=[];
    for(var cri=0;cri<cRngE.length;cri++){var ca=cRngE[cri][0],cb=cRngE[cri][1];var inM=false;for(var cmi=0;cmi<cEdges.length;cmi++)if((cEdges[cmi][0]===ca&&cEdges[cmi][1]===cb)||(cEdges[cmi][0]===cb&&cEdges[cmi][1]===ca)){inM=true;break;}if(!inM)cExtras.push([ca,cb]);}
    function cFindPath(f,t,mx){var q=[[f,[f]]],v={};v[f]=true;while(q.length>0){var cur=q.shift(),n=cur[0],p=cur[1];if(p.length>mx+1)continue;if(n===t&&p.length>1)return p;for(var ni=0;ni<cAdj[n].length;ni++){var nx=cAdj[n][ni];if(!v[nx]){v[nx]=true;q.push([nx,p.concat([nx])]);}}}return null;}
    function cPtInPoly(px,py,poly){var s=0;for(var i=0;i<poly.length;i++){var j=(i+1)%poly.length;var c=(poly[j].x-poly[i].x)*(py-poly[i].y)-(poly[j].y-poly[i].y)*(px-poly[i].x);if(Math.abs(c)<.01)continue;if(s===0)s=c>0?1:-1;else if((c>0?1:-1)!==s)return false;}return true;}
    var cAC=0;
    for(var cei=0;cei<cExtras.length&&cAC<2;cei++){var ca=cExtras[cei][0],cb=cExtras[cei][1];var path=cFindPath(ca,cb,3);if(!path||path.length<3||path.length>4)continue;var poly=path.map(function(i){return cStars[i];});var enc=false;for(var csi=0;csi<12;csi++){var inP=false;for(var pi=0;pi<path.length;pi++)if(path[pi]===csi){inP=true;break;}if(inP)continue;if(cPtInPoly(cStars[csi].x,cStars[csi].y,poly)){enc=true;break;}}if(enc)continue;cEdges.push([ca,cb]);cAdj[ca].push(cb);cAdj[cb].push(ca);cAC++;}

    // Draw order: etched groove lines, then stars on top
    // Three passes: dark shadow (shifted down), main groove (center), light edge (shifted up)

    // Etched groove: offset perpendicular to each edge for angle-independent etching
    // Light source from top — shadow on upper-left side, highlight on lower-right
    for (var cei = 0; cei < cEdges.length; cei++) {
      var x0 = cStars[cEdges[cei][0]].x, y0 = cStars[cEdges[cei][0]].y;
      var x1 = cStars[cEdges[cei][1]].x, y1 = cStars[cEdges[cei][1]].y;
      // Perpendicular normal (rotated 90 degrees, normalized)
      var dx = x1 - x0, dy = y1 - y0;
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.1) continue;
      // Normal pointing toward the light (upper-left)
      var nx = -dy / len, ny = dx / len;
      // Ensure normal has a consistent "toward light" direction (upper side)
      if (ny > 0) { nx = -nx; ny = -ny; }
      var off = 0.8;
      // Dark shadow (offset toward light — this is the shadow inside the groove on the lit side)
      conCtx.strokeStyle = 'rgba(0,0,0,0.55)';
      conCtx.lineWidth = 0.6;
      conCtx.beginPath(); conCtx.moveTo(x0 + nx * off, y0 + ny * off); conCtx.lineTo(x1 + nx * off, y1 + ny * off); conCtx.stroke();
      // Bright highlight (offset away from light — bottom lip catches light)
      conCtx.strokeStyle = 'rgba(255,255,255,0.45)';
      conCtx.lineWidth = 0.7;
      conCtx.beginPath(); conCtx.moveTo(x0 - nx * off, y0 - ny * off); conCtx.lineTo(x1 - nx * off, y1 - ny * off); conCtx.stroke();
      // Main groove line (center)
      conCtx.strokeStyle = 'rgba(255,255,255,0.6)';
      conCtx.lineWidth = 0.5;
      conCtx.beginPath(); conCtx.moveTo(x0, y0); conCtx.lineTo(x1, y1); conCtx.stroke();
    }

    // 3. Stars — animated twinkle via setTimeout
    var _tcR = 160, _tcG = 160, _tcB = 160;
    if (tierColor) { _tcR = parseInt(tierColor.slice(1,3),16); _tcG = parseInt(tierColor.slice(3,5),16); _tcB = parseInt(tierColor.slice(5,7),16); }

    // Save the line canvas state (lines don't change)
    var lineSnapshot = conCtx.getImageData(0, 0, CON_W, CON_H);

    // Star twinkle parameters — each star gets a random phase and period
    var twinklePhase = [], twinklePeriod = [];
    for (var tsi = 0; tsi < 12; tsi++) {
      twinklePhase.push(Math.random() * 6.2832);
      twinklePeriod.push(2000 + Math.random() * 4000); // 2-6 second cycle
    }

    function drawStars() {
      // Restore lines (clear stars from previous frame)
      conCtx.putImageData(lineSnapshot, 0, 0);

      var now = Date.now();
      for (var csi = 0; csi < 12; csi++) {
        var cs = cStars[csi];
        var twinkle = 0.85 + 0.15 * Math.sin(now / twinklePeriod[csi] * 6.2832 + twinklePhase[csi]); // 0.85-1.0

        var shadowR, coreR, shadowPeak, shadowHold;
        if (csi === 0) { shadowR = 14; coreR = 4; shadowPeak = 0.9; shadowHold = 0.45; }
        else if (csi === myChunkIdx) { shadowR = 11; coreR = 3.5; shadowPeak = 0.9; shadowHold = 0.35; }
        else { shadowR = 7; coreR = 2.7; shadowPeak = 0.7; shadowHold = 0.25; }

        // Spherical dent — ball bearing pressed into metal
        var dentR = coreR + 7;

        // 1. Dark concavity (the hollow)
        var wellGrad = conCtx.createRadialGradient(cs.x, cs.y, coreR * 0.3, cs.x, cs.y, dentR);
        wellGrad.addColorStop(0, 'rgba(0,0,0,' + (shadowPeak * 0.9) + ')');
        wellGrad.addColorStop(0.4, 'rgba(0,0,0,' + (shadowHold * 0.6) + ')');
        wellGrad.addColorStop(1, 'rgba(0,0,0,0)');
        conCtx.fillStyle = wellGrad;
        conCtx.beginPath(); conCtx.arc(cs.x, cs.y, dentR, 0, 6.2832); conCtx.fill();

        // 2. Dark crescent on top (rim blocks light going into the hole)
        var rimGrad = conCtx.createRadialGradient(cs.x, cs.y - dentR * 0.35, dentR * 0.3, cs.x, cs.y, dentR);
        rimGrad.addColorStop(0, 'rgba(0,0,0,' + (shadowPeak * 0.5) + ')');
        rimGrad.addColorStop(0.5, 'rgba(0,0,0,' + (shadowPeak * 0.15) + ')');
        rimGrad.addColorStop(1, 'rgba(0,0,0,0)');
        conCtx.fillStyle = rimGrad;
        conCtx.beginPath(); conCtx.arc(cs.x, cs.y, dentR, 0, 6.2832); conCtx.fill();

        // 3. Light crescent on bottom (inner surface facing the light)
        var btmGrad = conCtx.createRadialGradient(cs.x, cs.y + dentR * 0.35, dentR * 0.3, cs.x, cs.y, dentR);
        btmGrad.addColorStop(0, 'rgba(255,255,255,' + (shadowPeak * 0.55) + ')');
        btmGrad.addColorStop(0.5, 'rgba(255,255,255,' + (shadowPeak * 0.2) + ')');
        btmGrad.addColorStop(1, 'rgba(255,255,255,0)');
        conCtx.fillStyle = btmGrad;
        conCtx.beginPath(); conCtx.arc(cs.x, cs.y, dentR, 0, 6.2832); conCtx.fill();

        // 4. Specular highlight — light pooling at the bottom of the bowl
        var specX = cs.x + dentR * 0.1, specY = cs.y + dentR * 0.2;
        var specR = dentR * 0.3;
        var specGrad = conCtx.createRadialGradient(specX, specY, 0, specX, specY, specR);
        specGrad.addColorStop(0, 'rgba(255,255,255,' + (shadowPeak * 0.25) + ')');
        specGrad.addColorStop(0.6, 'rgba(255,255,255,' + (shadowPeak * 0.06) + ')');
        specGrad.addColorStop(1, 'rgba(255,255,255,0)');
        conCtx.fillStyle = specGrad;
        conCtx.beginPath(); conCtx.arc(specX, specY, specR, 0, 6.2832); conCtx.fill();
        conCtx.beginPath(); conCtx.arc(cs.x, cs.y, dentR, 0, 6.2832); conCtx.fill();

        var isHeart = csi === 0;
        var isCurrent = csi === myChunkIdx;
        var isHeartAndCurrent = isHeart && isCurrent;
        var spikeR = isHeartAndCurrent ? _tcR : 255;
        var spikeG = isHeartAndCurrent ? _tcG : 250;
        var spikeB = isHeartAndCurrent ? _tcB : 230;

        if (isHeart) {
          var heartTwinkle = 0.85 + 0.15 * Math.sin(now / 3000 * 6.2832 + twinklePhase[0]);
          var spikeRotation = (now / 60000) * 6.2832; // one full rotation per 60 seconds
          // + spikes (cardinal, longer)
          conCtx.strokeStyle = 'rgba(' + spikeR + ',' + spikeG + ',' + spikeB + ',' + heartTwinkle + ')';
          conCtx.lineWidth = 1.5;
          var plusLen = 18;
          for (var sp = 0; sp < 4; sp++) {
            var spAng = sp * Math.PI / 2 + spikeRotation;
            conCtx.beginPath();
            conCtx.moveTo(cs.x + Math.cos(spAng) * (coreR + 1), cs.y + Math.sin(spAng) * (coreR + 1));
            conCtx.lineTo(cs.x + Math.cos(spAng) * plusLen, cs.y + Math.sin(spAng) * plusLen);
            conCtx.stroke();
          }
          // × spikes (diagonal, shorter)
          conCtx.strokeStyle = 'rgba(' + spikeR + ',' + spikeG + ',' + spikeB + ',' + (heartTwinkle * 0.8) + ')';
          conCtx.lineWidth = 1.0;
          var crossLen = 12;
          for (var sp2 = 0; sp2 < 4; sp2++) {
            var spAng2 = sp2 * Math.PI / 2 + Math.PI / 4 + spikeRotation;
            conCtx.beginPath();
            conCtx.moveTo(cs.x + Math.cos(spAng2) * (coreR + 1), cs.y + Math.sin(spAng2) * (coreR + 1));
            conCtx.lineTo(cs.x + Math.cos(spAng2) * crossLen, cs.y + Math.sin(spAng2) * crossLen);
            conCtx.stroke();
          }
          conCtx.fillStyle = isHeartAndCurrent ? 'rgba(' + _tcR + ',' + _tcG + ',' + _tcB + ',1)' : 'rgba(255,245,220,1)';
        } else {
          var coreBright = Math.round(200 + 55 * twinkle); // 247-255, never dim
          conCtx.fillStyle = 'rgba(' + coreBright + ',' + coreBright + ',' + coreBright + ',1)';
        }

        if (isCurrent) {
          conCtx.strokeStyle = 'rgba(' + _tcR + ',' + _tcG + ',' + _tcB + ',1)';
          conCtx.lineWidth = 2.5;
          conCtx.beginPath(); conCtx.arc(cs.x, cs.y, coreR + 5, 0, 6.2832); conCtx.stroke();
        }
        conCtx.beginPath(); conCtx.arc(cs.x, cs.y, coreR, 0, 6.2832); conCtx.fill();
      }
    }

    drawStars();
    // Twinkle loop — slow, cosmic pace
    (function twinkleLoop() {
      setTimeout(function() {
        drawStars();
        twinkleLoop();
      }, 80); // ~12fps — gentle, not flashy
    })();

    plate.appendChild(conCanvas);
  }

  // Portrait — the face is only revealed when the image was present (verified).
  // Navigating by word alone = stargazing. You see the fingerprint, not the source.
  // Bring the body (By Sight or By Soul) and the face is the reward.
  var vfEarly = meta._verification;
  var imageWasPresent = vfEarly && (vfEarly.status === 'verified' || vfEarly.status === 'bar_verified' || vfEarly.status === 'tampered');
  if (meta.thumbnail && imageWasPresent) {
    var portraitWrap = _div();
    portraitWrap.style.cssText = 'text-align:center;margin-bottom:12px;position:relative;z-index:3';
    var portraitRing = _div();
    portraitRing.style.cssText = 'display:inline-block;width:64px;height:64px;border-radius:50%;overflow:hidden;border:2px solid rgba(0,0,0,0.08);box-shadow:0 2px 8px rgba(0,0,0,0.1)';
    var portraitImg = document.createElement('img');
    portraitImg.src = meta.thumbnail;
    portraitImg.style.cssText = 'width:100%;height:100%;object-fit:cover';
    portraitRing.appendChild(portraitImg);
    portraitWrap.appendChild(portraitRing);
    plate.appendChild(portraitWrap);
  }

  // Brand + Title + Rarity (integrated header)
  var header = _div('plate-header');
  var headerHtml = '<div class="plate-brand">M E M E M A G E</div><div class="plate-title">Certificate of Origin</div>';
  if (meta.rarity_score !== undefined) {
    // Lighten rarity color toward white for readability against drop shadow
    var _rc = _hexToRgb(tierColor);
    var _lR = Math.min(255, _rc[0] + Math.round((255 - _rc[0]) * 0.4));
    var _lG = Math.min(255, _rc[1] + Math.round((255 - _rc[1]) * 0.4));
    var _lB = Math.min(255, _rc[2] + Math.round((255 - _rc[2]) * 0.4));
    headerHtml += '<div style="margin-top:8px"><span class="rarity-badge" style="color:rgb(' + _lR + ',' + _lG + ',' + _lB + ');">' + escapeHtml(tierName.toUpperCase()) + ' (' + rarityScore + ')</span></div>';
  }
  header.innerHTML = headerHtml;
  plate.appendChild(header);

  // Verification badges — hidden in sample mode
  var vf = meta._verification;
  if (vf && !isSample) {
    var badgeWrap = _div('verify-badge-group');

    // WITNESSED badge (hash integrity)
    var badgeClass = vf.status === 'bar_verified' ? 'verified' : vf.status;
    var badge = _div('verify-badge verify-' + badgeClass);
    if (vf.status === 'verified' || vf.status === 'bar_verified') {
      badge.innerHTML = '<span class="verify-icon">&#x2713;</span> WITNESSED';
      badge.title = 'Hash match \u2014 body and soul joined, sealed by spirit';
    } else if (vf.status === 'tampered') {
      badge.innerHTML = '<span class="verify-icon">&#x2717;</span> ALTERED';
      badge.title = 'Hash mismatch \u2014 soul rejects the body';
    } else if (vf.status === 'unverified') {
      badge.innerHTML = '<span class="verify-icon">&#x25CB;</span> BODILESS';
      badge.title = 'No spirit \u2014 soul only, bring body to witness';
    } else {
      badge.innerHTML = '<span class="verify-icon">&#x25CB;</span> BODILESS';
      badge.title = 'No spirit \u2014 soul only, bring body to witness';
    }
    badgeWrap.appendChild(badge);

    // AUTHENTICATED badge (Ed25519 signature)
    if (vf.signature === true) {
      var sigBadge = _div('verify-badge verify-authenticated');
      sigBadge.innerHTML = '<span class="verify-icon">&#x1F511;</span> AUTHENTICATED';
      sigBadge.title = vf.signatureDetail || 'Ed25519 signature verified';
      badgeWrap.appendChild(sigBadge);
    } else if (vf.signature === false) {
      var sigBadge2 = _div('verify-badge verify-forged');
      sigBadge2.innerHTML = '<span class="verify-icon">&#x2717;</span> FORGED';
      sigBadge2.title = vf.signatureDetail || 'Signature invalid \u2014 possible forgery';
      badgeWrap.appendChild(sigBadge2);
    }
    // signature === null means no signature or can't verify — no badge shown

    // EMBODIED badge (portrait/dHash match)
    if (vf.portrait) {
      if (vf.portrait.match === true) {
        var embBadge = _div('verify-badge verify-embodied');
        embBadge.innerHTML = '<span class="verify-icon">&#x2B22;</span> EMBODIED';
        embBadge.title = 'Portrait match \u2014 dHash distance ' + vf.portrait.distance + '/' + vf.portrait.threshold + ' (image is the original body)';
        badgeWrap.appendChild(embBadge);
      } else if (vf.portrait.match === false) {
        var embBadge2 = _div('verify-badge verify-disembodied');
        embBadge2.innerHTML = '<span class="verify-icon">&#x2B21;</span> DISEMBODIED';
        embBadge2.title = 'Portrait mismatch \u2014 dHash distance ' + vf.portrait.distance + ' (this image may not be the original)';
        badgeWrap.appendChild(embBadge2);
      }
    }

    plate.appendChild(badgeWrap);
  }

  plate.appendChild(_div('plate-divider-short'));

  // Timestamp
  if (TIMESTAMP) {
    var ts = _div('plate-timestamp selectable');
    ts.textContent = TIMESTAMP;
    plate.appendChild(ts);
  }

  // Prompt
  if (PROMPT) {
    plate.appendChild(_divider());
    var prompt = _div('plate-prompt selectable');
    prompt.textContent = '\u201C' + PROMPT + '\u201D';
    plate.appendChild(prompt);
    plate.appendChild(_divider());
  }

  // Constellation — name is clickable (navigates to heart star)
  if (meta.constellation_name) {
    var conDiv = _div('lineage-text');
    var conNameEl;
    if (meta.heart_star_id && meta.heart_star_id !== meta._identifier) {
      // Sibling — constellation name links to heart star
      conNameEl = document.createElement('a');
      conNameEl.href = '#';
      conNameEl.textContent = meta.constellation_name;
      conNameEl.addEventListener('click', function(e) {
        e.preventDefault();
        lookupById(meta.heart_star_id);
        window.scrollTo({top: 0, behavior: 'smooth'});
      });
    } else {
      // Heart star itself, or no heart star — just the name
      conNameEl = document.createElement('span');
      conNameEl.textContent = meta.constellation_name;
    }
    // Bayer designation — Greek letters by birth order
    // Letter navigates to parent (one step back), name navigates to heart star
    var BAYER = ['\u03b1','\u03b2','\u03b3','\u03b4','\u03b5','\u03b6','\u03b7','\u03b8','\u03b9','\u03ba','\u03bb','\u03bc'];
    if (myChunkIdx >= 0 && myChunkIdx < 12) {
      if (meta.parent_id && !isHeartStar) {
        // Greek letter links to parent (previous star in chain)
        var bayerLink = document.createElement('a');
        bayerLink.href = '#';
        bayerLink.className = 'bayer-letter';
        bayerLink.textContent = BAYER[myChunkIdx] + ' ';
        bayerLink.title = 'Previous: ' + meta.parent_id;
        bayerLink.addEventListener('click', function(e) {
          e.preventDefault();
          lookupById(meta.parent_id);
          window.scrollTo({top: 0, behavior: 'smooth'});
        });
        conDiv.appendChild(bayerLink);
      } else {
        // Heart star — α is not a link (no previous, this is the beginning)
        var bayerSpan = document.createElement('span');
        bayerSpan.className = 'bayer-letter';
        bayerSpan.textContent = BAYER[myChunkIdx] + ' ';
        conDiv.appendChild(bayerSpan);
      }
    }
    conDiv.appendChild(conNameEl);
    plate.appendChild(conDiv);
  }

  // Lineage — hidden in the constellation name click.
  // The heart star link IS the chain. The raw identifier stays in the data, not the display.

  // ===================================================================
  // 2. BIRTH TEMPERAMENT
  // ===================================================================
  if (meta.birth_temperament) {
    plate.appendChild(_sectionLabel('BIRTH TEMPERAMENT'));

    var tempCell = _div('temperament-cell');

    var tempName = _div('plate-temperament-name selectable');
    tempName.textContent = meta.birth_temperament;
    tempCell.appendChild(tempName);

    if (meta.birth_summary) {
      var tempSummary = _div('plate-temperament-summary selectable');
      tempSummary.textContent = meta.birth_summary;
      tempCell.appendChild(tempSummary);
    }

    if (meta.birth_traits && meta.birth_traits.length) {
      var tempTraits = _div('trait-badge-group');
      for (var ti = 0; ti < meta.birth_traits.length; ti++) {
        var traitKey = meta.birth_traits[ti];
        var traitDef = (typeof BIRTH_TRAITS !== 'undefined') ? BIRTH_TRAITS[traitKey] : null;
        var badge = document.createElement('span');
        badge.className = 'trait-badge';
        if (traitDef) {
          badge.dataset.metal = traitDef.metal || 'silver';
          var imgUrl = assetUrl('img/traits/' + traitKey + '.png');
          var img = document.createElement('img');
          img.src = imgUrl;
          img.alt = traitDef.name;
          img.className = 'trait-img';
          // If the icon 404s, swap to the readable text fallback so the
          // badge doesn't render as a broken image symbol.
          img.onerror = function() {
            var b = this.parentElement;
            if (!b) return;
            this.remove();
            b.classList.add('trait-badge-text');
            b.textContent = traitDef.name;
            b.style.removeProperty('--trait-mask');
          };
          badge.style.setProperty('--trait-mask', 'url(' + imgUrl + ')');
          badge.appendChild(img);
          badge.title = traitDef.name + ' \u2014 ' + traitDef.desc;
        } else {
          // Trait isn't in BIRTH_TRAITS at all — show the key humanized.
          badge.classList.add('trait-badge-text');
          badge.textContent = traitKey.replace(/_/g, ' ').replace(/\b\w/g, function(c){return c.toUpperCase();});
          badge.title = badge.textContent;
        }
        tempTraits.appendChild(badge);
      }
      tempCell.appendChild(tempTraits);
    }

    plate.appendChild(tempCell);
  }

  // Sample mode: stop after Birth Temperament — the spirit reveals the rest
  var isSample = window._sampleMode;
  if (isSample) {
    window._sampleMode = false; // consume flag
    plate.classList.add('plate-sample');
  }

  // ===================================================================
  // 3. GENERATION PARAMETERS (canvas band)
  // ===================================================================
  if (GEN_PARAMS.length > 0 && !isSample) {
    plate.appendChild(_sectionLabel('GENERATION PARAMETERS'));

    var genWrap = _div('sky-band-wrap');
    var genContainer = _div('sky-band-container');
    // Max logical width; actual canvas buffer width is measured post-mount
    // so the band always matches the plate's real content area.
    var GEN_W = 604;
    // Count rows accounting for span 1/2/3 cells in a 3-col grid.
    // Mirrors the packing in gen-band.js so canvas height matches.
    var _gpCol = 0, _gpRow = 0;
    for (var _gpi = 0; _gpi < GEN_PARAMS.length; _gpi++) {
      var _sp = Math.min(3, Math.max(1, GEN_PARAMS[_gpi].span || 1));
      if (_gpCol + _sp > 3) { _gpCol = 0; _gpRow++; }
      _gpCol += _sp;
      if (_gpCol >= 3) { _gpCol = 0; _gpRow++; }
    }
    var genRows = _gpRow + (_gpCol > 0 ? 1 : 0);
    var GEN_H = Math.max(80, genRows * 50 + 30);
    var genCanvas = document.createElement('canvas');
    // Fluid CSS sizing so band width matches the plate. _setupHiDpi
    // measures actual rendered width in the setTimeout below.
    genCanvas.style.width = '100%';
    genContainer.appendChild(genCanvas);
    genWrap.appendChild(genContainer);
    plate.appendChild(genWrap);

    setTimeout(function() {
      if (typeof initGenBand !== 'function') return;
      var dims = _setupHiDpi(genCanvas, GEN_W, GEN_H);
      initGenBand(genCanvas, dims.w, dims.h, GEN_PARAMS, KERNEL_ENTROPY, BAR_SPEC, barFragments.gen, tierColor, rarityScore);
    }, 0);
  }

  // ===================================================================
  // 4. MACHINE DIE: vitals canvas band, machine rarity traits
  // ===================================================================
  if (MACHINE.length > 0 && !isSample) {
    plate.appendChild(_sectionLabel('MACHINE AT BIRTH'));

    var machWrap = _div('sky-band-wrap');
    var machContainer = _div('sky-band-container');
    var MACH_W = 604;
    // Compute row count using same span-based packing as machine-band.
    // Each row's spans sum to 3 (full width).
    var machRowSum = 0, machRows = 0;
    var MACH_EPS = 0.001;
    for (var mi = 0; mi < MACHINE.length; mi++) {
      var ms = Math.min(3, Math.max(0.5, MACHINE[mi].span || 1));
      if (machRowSum + ms > 3 + MACH_EPS) {
        if (machRowSum > 0) machRows++;
        machRowSum = 0;
      }
      machRowSum += ms;
      if (Math.abs(machRowSum - 3) < MACH_EPS) { machRows++; machRowSum = 0; }
    }
    if (machRowSum > 0) machRows++;
    // Extra height: entropy cell + identity/traits cell
    var extraH = 0;
    if (KERNEL_ENTROPY) extraH += 54; // entropy cell + gap
    // Identity+traits cell
    var bottomCellH = 14;
    if (meta.machine_fingerprint) bottomCellH += 12;
    var machTraitCount = (rarity.machine || []).length + (rarity.entropy || []).length;
    if (machTraitCount > 0) bottomCellH += 12;
    if (rarity.halo || rarity.echo) bottomCellH += 12;
    extraH += bottomCellH + 6; // cell + gap
    var MACH_H = Math.max(80, machRows * 44 + 30 + extraH);
    var machCanvas = document.createElement('canvas');
    machCanvas.style.width = '100%';
    machContainer.appendChild(machCanvas);
    machWrap.appendChild(machContainer);
    plate.appendChild(machWrap);

    var machineTraits = (rarity.machine || []).map(function(t) { return t.trait; });
    var entropyTraits = (rarity.entropy || []).map(function(t) { return t.trait; });
    var haloData = rarity.halo || rarity.echo || null;

    setTimeout(function() {
      if (typeof initMachineBand !== 'function') return;
      var dims = _setupHiDpi(machCanvas, MACH_W, MACH_H);
      initMachineBand(machCanvas, dims.w, dims.h, MACHINE, KERNEL_ENTROPY, meta.machine_fingerprint, BAR_SPEC, barFragments.machine, machineTraits, entropyTraits, haloData, tierColor, meta._about || '', rarityScore);
    }, 0);
  }

  // ===================================================================
  // 5. SKY DIE: celestial traits + skyband
  // ===================================================================
  if (hasSky && !isSample) {
    plate.appendChild(_sectionLabel('SKY AT THE MOMENT OF CREATION'));

    var skyWrap = _div('sky-band-wrap');
    var skyContainer = _div('sky-band-container');
    var SKY_W = 604;
    var skyCanvas = document.createElement('canvas');
    skyCanvas.style.width = '100%';
    skyContainer.appendChild(skyCanvas);
    skyWrap.appendChild(skyContainer);
    plate.appendChild(skyWrap);

    var celestialTraits = (rarity.celestial || []).map(function(t) { return t.trait; });
    var birthTemp = meta.birth_temperament || '';
    // Sky-band height stays fixed at 390 regardless of canvas width.
    // Its graphical elements (zodiac wheel, orbit ring, meteor trails)
    // are positioned in absolute logical coordinates from the top —
    // scaling H proportionally with W pushes them off-canvas on mobile.
    // Keeping 390 means mobile gets a portrait-aspect sky (narrower
    // but same tall) with every graphical element intact.
    // Reserve extra height for:
    // (1) multi-line trait footer when there are multiple celestial
    //     traits — on narrow canvases they stack one per line (see
    //     sky-band.js) and need +11px each to not overlap the reading.
    // (2) the celestial reading wrapping to more lines on narrow
    //     canvases — text that fits on 2 lines at 604px wraps to 4
    //     on ~295px. Reserve ~12px per extra anticipated line below
    //     500px canvas width.
    setTimeout(function() {
      var dims = _setupHiDpi(skyCanvas, SKY_W, function(w) {
        var readingExtra = w < 500 ? 36 : (w < 600 ? 12 : 0);
        var traitExtra = Math.max(0, celestialTraits.length - 1) * 11;
        return 390 + readingExtra + traitExtra;
      });
      initSkyBand(skyCanvas, dims.w, dims.h, PLANET_DATA, SKY_READING, KERNEL_ENTROPY, m, ageTier, rarityScore, celestialTraits, birthTemp);
    }, 0);

    if (typeof enableCanvasSave === 'function') {
      var skyMeta = {};
      for (var si = 0; si < PLANET_DATA.length; si++) {
        var sp = PLANET_DATA[si];
        skyMeta[sp.name] = sp.sign + ' ' + sp.deg.toFixed(1) + '\u00b0';
      }
      if (born.moon_phase) skyMeta.moon_phase = born.moon_phase;
      if (born.angular_spread) skyMeta.angular_spread = '' + born.angular_spread;
      enableCanvasSave(skyCanvas, {
        celestial_positions: JSON.stringify(skyMeta),
        bar_spec: JSON.stringify(BAR_SPEC),
        bar_payload_2: barFragments.sky,
        Software: 'Mememage'
      });
    }
  }

  // ===================================================================
  // 6. BIRTHPLACE — TIME-LOCKED
  // ===================================================================
  if (GPS_CIPHER && !isSample) {
    plate.appendChild(_sectionLabel('BIRTHPLACE \u2014 TIME-LOCKED *'));

    var gpsContainer = _div('gps-container');
    var gtc = _hexToRgb(tierColor || '#a0a0a0');
    gpsContainer.style.background = 'linear-gradient(180deg, rgb(' + Math.floor(gtc[0]*0.08) + ',' + Math.floor(gtc[1]*0.08) + ',' + Math.floor(gtc[2]*0.08) + ') 0%, rgb(' + Math.floor(gtc[0]*0.12) + ',' + Math.floor(gtc[1]*0.12) + ',' + Math.floor(gtc[2]*0.12) + ') 50%, rgb(' + Math.floor(gtc[0]*0.08) + ',' + Math.floor(gtc[1]*0.08) + ',' + Math.floor(gtc[2]*0.08) + ') 100%)';

    var cipherLabel = _div('gps-mod-label');
    cipherLabel.textContent = 'Encrypted GPS Coordinates \u2014 click to copy';
    gpsContainer.appendChild(cipherLabel);

    var gpsCipher = _div('gps-cipher');
    gpsCipher.textContent = GPS_CIPHER;
    _copyable(gpsCipher, GPS_CIPHER);
    gpsContainer.appendChild(gpsCipher);

    if (GPS_MODULUS) {
      var modLabel = _div('gps-mod-label');
      modLabel.textContent = 'RSA Modulus N (2048-bit) \u2014 click to copy';
      gpsContainer.appendChild(modLabel);

      var modBlock = _div('gps-modulus expanded');
      modBlock.textContent = GPS_MODULUS;
      _copyable(modBlock, GPS_MODULUS);
      gpsContainer.appendChild(modBlock);
    }

    var footnote = _div('gps-footnote');
    var tExp = born.gps_locked && born.gps_locked.t ? born.gps_locked.t.toExponential(0) : '?';
    var pLen = born.gps_locked && (born.gps_locked.len || born.gps_locked.plaintext_length) || '?';
    footnote.innerHTML = '* ' + escapeHtml('' + tExp) + ' sequential squarings of 2 mod N, SHA-256 the result, XOR with ciphertext. First ' + escapeHtml('' + pLen) + ' bytes = GPS.';
    gpsContainer.appendChild(footnote);

    // Password-based GPS unlock — the creator can reveal their own
    // GPS instantly by entering the password set at conception time,
    // no need to wait 10 years for the time-lock puzzle to finish.
    // Only rendered when the record actually carries an AES envelope.
    if (meta.gps_encrypted) {
      var unlockWrap = _div('gps-unlock');
      var unlockLabel = _div('gps-mod-label');
      unlockLabel.textContent = 'Creator password \u2014 unlock instantly';
      unlockWrap.appendChild(unlockLabel);

      var unlockRow = _div('gps-unlock-row');
      var pwInput = document.createElement('input');
      pwInput.type = 'password';
      pwInput.className = 'gps-pw';
      pwInput.placeholder = 'password';
      unlockRow.appendChild(pwInput);

      var unlockBtn = document.createElement('button');
      unlockBtn.type = 'button';
      unlockBtn.className = 'gps-unlock-btn';
      unlockBtn.textContent = 'Unlock';
      unlockRow.appendChild(unlockBtn);
      unlockWrap.appendChild(unlockRow);

      var resultSlot = _div('gps-unlock-result');
      unlockWrap.appendChild(resultSlot);
      gpsContainer.appendChild(unlockWrap);

      var envRef = meta.gps_encrypted;
      async function doUnlock() {
        var pw = pwInput.value;
        if (!pw) { resultSlot.innerHTML = '<span class="gps-unlock-err">Enter password</span>'; return; }
        unlockBtn.disabled = true;
        resultSlot.innerHTML = '<span class="gps-unlock-pending">Decrypting\u2026</span>';
        var res = await Access.decryptGps(envRef, pw);
        if (res.ok) {
          resultSlot.innerHTML =
            '<div class="gps-unlock-coords">' +
              '<div><span class="gps-unlock-k">LAT</span> <span class="gps-unlock-v">' + escapeHtml(res.lat) + '</span></div>' +
              '<div><span class="gps-unlock-k">LON</span> <span class="gps-unlock-v">' + escapeHtml(res.lon) + '</span></div>' +
            '</div>';
        } else {
          resultSlot.innerHTML = '<span class="gps-unlock-err">' + escapeHtml(res.error || 'Wrong password') + '</span>';
        }
        unlockBtn.disabled = false;
      }
      unlockBtn.addEventListener('click', doUnlock);
      pwInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') doUnlock(); });
    }

    plate.appendChild(gpsContainer);
  }

  // ===================================================================
  // 8. FOOTER
  // ===================================================================
  var footer = _div('plate-footer');
  if (hasSky) {
    footer.innerHTML = '<div class="plate-footer-line">Celestial positions computed via Meeus algorithms (J2000.0 epoch)</div>';
  }
  footer.innerHTML += '<div class="plate-footer-italic">The cosmos does not care, but it was watching.</div>';

  // Age badge — hidden in sample mode, since the example isn't a real
  // record accumulating age.
  if (TIMESTAMP && ageTier !== 'fresh' && !isSample) {
    var ageDays = Math.floor(ageSecs / 86400);
    var ageStr = ageDays < 30 ? ageDays + ' days old' : ageDays < 365 ? Math.floor(ageDays / 30) + ' months old' : Math.floor(ageDays / 365) + ' years old';
    footer.innerHTML += '<div style="text-align:center"><span class="age-badge">' + ageLabel + ' \u00b7 ' + ageStr + '</span></div>';
  }

  plate.appendChild(footer);

  // ===================================================================
  // SAVE CERTIFICATE — composite canvases + encode bar
  // ===================================================================
  if (barId && barHash && !isSample) {
    var saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save Certificate';
    saveBtn.className = 'save-cert-btn save-cert-rarity-' + rarityTier;

    // Stardust particle system
    var sparkCanvas = document.createElement('canvas');
    sparkCanvas.className = 'sparkle-canvas';
    saveBtn.appendChild(sparkCanvas);
    var _sparkles = [], _sparkRAF = null, _sparkActive = false;
    function initSparkles() {
      var rect = saveBtn.getBoundingClientRect();
      sparkCanvas.width = Math.round(rect.width * 2);
      sparkCanvas.height = Math.round(rect.height * 2);
      sparkCanvas.style.width = '100%';
      sparkCanvas.style.height = '100%';
      _sparkles = [];
      for (var i = 0; i < 20; i++) {
        _sparkles.push({
          x: Math.random() * sparkCanvas.width,
          y: Math.random() * sparkCanvas.height,
          vx: (Math.random() - 0.5) * 0.15,
          vy: -0.06 - Math.random() * 0.15,
          r: 1 + Math.random() * 1.5,
          life: Math.random(),
          speed: 0.002 + Math.random() * 0.004,
          warm: Math.random() > 0.3
        });
      }
    }
    function animSparkles() {
      if (!_sparkActive) return;
      var sctx = sparkCanvas.getContext('2d');
      sctx.clearRect(0, 0, sparkCanvas.width, sparkCanvas.height);
      for (var i = 0; i < _sparkles.length; i++) {
        var p = _sparkles[i];
        p.life += p.speed;
        if (p.life > 1) p.life -= 1;
        p.x += p.vx;
        p.y += p.vy;
        // Wrap around
        if (p.y < -2) { p.y = sparkCanvas.height + 2; p.x = Math.random() * sparkCanvas.width; }
        if (p.x < -2) p.x = sparkCanvas.width + 2;
        if (p.x > sparkCanvas.width + 2) p.x = -2;
        // Pulse: fade in, bright, fade out
        var a = Math.sin(p.life * Math.PI);
        a = a * a; // sharper peak
        if (a < 0.05) continue;
        var col = p.warm ? '255,240,160' : '255,250,220';
        // Glow
        sctx.globalAlpha = a * 0.2;
        sctx.fillStyle = 'rgb(' + col + ')';
        sctx.beginPath();
        sctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2);
        sctx.fill();
        // Core
        sctx.globalAlpha = a * 0.9;
        sctx.beginPath();
        sctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        sctx.fill();
      }
      sctx.globalAlpha = 1;
      _sparkRAF = requestAnimationFrame(animSparkles);
    }
    saveBtn.addEventListener('mouseenter', function() {
      initSparkles();
      _sparkActive = true;
      animSparkles();
    });
    saveBtn.addEventListener('mouseleave', function() {
      _sparkActive = false;
      if (_sparkRAF) cancelAnimationFrame(_sparkRAF);
    });

    saveBtn.addEventListener('click', function() {
      var canvases = plate.querySelectorAll('canvas');
      var S = 3; // Resolution scale (3x retina)
      var W = 604*S, M = 8*S, PAD = 20*S, GAP = 8*S, INNER = 40*S;
      var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      var MONO = '"SF Mono", Monaco, Menlo, monospace';

      // Rarity theme
      var _pgDefs = {
        common:    {stops:[['#b8b8bc',0],['#a0a0a4',.3],['#909094',.7],['#808084',1]], border:'rgba(0,0,0,0.1)', text:'#1a1a22', dim:'#4a4a60', lbl:'#5a5a70', div:'rgba(0,0,0,0.06)'},
        uncommon:  {stops:[['#b8c0b6',0],['#98a892',.2],['#849880',.5],['#748872',1]], border:'rgba(74,158,74,0.25)', text:'#1a1a22', dim:'#3a5a3a', lbl:'#4a6a4a', div:'rgba(0,0,0,0.06)'},
        rare:      {stops:[['#b8bcc8',0],['#98a0b4',.2],['#838aa0',.5],['#707894',1]], border:'rgba(74,122,190,0.3)', text:'#1a1a22', dim:'#3a4a6a', lbl:'#4a5a7a', div:'rgba(0,0,0,0.06)'},
        veryrare:  {stops:[['#bcb8c6',0],['#a098b0',.2],['#8a80a0',.5],['#787094',1]], border:'rgba(138,74,190,0.3)', text:'#1a1a22', dim:'#4a3a5a', lbl:'#5a4a6a', div:'rgba(0,0,0,0.06)'},
        epic:      {stops:[['#c2bca8',0],['#a69c86',.2],['#908670',.5],['#807460',1]], border:'rgba(190,138,26,0.35)', text:'#1a1a22', dim:'#5a4a30', lbl:'#6a5a40', div:'rgba(0,0,0,0.06)'},
        legendary: {stops:[['#2a2228',0],['#1e181e',.3],['#181018',.7],['#120a12',1]], border:'rgba(190,42,42,0.4)', text:'#e8d8d8', dim:'#c0a0a0', lbl:'#b09090', div:'rgba(255,255,255,0.06)'}
      };
      var _t2 = getRarityTier(meta.rarity_score||0);
      var tK = _t2.name.toLowerCase().replace(' ','');
      var pg = _pgDefs[tK] || _pgDefs.common;

      // Draw on oversized canvas, trim later. Plate gradient painted first as background.
      var tmpC = document.createElement('canvas'); tmpC.width = W; tmpC.height = 6000;
      var c = tmpC.getContext('2d');
      c.fillStyle = '#0d0d14'; c.fillRect(0, 0, W, 6000);
      var preGr = c.createLinearGradient(0, M, 0, 5000);
      for (var si3 = 0; si3 < pg.stops.length; si3++) preGr.addColorStop(pg.stops[si3][1], pg.stops[si3][0]);
      c.fillStyle = preGr; c.beginPath(); c.roundRect(M, M, W-M*2, 5980, 10*S); c.fill();
      c.textAlign = 'center';
      var y = PAD + M;

      function _div2() { c.strokeStyle=pg.div; c.beginPath(); c.moveTo(INNER,y); c.lineTo(W-INNER,y); c.stroke(); y+=6*S; }
      // Etched text: dark inset shadow above + light highlight below (engraved plate look)
      var _etchHi = tK==='legendary' ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.5)';
      var _etchLo = tK==='legendary' ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.15)';
      function _etch(text, x, yPos, color) {
        c.fillStyle = _etchLo; c.fillText(text, x, yPos - S);  // dark shadow above (inset top)
        c.fillStyle = _etchHi; c.fillText(text, x, yPos + S);  // light highlight below (catch light)
        c.fillStyle = color; c.fillText(text, x, yPos);         // actual text
      }
      function _etchWrap(text, mw, lh, color) {
        var ws=text.split(' '),ln='';
        for(var i=0;i<ws.length;i++){var tt=ln+(ln?' ':'')+ws[i];if(c.measureText(tt).width>mw&&ln){_etch(ln,W/2,y,color);y+=lh;ln=ws[i];}else ln=tt;}
        if(ln){_etch(ln,W/2,y,color);y+=lh;}
      }
      function _lbl(t) { c.font='600 '+(7*S)+'px '+FONT; c.letterSpacing=(1*S)+'px'; c.textAlign='center'; _etch(t,W/2,y+9*S,pg.lbl); c.letterSpacing='0px'; y+=16*S; }
      function _wrap(t,mw,lh) { var ws=t.split(' '),ln=''; for(var i=0;i<ws.length;i++){var tt=ln+(ln?' ':'')+ws[i];if(c.measureText(tt).width>mw&&ln){c.fillText(ln,W/2,y);y+=lh;ln=ws[i];}else ln=tt;} if(ln){c.fillText(ln,W/2,y);y+=lh;} }

      // Portrait
      var _hp = meta.thumbnail && meta._verification && (meta._verification.status==='verified'||meta._verification.status==='bar_verified');
      if (_hp) { try { var _ti=new Image();_ti.src=meta.thumbnail;var cx=W/2,cy=y+32*S,r=30*S;c.save();c.beginPath();c.arc(cx,cy,r,0,Math.PI*2);c.clip();c.drawImage(_ti,cx-r,cy-r,r*2,r*2);c.restore();c.strokeStyle=pg.div;c.lineWidth=1.5*S;c.beginPath();c.arc(cx,cy,r,0,Math.PI*2);c.stroke();y+=70*S;} catch(e){} }

      // Constellation
      if (meta.constellation_name) { c.font='600 '+(9*S)+'px '+FONT; c.letterSpacing=(2*S)+'px'; c.textAlign='center'; _etch(meta.constellation_name.toUpperCase(),W/2,y+10*S,tK==='legendary'?'rgba(200,180,180,0.4)':'rgba(60,60,80,0.35)'); c.letterSpacing='0px'; y+=16*S; }

      // Identifier
      c.font='600 '+(13*S)+'px '+MONO; _etch(barId,W/2,y+13*S,pg.text); y+=22*S;

      // Badges
      var _vf=meta._verification;
      if(_vf){var _bs=[];if(_vf.status==='verified'||_vf.status==='bar_verified')_bs.push({t:'\u2713 WITNESSED',c:'#a0e8d4'});else if(_vf.status==='tampered')_bs.push({t:'\u2717 ALTERED',c:'#f06040'});if(_vf.signature===true)_bs.push({t:'\uD83D\uDD11 AUTHENTICATED',c:'#b8d4ff'});if(_vf.portrait&&_vf.portrait.match===true)_bs.push({t:'\u2B22 EMBODIED',c:'#dcc0f0'});if(_bs.length){var bw=116*S,bh=16*S,bg3=5*S,tbw2=_bs.length*bw+(_bs.length-1)*bg3,bx2=(W-tbw2)/2;for(var bi2=0;bi2<_bs.length;bi2++){c.globalAlpha=0.12;c.fillStyle=_bs[bi2].c;c.beginPath();c.roundRect(bx2,y,bw,bh,3*S);c.fill();c.globalAlpha=0.3;c.strokeStyle=_bs[bi2].c;c.lineWidth=S;c.stroke();c.globalAlpha=1;c.font='700 '+(7*S)+'px '+FONT;c.fillStyle=_bs[bi2].c;c.fillText(_bs[bi2].t,bx2+bw/2,y+11.5*S);bx2+=bw+bg3;}y+=bh+8*S;}}

      _div2();

      // Timestamp
      var _ts=meta.conceived||meta.timestamp||'';
      if(_ts){c.font='300 '+(10*S)+'px '+FONT;_etch(_ts,W/2,y+10*S,pg.dim);y+=16*S;}

      // Prompt
      var _pr=meta.prompt||'';
      if(_pr){_div2();c.font='italic 300 '+(10*S)+'px '+FONT;var _pCol=tK==='legendary'?'#d8c0c0':pg.text;y+=2*S;_etchWrap('\u201C'+_pr+'\u201D',W-INNER*2,14*S,_pCol);y+=2*S;_div2();}

      // Rarity
      if(meta.rarity_score!==undefined){c.font='600 '+(9*S)+'px '+FONT;_etch(_t2.name.toUpperCase()+' ('+meta.rarity_score+')',W/2,y+10*S,_t2.color);y+=18*S;}

      // Birth Temperament
      if(meta.birth_temperament){_lbl('BIRTH TEMPERAMENT');c.font='500 '+(10*S)+'px '+FONT;_etch(meta.birth_temperament,W/2,y+10*S,pg.text);y+=14*S;if(meta.birth_summary){c.font='italic 300 '+(9*S)+'px '+FONT;_etch(meta.birth_summary,W/2,y+10*S,pg.dim);y+=14*S;}if(meta.birth_traits&&meta.birth_traits.length){c.font='300 '+(8*S)+'px '+FONT;_etch(meta.birth_traits.join(' \u00b7 '),W/2,y+10*S,pg.dim);y+=14*S;}y+=6*S;}

      // Canvas bands — inset with rounded clip so plate gradient shows as margin
      var bandInset = 12*S;
      for(var ci2=0;ci2<canvases.length;ci2++){
        var src=canvases[ci2];
        var bx3=bandInset, bw2=W-bandInset*2;
        var scale=bw2/src.width, bh2=Math.round(src.height*scale);
        c.save();
        c.beginPath();c.roundRect(bx3,y,bw2,bh2,6*S);c.clip();
        c.drawImage(src,bx3,y,bw2,bh2);
        c.restore();
        y+=bh2+GAP;
      }

      // GPS
      var _gps='';if(born&&born.gps_locked)_gps=born.gps_locked.ct||born.gps_locked.ciphertext||'';
      if(_gps){_lbl('BIRTHPLACE \u2014 TIME-LOCKED');c.font='300 '+(6*S)+'px '+MONO;c.fillStyle=pg.dim;_wrap(_gps,W-INNER*2,9*S);y+=4*S;if(born.gps_locked.t){c.font='italic 300 '+(7*S)+'px '+FONT;c.fillStyle=pg.dim;var _te=typeof born.gps_locked.t.toExponential==='function'?born.gps_locked.t.toExponential(0):born.gps_locked.t;c.fillText('* '+_te+' sequential squarings to unlock',W/2,y+8*S);y+=14*S;}}

      // Footer
      y+=4*S;c.font='300 '+(8*S)+'px '+FONT;_etch('Celestial positions via Meeus algorithms (J2000.0)',W/2,y+9*S,pg.dim);y+=12*S;
      c.font='italic 300 '+(8*S)+'px '+FONT;_etch('The cosmos does not care, but it was watching.',W/2,y+9*S,pg.dim);y+=14*S;y+=M;

      // === Trim to final height + add border + bar ===
      var fH=y+2;var out=document.createElement('canvas');out.width=W;out.height=fH;
      var o=out.getContext('2d');
      o.fillStyle='#0d0d14';o.fillRect(0,0,W,fH);
      o.save();o.beginPath();o.roundRect(M,M,W-M*2,y-M*2,10*S);o.clip();
      o.drawImage(tmpC,0,0,W,fH,0,0,W,fH);
      o.restore();
      o.strokeStyle=pg.border;o.lineWidth=S;o.beginPath();o.roundRect(M,M,W-M*2,y-M*2,10*S);o.stroke();

      // Bar
      if(typeof encodeFrame==='function'&&typeof embedBits==='function'){var ps=barId+'\x00'+barHash;var pb=new TextEncoder().encode(ps);var fb=encodeFrame(pb);if(fb){var pp=out.width>=1024?3:2;var px=o.getImageData(0,0,out.width,out.height);embedBits(px.data,out.width,out.height,fb,pp);o.putImageData(px,0,0);}}

      out.toBlob(function(blob){var u=URL.createObjectURL(blob);var a=document.createElement('a');a.href=u;a.download=barId+'.certificate.png';document.body.appendChild(a);a.click();document.body.removeChild(a);setTimeout(function(){URL.revokeObjectURL(u);},1000);
      }, 'image/png');
    });
    plate.appendChild(saveBtn);
  }

  // Inject cosmic audio player as the plate's bottom edge. Skipped in
  // sample mode — the example cert is a truncated preview, the full song
  // belongs with the full cert.
  if (injectPlayer && !isSample && typeof CosmicPlayer !== 'undefined' && born && born.sun) {
    CosmicPlayer.inject(plate, meta);
  }

  certWrap.appendChild(plate);
  // Only add .visible on first reveal — re-adding it mid-swap re-triggers
  // panelFadeIn and double-fades with PanelSwap's intro animation.
  if (!wasVisible) {
    certWrap.classList.add('visible');
    if (window.innerWidth < 1200 && typeof scrollResultIntoView === 'function') {
      scrollResultIntoView(certWrap);
    }
  }
  // Drag-to-scroll on the plate (scrollable when player is injected).
  // Sample mode doesn't scroll, but the helper is idempotent and only
  // has visible effect when there's overflow — safe to attach always.
  if (typeof DragScroll !== 'undefined') DragScroll.attach(plate);
  // Activate side-by-side layout on desktop
  if (activateLayout) {
    var desktopMain = document.querySelector('.panel-layout');
    if (desktopMain) desktopMain.classList.add('layout-active');
  }

  // ===================================================================
  // Specular drift + shine effects
  // ===================================================================
  var shineConfigs = {
    'plate-rarity-uncommon': {
      grad: 'linear-gradient(105deg, transparent 43%, rgba(180,220,180,0.02) 47%, rgba(180,220,180,0.04) 50%, rgba(180,220,180,0.02) 53%, transparent 57%)',
      minDelay: 24, maxDelay: 45, dur: [5, 8], opa: [0.2, 0.4]
    },
    'plate-rarity-rare': {
      grad: 'linear-gradient(105deg, transparent 43%, rgba(140,170,220,0.02) 47%, rgba(140,170,220,0.05) 50%, rgba(140,170,220,0.02) 53%, transparent 57%)',
      minDelay: 20, maxDelay: 40, dur: [5, 7], opa: [0.2, 0.4]
    },
    'plate-rarity-veryrare': {
      grad: 'linear-gradient(105deg, transparent 43%, rgba(180,140,240,0.02) 47%, rgba(180,140,240,0.05) 50%, rgba(180,140,240,0.02) 53%, transparent 57%)',
      minDelay: 18, maxDelay: 36, dur: [4, 7], opa: [0.2, 0.4]
    },
    'plate-rarity-epic': {
      grad: 'linear-gradient(105deg, transparent 43%, rgba(240,200,100,0.02) 47%, rgba(255,220,120,0.06) 50%, rgba(240,200,100,0.02) 53%, transparent 57%)',
      minDelay: 16, maxDelay: 32, dur: [4, 7], opa: [0.2, 0.4]
    },
    'plate-rarity-legendary': {
      grad: 'linear-gradient(105deg, transparent 44%, rgba(255,140,120,0.01) 47%, rgba(255,170,150,0.025) 50%, rgba(255,140,120,0.01) 53%, transparent 56%)',
      minDelay: 25, maxDelay: 50, dur: [5, 9], opa: [0.15, 0.3]
    }
  };

  function _rand(a, b) { return a + Math.random() * (b - a); }

  var shineCfg = null;
  for (var sk in shineConfigs) { if (plate.classList.contains(sk)) { shineCfg = shineConfigs[sk]; break; } }
  if (shineCfg) {
    (function scheduleShine() {
      var delay = _rand(shineCfg.minDelay, shineCfg.maxDelay) * 1000;
      setTimeout(function() {
        var el = _div('shine');
        var dur = _rand(shineCfg.dur[0], shineCfg.dur[1]);
        var angle = 105 + (Math.random() - 0.5) * 30;
        el.style.background = shineCfg.grad.replace('105deg', angle + 'deg');
        el.style.opacity = _rand(shineCfg.opa[0], shineCfg.opa[1]);
        el.style.animation = 'sweep ' + dur + 's ease-in-out forwards';
        el.style.top = '0';
        el.style.height = plate.scrollHeight + 'px';
        plate.appendChild(el);
        setTimeout(function() { el.remove(); }, dur * 1000 + 100);
        scheduleShine();
      }, delay);
    })();
  }
}

// escapeHtml lives in portal.js (shared with validator); keeping the
// local definition out of here avoids the redeclaration if a future
// consumer also picks it up.
