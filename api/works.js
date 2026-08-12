// POST /api/works — the portfolio's list, add, edit and delete endpoint.
//
// There is no database behind this site, so the works list is published by
// writing it back into the repo that builds the site: images live in
// images/uploads/, the list lives in data/works.json, and Vercel's existing
// GitHub integration redeploys on the resulting push.
//
// Every action requires the password. Reads go through here rather than
// fetching the deployed data/works.json directly, because that file is up to a
// deploy behind — editing against a stale list would silently undo changes.
//
// Required environment variables (set in the Vercel project, never in code):
//   ADMIN_PASSWORD  at least 12 characters; the only thing gating this endpoint
//   GITHUB_TOKEN    fine-grained PAT, contents:write on GITHUB_REPO alone
//   GITHUB_REPO     "owner/name"      (optional, defaults below)
//   GITHUB_BRANCH   branch to commit  (optional, defaults below)

const crypto = require('node:crypto');

const DEFAULT_REPO = 'tazuuu/website';
const DEFAULT_BRANCH = 'main';
const WORKS_PATH = 'data/works.json';
const UPLOAD_DIR = 'images/uploads';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_TITLE = 80;
const MAX_SUB = 120;
const MIN_PASSWORD = 12;

// Brute-force throttle. Attempts are counted per client IP.
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const MIN_AUTH_MS = 400;

// Must stay in sync with the `services` list in js/portfolio.js — a category
// the grid has no filter for would save fine and then be unreachable.
const CATEGORIES = [
  '3D Signage', 'LED Wall', 'Vehicle Graphics', 'Vinyl Sticker', 'UV Printing',
  'Engraving', 'ID & Loyalty Cards', 'Event Management', 'Event Promotion'
];

// ponytail: per-instance memory, so it resets on cold start and is not shared
// across concurrent Vercel instances. It stops the realistic attack — a script
// hammering one endpoint — but is not a hard guarantee. A shared counter needs
// a KV store, which means another service; revisit if this ever gets abused.
const failures = new Map();

function throttleState(ip) {
  const record = failures.get(ip);
  if (!record) return { locked: false };
  if (Date.now() > record.until) {
    failures.delete(ip);
    return { locked: false };
  }
  return {
    locked: record.count >= MAX_ATTEMPTS,
    retryMinutes: Math.ceil((record.until - Date.now()) / 60000)
  };
}

function recordFailure(ip) {
  const record = failures.get(ip) || { count: 0, until: 0 };
  record.count += 1;
  record.until = Date.now() + LOCKOUT_MS;
  failures.set(ip, record);
}

// Hash first so the comparison is constant-time regardless of length —
// timingSafeEqual throws on a length mismatch, which would itself leak.
function secretMatches(given, expected) {
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

// Sniff the real format instead of trusting the filename, so a renamed file
// cannot be committed into the repo under an image extension.
function imageExtension(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.toString('hex', 0, 8) === '89504e470d0a1a0a') return 'png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'work';
}

// Paths are built from our own slugs, but a tampered request could still send
// an id that resolves outside the upload folder. Refuse anything that isn't a
// plain file directly inside it.
function isOwnedImage(path) {
  return typeof path === 'string' &&
    path.indexOf(UPLOAD_DIR + '/') === 0 &&
    path.indexOf('..') === -1 &&
    path.slice(UPLOAD_DIR.length + 1).indexOf('/') === -1;
}

// ---- GitHub contents API ----

function githubRequest(repo, token, path, options) {
  return fetch('https://api.github.com/repos/' + repo + '/contents/' + path, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'diagram-admin',
      'Content-Type': 'application/json'
    }
  });
}

async function putFile(ctx, path, contentBase64, message, sha) {
  const body = { message, content: contentBase64, branch: ctx.branch };
  if (sha) body.sha = sha;
  return githubRequest(ctx.repo, ctx.token, path, { method: 'PUT', body: JSON.stringify(body) });
}

