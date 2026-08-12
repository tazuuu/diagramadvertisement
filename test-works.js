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

console.log('All works-endpoint checks passed.');
