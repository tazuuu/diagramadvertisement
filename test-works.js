// Run with: node test-works.js
//
// Covers the parts of /api/works that decide whether something dangerous gets
// committed into the repo or deleted from it, the brute-force throttle, and the
// escaping that stops an uploaded title from becoming script on the portfolio.

const assert = require('node:assert');
const fs = require('node:fs');
const t = require('./api/works.js').__test;

// --- format sniffing: the filename is never trusted ---
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(8)]);
const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(8)]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);

assert.strictEqual(t.imageExtension(jpeg), 'jpg');
assert.strictEqual(t.imageExtension(png), 'png');
assert.strictEqual(t.imageExtension(webp), 'webp');

// A renamed text file, an executable, and a truncated header must all be refused.
assert.strictEqual(t.imageExtension(Buffer.from('hello world, not an image')), null);
assert.strictEqual(t.imageExtension(Buffer.concat([Buffer.from('MZ'), Buffer.alloc(20)])), null);
assert.strictEqual(t.imageExtension(Buffer.from([0xff, 0xd8])), null);
// RIFF alone is not enough — a .wav starts the same way.
assert.strictEqual(t.imageExtension(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')])), null);

// --- slugs stay filesystem- and URL-safe ---
assert.strictEqual(t.slugify('Nice Times Cafeteria'), 'nice-times-cafeteria');
assert.strictEqual(t.slugify('  Al Hikaya / Food Stuff!  '), 'al-hikaya-food-stuff');
assert.strictEqual(t.slugify('../../etc/passwd'), 'etc-passwd');
assert.strictEqual(t.slugify('%%%'), 'work');
assert.ok(t.slugify('x'.repeat(200)).length <= 40);

// --- delete only ever touches our own upload folder ---
assert.strictEqual(t.isOwnedImage('images/uploads/a-123.jpg'), true);
assert.strictEqual(t.isOwnedImage('assets/hero-liquid.jpg'), false);
assert.strictEqual(t.isOwnedImage('images/uploads/../../.github/workflows/deploy.yml'), false);
assert.strictEqual(t.isOwnedImage('images/uploads/nested/a.jpg'), false);
assert.strictEqual(t.isOwnedImage('.env'), false);
assert.strictEqual(t.isOwnedImage(undefined), false);

// --- password comparison ---
assert.strictEqual(t.secretMatches('a-long-enough-pass', 'a-long-enough-pass'), true);
assert.strictEqual(t.secretMatches('a-long-enough-pass', 'a-long-enough-pasr'), false);
// Different lengths must return false, not throw.
assert.strictEqual(t.secretMatches('short', 'a-much-longer-password'), false);
assert.strictEqual(t.secretMatches(undefined, 'a-long-enough-pass'), false);

// --- brute-force throttle ---
t.failures.clear();
assert.strictEqual(t.throttleState('1.2.3.4').locked, false);
for (let i = 0; i < 5; i++) t.recordFailure('1.2.3.4');
assert.strictEqual(t.throttleState('1.2.3.4').locked, true, 'five wrong guesses must lock the address out');
// One address locking out must not affect another.
assert.strictEqual(t.throttleState('5.6.7.8').locked, false);
// The lockout has to expire on its own.
t.failures.set('1.2.3.4', { count: 9, until: Date.now() - 1 });
assert.strictEqual(t.throttleState('1.2.3.4').locked, false);
t.failures.clear();

// --- field validation ---
const good = { title: 'Nice Times', sub: 'Facade signage', cat: '3D Signage' };
assert.strictEqual(t.validateFields(good).error, undefined);
assert.ok(t.validateFields({ ...good, title: '' }).error, 'empty title must be rejected');
assert.ok(t.validateFields({ ...good, sub: '   ' }).error, 'whitespace-only description must be rejected');
assert.ok(t.validateFields({ ...good, title: 'x'.repeat(81) }).error, 'over-long title must be rejected');
assert.ok(t.validateFields({ ...good, cat: 'Dropping Tables' }).error, 'unknown category must be rejected');

// --- image validation ---
assert.strictEqual(t.validateImage(undefined), null, 'no image is a valid state for an edit');
assert.strictEqual(t.validateImage(''), null);
assert.strictEqual(t.validateImage(jpeg.toString('base64')).ext, 'jpg');
assert.ok(t.validateImage(Buffer.from('just text').toString('base64')).error);
assert.ok(t.validateImage(Buffer.alloc(5 * 1024 * 1024).toString('base64')).error, 'oversized image must be rejected');

// --- the category list the form offers must match the one the server accepts ---
const offered = fs.readFileSync('admin.html', 'utf8')
  .match(/<option value="([^"]+)"/g)
  .map(function (tag) { return tag.slice(15, -1).replace(/&amp;/g, '&'); });
assert.deepStrictEqual(offered.slice().sort(), t.CATEGORIES.slice().sort());

// --- escaping on the render path (mirrors esc() in js/portfolio.js) ---
const portfolio = fs.readFileSync('js/portfolio.js', 'utf8');
assert.ok(portfolio.includes('esc(w.title)'), 'card titles must be escaped');
assert.ok(portfolio.includes('esc(w.sub)'), 'card descriptions must be escaped');
assert.ok(portfolio.includes('esc(w.img)'), 'image paths must be escaped');

const esc = new Function('text', portfolio.slice(
  portfolio.indexOf('return String(text == null'),
  portfolio.indexOf('function renderFilters()')
).trim().replace(/}\s*$/, ''));

