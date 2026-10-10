// Verifies a "Sign in with Apple" identity token (a JWT signed by Apple) on the server.
// Apple's public keys are fetched from appleid.apple.com and cached for an hour.
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const ISSUER = 'https://appleid.apple.com';
const KEYS_URL = 'https://appleid.apple.com/auth/keys';

function createAppleVerifier({ audiences = [], fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  let cache = { at: 0, keys: [] };
  async function keys(force = false) {
    if (!force && cache.keys.length && now() - cache.at < 60 * 60 * 1000) return cache.keys;
    let response;
    try { response = await fetchImpl(KEYS_URL, { signal: AbortSignal.timeout(8000) }); }
    catch { throw Object.assign(new Error('Apple sign-in temporarily unavailable'), { status: 503 }); }
    if (!response.ok) throw Object.assign(new Error('Apple sign-in temporarily unavailable'), { status: 503 });
    const body = await response.json();
    cache = { at: now(), keys: Array.isArray(body.keys) ? body.keys : [] };
    return cache.keys;
  }
  return async function verifyAppleToken(token) {
    const header = (jwt.decode(token, { complete: true }) || {}).header;
    if (!header?.kid || header.alg !== 'RS256') throw Object.assign(new Error('Apple identity could not be verified'), { status: 401 });
    let jwk = (await keys()).find(k => k.kid === header.kid);
    if (!jwk) jwk = (await keys(true)).find(k => k.kid === header.kid); // Apple rotated its keys
    if (!jwk) throw Object.assign(new Error('Apple identity could not be verified'), { status: 401 });
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    try {
      const payload = jwt.verify(token, key, { algorithms: ['RS256'], issuer: ISSUER, audience: audiences.length === 1 ? audiences[0] : audiences, clockTimestamp: Math.floor(now() / 1000) });
      if (!payload.sub) throw new Error('missing subject');
      return payload;
    } catch { throw Object.assign(new Error('Apple identity could not be verified'), { status: 401 }); }
  };
}

module.exports = { createAppleVerifier };
