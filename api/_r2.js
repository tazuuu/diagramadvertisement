// Cloudflare R2 access for the video half of the portfolio.
//
// Named with a leading underscore on purpose: Vercel turns every other file in
// api/ into a public endpoint, and this one is a library, not a route.
//
// Videos do not go through this server. A phone clip is tens of megabytes and
// Vercel rejects request bodies over 4.5MB, so the browser uploads straight to
// R2 using a presigned URL minted here. Only the short-lived signature crosses
// the function; the file never does.
//
// R2 speaks the S3 API, so this is AWS Signature V4. It is written out longhand
// against node:crypto rather than pulled from the AWS SDK — the whole site has
// no dependencies and no build step, and one signature is not worth giving that
// up.
//
// Required environment variables (Vercel project settings, never in code):
//   R2_ACCOUNT_ID          from the Cloudflare dashboard URL
//   R2_ACCESS_KEY_ID       R2 API token, "Object Read & Write" on one bucket
//   R2_SECRET_ACCESS_KEY   shown once when the token is created
//   R2_BUCKET              bucket name
//   R2_PUBLIC_BASE         the bucket's public URL, no trailing slash

const crypto = require('node:crypto');

const REGION = 'auto';           // R2 has no regions; the signature still needs one.
const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';

// Long enough for a slow phone upload of a large file, short enough that a
// leaked URL is not a standing write grant.
const UPLOAD_URL_TTL = 60 * 60;

function hmac(key, msg) {
  return crypto.createHmac('sha256', key).update(msg, 'utf8').digest();
}

function sha256Hex(msg) {
  return crypto.createHash('sha256').update(msg, 'utf8').digest('hex');
}

// The four-step derivation that turns the secret into a key scoped to one day,
// region and service. Order matters and getting it wrong surfaces only as an
// opaque 403 from R2, so test-works.js pins the output for fixed inputs. That
// value was cross-checked against a separate implementation of the same spec,
// which makes it a regression guard rather than proof of correctness — the
// proof is the first upload that succeeds.
function signingKey(secret, dateStamp, region, service) {
  let key = hmac('AWS4' + secret, dateStamp);
  key = hmac(key, region);
  key = hmac(key, service);
  return hmac(key, 'aws4_request');
}

// Returns the R2 config, or null when the site has no video storage set up.
// Every caller treats null as "videos are switched off" rather than an error,
// so the console keeps working for image-only works on a fresh deploy.
function r2Config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  const publicBase = process.env.R2_PUBLIC_BASE;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBase) return null;

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicBase: publicBase.replace(/\/+$/, ''),
    host: accountId + '.r2.cloudflarestorage.com'
  };
}

// A presigned URL carrying its own authorisation in the query string, so the
// browser can PUT or DELETE without ever seeing the secret key.
function presign(cfg, method, key, expiresIn) {
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = dateStamp + '/' + REGION + '/' + SERVICE + '/aws4_request';

  // R2's S3 endpoint is path-style: the bucket is the first path segment.
  const canonicalUri = '/' + cfg.bucket + '/' + key.split('/').map(encodeURIComponent).join('/');

  const query = new URLSearchParams({
    'X-Amz-Algorithm': ALGORITHM,
    'X-Amz-Credential': cfg.accessKeyId + '/' + scope,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresIn),
    'X-Amz-SignedHeaders': 'host'
  });
  query.sort(); // The canonical query string must be in key order.

  const canonicalRequest = [
    method,
    canonicalUri,
    query.toString(),
    'host:' + cfg.host + '\n',
    'host',
    // The body is not signed; it is streamed by the browser and never seen here.
    'UNSIGNED-PAYLOAD'
  ].join('\n');

  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const signature = hmac(signingKey(cfg.secretAccessKey, dateStamp, REGION, SERVICE), stringToSign)
    .toString('hex');

  return 'https://' + cfg.host + canonicalUri + '?' + query.toString() + '&X-Amz-Signature=' + signature;
}

function uploadUrl(cfg, key) {
  return presign(cfg, 'PUT', key, UPLOAD_URL_TTL);
}

function publicUrl(cfg, key) {
  return cfg.publicBase + '/' + key;
}

// Best effort: a video left behind in R2 costs storage but breaks nothing,
// whereas throwing here would fail a delete that has already been committed.
async function deleteObject(cfg, key) {
  try {
    const res = await fetch(presign(cfg, 'DELETE', key, 60), { method: 'DELETE' });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

module.exports = { r2Config, presign, uploadUrl, publicUrl, deleteObject, UPLOAD_URL_TTL };
module.exports.__test = { signingKey };
