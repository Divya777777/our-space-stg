// Public invite landing page: /j/ABC123 opens the app on the join screen.
// No data is read here; the app performs the authenticated join request itself.
const express = require('express');
const PACKAGE = 'com.ourspace.mobile';
function invitePage(code) {
  const deep = `ourspace://join?code=${code}`;
  const android = `intent://join?code=${code}#Intent;scheme=ourspace;package=${PACKAGE};end`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Join me on Our Space</title><meta name="robots" content="noindex"><meta property="og:title" content="Join me on Our Space"><meta property="og:description" content="Watch together, in sync. Room code ${code}.">
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0C101C;color:#F4F1EA;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:360px;padding:32px 24px;text-align:center}.moon{width:84px;height:84px;margin:0 auto 24px;border-radius:50%;background:linear-gradient(160deg,#F1E8D6,#C1B6D2 55%,#80759A);box-shadow:0 0 0 18px #C6B3F50F,0 0 0 36px #C6B3F508}
h1{font-weight:500;font-size:28px;letter-spacing:-.5px;margin:0 0 8px}p{color:#ADB5CA;font-size:14px;line-height:1.6;margin:0 0 24px}.code{font-size:26px;letter-spacing:8px;font-weight:600;color:#C8B6FF;background:#171D2D;border:1px solid #30394F;border-radius:14px;padding:14px;margin:0 0 20px}
a.btn{display:block;background:#C8B6FF;color:#0C101C;text-decoration:none;font-weight:700;padding:15px;border-radius:15px;margin-bottom:12px}a.alt{display:block;color:#C8B6FF;font-size:13px;padding:10px}</style></head>
<body><main><div class="moon"></div><h1>You’re invited.</h1><p>Someone saved you a seat in their space on Our Space.</p><div class="code">${code}</div>
<a class="btn" href="${android}">Open in Our Space (Android)</a><a class="alt" href="${deep}">Open on iPhone or another device</a>
<p style="font-size:12px;margin-top:16px">Don’t have the app yet? Install Our Space, then choose “Join with code” and enter ${code}.</p></main></body></html>`;
}
function createInviteRouter() {
  const router = express.Router();
  router.get('/j/:code', (req, res) => {
    const code = String(req.params.code || '').toUpperCase();
    if (!/^[A-Z0-9]{6,10}$/.test(code)) return res.status(404).type('text/plain').send('Invite not found');
    res.set('Cache-Control', 'public, max-age=300').type('html').send(invitePage(code));
  });
  return router;
}
module.exports = { createInviteRouter, invitePage };
