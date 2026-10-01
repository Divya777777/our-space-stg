function positiveId(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (!/^[1-9]\d*$/.test(String(value))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id <= 2147483647 ? id : null;
}

// Used before Prisma receives route parameters. Do not accept truncated IDs like 12abc.
function validateIdParams(req, res, next) {
  for (const [key, value] of Object.entries(req.params)) {
    if (key.endsWith('Id') && positiveId(value) === null) {
      return res.status(400).json({ error: `Invalid ${key}` });
    }
  }
  next();
}

module.exports = { positiveId, validateIdParams };
