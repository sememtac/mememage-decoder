// Starfield auto-initializes from js/starfield.js, reading data-theme
// off the #starfield canvas (yin = dark stars on light bg).

// === Constants ===
// SIG_ROWS, HEADER_BAND, etc. already defined by data.js

// === Reed-Solomon GF(2^8) — loaded from js/rs.js (gfMul, gfPow, rsDecode, ...) ===

// === Bar Codec === crc16, detectBar, extractBits, decodeFrame, decodePayload
// are loaded from js/codec.js. decodeFrame now always returns rsErrors and
// rsCapacity for forensic display. decodePayload returns {identifier,
// archive_id, content_hash} — the validator reads identifier and content_hash.

// === Tab switching ===
// showTab: programmatic entry used by link delegation, portal.init,
// and attack-lab toggles. Click-wiring for the three visible tabs
// goes through TabBar.wire() below; both paths converge on
// TabBar.activateById for the class toggling. Accepts short names
// ('img', 'cert', 'meta', 'attack') for backward compat.
function showTab(name){
  TabBar.activateById('tab-' + name);
  syncResultsVisibility(name);
}
TabBar.wire(function(panelId) {
  syncResultsVisibility(panelId.replace(/^tab-/, ''));
});

// Drag-to-scroll on the results sidebar — one mount covers Audit cert,
// Observatory record list, and any attack-lab cert that renders in the
// same container. See portal.js DragScroll for the gesture rules.
DragScroll.attach(document.getElementById('resultsWrap'));

// === Results sidebar management ===
function showResultsSidebar() {
  var rw = document.getElementById('resultsWrap');
  if (!rw) return;
  rw.classList.remove('dismissing');
  rw.classList.add('visible');
  var dm = document.querySelector('.panel-layout');
  if (dm) dm.classList.add('layout-active');
  if (window.innerWidth < 1200) scrollResultIntoView(rw);
}

function hideResultsSidebar(animate) {
  var rw = document.getElementById('resultsWrap');
  var dm = document.querySelector('.panel-layout');
  if (!rw || !rw.classList.contains('visible')) return;
  if (animate) {
    rw.classList.add('dismissing');
    rw.addEventListener('animationend', function() {
      rw.classList.remove('visible', 'dismissing');
      if (dm) dm.classList.remove('layout-active');
    }, { once: true });
  } else {
    rw.classList.remove('visible', 'dismissing');
    if (dm) dm.classList.remove('layout-active');
  }
}

// Clear every tab's results + left-panel input state except the one
// about to be populated. Called at the start of each tab's new query so
// stale state from one tab never sits next to fresh output from another.
function clearOtherResults(keep) {
  var divs = { img: 'imgResults', cert: 'certResults', meta: 'metaSidebarResults' };
  Object.keys(divs).forEach(function(k) {
    if (k === keep) return;
    var el = document.getElementById(divs[k]);
    if (el) { el.innerHTML = ''; el.style.display = ''; }
  });
  // Image tab — compact console (thumbnail + id + hash + status).
  if (keep !== 'img') {
    var con = document.getElementById('imgConsole');
    if (con) {
      con.classList.remove('visible', 'error-only');
      var t = document.getElementById('imgConsoleThumb'); if (t) t.src = '';
      var id = document.getElementById('imgConsoleId'); if (id) id.innerHTML = '';
      var h = document.getElementById('imgConsoleHash'); if (h) h.textContent = '';
      var s = document.getElementById('imgConsoleStatus');
      if (s) { s.textContent = ''; s.className = 'img-console-status'; }
    }
  }
  // Audit tab — identifier input + error slots + .how restored to default.
  if (keep !== 'cert') {
    var ai = document.getElementById('auditInput');
    if (ai) ai.value = '';
    if (typeof setAuditError === 'function') setAuditError('', '');
    if (typeof setHow === 'function' && _auditHowDefault !== null) setHow('default');
  }
  // Observatory tab — inline tab-error.
  if (keep !== 'meta') {
    var me = document.getElementById('metaError');
    if (me) { me.textContent = ''; me.style.color = ''; }
  }
}

function syncResultsVisibility(tabName) {
  var rw = document.getElementById('resultsWrap');
  if (!rw) return;
  var imgR = document.getElementById('imgResults');
  var certR = document.getElementById('certResults');
  var metaR = document.getElementById('metaSidebarResults');
  var hasImg = imgR && imgR.innerHTML.trim();
  var hasCert = certR && certR.innerHTML.trim();
  var hasMeta = metaR && metaR.innerHTML.trim();

  // Show the result div matching the active tab context, hide others.
  // Results persist until replaced by new query in their own tab.
  if (imgR) imgR.style.display = (tabName === 'meta') ? 'none' : '';
  if (certR) certR.style.display = (tabName === 'meta') ? 'none' : '';
  if (metaR) metaR.style.display = (tabName === 'meta' || (!hasImg && !hasCert)) ? '' : 'none';

  // Keep sidebar visible if any results exist (including Observatory)
  var hasAny = hasImg || hasCert || hasMeta;
  if (hasAny && tabName !== 'attack') {
    showResultsSidebar();
  }
}

// === Image UI ===
var dz=document.getElementById('dropZone'),imgResults=document.getElementById('imgResults');
DropZone.attach({
  zone: dz,
  accept: function(f) { return f.type.startsWith('image/'); },
  fileAccept: 'image/*',
  onFiles: analyze
});

// Raw bit brightness for forensic strip
function extractBitBrightness(px,w,h,ppb){ppb=ppb||PIXELS_PER_BIT;var v=[],dpr=w-HEADER_PIXELS-FOOTER_PIXELS,bpr=Math.floor(dpr/ppb);for(var row=0;row<SIG_ROWS;row++){var y=h-1-row;for(var b=0;b<bpr;b++){var cx=HEADER_PIXELS+b*ppb+Math.floor(ppb/2);var i=(y*w+cx)*4;v.push((px[i]+px[i+1]+px[i+2])/3);}}return v;}

function analyze(file){
  if (typeof _uploadDbgBanner === 'function') {
    var d = _uploadDbgBanner();
    d.log('validator analyze entry, file=' + (file ? file.name : 'null'));
    d.log('viewport=' + window.innerWidth + 'x' + window.innerHeight);
    window._validatorDbg = d;
  }
  clearOtherResults('img');
  imgResults.innerHTML='';
  // Shared decode pipeline — js/image-decode.js. Returns the canvas +
  // raw pixel buffer so the forensic bits below (bar-region crop,
  // color-band measurement, brightness strip) can still read from
  // the same source data without re-decoding.
  decodeImageBar(file).then(function(res) {
    var w = res.width, h = res.height;
    var px = res.pixels;
    var detected = res.detected;
    var decoded = res.decoded;
    var barFrame = res.frame;
    var barPpb = res.ppb || 3;
    var barBright = detected ? extractBitBrightness(px, w, h, barPpb) : null;

    // Bar region crop (bottom 16px, 4x zoom) — redraw from the canvas
    // already built by decodeImageBar so we don't hold onto a second
    // Image element.
    var barH=Math.min(16,h);
    var bc=document.createElement('canvas');bc.width=w;bc.height=barH*4;
    var bctx=bc.getContext('2d');bctx.imageSmoothingEnabled=false;
    bctx.drawImage(res.canvas,0,h-barH,w,barH,0,0,w,barH*4);
    var barUri=bc.toDataURL('image/png');

    // Color band measurement + purity
    var bands={},bandRaw={};
    var idealBands={M:[255,0,255],Y:[255,255,0],C:[0,255,255]};
    if(h>=2&&w>=50){var y=h-1,mid=Math.floor(HEADER_BAND/2);
      for(var bi=0;bi<3;bi++){var bpos=bi*HEADER_BAND+mid;var idx=(y*w+bpos)*4;var lbl=['M','Y','C'][bi];
        bands[lbl]='rgb('+px[idx]+','+px[idx+1]+','+px[idx+2]+')';bandRaw[lbl]=[px[idx],px[idx+1],px[idx+2]];}}

      // Error rule: when the image has no Mememage bar at all, mirror
      // decoder's error flow — inline status, no compact, no right-side
      // forensic panel. Anything forensic-worthy (bands present but
      // unreadable, etc.) still runs through the full report below.
      if(!detected){
        var imgConE = document.getElementById('imgConsole');
        imgConE.classList.remove('visible');
        imgConE.classList.add('error-only');
        var stE = document.getElementById('imgConsoleStatus');
        stE.className = 'img-console-status fail';
        stE.textContent = 'No Mememage bar in this image.';
        imgResults.innerHTML = '';
        var rwE = document.getElementById('resultsWrap');
        if (rwE && rwE.classList.contains('visible')) hideResultsSidebar(true);
        return;
      }

      // Thumbnail
      var tw=Math.min(w,360),th=Math.round(h*tw/w);
      var tc=document.createElement('canvas');tc.width=tw;tc.height=th;
      tc.getContext('2d').drawImage(res.canvas,0,0,tw,th);
      var thumbUri=tc.toDataURL('image/jpeg',0.7);

      var barOk=!!decoded;
      var cls=barOk?'both':'lost';
      var label=barOk?'Bar Survived':'Bar Lost';

      var o='<div class="ev">';
      o+='<div class="ev-h '+cls+'"><span class="ev-t">'+file.name+'</span><span class="ev-b '+cls+'">'+label+'</span></div>';
      o+='<div class="ev-body">';

      // Bar region
      o+='<div class="ev-sec">Bar Region (bottom '+barH+'px, 4x zoom)</div>';
      o+='<img src="'+barUri+'" class="bar-img" alt="Bar region"/>';

      // Bar results
      o+='<div class="ev-sec">Bar</div><div class="ev-g">';
      if(decoded){
        o+='<div class="ev-m"><div class="ev-ml">Status</div><div class="ev-mv pass">SURVIVED</div></div>';
        o+='<div class="ev-m"><div class="ev-ml">Content Hash</div><div class="ev-mv pass">'+decoded.content_hash+'</div></div>';
        o+='<div class="ev-m"><div class="ev-ml">Identifier</div><div class="ev-mv">'+(decoded.identifier?'<a href="#" class="audit-link" data-id="'+decoded.identifier+'" style="color:inherit;text-decoration:underline;text-decoration-color:rgba(255,255,255,0.2);cursor:pointer;">'+decoded.identifier+'</a>':'\u2014')+'</div></div>';
        o+='<div class="ev-m"><div class="ev-ml">Soul</div><div class="ev-mv" style="font-size:0.68rem;">'+(decoded.identifier||'')+'.'+decoded.content_hash+'.soul</div></div>';
      }else{
        o+='<div class="ev-m"><div class="ev-ml">Status</div><div class="ev-mv fail">LOST</div></div>';
        o+='<div class="ev-m w"><div class="ev-ml">Diagnosis</div><div class="ev-mv fail">'+(detected?'M/Y/C bands detected but data unreadable \u2014 compression destroyed brightness encoding':'No M/Y/C bands found \u2014 image cropped, resized, or not a Mememage image')+'</div></div>';
      }
      // File info
      o+='<div class="ev-m"><div class="ev-ml">Size</div><div class="ev-mv">'+(file.size/1024).toFixed(0)+' KB</div></div>';
      o+='<div class="ev-m"><div class="ev-ml">Dimensions</div><div class="ev-mv">'+w+' \u00d7 '+h+'</div></div>';
      o+='<div class="ev-m"><div class="ev-ml">Format</div><div class="ev-mv">'+(file.type||file.name.split('.').pop())+'</div></div>';
      if(bands.M)o+='<div class="ev-m"><div class="ev-ml">M / Y / C</div><div class="ev-mv" style="font-size:0.68rem;">'+bands.M+' '+bands.Y+' '+bands.C+'</div></div>';
      o+='</div>';

      // Bar Bit Confidence
      if(barBright&&barBright.length>0){
        o+='<div class="ev-sec">Bar Bit Confidence</div>';
        o+='<div style="font-size:0.65rem;color:#8a8a9a;margin-bottom:0.3rem;">Green=clear 1, red=clear 0, yellow=fragile (near threshold 128)</div>';
        var bbl=Math.min(barBright.length,600);
        var bbc=document.createElement('canvas');bbc.width=bbl;bbc.height=1;var bbx=bbc.getContext('2d');var bbd=bbx.createImageData(bbl,1);
        for(var bi2=0;bi2<bbl;bi2++){var bv=barBright[bi2];var dist=Math.abs(bv-128)/128;var p=bi2*4;
          if(bv>=128){bbd.data[p]=Math.round(255*(1-dist));bbd.data[p+1]=Math.round(120+135*dist);bbd.data[p+2]=Math.round(60*(1-dist));}
          else{bbd.data[p]=Math.round(120+135*dist);bbd.data[p+1]=Math.round(255*(1-dist));bbd.data[p+2]=Math.round(60*(1-dist));}
          bbd.data[p+3]=255;}
        bbx.putImageData(bbd,0,0);
        var bbu=document.createElement('canvas');bbu.width=bbl*2;bbu.height=16;var bbux=bbu.getContext('2d');bbux.imageSmoothingEnabled=false;bbux.drawImage(bbc,0,0,bbl*2,16);
        o+='<img src="'+bbu.toDataURL('image/png')+'" style="width:100%;image-rendering:pixelated;height:16px;border-radius:3px;"/>';
        var fragile=0;for(var bi3=0;bi3<barBright.length;bi3++)if(Math.abs(barBright[bi3]-128)<30)fragile++;
        o+='<div style="font-size:0.6rem;color:#8a8a9a;margin-top:0.2rem;">'+barBright.length+' bits at '+barPpb+'px/bit \u2014 <span style="color:'+(fragile>barBright.length*0.3?'#f87171':'#4ade80')+';">'+fragile+' fragile</span></div>';
      }

      // Reed-Solomon Error Correction
      if(barFrame){
        o+='<div class="ev-sec">Reed-Solomon Error Correction</div><div class="ev-g">';
        var rsE=barFrame.rsErrors>=0?barFrame.rsErrors:'?',rsC=barFrame.rsCapacity;
        var rsCol=barFrame.rsErrors===0?'#4ade80':barFrame.rsErrors>0&&barFrame.rsErrors<rsC?'#facc15':'#f87171';
        o+='<div class="ev-m"><div class="ev-ml">Errors Corrected</div><div class="ev-mv" style="color:'+rsCol+';">'+rsE+' / '+rsC+' max</div></div>';
        o+='<div class="ev-m"><div class="ev-ml">Parity Bytes</div><div class="ev-mv">6 (GF(2\u2078))</div></div>';
        o+='<div class="ev-m w"><div class="ev-ml">Error Budget</div><div style="height:12px;background:rgba(40,40,50,0.5);border-radius:6px;margin-top:0.2rem;overflow:hidden;display:flex;">';
        if(barFrame.rsErrors>=0)for(var ri=0;ri<rsC;ri++)o+='<div style="flex:1;background:'+(ri<barFrame.rsErrors?rsCol:'rgba(60,60,70,0.4)')+';margin-right:1px;"></div>';
        o+='</div><div style="font-size:0.58rem;color:#8a8a9a;margin-top:0.15rem;">'+(barFrame.rsErrors===0?'Pristine':barFrame.rsErrors>0?rsE+' corrected, '+(rsC-barFrame.rsErrors)+' remaining':'CRC fallback')+'</div></div>';
        o+='</div>';
      }

      // Color Band Purity
      if(bandRaw.M){
        o+='<div class="ev-sec">Color Band Purity</div><div class="ev-g">';
        var bLabels={M:'Magenta',Y:'Yellow',C:'Cyan'};
        for(var bl of['M','Y','C']){var act=bandRaw[bl],ide=idealBands[bl];
          var dist2=Math.sqrt(Math.pow(act[0]-ide[0],2)+Math.pow(act[1]-ide[1],2)+Math.pow(act[2]-ide[2],2));
          var pur=Math.max(0,1-dist2/441.7),pPct=Math.round(pur*100);
          var pCol=pur>0.8?'#4ade80':pur>0.5?'#facc15':'#f87171';
          o+='<div class="ev-m"><div class="ev-ml">'+bLabels[bl]+'</div><div style="display:flex;align-items:center;gap:0.4rem;">';
          o+='<div style="width:10px;height:10px;border-radius:2px;background:rgb('+act[0]+','+act[1]+','+act[2]+');border:1px solid rgba(255,255,255,0.15);"></div>';
          o+='<div style="flex:1;height:6px;background:rgba(40,40,50,0.5);border-radius:3px;overflow:hidden;"><div style="width:'+pPct+'%;height:100%;background:'+pCol+';"></div></div>';
          o+='<span style="font-size:0.7rem;color:'+pCol+';">'+pPct+'%</span></div></div>';}
        o+='</div>';
      }

      // Scale Survival
      o+='<div class="ev-sec">Scale Survival</div>';
      o+='<div style="font-size:0.62rem;color:#8a8a9a;margin-bottom:0.3rem;">Simulates platform resizing. Solid=survived, dashed=lost.</div>';
      for(var sf of[0.90,0.75,0.50,0.25]){
        var sw=Math.round(w*sf),sh=Math.round(h*sf);if(sw<16||sh<16)continue;
        var sc=document.createElement('canvas');sc.width=sw;sc.height=sh;sc.getContext('2d').drawImage(res.canvas,0,0,sw,sh);
        var spx=sc.getContext('2d').getImageData(0,0,sw,sh).data;
        var sBarOk=false;if(detectBar(spx,sw,sh)){for(var sppb of[3,2]){var sb=extractBits(spx,sw,sh,sppb);var sf2=decodeFrame(sb);if(sf2&&decodePayload(sf2.payload)){sBarOk=true;break;}}}
        // Bar region at scale
        var sBarH=Math.min(4,sh);var sbc=document.createElement('canvas');sbc.width=sw;sbc.height=sBarH*4;var sbx=sbc.getContext('2d');sbx.imageSmoothingEnabled=false;sbx.drawImage(sc,0,sh-sBarH,sw,sBarH,0,0,sw,sBarH*4);
        var sPct=Math.round(sf*100)+'%';
        var sRowBg=sBarOk?'rgba(74,158,74,0.08)':'rgba(180,60,60,0.06)';
        var sRowBdr=sBarOk?'rgba(74,158,74,0.5)':'rgba(180,60,60,0.4)';
        o+='<div style="padding:0.4rem 0.5rem;background:'+sRowBg+';border-left:3px solid '+sRowBdr+';border-radius:4px;margin-bottom:0.3rem;">';
        o+='<div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.3rem;">';
        o+='<span style="font-size:0.85rem;color:#c0c0d0;font-weight:700;">'+sPct+'</span>';
        o+='<span style="font-size:0.65rem;color:#8a8a9a;">'+sw+'\u00d7'+sh+'</span>';
        o+='<span style="font-size:0.65rem;padding:0.1rem 0.4rem;border-radius:3px;background:'+(sBarOk?'rgba(74,158,74,0.15)':'rgba(180,60,60,0.15)')+';color:'+(sBarOk?'#4ade80':'#f87171')+';font-weight:600;">Bar '+(sBarOk?'SURVIVED':'LOST')+'</span>';
        o+='</div>';
        o+='<div style="font-size:0.55rem;color:#8a8a9a;margin-bottom:2px;">Bar region</div>';
        o+='<img src="'+sbc.toDataURL('image/png')+'" style="width:100%;image-rendering:pixelated;border-radius:3px;opacity:0.85;"/>';
        o+='</div>';
      }

      // Image thumbnail
      o+='<div class="ev-sec">Image</div>';
      o+='<img src="'+thumbUri+'" style="width:100%;border-radius:6px;margin:0.3rem 0;"/>';

      // External source link intentionally omitted — the audit-link on
      // the identifier above handles "drill into this record" without
      // tying the UI to any specific platform. The Source row in the
      // Audit report shows where the record actually lives.

      o+='</div></div>';
      // Cross-fade if the panel is already showing another tab's result.
      PanelSwap(document.getElementById('resultsWrap'), function() {
        imgResults.insertAdjacentHTML('afterbegin', o);
        document.getElementById('certResults').style.display = 'none';
        imgResults.style.display = '';
        showResultsSidebar();
      });

      // Compact console in the left panel — thumbnail + clickable id + status.
      var imgCon = document.getElementById('imgConsole');
      imgCon.classList.remove('error-only');
      document.getElementById('imgConsoleThumb').src = thumbUri;
      if (decoded) {
        document.getElementById('imgConsoleId').innerHTML = '<a href="#" class="audit-link" data-id="' + decoded.identifier + '">' + decoded.identifier + '</a>';
        document.getElementById('imgConsoleHash').textContent = decoded.content_hash;
        var st = document.getElementById('imgConsoleStatus');
        st.className = 'img-console-status ok';
        st.textContent = 'Bar survived. Body and soul readable.';
      } else {
        document.getElementById('imgConsoleId').textContent = '—';
        document.getElementById('imgConsoleHash').textContent = '';
        var st2 = document.getElementById('imgConsoleStatus');
        st2.className = 'img-console-status fail';
        st2.textContent = 'Bands present but data unreadable.';
      }
      imgCon.classList.add('visible');
  }).catch(function(err) {
    // Surface any throw inside the .then body instead of swallowing
    // silently — that's what made drag-drop look "dead" when the
    // forensic code had a bug downstream.
    console.error('[analyze] failed:', err);
  });
}
// === Metadata UI ===
var jdz=document.getElementById('jsonDrop'),jInp=document.getElementById('jsonInput'),metaResults=document.getElementById('metaResults');
DropZone.attach({
  zone: jdz, input: jInp, multiple: true,
  onFiles: analyzeMeta
});
var folderBtn=document.getElementById('folderBtn'),folderInp=document.getElementById('folderInput');
folderBtn.addEventListener('click',function(){folderInp.click();});
folderInp.addEventListener('change',function(){
  var souls=Array.from(folderInp.files).filter(function(f){return f.name.endsWith('.soul')||f.name.endsWith('.json');});
  if(souls.length)analyzeMeta(souls);
  folderInp.value='';
});

