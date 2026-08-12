// Run with: node test-upload.js
//
// Covers the parts of the upload path that decide whether something dangerous
// gets committed into the repo, plus the escaping that stops an uploaded title
// from becoming script on the portfolio page.

const assert = require('node:assert');
const { imageExtension, slugify, secretMatches, CATEGORIES } = require('./api/upload.js').__test;

// --- format sniffing: the filename is never trusted ---
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(8)]);
const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(8)]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);

assert.strictEqual(imageExtension(jpeg), 'jpg');
assert.strictEqual(imageExtension(png), 'png');
assert.strictEqual(imageExtension(webp), 'webp');

// A renamed text file, an executable, and a truncated header must all be refused.
assert.strictEqual(imageExtension(Buffer.from('hello world, not an image')), null);
assert.strictEqual(imageExtension(Buffer.concat([Buffer.from('MZ'), Buffer.alloc(20)])), null);
assert.strictEqual(imageExtension(Buffer.from([0xff, 0xd8])), null);
// RIFF alone is not enough — a .wav starts the same way.
assert.strictEqual(imageExtension(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')])), null);

// --- slugs stay filesystem- and URL-safe ---
assert.strictEqual(slugify('Nice Times Cafeteria'), 'nice-times-cafeteria');
assert.strictEqual(slugify('  Al Hikaya / Food Stuff!  '), 'al-hikaya-food-stuff');
assert.strictEqual(slugify('../../etc/passwd'), 'etc-passwd');
assert.strictEqual(slugify('%%%'), 'work');
assert.ok(slugify('x'.repeat(200)).length <= 40);

// --- password comparison ---
assert.strictEqual(secretMatches('hunter2', 'hunter2'), true);
assert.strictEqual(secretMatches('hunter2', 'hunter3'), false);
// Different lengths must return false, not throw.
assert.strictEqual(secretMatches('short', 'a-much-longer-password'), false);
assert.strictEqual(secretMatches(undefined, 'hunter2'), false);

// --- the category list the form offers must match the one the server accepts ---
const offered = require('node:fs').readFileSync('admin.html', 'utf8')
  .match(/<option value="([^"]+)"/g)
  .map(function (tag) { return tag.slice(15, -1).replace(/&amp;/g, '&'); });
assert.deepStrictEqual(offered.slice().sort(), CATEGORIES.slice().sort());

// --- escaping on the render path (mirrors esc() in js/portfolio.js) ---
const portfolio = require('node:fs').readFileSync('js/portfolio.js', 'utf8');
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

console.log('All upload checks passed.');
