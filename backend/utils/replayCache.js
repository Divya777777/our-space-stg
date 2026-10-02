// Bounded, short-lived single-flight cache. Failed operations are never cached.
// Single-instance safeguard; use a shared store before horizontally scaling.
function createReplayCache({ ttlMs = 60000, max = 2000 } = {}) {
  const entries = new Map();
  return function replay(key, operation) {
    const now = Date.now();
    for (const [id, entry] of entries) if (entry.until <= now) entries.delete(id);
    if (entries.has(key)) return entries.get(key).promise;
    if (entries.size >= max) return Promise.reject(Object.assign(new Error('Please retry shortly'), { status: 503 }));
    const entry = { until: now + ttlMs, promise: null };
    entry.promise = Promise.resolve().then(operation).catch(error => { if (entries.get(key) === entry) entries.delete(key); throw error; });
    entries.set(key, entry);
    return entry.promise;
  };
}
module.exports = { createReplayCache };
