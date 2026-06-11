// The surface — a wall of recently-conceived images. Each tile is a thumbnail
// of the actual conceived image (light/public chains only); click it to see the
// full-resolution image in a lightbox. Pure catalog: no links out, no nav. A
// conception drops off when its image culls (~7 days) or its soul is removed.
(function () {
  var grid = document.getElementById('feedGrid');
  if (!grid) return;

  // Lightbox, built once. Click anywhere (or Escape) to close.
  var box = document.createElement('div');
  box.className = 'feed-lightbox';
  var boxImg = document.createElement('img');
  boxImg.className = 'feed-lightbox-img';
  boxImg.alt = '';
  box.appendChild(boxImg);
  box.addEventListener('click', close);
  // Append to <html>, not <body>: mememage.css's `body > *` rule forces every
  // body child to position:relative, which would break the fixed full-screen
  // centering. As an html child it keeps position:fixed and centers properly.
  document.documentElement.appendChild(box);

  function open(id) {
    boxImg.removeAttribute('src');
    boxImg.src = '/api/feed/full/' + encodeURIComponent(id);
    box.classList.add('open');
  }
  function close() { box.classList.remove('open'); boxImg.removeAttribute('src'); }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

  function escAttr(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  fetch('/api/feed?limit=200')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var feed = (d && d.feed) || [];
      grid.innerHTML = feed.map(function (it) {
        var id = encodeURIComponent(it.identifier);
        return '<div class="feed-tile" data-id="' + escAttr(it.identifier) + '">' +
          '<img src="/api/feed/thumb/' + id + '" loading="lazy" alt="" ' +
          'onerror="var t=this.closest(&quot;.feed-tile&quot;); if(t)t.style.display=&quot;none&quot;">' +
          '</div>';
      }).join('');
      grid.addEventListener('click', function (e) {
        var tile = e.target.closest('.feed-tile');
        if (tile) open(tile.getAttribute('data-id'));
      });
    })
    .catch(function () { /* quiet — an empty surface is just quiet */ });
})();
