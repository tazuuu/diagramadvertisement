// POST /api/upload — adds one portfolio work to the repo.
//
// There is no database behind this site, so a new work is published by writing
// it back into the repo that builds the site: the image lands in
// images/uploads/, an entry is appended to data/works.json, and Vercel's
// existing GitHub integration redeploys on the resulting push.
//
// Required environment variables (set in the Vercel project, never in code):
//   ADMIN_PASSWORD  long random string; the only thing gating this endpoint
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

// Must stay in sync with the `services` list in js/portfolio.js — a category
// the grid has no filter for would upload fine and then be unreachable.
const CATEGORIES = [
  '3D Signage', 'LED Wall', 'Vehicle Graphics', 'Vinyl Sticker', 'UV Printing',
  'Engraving', 'ID & Loyalty Cards', 'Event Management', 'Event Promotion'
];

// Sniff the real format instead of trusting the filename, so a renamed file
// cannot be committed into the repo under an image extension.
function imageExtension(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.toString('hex', 0, 8) === '89504e470d0a1a0a') return 'png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

// Hash first so the comparison is constant-time regardless of length —
// timingSafeEqual throws on a length mismatch, which would itself leak.
function secretMatches(given, expected) {
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'work';
}

function githubRequest(path, token, options) {
  return fetch('https://api.github.com/repos/' + path, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'diagram-admin-upload',
      'Content-Type': 'application/json'
    }
  });
}

async function putFile(repo, token, branch, path, contentBase64, message, sha) {
  const body = { message, content: contentBase64, branch };
  if (sha) body.sha = sha;
  const res = await githubRequest(repo + '/contents/' + path, token, {
    method: 'PUT',
    body: JSON.stringify(body)
  });
  return res;
}

async function readWorks(repo, token, branch) {
  const res = await githubRequest(
    repo + '/contents/' + WORKS_PATH + '?ref=' + encodeURIComponent(branch), token, { method: 'GET' }
  );
  // A missing file is a valid starting state, not an error.
  if (res.status === 404) return { items: [], sha: null };
  if (!res.ok) throw new Error('Could not read ' + WORKS_PATH + ' (' + res.status + ')');

  const data = await res.json();
  const parsed = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
  return { items: Array.isArray(parsed) ? parsed : [], sha: data.sha };
}

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

  const repo = process.env.GITHUB_REPO || DEFAULT_REPO;
  const branch = process.env.GITHUB_BRANCH || DEFAULT_BRANCH;
  const body = req.body || {};

  if (!secretMatches(body.password, password)) {
    return res.status(401).json({ error: 'Wrong password.' });
  }

  const title = String(body.title || '').trim();
  const sub = String(body.sub || '').trim();
  const cat = String(body.cat || '').trim();

  if (!title || title.length > MAX_TITLE) {
    return res.status(400).json({ error: 'Title is required, up to ' + MAX_TITLE + ' characters.' });
  }
  if (!sub || sub.length > MAX_SUB) {
    return res.status(400).json({ error: 'Description is required, up to ' + MAX_SUB + ' characters.' });
  }
  if (CATEGORIES.indexOf(cat) === -1) {
    return res.status(400).json({ error: 'Unknown category.' });
  }

  let image;
  try {
    image = Buffer.from(String(body.image || ''), 'base64');
  } catch {
    return res.status(400).json({ error: 'Image could not be decoded.' });
  }
  if (!image.length) return res.status(400).json({ error: 'An image is required.' });
  if (image.length > MAX_IMAGE_BYTES) {
    return res.status(413).json({ error: 'Image is too large after resizing. Try a smaller file.' });
  }

  const ext = imageExtension(image);
  if (!ext) return res.status(400).json({ error: 'That file is not a JPEG, PNG or WebP image.' });

  const imagePath = UPLOAD_DIR + '/' + slugify(title) + '-' + Date.now() + '.' + ext;

  try {
    const imageRes = await putFile(
      repo, token, branch, imagePath, image.toString('base64'), 'chore: upload work image ' + title
    );
    if (!imageRes.ok) {
      const detail = await imageRes.text();
      return res.status(502).json({ error: 'GitHub rejected the image (' + imageRes.status + '). ' + detail.slice(0, 200) });
    }

    const entry = { img: imagePath, title, sub, cat };

    // ponytail: two simultaneous uploads collide on works.json's sha; one retry
    // covers the accidental double-click. A real lock would need a queue, which
    // is not worth it for a single-operator tool.
    let lastStatus = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = await readWorks(repo, token, branch);
      const next = [entry].concat(current.items);
      const content = Buffer.from(JSON.stringify(next, null, 2) + '\n', 'utf8').toString('base64');

      const worksRes = await putFile(
        repo, token, branch, WORKS_PATH, content, 'feat: add work — ' + title, current.sha
      );
      if (worksRes.ok) return res.status(200).json({ ok: true, img: imagePath });

      lastStatus = worksRes.status;
      if (worksRes.status !== 409) break;
    }

    // The image committed but the index did not, so it is orphaned rather than
    // shown. Harmless, but say so plainly instead of reporting success.
    return res.status(502).json({
      error: 'The image was saved but the works list could not be updated (' + lastStatus + '). Try again.'
    });
  } catch (err) {
    return res.status(502).json({ error: 'Upload failed: ' + err.message });
  }
};

// Exposed for test-upload.js. Vercel ignores extra properties on the handler.
module.exports.__test = { imageExtension, slugify, secretMatches, CATEGORIES };

