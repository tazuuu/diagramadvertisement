// Admin console: list, add, edit and delete portfolio works.
//
// Every call goes to /api/works, which does the committing. The image is shrunk
// here first — that is not cosmetic: Vercel rejects request bodies over 4.5MB,
// base64 inflates a file by a third, and every uploaded byte lives in the git
// repo forever.
//
// Videos take the opposite route. They are far too big for either limit, so the
// server hands back a presigned URL and the file goes browser-to-Cloudflare
// without touching Vercel. Only the resulting URL is committed.
(function () {
  var unlockForm = document.getElementById('unlockForm');
  if (!unlockForm) return;

  var passInput = document.getElementById('f-pass');
  var unlockError = document.getElementById('unlockError');
  var unlockBtn = document.getElementById('unlockBtn');
  var consoleEl = document.getElementById('console');

  var workForm = document.getElementById('workForm');
  var idInput = document.getElementById('f-id');
  var fileInput = document.getElementById('f-image');
  var titleInput = document.getElementById('f-title');
  var subInput = document.getElementById('f-sub');
  var catInput = document.getElementById('f-cat');
  var preview = document.getElementById('preview');
  var previewImg = preview.querySelector('img');
  var note = document.getElementById('imageNote');
  var errorEl = document.getElementById('formError');
  var okEl = document.getElementById('formOk');
  var submitBtn = document.getElementById('submitBtn');
  var cancelBtn = document.getElementById('cancelEdit');
  var heading = document.getElementById('formHeading');
  var listEl = document.getElementById('workList');
  var videoField = document.getElementById('videoField');
  var videoInput = document.getElementById('f-video');
  var videoNote = document.getElementById('videoNote');
  var videoProgress = document.getElementById('videoProgress');
  var videoBar = videoProgress.querySelector('span');
  var videoCurrent = document.getElementById('videoCurrent');
  var removeVideoBtn = document.getElementById('removeVideo');

  var MAX_WIDTH = 1600;
  var JPEG_QUALITY = 0.82;
  var DEFAULT_NOTE = 'JPEG, PNG or WebP. Large photos are fine — they get resized.';
  var EDIT_NOTE = 'Optional — leave empty to keep the current image.';
  var VIDEO_NOTE = 'MP4 or WebM, up to 200MB. The image above stays the card thumbnail.';
  var MAX_VIDEO_BYTES = 200 * 1024 * 1024;

  // Held in memory only, for the life of the tab. Never written to storage.
  var password = null;
  var resized = null;
  var videoEnabled = false;
  var clearVideo = false;   // Set when editing and the operator drops the video.

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

  function call(payload) {
    return fetch('/api/works', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ password: password }, payload))
    }).then(function (res) {
      return res.json()
        .catch(function () { return { error: 'Server returned an unreadable response.' }; })
        .then(function (data) {
          if (!res.ok) throw new Error(data.error || 'Request failed.');
          return data;
        });
    });
  }

  // ---- Video upload ----

  // XHR rather than fetch purely for the progress events. A 150MB upload over a
  // phone connection is minutes long, and a silent button invites a second
  // click that would upload the whole thing again.
  function putToR2(url, file) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('PUT', url, true);
      xhr.setRequestHeader('Content-Type', file.type);

      xhr.upload.onprogress = function (e) {
        if (!e.lengthComputable) return;
        videoBar.style.width = Math.round((e.loaded / e.total) * 100) + '%';
      };
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error('The video upload was rejected (' + xhr.status + ').'));
      };
      xhr.onerror = function () {
        // A browser cannot see why a cross-origin request failed, and the
        // overwhelmingly likely reason is a bucket without a CORS rule.
        reject(new Error('Could not reach the video host. Check the bucket CORS rule in Cloudflare.'));
      };
      xhr.send(file);
    });
  }

  // Resolves to the public URL of the uploaded video.
  function uploadVideo(file, title) {
    videoProgress.classList.add('is-active');
    videoBar.style.width = '0%';
    videoNote.textContent = 'Uploading video…';

    return call({ action: 'sign-video', contentType: file.type, title: title })
      .then(function (data) {
        return putToR2(data.upload.url, file).then(function () { return data.upload.publicUrl; });
      })
      .finally(function () {
        videoProgress.classList.remove('is-active');
        videoNote.textContent = VIDEO_NOTE;
      });
  }

  videoInput.addEventListener('change', function () {
    clearMessages();
    var file = videoInput.files && videoInput.files[0];
    if (!file) { videoNote.textContent = VIDEO_NOTE; return; }

    if (file.size > MAX_VIDEO_BYTES) {
      videoInput.value = '';
      videoNote.textContent = VIDEO_NOTE;
      show(errorEl, 'That video is ' + readableSize(file.size) + '. The limit is 200MB — compress it first.');
      return;
    }
    clearVideo = false;
    videoNote.textContent = readableSize(file.size) + ' — uploads when you publish.';
  });

  removeVideoBtn.addEventListener('click', function () {
    clearVideo = true;
    videoInput.value = '';
    videoCurrent.hidden = true;
    videoNote.textContent = 'Video will be removed when you save.';
  });

  // ---- Image resize ----

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
    if (!file) {
      note.textContent = idInput.value ? EDIT_NOTE : DEFAULT_NOTE;
      return;
    }

    note.textContent = 'Resizing…';
    shrink(file).then(function (result) {
      resized = result;
      previewImg.src = result.dataUrl;
      preview.classList.add('is-ready');
      note.textContent = readableSize(file.size) + ' → ' + readableSize(result.bytes) + ' after resizing.';
    }).catch(function (err) {
      note.textContent = idInput.value ? EDIT_NOTE : DEFAULT_NOTE;
      show(errorEl, err.message);
    });
  });

  // ---- Form modes ----

  function toCreateMode() {
    idInput.value = '';
    workForm.reset();
    resized = null;
    preview.classList.remove('is-ready');
    note.textContent = DEFAULT_NOTE;
    videoInput.value = '';
    videoNote.textContent = VIDEO_NOTE;
    videoCurrent.hidden = true;
    clearVideo = false;
    heading.textContent = 'Add a work';
    submitBtn.textContent = 'Publish work →';
    cancelBtn.hidden = true;
  }

  function toEditMode(work) {
    idInput.value = work.id;
    titleInput.value = work.title;
    subInput.value = work.sub;
    catInput.value = work.cat;
    fileInput.value = '';
    resized = null;
    previewImg.src = work.img;
    preview.classList.add('is-ready');
    note.textContent = EDIT_NOTE;
    videoInput.value = '';
    videoNote.textContent = VIDEO_NOTE;
    videoCurrent.hidden = !work.video;
    clearVideo = false;
    heading.textContent = 'Edit work';
    submitBtn.textContent = 'Save changes →';
    cancelBtn.hidden = false;
    clearMessages();
    heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  cancelBtn.addEventListener('click', function () {
    clearMessages();
    toCreateMode();
  });

  // ---- Work list ----

  function renderList(works) {
    listEl.textContent = '';

    if (!works.length) {
      var empty = document.createElement('div');
      empty.className = 'work-empty';
      empty.textContent = 'No uploaded works yet. The eight built-in ones live in js/portfolio.js.';
      listEl.appendChild(empty);
      return;
    }

    works.forEach(function (work) {
      var row = document.createElement('div');
      row.className = 'work-row';

      // Built with DOM calls rather than innerHTML, so a title can never be
      // markup here either.
      var thumb = document.createElement('img');
      thumb.src = work.img;
      thumb.alt = '';
      thumb.loading = 'lazy';

      var meta = document.createElement('div');
      meta.className = 'meta';
      [['t', work.title], ['s', work.sub], ['c', work.cat]].forEach(function (pair) {
        var line = document.createElement('div');
        line.className = pair[0];
        line.textContent = pair[1];
        meta.appendChild(line);
      });

      if (work.video) {
        var badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = 'VIDEO';
        meta.querySelector('.t').appendChild(badge);
      }

      var edit = document.createElement('button');
      edit.type = 'button';
      edit.textContent = 'Edit';
      edit.addEventListener('click', function () { toEditMode(work); });

      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'danger';
      remove.textContent = 'Delete';
      remove.addEventListener('click', function () { deleteWork(work, remove); });

      row.appendChild(thumb);
      row.appendChild(meta);
      row.appendChild(edit);
      row.appendChild(remove);
      listEl.appendChild(row);
    });
  }

  function deleteWork(work, button) {
    if (!window.confirm('Delete “' + work.title + '”? This also removes its image from the repo.')) return;

    clearMessages();
    button.disabled = true;
    button.textContent = 'Deleting…';

    call({ action: 'delete', id: work.id }).then(function (data) {
      renderList(data.works);
      show(okEl, 'Deleted. The site is rebuilding — it will be gone from the portfolio in about a minute.');
      if (idInput.value === work.id) toCreateMode();
    }).catch(function (err) {
      show(errorEl, err.message);
      button.disabled = false;
      button.textContent = 'Delete';
    });
  }

  // ---- Unlock ----

  unlockForm.addEventListener('submit', function (e) {
    e.preventDefault();
    unlockError.hidden = true;
    unlockBtn.disabled = true;
    unlockBtn.textContent = 'Checking…';

    password = passInput.value;

    call({ action: 'list' }).then(function (data) {
      unlockForm.hidden = true;
      consoleEl.hidden = false;
      // Hidden rather than broken when R2 is not configured, so the console
      // stays usable for image-only works.
      videoEnabled = !!data.video;
      videoField.hidden = !videoEnabled;
      renderList(data.works);
    }).catch(function (err) {
      password = null;
      show(unlockError, err.message);
    }).finally(function () {
      unlockBtn.disabled = false;
      unlockBtn.textContent = 'Unlock';
    });
  });

  // ---- Create / update ----

  workForm.addEventListener('submit', function (e) {
    e.preventDefault();
    clearMessages();

    var editing = !!idInput.value;
    if (!editing && !resized) {
      show(errorEl, 'Choose an image first.');
      return;
    }

    var title = titleInput.value.trim();
    var sub = subInput.value.trim();
    if (!title || !sub) {
      show(errorEl, 'Title and description are both required.');
      return;
    }

    var payload = {
      action: editing ? 'update' : 'create',
      id: idInput.value,
      title: title,
      sub: sub,
      cat: catInput.value
    };
    if (resized) payload.image = resized.base64;

    var videoFile = videoEnabled && videoInput.files && videoInput.files[0];
    if (editing && clearVideo && !videoFile) payload.video = 'remove';

    submitBtn.disabled = true;
    submitBtn.textContent = videoFile ? 'Uploading…' : (editing ? 'Saving…' : 'Publishing…');

    // The video goes up first. If it fails the work is never created, which is
    // the right way round — the alternative is a published card pointing at a
    // video that is not there.
    var ready = videoFile
      ? uploadVideo(videoFile, title).then(function (url) { payload.video = url; })
      : Promise.resolve();

    ready.then(function () {
      submitBtn.textContent = editing ? 'Saving…' : 'Publishing…';
      return call(payload);
    }).then(function (data) {
      renderList(data.works);
      toCreateMode();
      show(okEl, editing
        ? 'Saved. The site is rebuilding — the change goes live in about a minute.'
        : 'Published. The site is rebuilding — it should be live on the portfolio page in about a minute.');
    }).catch(function (err) {
      show(errorEl, err.message);
    }).finally(function () {
      submitBtn.disabled = false;
      submitBtn.textContent = idInput.value ? 'Save changes →' : 'Publish work →';
    });
  });
})();
