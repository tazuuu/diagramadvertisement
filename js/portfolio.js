// Portfolio page: category filters + grid render.
(function () {
  var filtersEl = document.getElementById('filters');
  var gridEl = document.getElementById('portfolioGrid');
  if (!filtersEl || !gridEl) return;

  var services = [
    { slug: '3d-signage', cat: '3D Signage', sub: 'Illuminated & fabricated signage' },
    { slug: 'led-wall', cat: 'LED Wall', sub: 'Indoor & outdoor displays' },
    { slug: 'vehicle-graphics', cat: 'Vehicle Graphics', sub: 'Wraps & fleet branding' },
    { slug: 'vinyl-sticker', cat: 'Vinyl Sticker', sub: 'Cut & large-format vinyl' },
    { slug: 'uv-printing', cat: 'UV Printing', sub: 'Direct-to-surface printing' },
    { slug: 'engraving', cat: 'Engraving', sub: 'Etching & engraving' },
    { slug: 'loyalty-id-cards', cat: 'ID & Loyalty Cards', sub: 'PVC card design & print' },
    { slug: 'event-management', cat: 'Event Management', sub: 'Exhibitions & stands' },
    { slug: 'event-promotion', cat: 'Event Promotion', sub: 'Activations & promos' }
  ];

  var cats = ['All'].concat(services.map(function (s) { return s.cat; }));

  var items = [
    { img: 'assets/signage.png', title: 'Nice Times Cafeteria', sub: 'Facade signage & lighting', cat: '3D Signage' },
    { img: 'assets/gifts.png', title: 'Al Hikaya Food Stuff', sub: 'Refrigerated fleet wrap', cat: 'Vehicle Graphics' },
    { img: 'assets/ledwall.png', title: 'ColorLit 4K', sub: 'Indoor LED video wall', cat: 'LED Wall' },
    { img: 'assets/events.png', title: 'Big Deal Mart', sub: 'Retail campaign & display', cat: 'Vinyl Sticker' },
    { img: 'assets/uvprint.png', title: 'Ten Markets', sub: 'Mega Shopping promotion', cat: 'Event Promotion' },
    { img: 'assets/vehicle.png', title: 'Loyalty & VIP Cards', sub: 'PVC card design & print', cat: 'ID & Loyalty Cards' },
    { img: 'assets/engraving.png', title: 'Diagram Merch', sub: 'Branded team apparel', cat: 'UV Printing' },
    { img: 'assets/screenprint.png', title: 'Etched Metal Badges', sub: 'Engraving & etching', cat: 'Engraving' }
  ];

  // Gallery files that are the same photos as the named cards above — skipped
  // so the grid doesn't show the same work twice.
  var dupes = {
    'images/services/3d-signage/3d-signage-01.jpg': 1,
    'images/services/vehicle-graphics/vehicle-graphics-02.jpg': 1,
    'images/services/led-wall/led-wall-04.jpg': 1,
    'images/services/vinyl-sticker/vinyl-sticker-01.jpg': 1,
    'images/services/event-promotion/event-promotion-01.jpg': 1,
    'images/services/loyalty-id-cards/loyalty-id-cards-03.jpg': 1,
    'images/services/uv-printing/uv-printing-01.jpg': 1,
    'images/services/engraving/engraving-01.jpg': 1
  };

  // Interleave the PDF image sets round-robin so 'All' mixes categories.
  var sets = window.SERVICE_IMAGES || {};
  var queues = services.map(function (s) {
    return (sets[s.slug] || []).filter(function (img) {
      return !dupes[img];
    }).map(function (img) {
      return { img: img, title: s.cat, sub: s.sub, cat: s.cat };
    });
  });
  var added = true;
  while (added) {
    added = false;
    queues.forEach(function (q) {
      if (q.length) { items.push(q.shift()); added = true; }
    });
  }

  // Alternate wide/narrow cards for a varied grid rhythm. Re-run after works
  // uploaded through /admin are merged in, so the pattern stays unbroken.
  function assignRhythm() {
    items.forEach(function (w, i) {
      var wide = i % 4 === 0 || i % 4 === 3;
      w.span = wide ? 7 : 5;
      w.ratio = wide ? '16/10' : '16/12';
    });
  }

  var active = 'All';

  // Cards are built with innerHTML, and titles now arrive from /admin rather
  // than only from this file, so every interpolated value has to be escaped.
  function esc(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderFilters() {
    filtersEl.innerHTML = '';
    cats.forEach(function (c) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'filter-btn' + (c === active ? ' active' : '');
      btn.textContent = c;
      btn.setAttribute('aria-pressed', c === active ? 'true' : 'false');
      btn.addEventListener('click', function () {
        if (active === c) return;
        active = c;
        renderFilters();
        renderGrid();
      });
      filtersEl.appendChild(btn);
    });
  }

  var shown = [];

  function renderGrid() {
    shown = active === 'All' ? items : items.filter(function (x) { return x.cat === active; });
    gridEl.innerHTML = '';
    shown.forEach(function (w, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'portfolio-card';
      b.setAttribute('data-reveal', '');
      b.setAttribute('aria-label', 'View ' + w.title + ' — ' + w.sub);
      b.style.gridColumn = 'span ' + w.span;
      b.innerHTML =
        '<div class="thumb" style="aspect-ratio:' + w.ratio + ';">' +
          '<img src="' + esc(w.img) + '" alt="' + esc(w.title) + '" loading="lazy">' +
          '<div class="thumb-shade" aria-hidden="true"></div>' +
          '<div class="cat">' + esc(w.cat) + '</div>' +
          '<div class="info"><div class="t anton">' + esc(w.title) + '</div><div class="s">' + esc(w.sub) + '</div></div>' +
        '</div>';
      b.addEventListener('click', function () { openLightbox(i); });
      gridEl.appendChild(b);
    });
    observeReveal(Array.from(gridEl.querySelectorAll('[data-reveal]')));
  }

  // ---- Lightbox ----
  var lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.hidden = true;
  lb.innerHTML =
    '<button type="button" class="lb-btn lb-close" aria-label="Close">&#215;</button>' +
    '<button type="button" class="lb-btn lb-prev" aria-label="Previous image">&#8592;</button>' +
    '<figure class="lb-figure">' +
      '<img class="lb-img" alt="">' +
      '<figcaption class="lb-caption"><span class="lb-cat"></span><span class="lb-title anton"></span><span class="lb-sub"></span></figcaption>' +
    '</figure>' +
    '<button type="button" class="lb-btn lb-next" aria-label="Next image">&#8594;</button>';
  document.body.appendChild(lb);

  var lbImg = lb.querySelector('.lb-img');
  var lbIdx = 0, lastFocus = null;

  function showAt(i) {
    lbIdx = (i + shown.length) % shown.length;
    var w = shown[lbIdx];
    lbImg.src = w.img;
    lbImg.alt = w.title;
    lb.querySelector('.lb-cat').textContent = w.cat;
    lb.querySelector('.lb-title').textContent = w.title;
    lb.querySelector('.lb-sub').textContent = w.sub;
  }

  function openLightbox(i) {
    lastFocus = document.activeElement;
    showAt(i);
    lb.hidden = false;
    document.body.style.overflow = 'hidden';
    lb.querySelector('.lb-close').focus();
  }

  function closeLightbox() {
    lb.hidden = true;
    lbImg.src = '';
    document.body.style.overflow = '';
    if (lastFocus) lastFocus.focus();
  }

  lb.querySelector('.lb-close').addEventListener('click', closeLightbox);
  lb.querySelector('.lb-prev').addEventListener('click', function () { showAt(lbIdx - 1); });
  lb.querySelector('.lb-next').addEventListener('click', function () { showAt(lbIdx + 1); });
  lb.addEventListener('click', function (e) {
    if (e.target === lb || e.target.classList.contains('lb-figure')) closeLightbox();
  });
  document.addEventListener('keydown', function (e) {
    if (lb.hidden) return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowLeft') showAt(lbIdx - 1);
    else if (e.key === 'ArrowRight') showAt(lbIdx + 1);
  });

  function observeReveal(els) {
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) { entry.target.classList.add('is-visible'); io.unobserve(entry.target); }
        });
      }, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' });
      els.forEach(function (el) { io.observe(el); });
    } else {
      els.forEach(function (el) { el.classList.add('is-visible'); });
    }
  }

  // Works added through /admin live in data/works.json. Newest first, so they
  // go in front of the hand-authored list. The fetch is awaited before the
  // first render — the file is tiny and same-origin, and rendering twice would
  // shift the grid under the reader on every visit.
  var known = {};
  services.forEach(function (s) { known[s.cat] = 1; });

  function isUsable(w) {
    return w && typeof w.img === 'string' &&
      // Anything outside the upload folder means a tampered or hand-edited
      // file; refuse it rather than letting an arbitrary URL into src.
      w.img.indexOf('images/uploads/') === 0 &&
      w.title && w.sub && known[w.cat] === 1;
  }

  function start() {
    assignRhythm();
    renderFilters();
    renderGrid();
  }

  fetch('data/works.json', { cache: 'no-cache' })
    .then(function (res) { return res.ok ? res.json() : []; })
    .then(function (uploaded) {
      if (Array.isArray(uploaded)) {
        items.unshift.apply(items, uploaded.filter(isUsable));
      }
    })
    .catch(function () { /* No uploads file yet, or offline — show the built-in works. */ })
    .then(start);
})();
