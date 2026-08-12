// Home page: draggable filmstrip.
(function () {
  var el = document.getElementById('filmstrip');
  if (!el) return;
  var down = false, sx = 0, sl = 0, moved = false;

  el.addEventListener('pointerdown', function (e) {
    down = true; moved = false; sx = e.clientX; sl = el.scrollLeft;
    el.classList.add('dragging');
  });
  window.addEventListener('pointerup', function () {
    if (down) { down = false; el.classList.remove('dragging'); }
  });
  window.addEventListener('pointermove', function (e) {
    if (!down) return;
    var dx = e.clientX - sx;
    if (Math.abs(dx) > 4) moved = true;
    el.scrollLeft = sl - dx;
  });
  // Prevent link click firing right after a drag.
  el.addEventListener('click', function (e) {
    if (moved) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // Arrow buttons for mouse users: scroll one card at a time.
  var prev = document.getElementById('stripPrev');
  var next = document.getElementById('stripNext');
  if (prev && next) {
    function step() {
      var card = el.querySelector('.filmstrip-card');
      return card ? card.getBoundingClientRect().width + 20 : 300;
    }
    function updateArrows() {
      prev.disabled = el.scrollLeft <= 2;
      next.disabled = el.scrollLeft >= el.scrollWidth - el.clientWidth - 2;
    }
    // Jump to exact card offsets so the scroll-snap doesn't pull the strip back.
    function go(dir) {
      var s = step();
      var target = (Math.round(el.scrollLeft / s) + dir) * s;
      el.scrollTo({ left: Math.max(0, Math.min(target, el.scrollWidth - el.clientWidth)), behavior: 'smooth' });
    }
    prev.addEventListener('click', function () { go(-1); });
    next.addEventListener('click', function () { go(1); });
    el.addEventListener('scroll', updateArrows, { passive: true });
    window.addEventListener('resize', updateArrows);
    updateArrows();
  }
})();

// Clients marquee: duplicate the logo row so the scroll loops seamlessly.
// Done in JS rather than the markup so index.html keeps one authoritative copy
// of the client list — a hand-duplicated set drifts the moment a client is
// added. The clone is aria-hidden and inert, so assistive tech and keyboard
// users meet each client exactly once.
(function () {
  var group = document.getElementById('clientsGroup');
  if (!group) return;

  var clone = group.cloneNode(true);
  clone.removeAttribute('id');
  clone.setAttribute('aria-hidden', 'true');
  clone.querySelectorAll('img').forEach(function (img) { img.alt = ''; });
  group.parentNode.appendChild(clone);
})();

// Auto-rotate filmstrip card images, staggered per card, paused on hover.
(function () {
  var sets = window.SERVICE_IMAGES;
  if (!sets) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var INTERVAL = 3500, STAGGER = 700;

  document.querySelectorAll('.filmstrip-card[data-service]').forEach(function (card, idx) {
    var imgs = sets[card.getAttribute('data-service')];
    if (!imgs || imgs.length < 2) return;
    var thumb = card.querySelector('.thumb');
    var base = thumb.querySelector('img');
    var overlay = document.createElement('img');
    overlay.className = 'rot-img';
    overlay.alt = '';
    overlay.setAttribute('aria-hidden', 'true');
    base.insertAdjacentElement('afterend', overlay);

    var i = 0, timer = null, hovered = false;

    function advance() {
      if (hovered) return;
      i = (i + 1) % imgs.length;
      var next = new Image();
      next.onload = function () {
        overlay.src = next.src;
        overlay.classList.add('show');
        setTimeout(function () {
          base.src = next.src;
          overlay.classList.remove('show');
        }, 950);
      };
      next.src = imgs[i];
    }

    card.addEventListener('mouseenter', function () { hovered = true; });
    card.addEventListener('mouseleave', function () { hovered = false; });

    setTimeout(function () {
      advance();
      timer = setInterval(advance, INTERVAL);
    }, INTERVAL + idx * STAGGER);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { clearInterval(timer); timer = null; }
      else if (!timer) { timer = setInterval(advance, INTERVAL); }
    });
  });
})();