// Persistent chunk collection (survives across multiple drops)
var collected={decoder:{},proof:{},truth:{},schematic:{},claim:null,egg:null};

async function verifyChunkHash(data,expectedHash){
  if(!expectedHash||!data)return null;
  try{var buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data));
    var hex=Array.from(new Uint8Array(buf)).map(function(b){return b.toString(16).padStart(2,'0');}).join('').slice(0,12);
    return hex===expectedHash;}catch(e){return null;}
}

async function gunzip(base64){
  var bytes=Uint8Array.from(atob(base64),function(c){return c.charCodeAt(0);});
  var ds=new DecompressionStream('gzip');
  var writer=ds.writable.getWriter();writer.write(bytes);writer.close();
  var reader=ds.readable.getReader();var chunks=[];
  while(true){var r=await reader.read();if(r.done)break;chunks.push(r.value);}
  var total=chunks.reduce(function(a,c){return a+c.length;},0);
  var out=new Uint8Array(total);var off=0;
  for(var i=0;i<chunks.length;i++){out.set(chunks[i],off);off+=chunks[i].length;}
  return new TextDecoder().decode(out);
}

async function assembleChunks(store,count){
  var parts=[];for(var i=0;i<count;i++){if(!store[i])return null;parts.push(store[i].data);}
  var joined=parts.join('');
  try{return await gunzip(joined);}catch(e){return joined;} // fallback: raw join if not gzipped
}

// HASH_INCLUDED, sortKeysDeep, sha256_16 — loaded from js/verify.js

