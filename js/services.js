// Services page: interactive index + sticky preview panel.
(function () {
  var list = document.getElementById('svcList');
  if (!list) return;

  var data = [
    { title: 'LED Walls', slug: 'led-wall', img: 'assets/ledwall.png', desc: 'High-resolution indoor and outdoor LED screens for advertising, events, retail and corporate spaces. Vibrant colour, excellent brightness and long-lasting performance — supplied, installed and warrantied.' },
    { title: '3D Signage', slug: '3d-signage', img: 'assets/signage.png', desc: 'Illuminated and fabricated indoor and outdoor signage built to communicate and persuade. Signs that guide, inform and sell — engineered to last in the Gulf climate.' },
    { title: 'Vinyl Sticker', slug: 'vinyl-sticker', img: 'assets/events.png', desc: 'Frosted glass, one-way vision, banners, roll-ups, duratrans and vehicle graphics. Precision-cut and large-format printed vinyl for every surface.' },
    { title: 'Event Management', slug: 'event-management', img: 'assets/cards.png', desc: 'Exhibitions, trade fairs and brand activations — from stand design and build to on-site production. Organised presentation that makes your brand the thing people remember.' },
    { title: 'ID & Loyalty Cards', slug: 'loyalty-id-cards', img: 'assets/vehicle.png', desc: 'High-quality PVC ID and loyalty cards with barcode, QR, magnetic strip, smart chip and variable data printing. Durable, waterproof and professionally finished.' },
    { title: 'Vehicle Branding', slug: 'vehicle-graphics', img: 'assets/gifts.png', desc: 'The true definition of mobile advertising. Full and partial wraps and fleet graphics for cars, SUVs, trucks and buses — designed and printed to spec.' },
    { title: 'UV Printing', slug: 'uv-printing', img: 'assets/uvprint.png', desc: 'Advanced UV digital printing on acrylic, PVC, wood, glass, metal and more — mugs, t-shirts, caps, pens and bags. Instant-cure, scratch-resistant, sharp detail.' },
    { title: 'Engraving', slug: 'engraving', img: 'assets/screenprint.png', desc: 'Etching and engraving on hard surfaces — incised designs for signage, awards, gifts and commercial reproduction with a premium, permanent finish.' },
    { title: 'Event Promotion', slug: 'event-promotion', img: 'assets/events.png', desc: 'Product launches, mall activations and promotional campaigns — staffed, staged and supplied with everything from displays to giveaways.' },
    { title: 'Promotional Gifts', img: 'assets/engraving.png', desc: 'Branded corporate merchandise and giveaways that carry your logo into the world — sourced, printed and delivered for launches, events and campaigns.' },
    { title: 'Branding', img: 'assets/signage.png', desc: 'We are passionate about developing and building brands — identity, strategy and the creative system that makes everything else consistent.' },
    { title: 'Media Service', img: 'assets/ledwall.png', desc: 'Media planning and buying backed by in-house market research, so every dirham of budget works as hard as possible across the right channels.' },
    { title: 'T-Shirt Printing', img: 'assets/engraving.png', desc: 'Custom apparel and team uniforms — DTG, vinyl and print for staff kit, events and merchandise runs of any size.' },
    { title: 'Screen Printing', img: 'assets/engraving.png', desc: 'Classic screen printing for bold, durable results on textiles, packaging and promotional items at volume.' },
    { title: 'Offset Printing', img: 'assets/events.png', desc: 'Sharp, colour-accurate offset printing for brochures, stationery, packaging and marketing collateral at commercial scale.' }
  ];

  // Use the image sets extracted from the service PDFs where available.
  var sets = window.SERVICE_IMAGES || {};
  data.forEach(function (s) {
    s.imgs = (s.slug && sets[s.slug] && sets[s.slug].length) ? sets[s.slug] : [s.img];
  });

  var svcImg = document.getElementById('svcImg');
  var svcTitle = document.getElementById('svcTitle');
  var svcDesc = document.getElementById('svcDesc');
  var svcLayout = document.getElementById('svcLayout');
  var svcPanel = document.getElementById('svcPanel');
  var rows = [];
  var active = 0;

  // On mobile the panel sits inline under the selected row (accordion style),
  // so the image is always visible next to the tap. On desktop it stays in
  // the sticky right column.
  var mobileMQ = window.matchMedia('(max-width: 860px)');
  function placePanel() {
    if (mobileMQ.matches && rows[active]) {
      rows[active].insertAdjacentElement('afterend', svcPanel);
    } else if (svcPanel.parentElement !== svcLayout) {
      svcLayout.appendChild(svcPanel);
    }
  }
  if (mobileMQ.addEventListener) mobileMQ.addEventListener('change', placePanel);

  data.forEach(function (s, i) {
    var row = document.createElement('div');
    row.className = 'svc-row' + (i === 0 ? ' active' : '');
    row.setAttribute('data-reveal', '');
    row.setAttribute('tabindex', '0');
    row.setAttribute('role', 'button');
    row.innerHTML =
      '<span class="num anton">' + String(i + 1).padStart(2, '0') + '</span>' +
      '<span class="title anton">' + s.title + '</span>' +
      '<span class="arrow" aria-hidden="true">&#8594;</span>';
    var activate = function () { setActive(i); };
    row.addEventListener('mouseenter', activate);
    row.addEventListener('click', activate);
    row.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
    });
    list.appendChild(row);
    rows.push(row);
  });

  var ROTATE_MS = 3000;
  var rotTimer = null, imgIdx = 0;
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function fadeTo(src) {
    svcImg.style.opacity = '0';
    setTimeout(function () {
      svcImg.src = src;
      requestAnimationFrame(function () { svcImg.style.opacity = '1'; });
    }, 460);
  }

  function startRotation() {
    if (rotTimer) { clearInterval(rotTimer); rotTimer = null; }
    var imgs = data[active].imgs;
    if (reducedMotion || imgs.length < 2) return;
    rotTimer = setInterval(function () {
      if (document.hidden) return;
      imgIdx = (imgIdx + 1) % imgs.length;
      fadeTo(imgs[imgIdx]);
    }, ROTATE_MS);
  }

  function setActive(i) {
    if (i === active) return;
    active = i;
    imgIdx = 0;
    rows.forEach(function (r, idx) { r.classList.toggle('active', idx === i); });
    placePanel();
    svcImg.style.opacity = '0';
    requestAnimationFrame(function () {
      svcImg.src = data[i].imgs[0];
      svcImg.alt = data[i].title;
      svcTitle.textContent = data[i].title;
      svcDesc.textContent = data[i].desc;
      requestAnimationFrame(function () { svcImg.style.opacity = '1'; });
    });
    startRotation();
  }

  // First service starts rotating on load.
  svcImg.src = data[0].imgs[0];
  svcImg.alt = data[0].title;
  placePanel();
  startRotation();

  // Re-run reveal observer for rows injected after main.js already ran.
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add('is-visible'); io.unobserve(entry.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    rows.forEach(function (r) { io.observe(r); });
  } else {
    rows.forEach(function (r) { r.classList.add('is-visible'); });
  }
})();
