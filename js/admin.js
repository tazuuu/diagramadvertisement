// Admin upload form: shrink the image in the browser, then POST it to
// /api/upload, which does the committing.
//
// The resize is not cosmetic. Vercel rejects request bodies over 4.5MB, and
// base64 inflates a file by a third, so an unshrunk phone photo would fail —
// and every uploaded byte lives in the git repo forever.
(function () {
  var form = document.getElementById('uploadForm');
  if (!form) return;

  var fileInput = document.getElementById('f-image');
  var preview = document.getElementById('preview');
  var previewImg = preview.querySelector('img');
  var note = document.getElementById('imageNote');
  var errorEl = document.getElementById('formError');
  var okEl = document.getElementById('formOk');
  var submitBtn = document.getElementById('submitBtn');

  var MAX_WIDTH = 1600;
  var JPEG_QUALITY = 0.82;

  var resized = null; // { base64, bytes }

  function show(el, message) {
    el.textContent = message;
    el.hidden = false;
  }

  function clearMessages() {
    errorEl.hidden = true;
    okEl.hidden = true;
  }

  function readableSize(bytes) {
    return bytes < 1024 * 1024
      ? Math.round(bytes / 1024) + ' KB'
      : (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // Draw the image into a canvas at a capped width and re-encode as JPEG.
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();

      img.onload = function () {
        URL.revokeObjectURL(url);
        var scale = Math.min(1, MAX_WIDTH / img.naturalWidth);
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

        var dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
        var base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
        // base64 encodes 3 bytes as 4 characters, minus any '=' padding.
        var bytes = Math.round(base64.length * 3 / 4) - (base64.match(/=+$/) || [''])[0].length;
        resolve({ base64: base64, bytes: bytes, dataUrl: dataUrl });
      };

      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('That file could not be read as an image.'));
      };

      img.src = url;
    });
  }

  fileInput.addEventListener('change', function () {
    clearMessages();
    resized = null;
    preview.classList.remove('is-ready');

    var file = fileInput.files && fileInput.files[0];
    if (!file) return;

    note.textContent = 'Resizing…';
    shrink(file).then(function (result) {
      resized = result;
      previewImg.src = result.dataUrl;
      preview.classList.add('is-ready');
      note.textContent = readableSize(file.size) + ' → ' + readableSize(result.bytes) + ' after resizing.';
    }).catch(function (err) {
      note.textContent = 'JPEG, PNG or WebP. Large photos are fine — they get resized.';
      show(errorEl, err.message);
    });
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearMessages();

    if (!resized) {
      show(errorEl, 'Choose an image first.');
      return;
    }

    var payload = {
      password: document.getElementById('f-pass').value,
      title: document.getElementById('f-title').value.trim(),
      sub: document.getElementById('f-sub').value.trim(),
      cat: document.getElementById('f-cat').value,
      image: resized.base64
    };

    if (!payload.title || !payload.sub) {
      show(errorEl, 'Title and description are both required.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Publishing…';

    fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().catch(function () { return { error: 'Server returned an unreadable response.' }; })
        .then(function (data) { return { ok: res.ok, data: data }; });
    }).then(function (result) {
      if (!result.ok) throw new Error(result.data.error || 'Upload failed.');

      show(okEl, 'Published. The site is rebuilding — it should be live on the portfolio page in about a minute.');
      form.reset();
      resized = null;
      preview.classList.remove('is-ready');
      note.textContent = 'JPEG, PNG or WebP. Large photos are fine — they get resized.';
    }).catch(function (err) {
      show(errorEl, err.message);
    }).finally(function () {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Publish work →';
    });
  });
})();
