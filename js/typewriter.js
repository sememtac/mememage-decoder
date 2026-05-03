// Typewriter idle animations for the MEMEMAGE title
// Click to trigger. Plays random animations at idle intervals.
(function() {
  var h1 = document.querySelector('.page-header h1');
  if (!h1) return;

  var TITLE = 'Mememage';
  var busy = false;
  var displayed = TITLE;

  // --- Cursor ---
  var cursor = document.createElement('span');
  cursor.style.cssText = 'display:inline-block;width:2px;height:0.8em;background:currentColor;margin-left:2px;vertical-align:baseline;opacity:0;transition:opacity 0.1s;';
  h1.appendChild(cursor);
  setInterval(function() { cursor.style.opacity = cursor.style.opacity === '0.4' ? '0' : '0.4'; }, 530);

  // --- Engine ---
  function set(s) { displayed = s; h1.textContent = s; h1.appendChild(cursor); }
  function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
  function jitter(base, range) { return base + Math.random() * (range || base * 0.5); }

  async function type(str, speed) {
    for (var i = 0; i < str.length; i++) { set(displayed + str[i]); await wait(jitter(speed || 80, 60)); }
  }

  async function erase(n, speed) {
    for (var i = 0; i < n; i++) { set(displayed.slice(0, -1)); await wait(jitter(speed || 50, 40)); }
  }

  async function clear(speed) { await erase(displayed.length, speed || 35); }

  async function retype(str, speed) { await clear(speed); await wait(jitter(350)); await type(str, speed || 90); }

  // --- Animations ---
  // Each is an async function. Add new ones here.

  var ANIMS = {

    // Erase all, retype from scratch
    retype: { weight: 1, fn: function() { return retype(TITLE); } },

    // Typo: types a fumbled version, pauses, corrects
    mistype: { weight: 3, fn: async function() {
      var typos = ['Memeage', 'Memeemage', 'Mememmage', 'Memege', 'Mememge', 'Memamage'];
      var wrong = typos[Math.floor(Math.random() * typos.length)];
      var common = 0;
      while (common < TITLE.length && common < wrong.length &&
             TITLE[common].toLowerCase() === wrong[common].toLowerCase()) common++;
      await erase(displayed.length - common, 45);
      await wait(100);
      await type(wrong.slice(common), 70);
      await wait(jitter(600, 400));
      await erase(wrong.length - common, 35);
      await wait(200);
      await type(TITLE.slice(common), 80);
    }},

    // Rapid character scramble then settle
    glitch: { weight: 1, fn: async function() {
      var pool = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%&';
      for (var r = 0; r < 6; r++) {
        var g = '';
        for (var i = 0; i < TITLE.length; i++)
          g += Math.random() < 0.4 ? pool[Math.floor(Math.random() * pool.length)] : TITLE[i];
        set(g); await wait(jitter(50, 30));
      }
      for (var j = 0; j < TITLE.length; j++) {
        set(TITLE.slice(0, j + 1) + displayed.slice(j + 1)); await wait(30);
      }
      set(TITLE);
    }},

    // Erase to "Meme", pause thoughtfully, complete
    contemplate: { weight: 3, fn: async function() {
      await erase(displayed.length - 4, 45);
      await wait(jitter(1200, 800));
      await type(TITLE.slice(4), 100);
    }},

    // M...e...(pause)...memage
    stutter: { weight: 2, fn: async function() {
      await clear();
      await wait(300);
      await type('M', 80); await wait(200);
      await type('e', 80); await wait(jitter(400, 300));
      await type('memage', 70);
    }},

    // Types "image", erases back, retypes as Mememage
    imageFix: { weight: 2, fn: async function() {
      await clear();
      await wait(300);
      await type('image', 80);
      await wait(jitter(800, 400));
      await erase(3, 40); await wait(150); // "im"
      await erase(1, 40); await wait(100); // "i"
      await erase(1, 40); await wait(200); // ""
      await type('M', 90); await wait(100);
      await type('eme', 70); await wait(300);
      await type('mage', 75);
    }},

    // Types "Meme age" with space, erases space+age, completes
    memeAge: { weight: 2, fn: async function() {
      await clear();
      await wait(300);
      await type('Meme', 80); await wait(200);
      await type(' age', 80);
      await wait(jitter(900, 400));
      await erase(4, 40); await wait(300);
      await type('mage', 75);
    }}
  };

  // --- Scheduler ---
  // Animation probability weights are themable via docs/js/theme.js
  // (Theme.typewriterWeights). The weights baked into ANIMS above are
  // the vanilla skin defaults; theme.js can override per Age.
  var keys = Object.keys(ANIMS);
  var twWeights = (typeof Theme !== 'undefined') && Theme.typewriterWeights;
  if (twWeights) {
    keys.forEach(function(k) {
      if (typeof twWeights[k] === 'number') ANIMS[k].weight = twWeights[k];
    });
  }
  var totalWeight = keys.reduce(function(s, k) { return s + ANIMS[k].weight; }, 0);

  function pick() {
    var r = Math.random() * totalWeight, s = 0;
    for (var i = 0; i < keys.length; i++) {
      s += ANIMS[keys[i]].weight;
      if (r < s) return ANIMS[keys[i]].fn;
    }
    return ANIMS[keys[0]].fn;
  }

  async function run(anim) {
    if (busy) return;
    busy = true;
    try { await anim(); } catch(e) { set(TITLE); }
    busy = false;
  }

  function schedule() {
    setTimeout(function() { run(pick()).then(schedule); }, jitter(12000, 18000));
  }

  // Click to trigger
  h1.style.cursor = 'default';
  h1.addEventListener('click', function() { run(pick()); });

  // Start idle loop
  setTimeout(schedule, jitter(5000, 5000));
})();