assert.strictEqual(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
assert.strictEqual(esc('Tom & Jerry'), 'Tom &amp; Jerry');
assert.strictEqual(esc('" onload="evil()'), '&quot; onload=&quot;evil()');
assert.strictEqual(esc(null), '');

// --- the docs must not tell the operator a shorter password is acceptable ---
assert.ok(fs.readFileSync('ADMIN.md', 'utf8').includes(String(t.MIN_PASSWORD)),
  'ADMIN.md must state the ' + t.MIN_PASSWORD + '-character minimum the server enforces');

// --- video URLs: the one field that ends up as a src pointing off-site ---
const r2 = require('./api/_r2.js');
const cfg = {
  accountId: 'acct', accessKeyId: 'AK', secretAccessKey: 'SK', bucket: 'media',
  publicBase: 'https://media.example.com', host: 'acct.r2.cloudflarestorage.com'
};

assert.strictEqual(t.validateVideoUrl(undefined, cfg), null, 'no video is not an error');
assert.strictEqual(t.validateVideoUrl('', cfg), null);
assert.deepStrictEqual(
  t.validateVideoUrl('https://media.example.com/videos/a-clip-1787.mp4', cfg),
  { url: 'https://media.example.com/videos/a-clip-1787.mp4' }
);
assert.ok(t.validateVideoUrl('https://media.example.com/videos/a.webm', cfg).url);

// Another host, another prefix, a scheme that is not a URL at all, a directory
// escape, and an extension that would be served as something executable.
['https://evil.example/videos/a.mp4',
 'https://media.example.com/other/a.mp4',
 'javascript:alert(1)//media.example.com/videos/a.mp4',
 'https://media.example.com/videos/../../secret.mp4',
 'https://media.example.com/videos/a.mp4.html',
 'https://media.example.com/videos/a.svg',
 'https://media.example.com/videos/sub/dir/a.mp4'
].forEach(function (bad) {
  assert.ok(t.validateVideoUrl(bad, cfg).error, 'must refuse ' + bad);
});

// A lookalike host must not pass on a prefix match alone.
assert.ok(t.validateVideoUrl('https://media.example.com.evil.net/videos/a.mp4', cfg).error);

// Non-strings, and a video sent when the site has no video storage at all.
assert.ok(t.validateVideoUrl({}, cfg).error);
assert.ok(t.validateVideoUrl('https://media.example.com/videos/a.mp4', null).error);

// --- deletes resolve back to a key inside our own prefix, or to nothing ---
assert.strictEqual(t.videoKey('https://media.example.com/videos/a-1.mp4', cfg), 'videos/a-1.mp4');
assert.strictEqual(t.videoKey('https://evil.example/videos/a.mp4', cfg), null);
assert.strictEqual(t.videoKey(undefined, cfg), null);

// --- the upload URL is minted server-side; the client never names the file ---
const signed = t.signVideo({ r2: cfg }, { contentType: 'video/mp4', title: '../../etc/passwd' });
assert.strictEqual(signed.status, 200);
assert.ok(/\/videos\/etc-passwd-\d+\.mp4\?/.test(signed.upload.url), 'key comes from a slug, not the title');
assert.ok(signed.upload.publicUrl.indexOf('https://media.example.com/videos/') === 0);
assert.ok(!t.validateVideoUrl(signed.upload.publicUrl, cfg).error, 'what we mint must pass our own check');

assert.strictEqual(t.signVideo({ r2: cfg }, { contentType: 'video/quicktime', title: 'x' }).status, 400);
assert.strictEqual(t.signVideo({ r2: cfg }, { contentType: 'text/html', title: 'x' }).status, 400);
assert.strictEqual(t.signVideo({ r2: null }, { contentType: 'video/mp4', title: 'x' }).status, 501);

// --- SigV4: a wrong signature shows up only as an opaque 403 from R2 ---
// Pinned for fixed inputs, cross-checked against a separate implementation of
// the same derivation. It catches a reordering of the four HMAC steps.
assert.strictEqual(
  r2.__test.signingKey('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', '20120215', 'us-east-1', 'iam').toString('hex'),
  '004aa806e13dae88b9032d9261bcb04c67d023afadd221e6b0d206e1760e0b5e'
);

const presigned = new URL(r2.presign(cfg, 'PUT', 'videos/a.mp4', 3600));
assert.strictEqual(presigned.host, 'acct.r2.cloudflarestorage.com');
assert.strictEqual(presigned.pathname, '/media/videos/a.mp4', 'R2 is path-style: bucket first');
['X-Amz-Algorithm', 'X-Amz-Credential', 'X-Amz-Date', 'X-Amz-Expires', 'X-Amz-SignedHeaders', 'X-Amz-Signature']
  .forEach(function (param) { assert.ok(presigned.searchParams.get(param), 'missing ' + param); });
assert.match(presigned.searchParams.get('X-Amz-Signature'), /^[0-9a-f]{64}$/);
assert.ok(presigned.searchParams.get('X-Amz-Credential').indexOf('/auto/s3/aws4_request') > 0);
// The secret must never appear in a URL that reaches the browser.
assert.strictEqual(presigned.href.indexOf('SK'), -1);

// A different method or key must produce a different signature.
assert.notStrictEqual(
  new URL(r2.presign(cfg, 'DELETE', 'videos/a.mp4', 3600)).searchParams.get('X-Amz-Signature'),
  presigned.searchParams.get('X-Amz-Signature')
);

// --- r2Config is all-or-nothing, so a half-set project does not half-work ---
const saved = {};
const keys = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE'];
keys.forEach(function (k) { saved[k] = process.env[k]; delete process.env[k]; });
assert.strictEqual(r2.r2Config(), null, 'no R2 variables means video is simply off');
keys.forEach(function (k) { process.env[k] = 'x'; });
process.env.R2_PUBLIC_BASE = 'https://media.example.com/';
assert.strictEqual(r2.r2Config().publicBase, 'https://media.example.com', 'trailing slash is trimmed');
delete process.env.R2_BUCKET;
assert.strictEqual(r2.r2Config(), null, 'one missing variable disables video rather than half-enabling it');
keys.forEach(function (k) {
  if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
});

// --- the portfolio must not build media URLs into markup ---
assert.ok(portfolio.includes('lbVideo.src = w.video'), 'video src must be set as a property, not interpolated');
assert.ok(!/w\.video.*\+.*'<'/.test(portfolio), 'video URLs must never be concatenated into HTML');

// --- the docs must cover the R2 variables the endpoint reads ---
const adminDoc = fs.readFileSync('ADMIN.md', 'utf8');
keys.forEach(function (k) {
  assert.ok(adminDoc.includes(k), 'ADMIN.md must document ' + k);
});

console.log('All works-endpoint checks passed.');