async function analyzeMeta(files){
  // Render Observatory results in the sidebar, not inline
  clearOtherResults('meta');
  var metaSidebar = document.getElementById('metaSidebarResults');
  var metaErr = document.getElementById('metaError');
  if (metaErr) metaErr.textContent = '';
  metaResults.innerHTML='';
  // Defer opening the sidebar. Parsing the files might turn up zero
  // valid souls, in which case we show an inline error in the tab and
  // the sidebar should stay closed. Show a transient "Analyzing..."
  // note inside the tab's error slot — it flips to the error text or
  // is cleared when valid records render.
  if (metaErr) { metaErr.textContent = 'Analyzing ' + files.length + ' file(s)\u2026'; metaErr.style.color = '#8a8a94'; }
  if (metaSidebar) metaSidebar.innerHTML = '';
  var recs=[];
  // Normalize display filename: strip trailing .json → .soul. IA mirrors
  // store records as .json for CORS; from the user's perspective the
  // file *is* a .soul, so the record list should say so.
  function toSoulName(name){ return name.replace(/\.json$/, '.soul'); }
  for(var i=0;i<files.length;i++){try{var t=await files[i].text();var m=JSON.parse(t);m._fn=toSoulName(files[i].name);recs.push(m);
    // Also stash in the offline cache so Audit can resolve the
    // identifier locally without a network trip.
    if (m && m.identifier) OfflineRecords.add(m, m._fn);
  }catch(e){recs.push({_fn:toSoulName(files[i].name),_err:e.message});}}

  var valid=recs.filter(function(r){return !r._err;});
  // Error rule: if nothing parsed, show the failure inline and leave
  // the sidebar closed (we never opened it — deferred until valid).
  if (valid.length === 0) {
    if (metaSidebar) metaSidebar.innerHTML = '';
    if (metaErr) {
      var firstErr = recs.length ? recs[0]._err : 'unknown';
      metaErr.textContent = recs.length > 1
        ? 'No valid soul files. ' + recs.length + ' files failed to parse.'
        : 'Not a valid soul file: ' + firstErr;
      metaErr.style.color = '';  // revert to .tab-error's red
    }
    return;
  }
  // At least one valid parse — now we can open the sidebar and clear
  // the transient "Analyzing..." note from the error slot.
  if (metaErr) { metaErr.textContent = ''; metaErr.style.color = ''; }
  showResultsSidebar();
  valid.sort(function(a,b){var aa=a.decoder_age||a.decoder_age_name||'';var ba=b.decoder_age||b.decoder_age_name||'';if(aa!==ba)return aa<ba?-1:1;var ai=a.truth_chunk_index!=null?a.truth_chunk_index:0;var bi=b.truth_chunk_index!=null?b.truth_chunk_index:0;return ai-bi;});

  // Compute hashes for all valid records
  for(var vi=0;vi<valid.length;vi++){
    var r=valid[vi];var stored=r.content_hash||null;
    var hashable={};Object.keys(r).filter(function(k){return HASH_INCLUDED.has(k);}).sort().forEach(function(k){hashable[k]=r[k];});
    try{r._computed=await sha256_16(hashable);}catch(e){r._computed=null;}
    r._match=stored&&r._computed&&stored===r._computed;
  }

  // Accumulate chunks from these records
  for(var ci=0;ci<valid.length;ci++){
    var cr=valid[ci];
    if(cr.decoder_chunk_index!==undefined&&cr.decoder_chunk){
      var di=cr.decoder_chunk_index;
      collected.decoder[di]={data:cr.decoder_chunk,hash:cr.decoder_chunk_hash||null,verified:null};
    }
    if(cr.proof_chunk_index!==undefined&&cr.proof_chunk){
      var pi2=cr.proof_chunk_index;
      collected.proof[pi2]={data:cr.proof_chunk,hash:cr.proof_chunk_hash||null,verified:null};
    }
    if(cr.truth_chunk_index!==undefined&&cr.truth_chunk){
      collected.truth[cr.truth_chunk_index]={data:cr.truth_chunk,hash:cr.truth_chunk_hash||null,verified:null};
    }
    if(cr.schematic_chunk_index!==undefined&&cr.schematic_chunk){
      collected.schematic[cr.schematic_chunk_index]={data:cr.schematic_chunk,hash:cr.schematic_chunk_hash||null,verified:null};
    }
    if(cr.claim_chunk){
      collected.claim={data:cr.claim_chunk,hash:cr.claim_chunk_hash||null,verified:null};
    }
    if(cr.easter_egg){
      collected.egg={
        text:cr.easter_egg_text||cr.easter_egg_chunk||'',
        image:cr.easter_egg_image||null,
        data:cr.easter_egg_chunk||cr.easter_egg_text||'',
        hash:cr.easter_egg_hash||null,verified:null
      };
    }
  }
  // Verify chunk hashes asynchronously
  for(var dk in collected.decoder){var d=collected.decoder[dk];if(d.hash&&d.verified===null)d.verified=await verifyChunkHash(d.data,d.hash);}
  for(var pk in collected.proof){var p=collected.proof[pk];if(p.hash&&p.verified===null)p.verified=await verifyChunkHash(p.data,p.hash);}
  for(var tk in collected.truth){var tt=collected.truth[tk];if(tt.hash&&tt.verified===null)tt.verified=await verifyChunkHash(tt.data,tt.hash);}
  for(var sk in collected.schematic){var ss=collected.schematic[sk];if(ss.hash&&ss.verified===null)ss.verified=await verifyChunkHash(ss.data,ss.hash);}
  if(collected.claim&&collected.claim.hash&&collected.claim.verified===null)collected.claim.verified=await verifyChunkHash(collected.claim.data,collected.claim.hash);
  if(collected.egg&&collected.egg.hash&&collected.egg.verified===null)collected.egg.verified=await verifyChunkHash(collected.egg.data,collected.egg.hash);

  var html='';

  _gpsRecords=valid;

  // === Orbit Inspector placeholder (built after innerHTML set) ===
  html+='<div id="orbitInspector"></div>';

  // === Compact record table — one row per record, click to expand ===
  html+='<div class="ev"><div class="ev-h" style="background:rgba(80,80,100,0.08);border-left:3px solid rgba(80,80,100,0.3);"><span class="ev-t">Records ('+recs.length+')</span><span style="font-size:0.6rem;color:#8a8a9a;">click row to expand</span></div><div class="ev-body" style="padding:0;">';

  // Error rows first
  for(var ei=0;ei<recs.length;ei++){var er=recs[ei];if(!er._err)continue;
    html+='<div style="padding:0.4rem 0.8rem;border-bottom:1px solid #1a1a2a;"><span style="color:#f87171;font-size:0.75rem;">'+er._fn+' \u2014 '+er._err+'</span></div>';}

  // Valid record rows
  for(var ri=0;ri<valid.length;ri++){
    var r=valid[ri];
    var rBadgeCol=r._match?'#4ade80':r.content_hash?'#f87171':'#4a4a60';
    var rBadge=r._match?'\u2713':r.content_hash?'\u2717':'\u2014';
    var ti=r.truth_chunk_index;
    var isDk2=ti!=null&&ti>=360&&ti<=363,isEp2=ti===364;

    // Compact row — white labels, green only for verified badge
    html+='<div id="rec-'+(ti!=null?ti:ri)+'" data-identifier="'+(r.identifier||'')+'" data-age="'+(r.decoder_age_name||'')+'" data-con="'+(r.constellation_name||'')+'" data-chunk="'+(r.decoder_chunk_index!=null?r.decoder_chunk_index:'')+'" style="border-bottom:1px solid #1a1a2a;">';
    html+='<div class="meta-row" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display===\'none\'?\'block\':\'none\';" style="padding:0.35rem 0.8rem;cursor:pointer;display:flex;align-items:center;gap:0.5rem;transition:background 0.1s;" onmouseover="this.style.background=\'rgba(255,255,255,0.03)\'" onmouseout="this.style.background=\'none\'">';
    html+='<span style="font-size:0.72rem;color:'+rBadgeCol+';min-width:1rem;">'+rBadge+'</span>';
    html+='<span style="font-size:0.7rem;font-family:monospace;min-width:10rem;color:#d0d0d8;">'+(r.identifier?r.identifier.slice(-16):(r._fn||'').slice(-16))+'</span>';
    if(ti!=null)html+='<span style="font-size:0.6rem;color:'+(isEp2?'#d4b87b':isDk2?'#8a7050':'#6a6a80')+';">T'+ti+(r.decoder_chunk_index!=null?' D'+r.decoder_chunk_index:'')+'</span>';
    if(r.constellation_name)html+='<span style="font-size:0.58rem;color:#8a8a9a;margin-left:auto;">'+r.constellation_name+'</span>';
    html+='</div>';

    // Expandable detail (hidden by default)
    html+='<div class="meta-detail" style="display:none;padding:0.5rem 0.8rem;background:rgba(24,24,28,0.6);">';

    var stored=r.content_hash||null;
    var hashable={};Object.keys(r).filter(function(k){return HASH_INCLUDED.has(k);}).sort().forEach(function(k){hashable[k]=r[k];});
    var computed=null;try{computed=await sha256_16(hashable);}catch(e){}
    var match=stored&&computed&&stored===computed;
    var cls=match?'both':stored?'lost':'bar-only';
    var badge=match?'Verified':stored?'Hash Mismatch':'No Hash';

    html+='<div class="ev"><div class="ev-h '+cls+'"><span class="ev-t">'+r._fn+'</span><span class="ev-b '+cls+'">'+badge+'</span></div><div class="ev-body">';

    // Identity
    html+='<div class="ev-sec">Identity</div><div class="ev-g">';
    html+='<div class="ev-m"><div class="ev-ml">Identifier</div><div class="ev-mv">'+(r.identifier?'<a href="#" class="audit-link" data-id="'+r.identifier+'" style="color:inherit;text-decoration:underline;text-decoration-color:rgba(255,255,255,0.2);cursor:pointer;">'+r.identifier+'</a>':'\u2014')+'</div></div>';
    html+='<div class="ev-m"><div class="ev-ml">Conceived</div><div class="ev-mv">'+(r.conceived||r.timestamp||'\u2014')+'</div></div>';
    html+='<div class="ev-m"><div class="ev-ml">Parent</div><div class="ev-mv">'+(r.parent_id||'none (genesis)')+'</div></div>';
    if(r.chain_visibility)html+='<div class="ev-m"><div class="ev-ml">Chain</div><div class="ev-mv" style="color:'+(r.chain_visibility==='dark_matter'?'#8080a0':'#d4b87b')+';">'+(r.chain_visibility==='dark_matter'?'Dark Matter (private)':'Light Energy (public)')+'</div></div>';
    if(r.prompt)html+='<div class="ev-m w"><div class="ev-ml">Prompt</div><div class="ev-mv" style="font-style:italic;font-size:0.72rem;word-break:break-word;">'+r.prompt+'</div></div>';
    html+='</div>';

    // Hash verification
    html+='<div class="ev-sec">Content Hash</div><div class="ev-g">';
    html+='<div class="ev-m"><div class="ev-ml">Stored</div><div class="ev-mv '+(match?'pass':stored?'fail':'')+'">'+(stored||'none')+'</div></div>';
    html+='<div class="ev-m"><div class="ev-ml">Computed</div><div class="ev-mv '+(match?'pass':computed?'fail':'')+'">'+(computed||'unavailable')+'</div></div>';
    html+='<div class="ev-m w"><div class="ev-ml">Verdict</div><div class="ev-mv '+(match?'pass':'fail')+'">'+(match?'Untampered \u2014 hashes match':stored&&computed?'MISMATCH \u2014 record may be modified':'Cannot verify')+'</div></div>';
    html+='</div>';

    // Field audit
    html+='<div class="ev-sec">Field Audit</div>';
    html+='<div style="display:flex;flex-wrap:wrap;gap:3px;margin:0.3rem 0;">';
    var allK=Object.keys(r).filter(function(k){return k[0]!=='_';}).sort();
    for(var ki=0;ki<allK.length;ki++){var k=allK[ki];var inH=HASH_INCLUDED.has(k);html+='<span style="font-size:0.58rem;padding:0.1rem 0.3rem;border-radius:3px;background:'+(inH?'rgba(255,255,255,0.06)':'rgba(255,255,255,0.02)')+';color:'+(inH?'#a0a0a8':'#505058')+';font-family:monospace;">'+k+'</span>';}
    html+='</div><div style="font-size:0.6rem;color:#8a8a9a;">'+Object.keys(hashable).length+' hashed, '+(allK.length-Object.keys(hashable).length)+' excluded</div>';

    // Generation Parameters
    var genF=[['seed','Seed'],['width','Width'],['height','Height'],['steps','Steps'],['cfg','CFG'],['guidance','Guidance'],['denoise','Denoise'],['sampler','Sampler'],['scheduler','Scheduler'],['unet','Model'],['mode','Mode']];
    var hasGen=genF.some(function(g){return r[g[0]]!==undefined;});
    if(hasGen){
      html+='<div class="ev-sec">Generation Parameters</div><div class="ev-g">';
      for(var gi=0;gi<genF.length;gi++){if(r[genF[gi][0]]!==undefined)html+='<div class="ev-m"><div class="ev-ml">'+genF[gi][1]+'</div><div class="ev-mv">'+r[genF[gi][0]]+'</div></div>';}
      if(r.lora)html+='<div class="ev-m"><div class="ev-ml">LoRA</div><div class="ev-mv">'+r.lora+(r.lora_strength!==undefined?' ('+r.lora_strength+')':'')+'</div></div>';
      html+='</div>';
    }

    // Cycle position
    if(r.decoder_chunk_index!==undefined||r.truth_chunk_index!==undefined){
      html+='<div class="ev-sec">Cycle Position</div><div class="ev-g">';
      if(r.decoder_chunk_index!==undefined)html+='<div class="ev-m"><div class="ev-ml">Decoder</div><div class="ev-mv">'+r.decoder_chunk_index+' / '+(r.decoder_total_chunks||12)+'</div></div>';
      if(r.truth_chunk_index!==undefined)html+='<div class="ev-m"><div class="ev-ml">Truth</div><div class="ev-mv">'+r.truth_chunk_index+' / 365</div></div>';
      if(r.proof_chunk_index!==undefined)html+='<div class="ev-m"><div class="ev-ml">Proof</div><div class="ev-mv">'+r.proof_chunk_index+(r.proof_day==='sunday'?' (sunday)':'')+'</div></div>';
      if(r.decoder_age_name)html+='<div class="ev-m"><div class="ev-ml">Age</div><div class="ev-mv">'+r.decoder_age_name+'</div></div>';
      if(r.decoder_hash)html+='<div class="ev-m"><div class="ev-ml">Decoder Hash</div><div class="ev-mv" style="font-size:0.68rem;">'+r.decoder_hash+'</div></div>';
      if(r.decoder_version)html+='<div class="ev-m"><div class="ev-ml">Decoder Version</div><div class="ev-mv" style="font-size:0.68rem;">'+r.decoder_version+'</div></div>';
      if(r.constellation_name)html+='<div class="ev-m"><div class="ev-ml">Constellation</div><div class="ev-mv">'+r.constellation_name+'</div></div>';
      if(r.heart_star_id)html+='<div class="ev-m"><div class="ev-ml">Heart Star</div><div class="ev-mv" style="font-size:0.68rem;">'+r.heart_star_id+'</div></div>';
      if(r.schematic_chunk)html+='<div class="ev-m"><div class="ev-ml">Schematic</div><div class="ev-mv" style="color:#8a7050;">Dark day '+(r.schematic_chunk_index+1)+'</div></div>';
      if(r.claim_chunk)html+='<div class="ev-m"><div class="ev-ml">Claim</div><div class="ev-mv" style="color:#d4b87b;">Epagomenal</div></div>';
      if(r.easter_egg)html+='<div class="ev-m"><div class="ev-ml">Easter Egg</div><div class="ev-mv" style="color:#c47bbb;">Madeline</div></div>';
      html+='</div>';
    }

    // Birth Certificate — Celestial
    if(r.born){
      var born=r.born;
      var bodies=['sun','moon','mercury','venus','mars','jupiter','saturn'];
      var bNames={sun:'Sun',moon:'Moon',mercury:'Mercury',venus:'Venus',mars:'Mars',jupiter:'Jupiter',saturn:'Saturn'};
      var hasCelestial=bodies.some(function(b){return !!born[b];});
      if(hasCelestial){
        html+='<div class="ev-sec">Celestial State at Birth</div><div class="ev-g">';
        for(var ci2=0;ci2<bodies.length;ci2++){var cb=bodies[ci2];if(born[cb]){var extra=cb==='moon'&&born.moon_phase?' ('+born.moon_phase+')':'';html+='<div class="ev-m"><div class="ev-ml">'+bNames[cb]+'</div><div class="ev-mv">'+born[cb]+extra+'</div></div>';}}
        if(born.angular_spread)html+='<div class="ev-m"><div class="ev-ml">Angular Spread</div><div class="ev-mv">'+born.angular_spread+'\u00b0</div></div>';
        if(r.constellation_hash)html+='<div class="ev-m"><div class="ev-ml">Constellation Hash</div><div class="ev-mv" style="font-size:0.68rem;">'+r.constellation_hash+'</div></div>';
        html+='</div>';
      }

      // Machine State
      if(born.machine){
        var m=born.machine;
        html+='<div class="ev-sec">Machine State at Birth</div><div class="ev-g">';
        var mF=[['cpu','CPU'],['cores','Cores'],['gpu_cores','GPU'],['ram','RAM'],['mem_active','Active'],['mem_compressed','Compressed'],['mem_free','Free'],['load','Load'],['power','Power'],['disk_io','Disk I/O'],['net_rx','Net \u2193'],['net_tx','Net \u2191'],['uptime','Uptime']];
        for(var mi=0;mi<mF.length;mi++){if(m[mF[mi][0]]!==undefined)html+='<div class="ev-m"><div class="ev-ml">'+mF[mi][1]+'</div><div class="ev-mv" style="font-size:0.7rem;">'+m[mF[mi][0]]+'</div></div>';}
        html+='</div>';
        if(m.entropy){html+='<div class="ev-sec">Kernel Entropy</div><div class="ev-m w" style="margin:0.3rem 0;"><div class="ev-mv" style="font-size:0.55rem;word-break:break-all;line-height:1.5;color:#8898b8;">'+m.entropy+'</div></div>';}
      }

      // GPS Time-Lock
      if(born.gps_locked){
        var gps=born.gps_locked;
        html+='<div class="ev-sec">Birthplace \u2014 Time-Locked</div><div class="ev-g">';
        if(gps.ct)html+='<div class="ev-m w"><div class="ev-ml">Ciphertext</div><div class="ev-mv" style="font-size:0.52rem;word-break:break-all;">'+gps.ct+'</div></div>';
        if(gps.N)html+='<div class="ev-m w"><div class="ev-ml">RSA Modulus N</div><div class="ev-mv" style="font-size:0.52rem;word-break:break-all;">'+gps.N+'</div></div>';
        if(gps.T)html+='<div class="ev-m"><div class="ev-ml">Squarings</div><div class="ev-mv">'+gps.T.toLocaleString()+'</div></div>';
        if(gps.e)html+='<div class="ev-m"><div class="ev-ml">RSA e</div><div class="ev-mv">'+gps.e+'</div></div>';
        html+='</div>';
      }

      // GPS Password Unlock
      if(r.gps_encrypted){
        html+='<div class="ev-sec">GPS \u2014 Password Unlock</div>';
        html+='<div style="display:flex;gap:0.5rem;align-items:center;">';
        html+='<input type="password" class="gps-pw-input" id="gps-pw-'+ri+'" placeholder="Creator password" style="flex:1;background:#0a0a12;color:#c8c8d4;border:1px solid #2a2a40;border-radius:4px;padding:0.3rem 0.5rem;font-size:0.75rem;font-family:inherit;">';
        html+='<button onclick="unlockGPS('+ri+')" style="padding:0.3rem 0.8rem;background:rgba(46,196,160,0.1);border:1px solid rgba(46,196,160,0.25);color:#2ec4a0;border-radius:4px;cursor:pointer;font-size:0.72rem;font-weight:600;">Unlock</button>';
        html+='</div>';
        html+='<div id="gps-result-'+ri+'" style="margin-top:0.3rem;"></div>';
      }
    }

    // Rarity
    if(r.rarity_score!==undefined){
      html+='<div class="ev-sec">Rarity</div><div class="ev-g">';
      var rs=r.rarity_score;var rTier=rs>=80?'Legendary':rs>=70?'Epic':rs>=60?'Very Rare':rs>=46?'Rare':rs>=35?'Uncommon':'Common';
      var rCol=rs>=80?'#f87171':rs>=70?'#facc15':rs>=60?'#c084fc':rs>=46?'#60a5fa':rs>=35?'#4ade80':'#a0a0a0';
      html+='<div class="ev-m"><div class="ev-ml">Score</div><div class="ev-mv" style="color:'+rCol+';font-weight:700;">'+rs+' \u2014 '+rTier+'</div></div>';
      if(r.machine_fingerprint)html+='<div class="ev-m"><div class="ev-ml">Fingerprint</div><div class="ev-mv">'+r.machine_fingerprint+'</div></div>';
      if(r.rarity&&typeof r.rarity==='object'){for(var rd of['celestial','machine','entropy']){var rT=r.rarity[rd];if(rT&&rT.length)html+='<div class="ev-m"><div class="ev-ml">'+rd.charAt(0).toUpperCase()+rd.slice(1)+'</div><div class="ev-mv" style="font-size:0.7rem;">'+rT.map(function(t){return t.trait+' (+'+t.points+')';}).join(', ')+'</div></div>';}}
      html+='</div>';
    }

    // Birth Temperament + Trait Medals
    if(r.birth_temperament){
      html+='<div class="ev-sec">Birth Temperament</div><div class="ev-g">';
      var hasMedals=r.birth_traits&&r.birth_traits.length&&typeof BIRTH_TRAITS!=='undefined';
      html+='<div class="ev-m w"><div class="ev-ml">'+r.birth_temperament+'</div>'+(!hasMedals&&r.birth_summary?'<div class="ev-mv" style="font-style:italic;font-size:0.72rem;">'+r.birth_summary+'</div>':'')+'</div>';
      if(hasMedals){
        html+='<div class="ev-m w" style="padding:0.5rem;">';
        for(var bti=0;bti<r.birth_traits.length;bti++){
          var btKey=r.birth_traits[bti],btDef=BIRTH_TRAITS[btKey];
          if(btDef){
            html+='<div style="display:flex;align-items:center;gap:0.5rem;margin:0.25rem 0;">';
            html+='<img src="img/traits/'+btKey+'.png" style="width:24px;height:24px;object-fit:contain;flex-shrink:0;" alt="'+btDef.name+'">';
            html+='<span style="font-size:0.72rem;color:#c0c0cc;"><strong style="color:#d0d0d8;">'+btDef.name+'</strong> \u2014 '+btDef.desc+'</span>';
            html+='</div>';
          }else{
            html+='<div style="font-size:0.72rem;color:#8a8a94;margin:0.25rem 0;">'+btKey.replace(/_/g,' ')+'</div>';
          }
        }
        html+='</div>';
      }
      html+='</div>';
    }

    html+='</div></div>'; // close ev-body + ev (evidence card)
    html+='</div>'; // close meta-detail
    html+='</div>'; // close record row wrapper
  }
  html+='</div></div>'; // close ev-body + ev card

  // === Chain, Constellation, Age — below the table ===
  if(valid.length>1){
    html+='<div class="ev"><div class="ev-h" style="background:rgba(80,80,100,0.06);border-left:3px solid rgba(80,80,100,0.2);"><span class="ev-t">Chain &amp; Constellation</span></div><div class="ev-body">';
    var idSet={};valid.forEach(function(r){if(r.identifier)idSet[r.identifier]=r;});
    var chainOk=0,chainExt=0;
    html+='<div class="ev-sec">Parent Chain</div><details><summary style="font-size:0.65rem;color:#6a6a80;cursor:pointer;">'+valid.length+' links</summary><div style="font-size:0.65rem;margin-top:0.3rem;">';
    for(var ci=0;ci<valid.length;ci++){var cr=valid[ci],pid=cr.parent_id;
      var ok2=!pid||!!idSet[pid];var ext=pid&&!idSet[pid];if(ok2)chainOk++;if(ext)chainExt++;
      var col=!pid?'#8898b8':ok2?'#4ade80':'#facc15';
      html+='<div style="padding:0.1rem 0;display:flex;gap:0.3rem;align-items:center;">';
      html+='<span style="width:5px;height:5px;border-radius:50%;background:'+col+';"></span>';
      html+='<span style="color:#8888a0;font-family:monospace;font-size:0.58rem;">'+(cr.identifier||cr._fn).slice(-14)+'</span>';
      html+='<span style="color:'+col+';font-size:0.55rem;">'+(!pid?'genesis':ok2?'\u2190'+pid.slice(-10):'\u2190'+pid.slice(-10)+' (ext)')+'</span></div>';}
    html+='</div></details>';
    html+='<div style="font-size:0.62rem;color:#8a8a9a;margin-top:0.2rem;"><span style="color:#4ade80;">'+chainOk+' valid</span>'+(chainExt?' <span style="color:#facc15;">'+chainExt+' external</span>':'')+'</div>';

    // Constellation Map
    var conMap={};valid.forEach(function(r2){var cn=r2.constellation_name||'_none';if(!conMap[cn])conMap[cn]={recs:[],heart:null,chunks:new Set()};conMap[cn].recs.push(r2);if(r2.decoder_chunk_index!==undefined)conMap[cn].chunks.add(r2.decoder_chunk_index);if(r2.heart_star_id)conMap[cn].heart=r2.heart_star_id;});
    var conNames=Object.keys(conMap).filter(function(n){return n!=='_none';});
    if(conNames.length>0){
      var BAYER=['\u03b1','\u03b2','\u03b3','\u03b4','\u03b5','\u03b6','\u03b7','\u03b8','\u03b9','\u03ba','\u03bb','\u03bc'];
      html+='<div class="ev-sec">Constellations ('+conNames.length+')</div>';
      for(var cni=0;cni<conNames.length;cni++){var cn2=conNames[cni],cd=conMap[cn2],cc=cd.chunks.size===12;
        html+='<div style="margin:0.3rem 0;padding:0.25rem 0.4rem;background:rgba(60,60,80,0.08);border-left:2px solid '+(cc?'rgba(74,158,74,0.4)':'rgba(180,160,60,0.3)')+';border-radius:3px;">';
        html+='<div style="display:flex;justify-content:space-between;"><span style="font-size:0.7rem;color:#c0c0d0;font-weight:600;">'+cn2+'</span><span style="font-size:0.55rem;color:'+(cc?'#4ade80':'#facc15')+';">'+cd.chunks.size+'/12</span></div>';
        html+='<div style="display:flex;flex-wrap:wrap;gap:2px;margin-top:0.15rem;">';
        for(var cri=0;cri<cd.recs.length&&cri<12;cri++){var cr2=cd.recs[cri];var isH=cr2.identifier&&cr2.identifier===cd.heart;
          var starLetter=cr2.constellation_star||BAYER[cri];
          html+='<span style="font-size:0.52rem;padding:0.05rem 0.25rem;border-radius:2px;background:rgba(80,80,100,0.12);color:'+(isH?'#d4b87b':'#4a4a60')+';">'+starLetter+'</span>';}
        html+='</div></div>';}}

    // Age
    var ages=new Set();valid.forEach(function(r2){if(r2.decoder_age_name)ages.add(r2.decoder_age_name);});
    if(ages.size>0)html+='<div class="ev-sec">Age</div><div style="font-size:0.72rem;color:'+(ages.size===1?'#4ade80':'#f87171')+';">'+Array.from(ages).join(', ')+(ages.size===1?' (consistent)':' (mixed)')+'</div>';

    html+='</div></div>';
  }
  // Render into sidebar
  var metaSidebar = document.getElementById('metaSidebarResults');
  if (metaSidebar) {
    metaSidebar.innerHTML = html;
  } else {
    metaResults.innerHTML = html;
  }

  // === Build orbit inspector ===
  buildOrbitInspector(valid, collected);
}

