const express = require('express');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const CREDENTIAL_TTL_SECONDS = 24 * 60 * 60;

/**
 * Return short-lived Cloudflare TURN credentials to authenticated clients.
 * The permanent Cloudflare API token always remains on the backend.
 */
router.get('/ice-servers', authenticate, async (req, res) => {
  res.set('Cache-Control', 'no-store');

  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const apiToken = process.env.CLOUDFLARE_TURN_API_TOKEN;

  if (!keyId || !apiToken) {
    return res.status(503).json({
      success: false,
      error: 'TURN service is not configured'
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ttl: CREDENTIAL_TTL_SECONDS }),
        signal: controller.signal
      }
    );

    if (!response.ok) {
      const details = await response.text();
      console.error('[TURN] Cloudflare credential request failed:', response.status, details);
      return res.status(502).json({
        success: false,
        error: 'Could not obtain TURN credentials'
      });
    }

    const data = await response.json();
    if (!Array.isArray(data.iceServers) || data.iceServers.length === 0) {
      throw new Error('Cloudflare returned no ICE servers');
    }

    return res.json({
      success: true,
      iceServers: data.iceServers,
      expiresIn: CREDENTIAL_TTL_SECONDS
    });
  } catch (error) {
    console.error('[TURN] Credential generation error:', error.message);
    return res.status(502).json({
      success: false,
      error: 'TURN credential service is unavailable'
    });
  } finally {
    clearTimeout(timeout);
  }
});

module.exports = router;