async function getFileSha(ctx, path) {
  const res = await githubRequest(
    ctx.repo, ctx.token, path + '?ref=' + encodeURIComponent(ctx.branch), { method: 'GET' }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Could not read ' + path + ' (' + res.status + ')');
  return (await res.json()).sha;
}

async function deleteFile(ctx, path, message) {
  const sha = await getFileSha(ctx, path);
  if (!sha) return true; // Already gone; nothing to undo.
  const res = await githubRequest(ctx.repo, ctx.token, path, {
    method: 'DELETE',
    body: JSON.stringify({ message, sha, branch: ctx.branch })
  });
  return res.ok;
}

async function readWorks(ctx) {
  const res = await githubRequest(
    ctx.repo, ctx.token, WORKS_PATH + '?ref=' + encodeURIComponent(ctx.branch), { method: 'GET' }
  );
  if (res.status === 404) return { items: [], sha: null }; // Valid starting state.
  if (!res.ok) throw new Error('Could not read ' + WORKS_PATH + ' (' + res.status + ')');

  const data = await res.json();
  const parsed = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
  return { items: Array.isArray(parsed) ? parsed : [], sha: data.sha };
}

// Read, transform, write. `mutate` receives the current list and returns the
// next one, or throws to abort.
//
// ponytail: two simultaneous edits collide on works.json's sha; retrying the
// whole read-modify-write covers the accidental double-click. A real lock would
// need a queue, which is not worth it for a single-operator tool.
async function updateWorks(ctx, mutate, message) {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await readWorks(ctx);
    const next = mutate(current.items);
    const content = Buffer.from(JSON.stringify(next, null, 2) + '\n', 'utf8').toString('base64');

    const res = await putFile(ctx, WORKS_PATH, content, message, current.sha);
    if (res.ok) return next;

    lastStatus = res.status;
    if (res.status !== 409) break;
  }
  throw new Error('Could not update the works list (' + lastStatus + ').');
}

// ---- Field validation ----

function validateFields(body) {
  const title = String(body.title || '').trim();
  const sub = String(body.sub || '').trim();
  const cat = String(body.cat || '').trim();

  if (!title || title.length > MAX_TITLE) return { error: 'Title is required, up to ' + MAX_TITLE + ' characters.' };
  if (!sub || sub.length > MAX_SUB) return { error: 'Description is required, up to ' + MAX_SUB + ' characters.' };
  if (CATEGORIES.indexOf(cat) === -1) return { error: 'Unknown category.' };
  return { title, sub, cat };
}

// Returns { buffer, ext } for a supplied image, or null when none was sent,
// or { error } when one was sent but is not usable.
function validateImage(raw) {
  if (!raw) return null;

  let buffer;
  try {
    buffer = Buffer.from(String(raw), 'base64');
  } catch {
    return { error: 'Image could not be decoded.' };
  }
  if (!buffer.length) return { error: 'Image could not be decoded.' };
  if (buffer.length > MAX_IMAGE_BYTES) return { error: 'Image is too large after resizing. Try a smaller file.' };

  const ext = imageExtension(buffer);
  if (!ext) return { error: 'That file is not a JPEG, PNG or WebP image.' };
  return { buffer, ext };
}

// ---- Actions ----

async function createWork(ctx, body) {
  const fields = validateFields(body);
  if (fields.error) return { status: 400, error: fields.error };

  const image = validateImage(body.image);
  if (!image) return { status: 400, error: 'An image is required.' };
  if (image.error) return { status: 400, error: image.error };

  const imagePath = UPLOAD_DIR + '/' + slugify(fields.title) + '-' + Date.now() + '.' + image.ext;
  const res = await putFile(ctx, imagePath, image.buffer.toString('base64'), 'chore: upload image for ' + fields.title);
  if (!res.ok) return { status: 502, error: 'GitHub rejected the image (' + res.status + ').' };

  const entry = {
    id: 'w' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'),
    img: imagePath,
    title: fields.title,
    sub: fields.sub,
    cat: fields.cat
  };

  const works = await updateWorks(ctx, function (items) {
    return [entry].concat(items);
  }, 'feat: add work — ' + fields.title);

  return { status: 200, works };
}