function buildOrbitInspector(records, collected) {
  var el = document.getElementById('orbitInspector');
  if (!el || !records.length) return;

  var BAYER = '\u03b1\u03b2\u03b3\u03b4\u03b5\u03b6\u03b7\u03b8\u03b9\u03ba\u03bb\u03bc'.split('');
  var TOTAL_ROWS = Math.ceil(365 / 12); // 31

  // Group by age. Position on the 365-grid prefers truth_chunk_index;
  // older records (pre-truth-cycle) only carry decoder_chunk_index, so
  // fall back to that (0-11) so a solo drop still lights a cell in the
  // first decoder cycle rather than rendering an empty grid.
  var ages = {}, ageOrder = [];
  records.forEach(function(r) {
    var a = r.decoder_age_name || '_';
    if (!ages[a]) { ages[a] = { byPos: {}, recs: [] }; ageOrder.push(a); }
    ages[a].recs.push(r);
    var ti = r.truth_chunk_index != null ? r.truth_chunk_index : r.decoder_chunk_index;
    if (ti != null) ages[a].byPos[ti] = r;
  });

  var curAge = ageOrder[0], curSector = 0, mode = 'orbit', curFilter = 'all';
  var selectedCons = new Set(); // empty = show all in age
  var _ageAnimating = false;
  var SLOT_W = 110; // must match CSS .orbit-age width

  function mk(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function hx(h, a) { return 'rgba('+parseInt(h.slice(1,3),16)+','+parseInt(h.slice(3,5),16)+','+parseInt(h.slice(5,7),16)+','+a+')'; }

  function focusRecord(record) {
    document.querySelectorAll('[data-identifier]').forEach(function(row) {
      var d = row.querySelector('.meta-detail');
      if (d) d.style.display = 'none';
    });
    var target = document.querySelector('[data-identifier="' + record.identifier + '"]');
    if (target) {
      var d = target.querySelector('.meta-detail');
      if (d) d.style.display = 'block';
      // Scroll the results-wrap container (fixed panel), not the page
      var rw = document.getElementById('resultsWrap');
      if (rw && window.getComputedStyle(rw).position === 'fixed') {
        var h = el.offsetHeight || 0;
        var targetTop = target.offsetTop - h - 4;
        rw.scrollTo({ top: targetTop, behavior: 'smooth' });
      } else {
        var h = el.offsetHeight || 0;
        var top = target.getBoundingClientRect().top + window.scrollY - h - 4;
        window.scrollTo({ top: top, behavior: 'smooth' });
      }
      target.style.background = 'rgba(74,158,74,0.08)';
      setTimeout(function() { target.style.background = ''; }, 2000);
    }
  }

  function render() {
    el.innerHTML = '';
    var ad = ages[curAge];

    // Row → constellation name map
    var rowCon = {}, rowHeart = {};
    ad.recs.forEach(function(r) {
      if (r.truth_chunk_index != null) {
        var row = Math.floor(r.truth_chunk_index / 12);
        if (r.constellation_name) rowCon[row] = r.constellation_name;
        if (r.heart_star_id && r.identifier === r.heart_star_id) rowHeart[row] = true;
      }
    });

    // === Age label — single-age drops show a static centered label;
    // multi-age drops get the full carousel with ◀ ▶ for navigation. ===
    if (ageOrder.length === 1) {
      var single = mk('div', 'orbit-ages');
      var lbl = mk('div', 'orbit-age center');
      lbl.textContent = curAge === '_' ? 'Age I' : curAge;
      single.appendChild(lbl);
      el.appendChild(single);
    } else if (ageOrder.length > 1) {
      var ap = mk('div', 'orbit-ages');
      var curIdx = ageOrder.indexOf(curAge);
      var n = ageOrder.length;
      var atLeft = curIdx === 0, atRight = curIdx === n - 1;

      // Left arrow (dimmed at start)
      var la = mk('span', 'orbit-arrow');
      la.textContent = '\u25c0';
      if (atLeft) la.style.opacity = '0.15';
      ap.appendChild(la);

      // Window (overflow hidden, shows 5 labels)
      var win = mk('div', 'orbit-ages-window');
      var track = mk('div', 'orbit-ages-track');

      // Build 7 slots: center ± 3. Out-of-bounds slots are empty placeholders.
      for (var offset = -3; offset <= 3; offset++) {
        var ai = curIdx + offset;
        var absOff = Math.abs(offset);
        var p = mk('div', 'orbit-age');
        if (ai >= 0 && ai < n) {
          p.textContent = ageOrder[ai] === '_' ? 'Age I' : ageOrder[ai];
          if (absOff === 0) p.classList.add('center');
          else if (absOff === 1) {
            p.classList.add('near-1');
            (function(off) { p.onclick = function() { shiftAge(off); }; })(offset);
          }
          else if (absOff === 2) {
            p.classList.add('near-2');
            (function(off) { p.onclick = function() { shiftAge(off); }; })(offset);
          }
          else p.classList.add('off');
        } else {
          p.classList.add('off'); // empty slot beyond edges
        }
        track.appendChild(p);
      }

      // Position: center label (slot 3 of 7) centered in 5-slot window → offset = -1 slot
      track.style.transform = 'translateX(-' + SLOT_W + 'px)';

      win.appendChild(track);
      ap.appendChild(win);

      var ra2 = mk('span', 'orbit-arrow');
      ra2.textContent = '\u25b6';
      if (atRight) ra2.style.opacity = '0.15';
      ap.appendChild(ra2);

      // Animate by `steps` slots — clamped to edges, no wrap
      function shiftAge(steps) {
        if (_ageAnimating || steps === 0) return;
        var dest = curIdx + steps;
        if (dest < 0 || dest >= n) return; // at edge, do nothing
        _ageAnimating = true;
        track.classList.add('sliding');
        var target = (-1 + (-steps)) * SLOT_W;
        track.style.transform = 'translateX(' + target + 'px)';
        track.addEventListener('transitionend', function handler() {
          track.removeEventListener('transitionend', handler);
          _ageAnimating = false;
          curAge = ageOrder[dest];
          curSector = 0;
          selectedCons.clear();
          render();
        }, { once: true });
      }

      la.onclick = function() { shiftAge(-1); };
      ra2.onclick = function() { shiftAge(1); };
      el._shiftAge = shiftAge;

      el.appendChild(ap);
    }

    // === Controls row ===
    var ctl = mk('div', 'orbit-controls');

    var ob = mk('button', 'orbit-vbtn' + (mode === 'orbit' ? ' active' : ''));
    ob.textContent = 'Orbit';
    var sb = mk('button', 'orbit-vbtn' + (mode === 'sector' ? ' active' : ''));
    sb.textContent = 'Compact';
    ob.onclick = function() { mode = 'orbit'; fog(); sel.onchange(); restoreFocus(); ob.classList.add('active'); sb.classList.remove('active'); };
    sb.onclick = function() { mode = 'sector'; fog(); sel.onchange(); restoreFocus(); sb.classList.add('active'); ob.classList.remove('active'); };
    ctl.appendChild(ob);
    ctl.appendChild(sb);

    var sel = mk('select', 'orbit-filter');
    var opts = {all:'All',decoder:'Decoder',truth:'Truth',proof:'Proof',epag:'Epag',egg:'Egg'};
    for (var k in opts) { var o = document.createElement('option'); o.value = k; o.textContent = opts[k]; sel.appendChild(o); }
    sel.value = curFilter;
    ctl.appendChild(sel);

    var hashOk = ad.recs.filter(function(r) { return r._match; }).length;
    var supplied = Object.keys(ad.byPos).length;
    var stIn = mk('span', '');
    stIn.style.cssText = 'font-size:0.46rem;color:#5a5a6a;';
    stIn.textContent = supplied + '/365';
    ctl.appendChild(stIn);

    el.appendChild(ctl);

    // === Grid ===
    var gridWrap = mk('div', 'orbit-grid');
    var tbl = mk('table', 'orbit-tbl');

    // Header row
    var hdr = document.createElement('tr');
    var th0 = document.createElement('td');
    th0.style.cssText = 'max-width:68px;';
    hdr.appendChild(th0);
    for (var c = 0; c < 12; c++) {
      var th = mk('td', 'orbit-hdr');
      th.textContent = BAYER[c];
      hdr.appendChild(th);
    }
    tbl.appendChild(hdr);

    // Data rows
    var rowEls = [];
    for (var ri = 0; ri < TOTAL_ROWS; ri++) {
      var tr = document.createElement('tr');
      tr.className = 'orbit-row';
      var base = ri * 12;
      var cn = rowCon[ri];
      if (cn && selectedCons.has(cn)) tr.classList.add('row-selected');
      var special = base >= 360;

      // Label cell
      var lbl = mk('td', 'orbit-lbl');
      if (cn) {
        lbl.textContent = cn;
        lbl.classList.add('has-name');
        if (selectedCons.has(cn)) lbl.classList.add('selected');
        (function(name, lblEl, rowEl) {
          lblEl.onclick = function() {
            // Pure toggle — no sector focus change
            if (selectedCons.has(name)) {
              selectedCons.delete(name);
            } else {
              selectedCons.add(name);
            }
            // Update all label + row highlights
            tbl.querySelectorAll('.orbit-lbl.has-name').forEach(function(l) {
              l.classList.toggle('selected', selectedCons.has(l.textContent));
            });
            rowEls.forEach(function(tr, i) {
              tr.classList.toggle('row-selected', !!rowCon[i] && selectedCons.has(rowCon[i]));
            });
            tbl.classList.toggle('has-selection', selectedCons.size > 0);
            fog();
            sel.onchange();
            restoreFocus();
            filterRecords();
          };
        })(cn, lbl, tr);
      } else if (special) {
        lbl.textContent = base >= 364 ? '\u2609 Epag' : '\u25c6 Dark';
        lbl.style.color = '#8a7050';
      } else {
        lbl.textContent = (ri + 1);
      }
      tr.appendChild(lbl);

      // 12 cells
      for (var ci = 0; ci < 12; ci++) {
        var pos = base + ci;
        var td = document.createElement('td');
        if (pos >= 365) { tr.appendChild(td); continue; }

        var cell = mk('div', 'orbit-c');
        cell.dataset.pos = pos;
        cell.dataset.row = ri;

        var rec = ad.byPos[pos];
        var isDk = pos >= 360 && pos <= 363;
        var isEp = pos === 364;

        if (rec) {
          cell.classList.add('supplied');
          if (rec._match === false) cell.classList.add('tampered');
          cell.textContent = BAYER[ci];
          if (ci === 0 && rowHeart[ri]) cell.classList.add('heart');
          (function(record, row, cellEl) {
            var _savedBg = '';
            cellEl.addEventListener('mouseenter', function() {
              if (cellEl.classList.contains('focused')) return;
              cellEl.style.filter = 'brightness(1.4)';
              cellEl.style.boxShadow = '0 0 6px rgba(255,255,255,0.15)';
            });
            cellEl.addEventListener('mouseleave', function() {
              if (cellEl.classList.contains('focused')) return;
              cellEl.style.filter = '';
              cellEl.style.boxShadow = '';
            });
            cellEl.onclick = function() {
              // Only allow selection if cell is in the active filter
              var types = cellEl.dataset.types || '';
              if (curFilter !== 'all' && types.indexOf(curFilter) < 0) return;
              curSector = row;
              fog();
              // Clear old focus
              tbl.querySelectorAll('.orbit-c.focused').forEach(function(c) {
                c.classList.remove('focused');
                c.style.background = ''; c.style.boxShadow = ''; c.style.filter = '';
                c.style.borderColor = ''; c.style.borderTop = ''; c.style.borderRight = ''; c.style.borderBottom = ''; c.style.borderLeft = '';
              });
              // Re-apply filter to restore all cells (cadence borders, colors)
              sel.onchange();
              // Apply focus with filter-colored glow on top
              var FC = {all:'255,255,255', decoder:'123,196,160', truth:'136,152,184', proof:'184,152,216', epag:'212,184,123', egg:'196,123,187'};
              var fc = FC[curFilter] || FC.all;
              cellEl.classList.add('focused');
              cellEl.style.background = 'rgba(' + fc + ',0.65)';
              cellEl.style.borderColor = 'rgba(' + fc + ',0.9)';
              cellEl.style.boxShadow = '0 0 10px rgba(' + fc + ',0.5), 0 0 3px rgba(' + fc + ',0.8)';
              focusRecord(record);
            };
          })(rec, ri, cell);
        } else {
          cell.textContent = '\u00b7';
        }

        if (isDk) cell.classList.add('dark');
        if (isEp) cell.classList.add('epag');

        // Cycle membership for filter
        var types = 'truth';
        if (pos < 360) types += ' decoder';
        if (pos < 364) types += ' proof';
        if (pos >= 360) types += ' epag';
        if (pos === 364) types += ' egg';
        cell.dataset.types = types;

        td.appendChild(cell);
        tr.appendChild(td);
      }

      tbl.appendChild(tr);
      rowEls.push(tr);
    }

    gridWrap.appendChild(tbl);
    el.appendChild(gridWrap);

    // === Stats line (per-age counts) ===
    var stats = mk('div', 'orbit-stats');
    var ageDecChunks = {}, ageProofChunks = {}, ageTruthChunks = {}, ageSchemChunks = {};
    var ageHasClaim = false, ageHasEgg = false;
    ad.recs.forEach(function(r) {
      if (r.decoder_chunk_index !== undefined && r.decoder_chunk) ageDecChunks[r.decoder_chunk_index] = true;
      if (r.proof_chunk_index !== undefined && r.proof_chunk) ageProofChunks[r.proof_chunk_index] = true;
      if (r.truth_chunk_index !== undefined && r.truth_chunk) ageTruthChunks[r.truth_chunk_index] = true;
      if (r.schematic_chunk_index !== undefined && r.schematic_chunk) ageSchemChunks[r.schematic_chunk_index] = true;
      if (r.claim_chunk) ageHasClaim = true;
      if (r.easter_egg) ageHasEgg = true;
    });
    var decCount = Object.keys(ageDecChunks).length;
    var proofCount = Object.keys(ageProofChunks).length;
    var truthCount = Object.keys(ageTruthChunks).length;
    var schemCount = Object.keys(ageSchemChunks).length;
    var hasClaim = ageHasClaim;
    var hasEgg = ageHasEgg;
    stats.innerHTML =
      '<span>' + ad.recs.length + ' stars</span>' +
      '<span class="' + (hashOk === ad.recs.length ? 'pass' : 'warn') + '">' + hashOk + '/' + ad.recs.length + ' verified</span>';
    el.appendChild(stats);

    // === Reassembly downloads ===
    var hasAssembly = decCount === 12 || proofCount >= 6 || truthCount === 365 || schemCount === 4 || hasClaim || hasEgg;
    if (hasAssembly) {
      var ra = mk('div', 'orbit-assembly');
      function dlBtn(label, onclick) {
        var b = mk('button', 'orbit-vbtn');
        b.textContent = '\u2913 ' + label;
        b.onclick = onclick;
        ra.appendChild(b);
      }
      // Filter colors: decoder=green, truth=blue, proof=purple, epag=gold, egg=pink
      var FC = {decoder:'123,196,160', truth:'136,152,184', proof:'184,152,216', epag:'212,184,123', egg:'196,123,187'};
      function dlBtnColored(label, type, onclick) {
        var b = mk('button', 'orbit-vbtn');
        b.textContent = '\u2913 ' + label;
        var c = FC[type] || '255,255,255';
        b.style.borderColor = 'rgba(' + c + ',0.4)';
        b.style.color = 'rgb(' + c + ')';
        b.style.background = 'rgba(' + c + ',0.08)';
        b.onmouseenter = function() { b.style.background = 'rgba(' + c + ',0.18)'; };
        b.onmouseleave = function() { b.style.background = 'rgba(' + c + ',0.08)'; };
        b.onclick = onclick;
        ra.appendChild(b);
      }
      if (decCount === 12) dlBtnColored('Decoder', 'decoder', async function() {
        var h = await assembleChunks(collected.decoder, 12);
        if (h) { var b = new Blob([h], {type:'text/html'}); var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'mememage-decoder.html'; a.click(); }
      });
      if (proofCount >= 6) dlBtnColored('Proof', 'proof', async function() {
        var h = await assembleChunks(collected.proof, 6);
        if (h) { var b = new Blob([h], {type:'text/html'}); var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'mememage-proof.html'; a.click(); }
      });
      if (truthCount === 365) dlBtnColored('Truth', 'truth', async function() {
        var h = await assembleChunks(collected.truth, 365);
        if (h) { var b = new Blob([h], {type:'text/plain'}); var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'mememage-truth.txt'; a.click(); }
      });
      if (schemCount === 4) dlBtnColored('Schematics', 'epag', function() {
        var names = ['fig1_system_overview.pdf','fig2_bar_format.pdf','fig3_watermark_derivation.pdf','fig4_nested_cycles.pdf'];
        for (var si = 0; si < 4; si++) {
          if (!collected.schematic[si]) continue;
          var data = collected.schematic[si].data;
          if (data.indexOf('data:application/pdf;base64,') === 0) {
            var raw = atob(data.split(',')[1]); var arr = new Uint8Array(raw.length);
            for (var bi = 0; bi < raw.length; bi++) arr[bi] = raw.charCodeAt(bi);
            var b = new Blob([arr], {type:'application/pdf'}); var a = document.createElement('a');
            a.href = URL.createObjectURL(b); a.download = names[si]; a.click();
          } else {
            var b = new Blob([data], {type:'text/plain'}); var a = document.createElement('a');
            a.href = URL.createObjectURL(b); a.download = names[si].replace('.pdf','.txt'); a.click();
          }
        }
      });
      if (hasClaim) dlBtnColored('Claim', 'epag', function() {
        var data = collected.claim.data;
        var isHtml = data.indexOf('<!DOCTYPE') >= 0 || data.indexOf('<html') >= 0;
        var b = new Blob([data], {type: isHtml ? 'text/html' : 'text/plain'}); var a = document.createElement('a');
        a.href = URL.createObjectURL(b); a.download = isHtml ? 'mememage-specification.html' : 'mememage-claim.txt'; a.click();
      });
      if (hasEgg) dlBtnColored('Easter Egg', 'egg', function() {
        var egg = collected.egg;
        var h = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Madeline</title>' +
          '<style>body{margin:0;background:#000;color:#c0c0c8;font-family:Georgia,serif;' +
          'display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:2rem;}' +
          'img{max-width:480px;width:100%;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,0.5);}' +
          'p{margin-top:1.5rem;font-size:0.9rem;color:#909098;text-align:center;max-width:400px;line-height:1.6;}' +
          '.name{font-size:1.8rem;margin-top:1.2rem;letter-spacing:0.1em;color:#d0d0d8;}' +
          '.note{font-size:0.7rem;color:#505058;margin-top:2rem;font-style:italic;}</style></head><body>' +
          (egg.image ? '<img src="' + egg.image + '" alt="Madeline">' : '') +
          '<div class="name">Madeline</div>' +
          '<p>' + (egg.text || '').replace(/\u2014/g, '&mdash;') + '</p>' +
          '<p class="note">The real cat who started it all.<br>Sealed into the epagomenal day &mdash; the day outside all cycles.</p>' +
          '</body></html>';
        var b = new Blob([h], {type:'text/html'}); var a = document.createElement('a');
        a.href = URL.createObjectURL(b); a.download = 'madeline.html'; a.click();
      });
      el.appendChild(ra);
    }

    el.classList.add('visible');

    // === Fog of war ===
    function fog() {
      var hasSel = selectedCons.size > 0;
      rowEls.forEach(function(tr, i) {
        tr.classList.remove('collapsed', 'near');
        if (mode !== 'sector') return;
        var base = i * 12;
        var isCon = !!rowCon[i];
        var isSpecial = base >= 360; // dark days (360-363) or epagomenal (364)
        var hasRec = false;
        for (var ci = 0; ci < 12 && base + ci < 365; ci++) {
          if (ad.byPos[base + ci]) { hasRec = true; break; }
        }

        if (!hasRec) {
          tr.classList.add('collapsed');
          return;
        }

        // Filter-aware collapse: hide rows outside the filter's range
        if (curFilter === 'decoder' && isSpecial) { tr.classList.add('collapsed'); return; }
        if ((curFilter === 'epag' || curFilter === 'egg') && !isSpecial) { tr.classList.add('collapsed'); return; }

        // Constellation selection filter — collapse unselected constellations
        // Special rows (dark/epag) with records always stay visible
        if (hasSel) {
          if (isCon && selectedCons.has(rowCon[i])) {
            // Selected constellation — stay visible
          } else if (isSpecial && hasRec) {
            // Special row with records — stay visible
          } else {
            tr.classList.add('collapsed');
          }
        }
      });
    }

    // === Filter handler — with cadence boundary outlines ===
    // Cycle lengths and offsets for boundary computation
    var CL = {decoder:12, truth:365, proof:7, epag:5, egg:1};
    var CO = {decoder:0, truth:0, proof:0, epag:360, egg:364};

    // Compute which edges of a cell are group boundaries
    function gEdge(p, groupLen) {
      var g = Math.floor(p / groupLen), c = p % 12;
      var t = false, b = false, l = false, r = false;
      if (p % groupLen === 0) l = true; else if (c === 0) l = true;
      if (p % groupLen === groupLen - 1) r = true; else if (c === 11) r = true;
      var above = p - 12;
      if (above < 0 || Math.floor(above / groupLen) !== g) t = true;
      var below = p + 12;
      if (below >= 366 || Math.floor(below / groupLen) !== g) b = true;
      return {t:t, b:b, l:l, r:r};
    }

    // Tampered cells always get red override, regardless of filter
    function applyTamperedOverride() {
      tbl.querySelectorAll('.orbit-c.tampered').forEach(function(c) {
        if (c.style.opacity === '0.06') return; // outside current filter — leave dimmed
        c.style.background = 'rgba(196,123,123,0.3)';
        c.style.color = '#c47b7b';
      });
    }

    sel.onchange = function() {
      curFilter = sel.value;
      // Update sector collapse for filter-aware rows
      fog();
      // Re-color focused cell glow to match new filter
      var FC = {all:'255,255,255', decoder:'123,196,160', truth:'136,152,184', proof:'184,152,216', epag:'212,184,123', egg:'196,123,187'};
      var focusedEl = tbl.querySelector('.orbit-c.focused');
      if (focusedEl) {
        var fc = FC[curFilter] || FC.all;
        focusedEl.style.background = 'rgba(' + fc + ',0.65)';
        focusedEl.style.borderColor = 'rgba(' + fc + ',0.9)';
        focusedEl.style.boxShadow = '0 0 10px rgba(' + fc + ',0.5), 0 0 3px rgba(' + fc + ',0.8)';
      }
      var cells = tbl.querySelectorAll('.orbit-c');
      if (curFilter === 'all') {
        cells.forEach(function(c) {
          var row = c.closest('.orbit-row');
          if (row && row.classList.contains('collapsed')) {
            c.style.border = 'none'; c.style.borderTop = ''; c.style.borderRight = ''; c.style.borderBottom = ''; c.style.borderLeft = '';
            c.style.background = ''; c.style.opacity = ''; c.style.color = '';
            return;
          }
          var sup = c.classList.contains('supplied');
          var p = parseInt(c.dataset.pos);
          var dk = p >= 360 && p <= 363, ep = p === 364;
          c.style.opacity = '1';
          c.style.background = sup ? (ep ? 'rgba(200,176,128,0.35)' : dk ? 'rgba(180,152,112,0.35)' : 'rgba(255,255,255,0.1)') :
            (ep ? 'rgba(200,176,128,0.08)' : dk ? 'rgba(138,112,80,0.1)' : 'rgba(255,255,255,0.02)');
          c.style.border = 'none';
          c.style.borderTop = ''; c.style.borderRight = ''; c.style.borderBottom = ''; c.style.borderLeft = '';
          c.style.color = sup ? (ep ? '#c8b080' : dk ? '#b89870' : 'rgba(255,255,255,0.65)') : '#38383e';
        });
        applyTamperedOverride();
        applySelectionHighlight();
        return;
      }
      var CC = {decoder:'#7bc4a0', truth:'#8898b8', proof:'#b898d8', epag:'#d4b87b', egg:'#c47bbb'};
      var col = CC[curFilter];
      var cn = CL[curFilter], co = CO[curFilter];
      cells.forEach(function(c) {
        // Skip cells in collapsed rows (sector mode)
        var row = c.closest('.orbit-row');
        if (row && row.classList.contains('collapsed')) {
          c.style.border = 'none'; c.style.borderTop = ''; c.style.borderRight = ''; c.style.borderBottom = ''; c.style.borderLeft = '';
          c.style.background = ''; c.style.opacity = ''; c.style.color = '';
          return;
        }
        var types = c.dataset.types || '';
        var p = parseInt(c.dataset.pos);
        var inC = types.indexOf(curFilter) >= 0;
        var sup = c.classList.contains('supplied');
        if (!inC) {
          c.style.opacity = '0.06';
          c.style.background = 'rgba(25,25,35,0.15)';
          c.style.border = 'none';
          c.style.borderTop = ''; c.style.borderRight = ''; c.style.borderBottom = ''; c.style.borderLeft = '';
          c.style.color = 'rgba(50,50,60,0.15)';
        } else {
          c.style.opacity = '1';
          c.style.background = sup ? hx(col, 0.3) : 'rgba(25,25,35,0.15)';
          c.style.color = sup ? col : hx(col, 0.2);
          // Cadence boundaries — solid for supplied, dashed for empty
          var e = gEdge(p - co, cn);
          if (curFilter === 'decoder') { e.t = true; e.b = true; } // decoder rows are always top/bottom bordered
          var eb = sup ? '2px solid ' + hx(col, 0.8) : '2px dashed ' + hx(col, 0.4);
          var ib = 'none';
          c.style.borderTop = e.t ? eb : ib;
          c.style.borderRight = e.r ? eb : ib;
          c.style.borderBottom = e.b ? eb : ib;
          c.style.borderLeft = e.l ? eb : ib;
        }
      });
      applyTamperedOverride();
      applySelectionHighlight();
    };

    function applySelectionHighlight() {
      if (selectedCons.size === 0) return;
      tbl.querySelectorAll('.orbit-row:not(.row-selected):not(.collapsed) .orbit-c.supplied').forEach(function(c) {
        if (!c.classList.contains('focused')) {
          c.style.opacity = '0.35';
        }
      });
      tbl.querySelectorAll('.orbit-row:not(.row-selected):not(.collapsed) .orbit-lbl').forEach(function(l) {
        l.style.opacity = '0.35';
      });
    }

    function restoreFocus() {
      var f = tbl.querySelector('.orbit-c.focused');
      if (!f) return;
      var FC = {all:'255,255,255', decoder:'123,196,160', truth:'136,152,184', proof:'184,152,216', epag:'212,184,123', egg:'196,123,187'};
      var fc = FC[curFilter] || FC.all;
      f.style.background = 'rgba(' + fc + ',0.65)';
      f.style.borderColor = 'rgba(' + fc + ',0.9)';
      f.style.boxShadow = '0 0 10px rgba(' + fc + ',0.5), 0 0 3px rgba(' + fc + ',0.8)';
      f.style.color = '#fff';
      f.style.opacity = '1';
    }

    fog();

    // Auto-focus first populated sector in sector mode
    if (mode === 'sector') {
      for (var si = 0; si < TOTAL_ROWS; si++) {
        if (rowCon[si]) { curSector = si; fog(); break; }
      }
    }

    // Re-apply active filter (persists across age changes)
    if (curFilter !== 'all') sel.onchange();

    // Filter records to current age + selected constellations
    filterRecords();
  }

  function filterRecords() {
    var ageLabel = curAge === '_' ? '' : curAge;
    var useCon = selectedCons.size > 0;
    var recRows = document.querySelectorAll('[data-age]');
    var visCount = 0;
    recRows.forEach(function(row) {
      var ageMatch = row.dataset.age === ageLabel;
      var conMatch = !useCon || selectedCons.has(row.dataset.con);
      if (ageMatch && conMatch) {
        row.style.display = '';
        visCount++;
      } else {
        row.style.display = 'none';
        var d = row.querySelector('.meta-detail');
        if (d) d.style.display = 'none';
      }
    });
    var recHeader = document.querySelector('.ev-t');
    if (recHeader && recHeader.textContent.indexOf('Records') === 0) {
      recHeader.textContent = 'Records (' + visCount + ')';
    }
  }

  render();
}

// =====================================================================
// AUDIT — full forensic report on a record fetched by identifier
// =====================================================================
document.getElementById('auditInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') runAudit();
});
// Audit source config — shared impl in SourceConfig (portal.js) so
// the decoder's By Word mirrors this exactly with prefix='lookup'.
(function() {
  var input = document.getElementById('auditSource');
  var wrap = input ? input.closest('.lookup-source') : null;
  SourceConfig.init({
    prefix: 'source',
    baseEl: input,
    defaultUrl: 'https://archive.org/download/{id}/',
    placeholder: 'https://archive.org/download/{id}/',
    resetEl: input && input.parentElement ? input.parentElement.querySelector('label') : null,
    modeEl: wrap ? wrap.querySelector('[data-source-mode-select]') : null,
    modeContainer: wrap
  });
})();
// Offline records — folder picker + shared cache. Audit's runAudit
// hits the cache before the network; Observatory drops also populate
// it automatically (per the for-loop in analyzeMeta).
OfflineRecords.bindUI();

// Delegated click handler for audit-link anchors — shared LinkClick
// owns the preventDefault/dataset boilerplate; callback handles the
// page-specific side effects (prefill + switch to Audit tab).
LinkClick.delegate('.audit-link', function(id) {
  document.getElementById('auditInput').value = id;
  showTab('cert');
});

// Snapshot the default .how help text so we can restore it after a
// "Fetching..." state resolves. The .how box is help-only now —
// errors live in the auditErrorHead + auditErrorBody slots; .how
// hides (via :has CSS) when head is non-empty.
var _auditHowDefault = null;
(function(){ var h = document.querySelector('#tab-cert .how'); if (h) _auditHowDefault = h.innerHTML; })();
function setHow(state, html) {
  var h = document.querySelector('#tab-cert .how');
  if (!h) return;
  if (state === 'default') h.innerHTML = _auditHowDefault || '';
  else h.innerHTML = html || '';
  // Any non-error state implicitly clears the error slots.
  if (state !== 'error') setAuditError('', '');
}
// Configure PanelError for the validator's tabs (shared helper in
// portal.js owns the DOM writes + cross-tab clearing). Observatory's
// metaError is a single-slot tab; Audit has the two-slot head/body.
// Image tab has its own console widget (imgConsole), not a plain
// error slot — it isn't routed through PanelError.
PanelError.configure({
  cert: { head: 'auditErrorHead', body: 'auditErrorBody' },
  meta: { body: 'metaError' }
});
function setAuditError(head, body) {
  PanelError.set('cert', head, body);
  // A bad audit result exits compact mode. Leaving the right sidebar
  // up with empty innards reads as "something rendered" when nothing
  // did — a fresh query that failed shouldn't inherit the prior
  // query's layout real estate. The dismiss animation also gives the
  // user an unmistakable signal that the previous cert is gone.
  if (head) {
    var out = document.getElementById('certResults');
    if (out) out.innerHTML = '';
    if (typeof hideResultsSidebar === 'function') hideResultsSidebar(true);
  }
}