async function updateWork(ctx, body) {
  const fields = validateFields(body);
  if (fields.error) return { status: 400, error: fields.error };

  const id = String(body.id || '');
  const existing = (await readWorks(ctx)).items.filter(function (w) { return w.id === id; })[0];
  if (!existing) return { status: 404, error: 'That work no longer exists. Reload the list.' };

  const image = validateImage(body.image);
  if (image && image.error) return { status: 400, error: image.error };

  let imagePath = existing.img;
  if (image) {
    imagePath = UPLOAD_DIR + '/' + slugify(fields.title) + '-' + Date.now() + '.' + image.ext;
    const res = await putFile(ctx, imagePath, image.buffer.toString('base64'), 'chore: replace image for ' + fields.title);
    if (!res.ok) return { status: 502, error: 'GitHub rejected the new image (' + res.status + ').' };
  }

  const works = await updateWorks(ctx, function (items) {
    return items.map(function (w) {
      return w.id === id ? { id: id, img: imagePath, title: fields.title, sub: fields.sub, cat: fields.cat } : w;
    });
  }, 'feat: edit work — ' + fields.title);

  // Only once the list no longer points at it, so a failure here leaves an
  // unreferenced file rather than a broken card.
  if (image && isOwnedImage(existing.img)) {
    await deleteFile(ctx, existing.img, 'chore: drop replaced image for ' + fields.title);
  }

  return { status: 200, works };
}

async function deleteWork(ctx, body) {
  const id = String(body.id || '');
  const existing = (await readWorks(ctx)).items.filter(function (w) { return w.id === id; })[0];
  if (!existing) return { status: 404, error: 'That work no longer exists. Reload the list.' };

  const works = await updateWorks(ctx, function (items) {
    return items.filter(function (w) { return w.id !== id; });
  }, 'feat: remove work — ' + existing.title);

  if (isOwnedImage(existing.img)) {
    await deleteFile(ctx, existing.img, 'chore: drop image for ' + existing.title);
  }

  return { status: 200, works };
}

// ---- Handler ----

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const password = process.env.ADMIN_PASSWORD;
  const token = process.env.GITHUB_TOKEN;
  if (!password || !token) {
    return res.status(500).json({ error: 'Server is not configured. ADMIN_PASSWORD and GITHUB_TOKEN must be set.' });
  }
  if (password.length < MIN_PASSWORD) {
    return res.status(500).json({
      error: 'ADMIN_PASSWORD must be at least ' + MIN_PASSWORD + ' characters. Set a longer one in Vercel and redeploy.'
    });
  }

  const ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  const throttle = throttleState(ip);
  if (throttle.locked) {
    return res.status(429).json({ error: 'Too many wrong passwords. Try again in ' + throttle.retryMinutes + ' minutes.' });
  }

  const body = req.body || {};

  // Hold every auth response to the same floor, so a wrong password cannot be
  // told from a right one by timing, and guessing stays slow.
  const startedAt = Date.now();
  const authorised = secretMatches(body.password, password);
  await new Promise(function (resolve) { setTimeout(resolve, Math.max(0, MIN_AUTH_MS - (Date.now() - startedAt))); });

  if (!authorised) {
    recordFailure(ip);
    return res.status(401).json({ error: 'Wrong password.' });
  }
  failures.delete(ip);

  const ctx = {
    repo: process.env.GITHUB_REPO || DEFAULT_REPO,
    branch: process.env.GITHUB_BRANCH || DEFAULT_BRANCH,
    token: token
  };

  try {
    let result;
    if (body.action === 'list') result = { status: 200, works: (await readWorks(ctx)).items };
    else if (body.action === 'create') result = await createWork(ctx, body);
    else if (body.action === 'update') result = await updateWork(ctx, body);
    else if (body.action === 'delete') result = await deleteWork(ctx, body);
    else return res.status(400).json({ error: 'Unknown action.' });

    if (result.error) return res.status(result.status).json({ error: result.error });
    return res.status(result.status).json({ ok: true, works: result.works });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
};

// Exposed for test-works.js. Vercel ignores extra properties on the handler.
module.exports.__test = {
  imageExtension, slugify, secretMatches, isOwnedImage, validateFields, validateImage,
  throttleState, recordFailure, failures, CATEGORIES, MIN_PASSWORD
};