function runAudit() {
  var input = document.getElementById('auditInput').value.trim();
  var out = document.getElementById('certResults');
  if (!input) return;
  clearOtherResults('cert');
  // Don't open the sidebar until we have a real record. A "Fetching..."
  // flash replaced by an inline error on fail leaves a blank sidebar
  // flash — keep the sidebar closed and show status inline in .how.
  out.innerHTML = '';
  setHow('loading', '<span style="color:#8a8a94;">Fetching...</span>');
  // The .how box above already shows "Fetching…" during the fetch.
  // No-op stopSpin kept for the terminal paths below (early return,
  // ok, fail) that call it — setHow('default') handles the actual
  // restore when the audit succeeds; fail() writes over .how via
  // setAuditError → hideResultsSidebar chain; mixed-content early
  // return writes its own error headline. Hence no button state to
  // manage here.
  function stopSpin() {}

  // Parse identifier. URL inputs can have the id embedded anywhere —
  // extract via unanchored regex. Bare inputs must match strictly
  // end-to-end so junk like "mememage-<hex>ff99bad" can't sneak past
  // by silently truncating to the valid hex prefix.
  var identifier;
  if (/^https?:\/\//.test(input)) {
    var urlMatch = input.match(/mememage-[a-f0-9]+/);
    identifier = urlMatch ? urlMatch[0] : null;
  } else {
    var bareMatch = input.match(/^mememage-[a-f0-9]+$/i);
    identifier = bareMatch ? bareMatch[0] : null;
  }
  if (!identifier) {
    setAuditError(
      'Invalid identifier.',
      'Expected <strong>mememage-&lt;hex&gt;</strong>, or a URL containing one.'
    );
    stopSpin();
    return;
  }

  // Source config — single URL field with {id} templating. Expand
  // {id} before probing so "https://archive.org/download/{id}/" and
  // "https://yourhost.com/" share one code path.
  var sourceEl = document.getElementById('auditSource');
  var base = (sourceEl ? sourceEl.value.trim() : 'https://archive.org/download/{id}/');
  var expanded = base.replace(/\{id\}/g, identifier).replace(/\/+$/, '');
  var isArchiveOrg = /archive\.org/.test(base);
  var offlineMode = SourceConfig.getMode('source') === 'offline';

  // Mixed-content pre-check (online only) — https pages can't fetch
  // http resources. Browsers block silently.
  if (!offlineMode && location.protocol === 'https:' && /^http:\/\//i.test(base)) {
    out.innerHTML = '';
    setAuditError(
      'Mixed content blocked for ' + identifier,
      'This page is served over HTTPS, but the source is HTTP \u2014 browsers block this silently.<br>' +
      'Open in a new tab (mixed-content rules don\u2019t apply to top-level navigation):<br>' +
      buildProbeLinks(base, identifier, null) + '<br>' +
      'Save and drop it into <em>Observatory</em>.'
    );
    stopSpin();
    return;
  }

  function fail() {
    out.innerHTML = '';
    if (offlineMode) {
      setAuditError(
        'Not in the offline cache.',
        'Identifier <strong>' + identifier + '</strong> isn\u2019t among ' +
        OfflineRecords.count() + ' record(s) currently loaded. ' +
        'Load a different folder under <em>Source</em>, or switch to <em>Online</em>.'
      );
    } else {
      var probeHtml = buildProbeLinks(base, identifier, null);
      var probeLinks = probeHtml
        ? 'Open the file in a new tab to check it loads:<br>' + probeHtml + '<br>' +
          'If it loads, save the file and drop it into <em>Observatory</em>.<br>'
        : '';
      setAuditError(
        'Could not find record for ' + identifier,
        probeLinks +
        'Self-hosting? Your server must send <code>Access-Control-Allow-Origin: *</code> \u2014 ' +
        'browsers silently block cross-origin fetches without it.'
      );
    }
    stopSpin();
  }

  // Stamp the URL that actually produced the record onto _source, so
  // renderAudit can show a "Source" link. Spinner stops on terminal
  // success too.
  function ok(url) {
    return function(record) {
      if (record && typeof record === 'object') record._source = url;
      renderAudit(record, identifier, out);
      stopSpin();
    };
  }

  // Offline cache first — Observatory drops + folder-picker loads
  // populate OfflineRecords. If the identifier matches an already-
  // parsed record, skip the network entirely.
  var cached = OfflineRecords.get(identifier);
  if (cached) {
    renderAudit(cached, identifier, out);
    stopSpin();
    return;
  }

  // Offline mode miss — user explicitly picked Offline but the
  // identifier isn't in the cache. Bail out cleanly; no network.
  if (offlineMode) {
    fail();
    return;
  }

  // Probe the expanded URL for the canonical .soul / .json forms.
  // Archive.org's actual filename is {id}.{hash}.soul (hash unknown
  // for bare-identifier input), so we fall back to IA's /metadata/
  // API to discover the file when direct probes miss.
  var soulUrl = expanded + '/' + identifier + '.soul';
  var jsonUrl = expanded + '/' + identifier + '.json';
  function iaFallback() {
    if (!isArchiveOrg) { fail(); return; }
    // archive.org resolver — /metadata/ API exposes the item's files,
    // pick the .soul/.json and download it.
    var iaRoot = base.match(/^(https?:\/\/[^/]*archive\.org)/);
    iaRoot = iaRoot ? iaRoot[1] : 'https://archive.org';
    var resolvedDownload = null;
    fetch(iaRoot + '/metadata/' + identifier + '?t=' + Date.now(), {cache: 'no-store'})
      .then(function(r) { return r.ok ? r.json() : Promise.reject('not found'); })
      .then(function(meta) {
        if (!meta || !meta.files) return Promise.reject('no files');
        var soulFile = null;
        for (var i = 0; i < meta.files.length; i++) {
          var fn = meta.files[i].name;
          if (fn.endsWith('.json') || fn.endsWith('.soul')) { soulFile = fn; break; }
        }
        if (!soulFile) return Promise.reject('no soul file');
        resolvedDownload = iaRoot + '/download/' + identifier + '/' + soulFile;
        return fetch(resolvedDownload + '?t=' + Date.now(), {cache: 'no-store'});
      })
      .then(function(r) { return r.ok ? r.json() : Promise.reject('fetch failed'); })
      .then(function(record) { ok(resolvedDownload)(record); })
      .catch(fail);
  }

  fetch(soulUrl + '?t=' + Date.now(), {cache: 'no-store'})
    .then(function(r) { return r.ok ? r.json() : Promise.reject('soul'); })
    .then(ok(soulUrl))
    .catch(function() {
      fetch(jsonUrl + '?t=' + Date.now(), {cache: 'no-store'})
        .then(function(r) { return r.ok ? r.json() : Promise.reject('json'); })
        .then(ok(jsonUrl))
        .catch(iaFallback);
    });
}

function auditRow(label, value, cls) {
  // `.selectable` is the shared class recognized under .drag-scroll:
  // single-click selects the entire cell's content (user-select: all),
  // ready for Cmd+C. Same affordance as the cert's prompt/timestamp
  // fields so audit values don't feel like different material.
  return '<div class="audit-row"><span class="audit-label">' + label + '</span><span class="audit-val selectable ' + (cls || '') + '">' + value + '</span></div>';
}

function auditSection(title, rows) {
  return '<div class="audit-section"><div class="audit-section-label">' + title + '</div>' + rows + '</div>';
}

function renderAudit(rec, identifier, out) {
  var html = '';

  // === IDENTITY ===
  var idRows = '';
  idRows += auditRow('Identifier', rec.identifier || identifier, 'audit-info');
  idRows += auditRow('Content Hash', rec.content_hash || 'missing', rec.content_hash ? '' : 'audit-fail');
  idRows += auditRow('Hash Version', rec.hash_version || '?');
  idRows += auditRow('Conceived', rec.conceived || 'unknown');
  if (rec.rendered) idRows += auditRow('Rendered', rec.rendered);
  if (rec.creator_name) idRows += auditRow('Creator', rec.creator_name, 'audit-info');
  html += auditSection('Identity', idRows);

  // === CONTENT HASH VERIFICATION ===
  var hashRows = '';
  var storedHash = rec.content_hash;
  if (storedHash) {
    // Compute hash client-side — uses shared HASH_INCLUDED from verify.js
    var hashable = {};
    HASH_INCLUDED.forEach(function(k) { if (rec[k] !== undefined && rec[k] !== null) hashable[k] = rec[k]; });
    var sorted = JSON.stringify(sortKeysDeep(hashable)).replace(/[\u0080-\uffff]/g, function(c) { return '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'); });
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(sorted)).then(function(buf) {
      var computed = Array.from(new Uint8Array(buf)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('').slice(0, 16);
      var hashEl = document.getElementById('auditHashResult');
      if (hashEl) {
        if (computed === storedHash) {
          hashEl.innerHTML = auditRow('Computed', computed, 'audit-pass') + auditRow('Verdict', 'MATCH \u2014 record is internally consistent', 'audit-pass');
        } else {
          hashEl.innerHTML = auditRow('Computed', computed, 'audit-fail') + auditRow('Stored', storedHash, 'audit-fail') + auditRow('Verdict', 'MISMATCH \u2014 record may be altered', 'audit-fail');
        }
      }
    });
    hashRows += auditRow('Stored Hash', storedHash);
    hashRows += '<div id="auditHashResult">' + auditRow('Computing...', '', 'audit-dim') + '</div>';
  } else {
    hashRows += auditRow('Status', 'No content hash in record', 'audit-warn');
  }
  html += auditSection('Content Hash', hashRows);

  // === SIGNATURE ===
  var sigRows = '';
  if (rec.signature) {
    sigRows += auditRow('Signature', rec.signature.slice(0, 16) + '...' + rec.signature.slice(-8));
    sigRows += auditRow('Public Key', rec.public_key ? rec.public_key.slice(0, 16) + '...' : 'missing', rec.public_key ? '' : 'audit-fail');
    sigRows += auditRow('Fingerprint', rec.key_fingerprint || 'missing', rec.key_fingerprint ? 'audit-info' : 'audit-fail');
    if (rec.creator_name) sigRows += auditRow('Creator (TOFU)', rec.creator_name, 'audit-info');
    // TODO: actual Ed25519 verification would go here
    sigRows += auditRow('Signed', 'Yes \u2014 signature present', 'audit-pass');
  } else {
    sigRows += auditRow('Status', 'UNSIGNED \u2014 no Ed25519 signature', 'audit-warn');
    sigRows += auditRow('Risk', 'Thumbnail and non-hashed fields are unprotected', 'audit-warn');
  }
  html += auditSection('Signature (Ed25519)', sigRows);

  // === CHAIN POSITION ===
  var chainRows = '';
  chainRows += auditRow('Parent', rec.parent_id || 'genesis (no parent)', rec.parent_id ? '' : 'audit-info');
  if (rec.constellation_name) {
    chainRows += auditRow('Constellation', rec.constellation_name, 'audit-info');
    chainRows += auditRow('Star', rec.constellation_star || '?');
    chainRows += auditRow('Heart Star', rec.heart_star_id || '?');
    var isHeart = rec.heart_star_id === rec.identifier;
    chainRows += auditRow('Role', isHeart ? '\u03B1 Heart Star (first in constellation)' : 'Sibling', isHeart ? 'audit-info' : '');
  } else {
    chainRows += auditRow('Constellation', 'Not assigned', 'audit-dim');
  }
  html += auditSection('Chain Position', chainRows);

  // === CYCLE INTEGRITY ===
  var cycleRows = '';
  if (rec.decoder_age_name) cycleRows += auditRow('Age', rec.decoder_age_name + ' (' + rec.decoder_age + ')');
  if (rec.decoder_chunk_index !== undefined) {
    cycleRows += auditRow('Decoder Chunk', (rec.decoder_chunk_index + 1) + ' of ' + (rec.decoder_total_chunks || 12));
    cycleRows += auditRow('Decoder Hash', rec.decoder_hash ? rec.decoder_hash.slice(0, 12) + '...' : 'missing', rec.decoder_hash ? '' : 'audit-warn');
    cycleRows += auditRow('Decoder Version', rec.decoder_version || '?');
  }
  if (rec.proof_chunk_index !== undefined) {
    cycleRows += auditRow('Proof Chunk', (rec.proof_chunk_index + 1) + ' of ' + (rec.proof_total_chunks || 7));
    cycleRows += auditRow('Proof Day', rec.proof_day || '?');
    cycleRows += auditRow('Proof Version', rec.proof_version || '?');
  }
  if (rec.chain_visibility) cycleRows += auditRow('Visibility', rec.chain_visibility, rec.chain_visibility === 'dark_matter' ? 'audit-warn' : '');
  if (cycleRows) html += auditSection('Cycle Position', cycleRows);

  // === GENERATION ===
  var genRows = '';
  genRows += auditRow('Prompt', rec.prompt || 'encrypted/missing', rec.prompt ? '' : 'audit-dim');
  genRows += auditRow('Seed', rec.seed || '?');
  genRows += auditRow('Size', (rec.width || '?') + ' \u00d7 ' + (rec.height || '?'));
  genRows += auditRow('Model', rec.unet || '?');
  genRows += auditRow('Steps / CFG / Guidance', (rec.steps || '?') + ' / ' + (rec.cfg || '?') + ' / ' + (rec.guidance || '?'));
  html += auditSection('Generation', genRows);

  // === CELESTIAL ===
  var born = rec.born || {};
  var celRows = '';
  if (born.sun) celRows += auditRow('Sun', born.sun);
  if (born.moon) celRows += auditRow('Moon', born.moon);
  if (born.moon_phase) celRows += auditRow('Phase', born.moon_phase);
  if (born.mercury) celRows += auditRow('Mercury', born.mercury);
  if (born.venus) celRows += auditRow('Venus', born.venus);
  if (born.mars) celRows += auditRow('Mars', born.mars);
  if (born.jupiter) celRows += auditRow('Jupiter', born.jupiter);
  if (born.saturn) celRows += auditRow('Saturn', born.saturn);
  if (rec.constellation_hash) celRows += auditRow('Constellation Hash', rec.constellation_hash);
  if (celRows) html += auditSection('Celestial', celRows);

  // === MACHINE ===
  var machRows = '';
  machRows += auditRow('Fingerprint', rec.machine_fingerprint || '?');
  machRows += auditRow('Temperament', rec.birth_temperament || '?');
  if (rec.birth_traits && rec.birth_traits.length && typeof BIRTH_TRAITS !== 'undefined') {
    var traitHtml = '';
    for (var bti = 0; bti < rec.birth_traits.length; bti++) {
      var btKey = rec.birth_traits[bti], btDef = BIRTH_TRAITS[btKey];
      if (btDef) {
        traitHtml += '<div style="display:flex;align-items:center;gap:6px;margin:3px 0;">';
        traitHtml += '<img src="img/traits/' + btKey + '.png" style="width:20px;height:20px;object-fit:contain;" alt="' + btDef.name + '">';
        traitHtml += '<span style="font-size:0.68rem;color:#c0c0cc;">' + btDef.name + ' \u2014 <span style="color:#8a8a94;">' + btDef.desc + '</span></span>';
        traitHtml += '</div>';
      }
    }
    if (traitHtml) machRows += '<div class="audit-row" style="flex-direction:column;align-items:flex-start;gap:2px;"><span class="audit-label">Traits</span>' + traitHtml + '</div>';
  } else if (rec.birth_traits) {
    machRows += auditRow('Traits', rec.birth_traits.join(' \u00b7 '));
  }
  machRows += auditRow('Rarity', rec.rarity_score !== undefined ? rec.rarity_score + '' : '?');
  html += auditSection('Machine', machRows);

  // === SONG FORENSICS ===
  var songRows = '';
  // Song name
  var songName = rec.song_name || (typeof CosmicAudio !== 'undefined' ? CosmicAudio.songName(rec.content_hash || '') : null);
  if (songName) songRows += auditRow('Song Name', songName, 'audit-info');

  // Derive musical properties from the record
  var sunStr = born.sun || '';
  var sign = sunStr.split(' ')[0] || '?';
  var FIRE = {Aries:1,Leo:1,Sagittarius:1};
  var WATER = {Cancer:1,Scorpio:1,Pisces:1};
  var EARTH = {Taurus:1,Virgo:1,Capricorn:1};
  var element = FIRE[sign] ? 'Fire' : WATER[sign] ? 'Water' : EARTH[sign] ? 'Earth' : 'Air';
  var SCALE_NAMES = {Fire:'Dorian',Water:'Aeolian',Earth:'Mixolydian',Air:'Lydian'};
  var SCALE_INTERVALS = {
    Fire:  [0, 2, 3, 5, 7, 9, 10],
    Water: [0, 2, 3, 5, 7, 8, 10],
    Earth: [0, 2, 4, 5, 7, 9, 10],
    Air:   [0, 2, 4, 6, 7, 9, 11]
  };
  var NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  var SIGN_FREQ = {
    Aries:55,Taurus:61.74,Gemini:65.41,Cancer:73.42,
    Leo:82.41,Virgo:87.31,Libra:98,Scorpio:55,
    Sagittarius:61.74,Capricorn:65.41,Aquarius:73.42,Pisces:82.41
  };
  var baseFreq = SIGN_FREQ[sign] || 55;

  // Key offset from hash (same algorithm as cosmic-audio.js)
  var hash = rec.content_hash || '';
  var keyOffset = 0;
  if (hash) {
    var kSeed = 0;
    for (var ki = 0; ki < hash.length; ki++) kSeed = (kSeed * 31 + hash.charCodeAt(ki)) & 0x7FFFFFFF;
    kSeed = (kSeed * 1103515245 + 12345) & 0x7FFFFFFF;
    keyOffset = Math.floor((kSeed / 0x7FFFFFFF) * 6);
  }
  var rootFreq = baseFreq * Math.pow(2, keyOffset / 12);
  var rootNote = NOTE_NAMES[Math.round(12 * Math.log2(rootFreq / 16.3516)) % 12];
  var rootOctave = Math.floor(Math.log2(rootFreq / 16.3516));

  songRows += auditRow('Element', element);
  songRows += auditRow('Modal Scale', SCALE_NAMES[element] + ' mode');
  songRows += auditRow('Scale Intervals', SCALE_INTERVALS[element].join(' '));

  // Build note names for the scale
  var scaleNotes = SCALE_INTERVALS[element].map(function(interval) {
    return NOTE_NAMES[(Math.round(12 * Math.log2(baseFreq / 16.3516)) + interval + keyOffset) % 12];
  });
  // Clickable scale notes — each note plays a piano tone. Seven
  // diatonic notes plus an 8th: the tonic an octave up, so melodies
  // can resolve home (Twinkle-style ascents, hymn cadences) without
  // falling off the top of the range. The 8th is the first note
  // doubled — same pitch class, double frequency.
  var noteHtml = scaleNotes.map(function(note, idx) {
    var freq = baseFreq * Math.pow(2, (SCALE_INTERVALS[element][idx] + keyOffset) / 12) * 4; // speaker octave
    return '<span class="audit-note" data-scale-note data-freq="' + freq.toFixed(2) + '" onclick="playAuditNote(this)" title="' + freq.toFixed(1) + ' Hz">' + note + '</span>';
  }).join(' ');
  var tonicFreq = baseFreq * Math.pow(2, (SCALE_INTERVALS[element][0] + keyOffset) / 12) * 4;
  var octaveFreq = tonicFreq * 2;
  noteHtml += ' <span class="audit-note audit-note-octave" data-scale-note data-freq="' + octaveFreq.toFixed(2) + '" onclick="playAuditNote(this)" title="Octave up — ' + octaveFreq.toFixed(1) + ' Hz">' + scaleNotes[0] + '\u2032</span>';
  // Play all button (chord stays 7-note diatonic; the octave tonic is
  // redundant for a stacked-chord sound and would muddy the blend).
  var allFreqs = SCALE_INTERVALS[element].map(function(interval) {
    return (baseFreq * Math.pow(2, (interval + keyOffset) / 12) * 4).toFixed(2);
  }).join(',');
  songRows += '<div class="audit-row"><span class="audit-label">Scale Notes</span><span class="audit-val"><span class="audit-rec-btn" id="auditRecBtn" onclick="toggleRecord()" title="Record (keys 1-8, 9=chord)">&#9679;</span> ' + noteHtml + ' <span class="audit-note" data-freqs="' + allFreqs + '" onclick="playAuditChord(this)" title="Play chord (key 9)" style="margin-left:4px;color:#facc15;">&#9835;</span> <span class="audit-play-btn disabled" id="auditPlayBtn" onclick="togglePlayback()" title="Play / stop recording">&#9655;</span></span></div>';
  songRows += auditRow('Base Root', sign + ' \u2192 ' + baseFreq + ' Hz');
  songRows += auditRow('Key Offset', '+' + keyOffset + ' semitones');
  songRows += '<div class="audit-row"><span class="audit-label">Actual Root</span><span class="audit-val"><span class="audit-note" data-freq="' + (rootFreq*4).toFixed(2) + '" onclick="playAuditNote(this)" title="Click to hear">' + rootNote + rootOctave + ' (' + rootFreq.toFixed(1) + ' Hz)</span></span></div>';

  // Speaker vs cosmic frequencies
  var speakerRoot = rootFreq * 4;
  var speakerNote = NOTE_NAMES[Math.round(12 * Math.log2(speakerRoot / 16.3516)) % 12];
  var speakerOctave = Math.floor(Math.log2(speakerRoot / 16.3516));
  songRows += '<div class="audit-row"><span class="audit-label">Speaker Mode</span><span class="audit-val"><span class="audit-note" data-freq="' + speakerRoot.toFixed(2) + '" onclick="playAuditNote(this)" title="Click to hear">' + speakerNote + speakerOctave + ' (' + speakerRoot.toFixed(1) + ' Hz)</span></span></div>';
  songRows += '<div class="audit-row"><span class="audit-label">Cosmic Mode</span><span class="audit-val"><span class="audit-note" data-freq="' + rootFreq.toFixed(2) + '" onclick="playAuditNote(this)" title="Click to hear">' + rootNote + rootOctave + ' (' + rootFreq.toFixed(1) + ' Hz)</span> + sub ' + (rootFreq/2).toFixed(1) + ' Hz</span></div>';

  // Temperament influence on audio
  var temp = rec.birth_temperament || '';
  var tempWord = temp.match(/^A\s+(.+?)\s+birth$/i);
  var audioTemp = tempWord ? tempWord[1] : temp;
  var modDesc = 'default';
  if (/serene|clean|perfect/.test(audioTemp)) modDesc = 'minimal modulation, very quiet noise';
  else if (/turbulent|fever/.test(audioTemp)) modDesc = 'fast modulation, prominent noise';
  else if (/electric|knotted/.test(audioTemp)) modDesc = 'medium modulation, wide detune';
  else modDesc = 'moderate modulation';
  songRows += auditRow('Temperament Effect', modDesc);

  // Moon influence
  var moonPhase = born.moon_phase || '';
  var moonPct = moonPhase.match(/\((\d+\.?\d*)%\)/);
  var moonBright = moonPct ? parseFloat(moonPct[1]) / 100 : 0.5;
  songRows += auditRow('Moon Brightness', (moonBright * 100).toFixed(0) + '% \u2192 filter cutoff & dust density');

  if (songRows) html += auditSection('Song Forensics', songRows);

  // === FIELD COMPLETENESS ===
  var totalKeys = Object.keys(rec).length;
  var expected = ['identifier', 'content_hash', 'conceived', 'prompt', 'seed', 'width', 'height', 'born', 'rarity_score', 'birth_temperament', 'machine_fingerprint'];
  // parent_id is only expected on non-genesis records
  if (rec.parent_id) expected.push('parent_id');
  var missing = expected.filter(function(k) { return rec[k] === undefined || rec[k] === null; });
  var fieldRows = '';
  fieldRows += auditRow('Total Fields', totalKeys);
  fieldRows += auditRow('Expected Core', expected.length + ' fields');
  if (missing.length === 0) {
    fieldRows += auditRow('Missing', 'None \u2014 all core fields present', 'audit-pass');
  } else {
    fieldRows += auditRow('Missing', missing.join(', '), 'audit-warn');
  }
  if (rec.thumbnail) fieldRows += auditRow('Thumbnail', 'Present (' + rec.thumbnail.length + ' chars)');
  else fieldRows += auditRow('Thumbnail', 'Missing', 'audit-dim');
  if (rec.song_name) fieldRows += auditRow('Song', rec.song_name);
  html += auditSection('Field Completeness', fieldRows);

  // === LINKS ===
  var linkRows = '';
  linkRows += '<div class="audit-row"><span class="audit-label">View in Decoder</span><a href="index.html#" onclick="localStorage.setItem(\'mememage-lookup\',\'' + (rec.identifier || identifier) + '\');return true;" class="audit-val audit-info" style="text-decoration:none;">Open \u2192</a></div>';
  // Source link — whichever URL actually produced the record. For IA
  // items we swap the /download/ path for /details/ (nicer landing),
  // otherwise we link to the raw source URL so self-hosters can open
  // their own file. Falls back to the /details/ convention if _source
  // is missing (older records fetched before stamping was added).
  var rawSource = rec._source || '';
  var sourceHref;
  var sourceDisplay;
  var isLocal = /^local:/i.test(rawSource);
  var iaMatch = rawSource.match(/^(https?:\/\/[^/]*archive\.org)\/download\/([^/]+)/);
  if (isLocal) {
    // Locally-loaded record (Observatory drop or folder picker) — no
    // clickable URL. Render as plain text with "Local file" label.
    sourceHref = null;
    sourceDisplay = rawSource;
  } else if (iaMatch) {
    sourceHref = iaMatch[1] + '/details/' + iaMatch[2];
    sourceDisplay = 'archive.org/details/' + iaMatch[2];
  } else if (rawSource) {
    sourceHref = rawSource;
    try { sourceDisplay = new URL(rawSource).host + new URL(rawSource).pathname; }
    catch (e) { sourceDisplay = rawSource; }
  } else {
    sourceHref = 'https://archive.org/details/' + (rec.identifier || identifier);
    sourceDisplay = 'archive.org/details/' + (rec.identifier || identifier);
  }
  if (sourceHref) {
    linkRows += '<div class="audit-row"><span class="audit-label">Source</span><a href="' + sourceHref + '" target="_blank" rel="noopener" class="audit-val audit-info" style="text-decoration:none;word-break:break-all;">' + sourceDisplay + ' \u2192</a></div>';
  } else {
    linkRows += '<div class="audit-row"><span class="audit-label">Source</span><span class="audit-val audit-dim" style="word-break:break-all;">' + sourceDisplay + '</span></div>';
  }
  html += auditSection('Links', linkRows);

  out.innerHTML = html;
  // Success — show sidebar and restore .how to its default help text
  document.getElementById('imgResults').style.display = 'none';
  out.style.display = '';
  setHow('default');
  showResultsSidebar();
}

// === Piano note playback for audit ===
var _auditCtx = null;
function playAuditNote(el) {
  var freq = parseFloat(el.dataset.freq);
  if (!freq) return;

  // Capture into the recording buffer if we're rolling. Previously
  // only keyboard (keys 1-7) appended here; mouse clicks played sound
  // but left _recorded empty, which kept the play button disabled
  // forever. Derive noteIdx from the DOM order of scale notes in the
  // current audit result.
  if (_recording) {
    var notes = document.querySelectorAll('#certResults .audit-note[data-scale-note]');
    var idx = Array.prototype.indexOf.call(notes, el);
    if (idx >= 0) _recorded.push({ noteIdx: idx, time: performance.now() - _recStart });
  }

  if (!_auditCtx) _auditCtx = new (window.AudioContext || window.webkitAudioContext)();
  _auditCtx.resume();

  var ctx = _auditCtx;
  var now = ctx.currentTime;
  var dur = 2.5;
  var vol = 0.12;

  // Piano partials
  var partials = [
    {ratio: 1, amp: 1.0, decay: 1.0},
    {ratio: 2.0, amp: 0.3, decay: 0.6},
    {ratio: 3.0, amp: 0.1, decay: 0.3},
    {ratio: 4.0, amp: 0.05, decay: 0.15}
  ];

  for (var i = 0; i < partials.length; i++) {
    var p = partials[i];
    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq * p.ratio;
    var env = ctx.createGain();
    var pVol = vol * p.amp;
    var pDur = dur * p.decay;
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(pVol, now + 0.005);
    env.gain.linearRampToValueAtTime(pVol * 0.4, now + 0.08);
    env.gain.exponentialRampToValueAtTime(0.0001, now + pDur);
    osc.connect(env);
    env.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + pDur + 0.1);
  }

  // Hammer noise
  var nLen = Math.floor(ctx.sampleRate * 0.04);
  var nBuf = ctx.createBuffer(1, nLen, ctx.sampleRate);
  var nd = nBuf.getChannelData(0);
  for (var j = 0; j < nLen; j++) nd[j] = (Math.random() * 2 - 1) * 0.3;
  var nSrc = ctx.createBufferSource();
  nSrc.buffer = nBuf;
  var nFilt = ctx.createBiquadFilter();
  nFilt.type = 'highpass'; nFilt.frequency.value = freq * 2; nFilt.Q.value = 2;
  var nEnv = ctx.createGain();
  nEnv.gain.setValueAtTime(vol * 0.2, now);
  nEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
  nSrc.connect(nFilt); nFilt.connect(nEnv); nEnv.connect(ctx.destination);
  nSrc.start(now); nSrc.stop(now + 0.05);

  // Visual feedback
  el.classList.add('ringing');
  setTimeout(function() { el.classList.remove('ringing'); }, 1500);
}

function playAuditChord(el) {
  var freqs = el.dataset.freqs.split(',').map(parseFloat);
  if (!freqs.length) return;

  // Capture chord into recording buffer on mouse click too (not just
  // key 9). noteIdx=-1 is the sentinel for chord, same as the keydown
  // path uses.
  if (_recording) {
    _recorded.push({ noteIdx: -1, time: performance.now() - _recStart, chord: true });
  }

  if (!_auditCtx) _auditCtx = new (window.AudioContext || window.webkitAudioContext)();
  _auditCtx.resume();

  var ctx = _auditCtx;
  var now = ctx.currentTime;

  for (var i = 0; i < freqs.length; i++) {
    var freq = freqs[i];
    var when = now + i * 0.03; // slight stagger for natural piano feel
    var vol = 0.07;
    var dur = 4;

    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    var env = ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(vol, when + 0.005);
    env.gain.linearRampToValueAtTime(vol * 0.35, when + 0.08);
    env.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(env); env.connect(ctx.destination);
    osc.start(when); osc.stop(when + dur + 0.1);

    // Soft 2nd partial
    var osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 2;
    var env2 = ctx.createGain();
    env2.gain.setValueAtTime(0, when);
    env2.gain.linearRampToValueAtTime(vol * 0.2, when + 0.005);
    env2.gain.exponentialRampToValueAtTime(0.0001, when + dur * 0.5);
    osc2.connect(env2); env2.connect(ctx.destination);
    osc2.start(when); osc2.stop(when + dur * 0.5 + 0.1);
  }

  // Light up all notes
  var row = el.parentElement;
  var notes = row.querySelectorAll('.audit-note');
  for (var n = 0; n < notes.length; n++) notes[n].classList.add('ringing');
  setTimeout(function() {
    for (var n = 0; n < notes.length; n++) notes[n].classList.remove('ringing');
  }, 3000);
}

// === Recording sequencer ===
var _recording = false;
var _recorded = [];
var _recStart = 0;

function toggleRecord() {
  var btn = document.getElementById('auditRecBtn');
  var playBtn = document.getElementById('auditPlayBtn');
  if (_recording) {
    // Stop recording — enable playback if anything was captured.
    _recording = false;
    btn.classList.remove('recording');
    btn.textContent = '\u25CF';
    if (_recorded.length > 0) {
      playBtn.classList.remove('disabled');
    }
  } else {
    // Start recording — wipe prior recording; play stays visible but
    // disabled so the record/play pair is always on screen.
    _recorded = [];
    _recStart = performance.now();
    _recording = true;
    btn.classList.add('recording');
    btn.textContent = '\u25A0';
    playBtn.classList.add('disabled');
  }
}

var _playbackTimers = [];

function stopPlayback() {
  for (var i = 0; i < _playbackTimers.length; i++) clearTimeout(_playbackTimers[i]);
  _playbackTimers = [];
  var playBtn = document.getElementById('auditPlayBtn');
  if (playBtn) {
    playBtn.classList.remove('playing');
    playBtn.textContent = '\u25B7';  // ▷ play
  }
}

// Play/stop toggle — the button's onclick. While playing, click stops
// (cancels pending timers); while stopped, click plays from the start.
// The record/play pair mirrors a tape-deck affordance: one button,
// two states, same glyph flip as the record button's ● ↔ ■.
function togglePlayback() {
  var playBtn = document.getElementById('auditPlayBtn');
  if (playBtn && playBtn.classList.contains('playing')) {
    stopPlayback();
  } else {
    playbackRecording();
  }
}

function playbackRecording() {
  if (!_recorded.length) return;
  stopPlayback();

  var playBtn = document.getElementById('auditPlayBtn');
  playBtn.classList.add('playing');
  playBtn.textContent = '\u25A0';  // ■ stop

  var notes = document.querySelectorAll('#certResults .audit-note[data-scale-note]');
  var chordBtn = document.querySelector('#certResults .audit-note[data-freqs]');
  for (var i = 0; i < _recorded.length; i++) {
    (function(entry) {
      var tid = setTimeout(function() {
        if (entry.chord && chordBtn) {
          playAuditChord(chordBtn);
        } else if (entry.noteIdx >= 0 && entry.noteIdx < notes.length) {
          playAuditNote(notes[entry.noteIdx]);
        }
      }, entry.time);
      _playbackTimers.push(tid);
    })(_recorded[i]);
  }

  var lastTime = _recorded[_recorded.length - 1].time;
  // Natural end of playback: reset to idle state (removes .playing
  // class, swaps glyph back to ▷) via the same stopPlayback helper
  // the toggle uses, so the button always lands in a consistent shape.
  var endTid = setTimeout(stopPlayback, lastTime + 2000);
  _playbackTimers.push(endTid);
}

// Keyboard 1-7 plays the scale notes, 8 plays chord
document.addEventListener('keydown', function(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  // Arrow keys cycle ages in orbit inspector
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    var oi = document.getElementById('orbitInspector');
    if (oi && oi._shiftAge) { e.preventDefault(); oi._shiftAge(e.key === 'ArrowRight' ? 1 : -1); return; }
  }
  var key = parseInt(e.key);
  if (key >= 1 && key <= 9) {
    var notes = document.querySelectorAll('#certResults .audit-note[data-scale-note]');
    if (!notes.length) return;
    // Recording capture now lives inside playAuditNote / playAuditChord
    // so mouse clicks and keyboard presses share one code path.
    if (key === 9) {
      var chordBtn = document.querySelector('#certResults .audit-note[data-freqs]');
      if (chordBtn) playAuditChord(chordBtn);
    } else if (key <= notes.length) {
      playAuditNote(notes[key - 1]);
    }
  }
});

// =====================================================================
// ATTACK LAB — interactive forgery playground
//   - Activating replaces the tabs with the attack surface in-place
//     (same 323px box — no expansion).
//   - A real example.soul is loaded; the cert renders on the right.
//   - Editing any input flips WITNESSED / AUTHENTICATED / EMBODIED live.
// =====================================================================
(function(){
var link = document.getElementById('attackToggleLink');
var inputSection = document.querySelector('.input-section');
var panel = document.getElementById('tab-attack');
var resultsWrap = document.getElementById('resultsWrap');
if (!link || !panel || !resultsWrap) return;

var ATTACK_IDENTIFIER = 'mememage-22dd171b5d648ec3';
var PORTRAIT_THRESHOLD = 15;
var savedResultsHTML = null;
// True only if at least one result div had actual content when the attack
// lab opened — the bare innerHTML contains three empty stub divs
// (imgResults, certResults, metaSidebarResults) even on a fresh page, so
// we can't use innerHTML.trim() alone to decide whether to restore.
var savedHadContent = false;
var inited = false;
var original = null;   // { record, hash, sig, pub, thumbDHash }
var current = null;    // { record, sig, pub, userDHash }
var debounceTimer = null;

function hideDrop() { document.getElementById('atk-drop').style.display = 'flex'; }

async function loadOriginal() {
  var exampleUrl = (typeof assetPath === 'function')
    ? assetPath('samples/example.soul')
    : 'samples/example.soul';
  var res = await fetch(exampleUrl, { cache: 'no-store' });
  var soul = await res.json();
  // Identifier isn't stored in soul files; derive it here.
  soul.identifier = ATTACK_IDENTIFIER;

  // Build the tamperable record view (HASH_INCLUDED fields only — the
  // fields that actually move the hash). Other fields ride along as
  // passthroughs via `soul` for rendering.
  var hashable = {};
  Object.keys(soul).sort().forEach(function(k) {
    if (HASH_INCLUDED.has(k)) hashable[k] = soul[k];
  });

  // Thumbnail dHash — compute once against the record's stored portrait.
  var thumbDHash = await new Promise(function(resolve) {
    var img = new Image();
    img.onload = function() {
      var c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      resolve(dHashFromCanvas(c));
    };
    img.onerror = function() { resolve(null); };
    img.src = soul.thumbnail;
  });

  original = {
    soul: soul,
    record: hashable,
    hash: soul.content_hash,
    sig: soul.signature,
    pub: soul.public_key,
    thumbDHash: thumbDHash
  };
  current = {
    record: JSON.parse(JSON.stringify(hashable)),
    sig: original.sig,
    pub: original.pub,
    userDHash: thumbDHash   // starts matching
  };
}

function buildCertMeta(verification) {
  var m = Object.assign({}, original.soul);
  m._identifier = ATTACK_IDENTIFIER;
  m._content_hash = original.hash;
  m._verification = verification;
  return m;
}

function renderDHashGrid(el, bits, diffMask) {
  if (!el) return;
  if (!bits) { el.innerHTML = ''; return; }
  var h = '';
  for (var y = 0; y < 8; y++) {
    h += '<tr>';
    for (var x = 0; x < 8; x++) {
      var i = y * 8 + x;
      var cls = diffMask && diffMask[i] ? 'diff' : (bits[i] ? 'on' : 'off');
      h += '<td class="' + cls + '"></td>';
    }
    h += '</tr>';
  }
  el.innerHTML = h;
}

function updateDHashGrids(userBits, origBits) {
  var diffMask = null;
  if (userBits && origBits && userBits.length === origBits.length) {
    diffMask = [];
    for (var i = 0; i < userBits.length; i++) diffMask.push(userBits[i] !== origBits[i] ? 1 : 0);
  }
  renderDHashGrid(document.getElementById('atk-dhash-user'), userBits, diffMask);
  renderDHashGrid(document.getElementById('atk-dhash-orig'), origBits, diffMask);
}

function setStatus(currentHash, witnessed, authenticated, dist, embodied, jsonErr) {
  var el = document.getElementById('atk-status');
  if (!el) return;
  if (jsonErr) { el.innerHTML = '<span class="bad">Invalid JSON</span>'; return; }
  var h = 'hash <span class="' + (witnessed ? 'ok' : 'bad') + '">' + currentHash + '</span>';
  h += ' &middot; sig <span class="' + (authenticated === true ? 'neu' : authenticated === false ? 'bad' : '') + '">';
  h += authenticated === true ? 'valid' : authenticated === false ? 'forged' : 'n/a';
  h += '</span>';
  h += ' &middot; portrait <span class="' + (embodied ? 'neu' : 'bad') + '">' + (dist == null ? '\u2014' : (dist + '/64')) + '</span>';
  el.innerHTML = h;
}

function updateCertBadges(witnessed, authenticated, embodied, dist) {
  var bg = resultsWrap.querySelector('.verify-badge-group');
  if (!bg) return;
  bg.innerHTML = '';
  var w = document.createElement('div');
  w.className = 'verify-badge ' + (witnessed ? 'verify-verified' : 'verify-tampered');
  w.innerHTML = witnessed
    ? '<span class="verify-icon">\u2713</span> WITNESSED'
    : '<span class="verify-icon">\u2717</span> ALTERED';
  bg.appendChild(w);

  if (authenticated === true) {
    var a = document.createElement('div');
    a.className = 'verify-badge verify-authenticated';
    a.innerHTML = '<span class="verify-icon">\uD83D\uDD11</span> AUTHENTICATED';
    bg.appendChild(a);
  } else if (authenticated === false) {
    var a2 = document.createElement('div');
    a2.className = 'verify-badge verify-forged';
    a2.innerHTML = '<span class="verify-icon">\u2717</span> FORGED';
    bg.appendChild(a2);
  }

  if (embodied === true) {
    var e = document.createElement('div');
    e.className = 'verify-badge verify-embodied';
    e.innerHTML = '<span class="verify-icon">\u2B22</span> EMBODIED';
    e.title = 'Portrait match \u2014 dHash distance ' + dist + '/' + PORTRAIT_THRESHOLD;
    bg.appendChild(e);
  } else if (embodied === false) {
    var e2 = document.createElement('div');
    e2.className = 'verify-badge verify-disembodied';
    e2.innerHTML = '<span class="verify-icon">\u2B21</span> DISEMBODIED';
    e2.title = 'Portrait mismatch \u2014 dHash distance ' + dist;
    bg.appendChild(e2);
  }
}

async function recompute() {
  var recEl = document.getElementById('atk-record');
  var sigEl = document.getElementById('atk-sig');
  var pubEl = document.getElementById('atk-pub');
  if (!recEl || !original) return;

  var rec;
  try { rec = JSON.parse(recEl.value); }
  catch (e) { setStatus(null, false, null, null, false, true); return; }
  current.record = rec;
  current.sig = sigEl.value.trim();
  current.pub = pubEl.value.trim();

  // WITNESSED = canonical-equal to the untampered original.
  // (Stored hash on v2 soul != JS v4 recompute, so direct hash compare
  //  would always fail. Equality of the sorted record is the honest test.)
  var origJson = JSON.stringify(sortKeysDeep(original.record));
  var curJson = JSON.stringify(sortKeysDeep(rec));
  var witnessed = (origJson === curJson);

  // Display hash — the stored bar hash when untampered, a drifting
  // JS-computed hash when tampered, so the user sees the hash break.
  var displayHash = witnessed
    ? original.hash
    : (await computeContentHash(rec));

  // AUTHENTICATED — mirror production: signature is meaningless over
  // tampered content, so auto-FORGED if WITNESSED fails. Otherwise
  // verify against the stored (bar-carried) hash.
  var authenticated = null;
  if (!witnessed) {
    authenticated = false;
  } else if (/^[0-9a-f]+$/i.test(current.sig) && /^[0-9a-f]+$/i.test(current.pub)) {
    authenticated = await verifySignature(
      ATTACK_IDENTIFIER, original.hash, current.sig, current.pub
    );
  }

  var dist = (current.userDHash && original.thumbDHash)
    ? hammingDistance(current.userDHash, original.thumbDHash) : null;
  var embodied = dist != null ? (dist <= PORTRAIT_THRESHOLD) : null;

  updateCertBadges(witnessed, authenticated, embodied, dist);
  setStatus(displayHash, witnessed, authenticated, dist, embodied, false);
  updateDHashGrids(current.userDHash, original.thumbDHash);
}

function scheduleRecompute() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(recompute, 200);
}

function resetAll() {
  current = {
    record: JSON.parse(JSON.stringify(original.record)),
    sig: original.sig,
    pub: original.pub,
    userDHash: original.thumbDHash
  };
  document.getElementById('atk-record').value = JSON.stringify(original.record, null, 2);
  document.getElementById('atk-sig').value = original.sig;
  document.getElementById('atk-pub').value = original.pub;
  document.getElementById('atk-drop-label').textContent = 'drop or click to swap image';
  document.getElementById('atk-file').value = '';
  recompute();
}

function loadUserImage(file) {
  var img = new Image();
  img.onload = function() {
    var c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    current.userDHash = dHashFromCanvas(c);
    document.getElementById('atk-drop-label').textContent = file.name + ' \u2713';
    recompute();
  };
  img.src = URL.createObjectURL(file);
}

function wire() {
  document.getElementById('atk-record').addEventListener('input', scheduleRecompute);
  document.getElementById('atk-sig').addEventListener('input', scheduleRecompute);
  document.getElementById('atk-pub').addEventListener('input', scheduleRecompute);
  document.getElementById('atk-reset').addEventListener('click', resetAll);
  var drop = document.getElementById('atk-drop');
  var file = document.getElementById('atk-file');
  file.addEventListener('change', function() { if (file.files[0]) loadUserImage(file.files[0]); });
  drop.addEventListener('dragover', function(e) { e.preventDefault(); drop.style.borderColor = 'rgba(110,168,254,0.5)'; });
  drop.addEventListener('dragleave', function() { drop.style.borderColor = 'rgba(255,255,255,0.1)'; });
  drop.addEventListener('drop', function(e) {
    e.preventDefault();
    drop.style.borderColor = 'rgba(255,255,255,0.1)';
    var f = e.dataTransfer.files[0];
    if (f && f.type.startsWith('image/')) loadUserImage(f);
  });
}

async function activate() {
  link.textContent = 'hide attack lab';
  inputSection.classList.add('attack-active');
  savedResultsHTML = resultsWrap.innerHTML;
  savedHadContent = ['imgResults', 'certResults', 'metaSidebarResults'].some(function(id) {
    var el = document.getElementById(id);
    return el && el.innerHTML.trim().length > 0;
  });
  // NOTE: do NOT add panel-right-has-player — the sample cert has no
  // player, and that class triggers a 100vh plate height that leaves
  // empty purple space below the short cert content.

  if (!inited) {
    try { await loadOriginal(); } catch (err) {
      console.error('Attack Lab: failed to load example.soul', err);
      deactivate();
      return;
    }
    document.getElementById('atk-record').value = JSON.stringify(original.record, null, 2);
    document.getElementById('atk-sig').value = original.sig;
    document.getElementById('atk-pub').value = original.pub;
    wire();
    inited = true;
  }

  // Initial cert render — all three badges green.
  var verification = {
    status: 'verified',
    detail: 'Attack lab fixture.',
    signature: true,
    signatureDetail: 'Ed25519 signature valid.',
    portrait: { match: true, distance: 0, threshold: PORTRAIT_THRESHOLD }
  };
  // Sample mode: truncates the cert at Birth Temperament, hides bands,
  // GPS, save button, and music player. Consumed by renderCert.
  // Cross-fade: if resultsWrap was already showing (e.g., a prior query
  // result), outtro it before rendering the test cert; the intro runs
  // after renderCert replaces the contents.
  PanelSwap(resultsWrap, function() {
    window._sampleMode = true;
    renderCert(buildCertMeta(verification), {
      target: resultsWrap, activateLayout: false, injectPlayer: false
    });
    resultsWrap.classList.add('visible');
  });
  var dm = document.querySelector('.panel-layout');
  if (dm) dm.classList.add('layout-active');

  // Sync status line + badges with current edits (may be non-original
  // if user previously typed, then toggled off/on).
  recompute();
}

function deactivate() {
  link.textContent = 'test an attack';
  inputSection.classList.remove('attack-active');
  if (savedHadContent) {
    // Cross-fade back to prior results (image forensics / audit cert).
    var restore = savedResultsHTML;
    savedResultsHTML = null;
    savedHadContent = false;
    PanelSwap(resultsWrap, function() {
      resultsWrap.innerHTML = restore;
      resultsWrap.classList.remove('panel-right-has-player');
      resultsWrap.classList.add('visible');
    });
  } else {
    // Nothing to return to — dismiss the panel, deactivate the two-
    // panel layout, and reset the tabs to their compact default so the
    // system box no longer shows the attack-active layout.
    savedResultsHTML = null;
    savedHadContent = false;
    PanelSwap(resultsWrap, function() {
      // Clear stub divs so nothing visible remains during the fade-out.
      resultsWrap.innerHTML = '<div id="imgResults"></div><div id="certResults"></div><div id="metaSidebarResults"></div>';
      resultsWrap.classList.remove('panel-right-has-player', 'visible');
      var dm = document.querySelector('.panel-layout');
      if (dm) dm.classList.remove('layout-active');
    });
  }
}

link.addEventListener('click', function(e) {
  e.preventDefault();
  if (inputSection.classList.contains('attack-active')) deactivate();
  else activate();
});
})();

// GPS Password Unlock — AES-256-GCM decryption via Access helper.
var _gpsRecords=[];
async function unlockGPS(idx){
  var r=_gpsRecords[idx];if(!r||!r.gps_encrypted)return;
  var pw=document.getElementById('gps-pw-'+idx);if(!pw)return;
  var out=document.getElementById('gps-result-'+idx);if(!out)return;
  var res = await Access.decryptGps(r.gps_encrypted, pw.value);
  if (res.ok) {
    out.innerHTML='<div class="ev-g"><div class="ev-m"><div class="ev-ml">Latitude</div><div class="ev-mv pass">'+res.lat+'</div></div><div class="ev-m"><div class="ev-ml">Longitude</div><div class="ev-mv pass">'+res.lon+'</div></div></div>';
  } else {
    out.innerHTML='<span style="color:#f87171;font-size:0.7rem;">'+(res.error||'Wrong password')+'</span>';
  }
}

// Portal transition — flip between validator and decoder (see js/portal.js)
Portal.init({
  sourceMarker: 'validator',
  otherMarker:  'decoder',

  applyIncomingTab: function(idx) {
    var tabNames = ['img', 'cert', 'meta'];
    showTab(tabNames[idx] || 'img');
  },

  getOutgoingTab: function() {
    var idx = 0;
    var tabMap = { 'tab-img': 0, 'tab-cert': 1, 'tab-meta': 2 };
    document.querySelectorAll('.input-panel').forEach(function(t) {
      if (t.classList.contains('active') && tabMap[t.id] !== undefined) idx = tabMap[t.id];
    });
    return idx;
  },

  reset: function() {
    document.getElementById('imgResults').innerHTML = '';
    document.getElementById('certResults').innerHTML = '';
    var metaR = document.getElementById('metaResults'); if (metaR) metaR.innerHTML = '';
    var orbitEl = document.getElementById('orbitInspector'); if (orbitEl) orbitEl.innerHTML = '';
    var auditIn = document.getElementById('auditInput'); if (auditIn) auditIn.value = '';
    // Return the Image tab's drop zone to its default state — mirrors
    // decoder's resetAll() which clears the preview/console on departure.
    var imgCon = document.getElementById('imgConsole');
    if (imgCon) {
      imgCon.classList.remove('visible');
      var t = document.getElementById('imgConsoleThumb'); if (t) t.src = '';
      var idEl = document.getElementById('imgConsoleId'); if (idEl) idEl.innerHTML = '';
      var hEl = document.getElementById('imgConsoleHash'); if (hEl) hEl.textContent = '';
      var sEl = document.getElementById('imgConsoleStatus'); if (sEl) { sEl.textContent = ''; sEl.className = 'img-console-status'; }
    }
  },

  dismissResults: function(done) {
    var rw = document.getElementById('resultsWrap');
    if (!rw || !rw.classList.contains('visible')) { done(); return; }
    rw.classList.add('dismissing');
    rw.addEventListener('animationend', function() {
      rw.classList.remove('visible', 'dismissing');
      rw.innerHTML = '<div id="imgResults"></div><div id="certResults"></div>';
      var dm = document.querySelector('.panel-layout');
      if (dm && dm.classList.contains('layout-active')) {
        dm.classList.add('layout-collapsing');
        setTimeout(function() {
          dm.classList.remove('layout-active', 'layout-collapsing');
          setTimeout(done, 100);
        }, 500);
      } else {
        done();
      }
    }, { once: true });
  },
});

// Typewriter — loaded from js/typewriter.js (shared with decoder)

