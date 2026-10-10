// Public pages the app stores require: privacy policy, terms of use, support (with a contact form) and
// an account-deletion request page that works without the app. Plus a small admin view (ADMIN_TOKEN)
// to read reports, support messages and deletion requests.
// Settings come from environment variables so nothing personal is hard-coded:
//   APP_OWNER (who runs the app, e.g. your full name), SUPPORT_EMAIL, OWNER_COUNTRY (default India),
//   POLICY_DATE (effective date), ADMIN_TOKEN (long random string for /admin).
const express = require('express');
const crypto = require('node:crypto');

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function settings(env) {
  return {
    owner: env.APP_OWNER || 'the Our Space team',
    email: env.SUPPORT_EMAIL || '',
    country: env.OWNER_COUNTRY || 'India',
    date: env.POLICY_DATE || '11 October 2026',
  };
}
function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Our Space</title><meta name="robots" content="index,follow">
<style>:root{color-scheme:dark}body{margin:0;background:#0C101C;color:#F4F1EA;font:16px/1.65 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:760px;margin:0 auto;padding:40px 22px 64px}a{color:#C8B6FF}h1{font-weight:600;font-size:32px;letter-spacing:-.5px;margin:0 0 6px}
h2{font-size:20px;margin:34px 0 8px}p,li{color:#D9DCE6}.muted{color:#ADB5CA;font-size:14px}nav{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:28px;font-size:14px}
.card{background:#171D2D;border:1px solid #30394F;border-radius:18px;padding:20px;margin:18px 0}label{display:block;font-size:14px;color:#ADB5CA;margin:12px 0 6px}
input,textarea,select{width:100%;box-sizing:border-box;background:#0C101C;color:#F4F1EA;border:1px solid #30394F;border-radius:12px;padding:12px;font:inherit}
button{margin-top:16px;background:#C8B6FF;color:#0C101C;border:0;border-radius:14px;padding:13px 20px;font-weight:700;font-size:15px;cursor:pointer}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{border-bottom:1px solid #30394F;padding:8px;text-align:left;vertical-align:top}</style></head>
<body><main><nav><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/support">Support</a><a href="/delete-account">Delete account</a></nav>${body}</main></body></html>`;
}
function contactLine(s) {
  return s.email ? `email <a href="mailto:${esc(s.email)}">${esc(s.email)}</a> or use the <a href="/support">support form</a>` : 'use the <a href="/support">support form</a>';
}

function privacy(s) {
  return page('Privacy policy', `<h1>Privacy policy</h1><p class="muted">Effective ${esc(s.date)}. Our Space is provided by ${esc(s.owner)} (${esc(s.country)}).</p>
<p>Our Space is a private space for you and the people you invite: watch YouTube in sync, chat, call, play games, share goals and make plans. This policy explains what we collect, why, and the choices you have. We do not sell your data, show ads, or track you across other apps or websites.</p>
<h2>What we collect</h2><ul>
<li><b>Account</b>: when you sign in with Google or Apple we receive your name, email address (Apple lets you hide it with a relay address) and, from Google, a profile picture link. You can change the name people see in the app.</li>
<li><b>Rooms</b>: rooms you create or join, room names, who is in each room, join requests, what is playing and the shared queue.</li>
<li><b>Chat</b>: messages, photos and files are <b>end-to-end encrypted</b> on your phone. Our servers only pass along encrypted data they cannot read, keep it until it is delivered (at most 7 days) and then delete it. Older messages sent before private chat existed are stored encrypted on our servers.</li>
<li><b>Calls</b>: voice and video go directly between phones (WebRTC). When a direct connection is not possible, they pass encrypted through Cloudflare's relay servers. Calls are never recorded. We briefly keep the connection messages needed to start a call.</li>
<li><b>Playlists and saved videos</b>: YouTube video IDs and titles you save, and your personal and room playlists.</li>
<li><b>Goals</b>: goals you create, daily progress, cheers and your reminder time. <b>Step count</b>: only if you allow it, the app reads today's total steps from Health Connect (Android) or Apple Health (iPhone) and saves that daily number as progress on your step goal, which the people sharing that goal can see. We read nothing else from your health data, never use it for advertising or marketing, never sell it, and never share it with anyone else. You can turn this off at any time in your phone's Health Connect or Health settings.</li>
<li><b>Games and plans</b>: drawings, guesses, quiz answers, scores, Truth or Dare progress, and plans with their dates and reminders.</li>
<li><b>Safety</b>: people you block and reports you make (including any message text you choose to include).</li>
<li><b>Device and technical data</b>: push notification tokens, app version, IP address and sign-in times, used to keep your account secure and the service working.</li></ul>
<h2>How we use it</h2><p>Only to run Our Space: sign you in, sync rooms, deliver messages and calls, send the notifications you expect (calls, messages, join requests, plans, goals), keep the service safe, review reports, and fix problems. We do not use your data for advertising or profiling.</p>
<h2>Who we share it with</h2><p>People in your rooms see what you share there. We use these service providers to run the app, under their own privacy terms: Render (servers), Neon (database), Cloudflare (call relay), Expo, Google Firebase Cloud Messaging and Apple Push Notification service (notifications), Google Sign-In and Sign in with Apple (sign-in), and YouTube API Services (search and playback). We share data with authorities only when the law requires it. Your data may be processed on servers outside your country.</p>
<h2>YouTube</h2><p>Our Space uses <b>YouTube API Services</b> to search and play videos. By using the YouTube features you agree to the <a href="https://www.youtube.com/t/terms">YouTube Terms of Service</a>, and Google's handling of that data is covered by the <a href="http://www.google.com/policies/privacy">Google Privacy Policy</a>. We send your search text to YouTube to get results; we do not access your YouTube or Google account. You can review or remove access granted to apps at <a href="https://security.google.com/settings/security/permissions">Google security settings</a>.</p>
<h2>How long we keep it</h2><p>Until you delete your account, except encrypted chat waiting for delivery (at most 7 days) and short-lived call and log data. When you delete your account we delete your profile, rooms you host (for everyone in them), memberships, messages, playlists, goals, step progress, game data, plans and notification tokens straight away; copies in database backups disappear within 30 days. Reports you made are kept without your name, so we can keep the service safe.</p>
<h2>Your choices and rights</h2><ul><li>Change your name in the app (You → Profile).</li><li>Block or report anyone from the People tab.</li><li>Delete your account in the app (You → Delete account) or at <a href="/delete-account">our deletion page</a>.</li><li>Ask us for a copy of your data, to correct it, or anything else: ${contactLine(s)}.</li></ul>
<h2>Children</h2><p>Our Space is not for children under 13 (or the higher minimum age in your country). We do not knowingly collect data from children. If you think a child is using it, contact us and we will delete the account.</p>
<h2>Security</h2><p>Connections use HTTPS, chat is end-to-end encrypted, and stored messages are encrypted at rest. No system is perfectly secure, so please keep your phone and sign-in protected.</p>
<h2>Changes</h2><p>We will update this page and the date above if this policy changes, and tell you in the app about important changes.</p>
<h2>Contact</h2><p>${esc(s.owner)}, ${esc(s.country)}. To reach us, ${contactLine(s)}.</p>`);
}
function terms(s) {
  return page('Terms of use', `<h1>Terms of use</h1><p class="muted">Effective ${esc(s.date)}. Provided by ${esc(s.owner)} (${esc(s.country)}).</p>
<p>By creating an account or using Our Space you agree to these terms and our <a href="/privacy">privacy policy</a>.</p>
<h2>Who can use it</h2><p>You must be at least 13 years old (or the minimum age in your country). The Spicy Truth or Dare deck is for adults (18+) and only unlocks when everyone in the game agrees.</p>
<h2>Zero tolerance for abuse</h2><p>Our Space has <b>no tolerance for objectionable content or abusive users</b>. You must not post or share anything illegal, sexual content involving minors, hate speech, harassment, threats, bullying, content that encourages self-harm, spam, scams or impersonation, or anything that violates others' rights. You can block anyone and report people or messages from the People tab or by long-pressing a message. We review reports within 24 hours and may remove content, close rooms and permanently ban accounts that break these rules.</p>
<h2>Your content</h2><p>You keep ownership of what you share. You give us permission to store and transmit it only to provide the service to you and the people you share it with. Chat is end-to-end encrypted, so we cannot read it unless someone includes it in a report.</p>
<h2>YouTube and other services</h2><p>Videos are provided by YouTube through YouTube API Services; using them means you also agree to the <a href="https://www.youtube.com/t/terms">YouTube Terms of Service</a>. We do not own that content and it is played only through YouTube's official player.</p>
<h2>Subscriptions</h2><p>If paid features are offered, they are sold through the App Store or Google Play, which handle billing, renewals and refunds under their own terms. You can cancel in your store account settings.</p>
<h2>The service</h2><p>We work hard to keep Our Space running, but it is provided "as is" and may change or be interrupted. To the extent the law allows, we are not liable for indirect losses. Nothing in these terms limits rights you have under the law of your country.</p>
<h2>Ending</h2><p>You can stop using Our Space and delete your account at any time. We may suspend accounts that break these terms.</p>
<h2>Contact</h2><p>${contactLine(s)}.</p>`);
}
function support(s, sent) {
  return page('Support', `<h1>Help &amp; support</h1>${sent ? '<div class="card"><b>Thanks — we got your message.</b> We usually reply within 24 hours.</div>' : ''}
<p>Questions, problems, safety concerns or feedback: ${contactLine(s)}. Safety reports are reviewed within 24 hours.</p>
<div class="card"><b>Quick answers</b><ul><li><b>Notifications don't arrive?</b> In the app: You → Notifications → send a test notification.</li><li><b>Someone is bothering you?</b> Open the room's People tab, tap ⋯ next to them, and choose Report or Block. You can also long-press any message to report it.</li><li><b>Steps not counting?</b> Allow Our Space in Health Connect (Android) or Health → Sharing (iPhone).</li><li><b>Delete your account?</b> In the app: You → Delete account, or <a href="/delete-account">request it here</a>.</li></ul></div>
<form class="card" method="post" action="/support/request"><b>Send us a message</b><label for="e">Your email (so we can reply)</label><input id="e" name="email" type="email" required maxlength="200">
<label for="t">Topic</label><select id="t" name="topic"><option>Question</option><option>Problem or bug</option><option>Safety or abuse</option><option>Privacy or my data</option><option>Feedback</option></select>
<label for="m">Message</label><textarea id="m" name="message" rows="6" required maxlength="4000"></textarea><button type="submit">Send</button></form>`);
}
function deletion(s, sent) {
  return page('Delete your account', `<h1>Delete your Our Space account</h1>${sent ? '<div class="card"><b>Request received.</b> We will email the address on your account to confirm it is you, then delete the account within 7 days.</div>' : ''}
<p><b>Fastest way:</b> open Our Space → <b>You</b> → <b>Delete account</b>. It is deleted immediately.</p>
<p>No longer have the app? Ask us here. We will confirm by emailing the address linked to your Our Space account, then delete it within 7 days.</p>
<div class="card"><b>What gets deleted</b><ul><li>Your profile (name, email, sign-in link)</li><li>Rooms you host, for everyone in them, and your membership in other rooms</li><li>Messages, photos and files, playlists and saved videos</li><li>Goals, step progress, game drawings, quiz answers and scores, plans and reminders</li><li>Notification tokens and sign-in sessions</li></ul><p class="muted">Database backups are cleared within 30 days. Safety reports you made are kept without your name. If you subscribed to a paid plan, cancel it in your App Store or Google Play account as well.</p></div>
<form class="card" method="post" action="/delete-account/request"><label for="e">Email address you signed in with (Google or Apple)</label><input id="e" name="email" type="email" required maxlength="200">
<label for="n">Anything we should know? (optional)</label><textarea id="n" name="note" rows="3" maxlength="1000"></textarea><button type="submit">Request account deletion</button></form>
<p class="muted">Questions: ${contactLine(s)}.</p>`);
}

function createLegalRouter({ env = process.env, db: injected } = {}) {
  const router = express.Router();
  let client = injected || null;
  const db = () => { if (!client) { const { PrismaClient } = require('@prisma/client'); client = new PrismaClient(); } return client; };
  let ready = null;
  const ensure = () => {
    if (!ready) ready = (async () => {
      await db().$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS support_requests (
        request_id SERIAL PRIMARY KEY, kind TEXT NOT NULL, email TEXT NOT NULL, topic TEXT NOT NULL DEFAULT '', message TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    })().catch(error => { ready = null; throw error; });
    return ready;
  };
  // A few submissions per IP per hour keeps the forms from being abused.
  const hits = new Map();
  const limited = req => { const key = req.ip || 'x'; const now = Date.now(); const list = (hits.get(key) || []).filter(t => now - t < 3600e3); list.push(now); hits.set(key, list); return list.length > 8; };
  const form = express.urlencoded({ extended: false, limit: '20kb' });
  const html = (res, body) => res.set('Cache-Control', 'public, max-age=300').type('html').send(body);

  router.get('/privacy', (req, res) => html(res, privacy(settings(env))));
  router.get('/terms', (req, res) => html(res, terms(settings(env))));
  router.get('/support', (req, res) => res.type('html').send(support(settings(env), req.query.sent === '1')));
  router.get('/delete-account', (req, res) => res.type('html').send(deletion(settings(env), req.query.sent === '1')));
  const save = (kind, path) => async (req, res) => {
    const email = String(req.body?.email || '').trim().slice(0, 200);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).type('html').send(page('Check your email', '<h1>Please check the email address</h1><p><a href="javascript:history.back()">Go back</a></p>'));
    if (limited(req)) return res.status(429).type('html').send(page('Too many requests', '<h1>Too many requests</h1><p>Please try again in an hour.</p>'));
    try {
      await ensure();
      await db().$executeRawUnsafe('INSERT INTO support_requests (kind, email, topic, message) VALUES ($1, $2, $3, $4)', kind, email,
        String(req.body?.topic || '').slice(0, 60), String(req.body?.message || req.body?.note || '').slice(0, 4000));
    } catch (error) { console.error('support request failed', error.message); return res.status(503).type('html').send(page('Try again', '<h1>Something went wrong</h1><p>Please try again in a minute.</p>')); }
    res.redirect(303, `${path}?sent=1`);
  };
  router.post('/support/request', form, save('support', '/support'));
  router.post('/delete-account/request', form, save('deletion', '/delete-account'));

  // ---- admin (reports, messages, deletion requests) ----
  const authorized = req => {
    const want = env.ADMIN_TOKEN || '';
    const got = String(req.query.token || req.body?.token || '');
    return want.length >= 24 && got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
  };
  router.get('/admin', async (req, res) => {
    if (!authorized(req)) return res.status(404).type('text/plain').send('Not found');
    const { sqlStore } = require('../services/safety');
    const reports = await sqlStore(db()).listReports().catch(() => []);
    await ensure().catch(() => {});
    const requests = await db().$queryRawUnsafe('SELECT * FROM support_requests ORDER BY created_at DESC LIMIT 200').catch(() => []);
    const t = esc(req.query.token);
    const act = (path, fields, label) => `<form method="post" action="${path}" style="display:inline"><input type="hidden" name="token" value="${t}">${Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join('')}<button style="margin:4px 0;padding:6px 10px;font-size:12px">${label}</button></form>`;
    res.set('Cache-Control', 'no-store').type('html').send(page('Admin', `<h1>Reports &amp; requests</h1><p class="muted">Review safety reports within 24 hours. For deletion requests, email the address to confirm, then delete.</p>
<h2>Safety reports</h2><table><tr><th>When</th><th>Reported</th><th>By</th><th>Why</th><th>Details / message</th><th></th></tr>${reports.map(r => `<tr><td>${esc(new Date(r.created_at).toISOString().slice(0, 16))}<br>${esc(r.status)}</td><td>${esc(r.reported_name)}<br><span class="muted">${esc(r.reported_email)} · #${esc(r.reported)}</span></td><td>${esc(r.reporter_name || '(deleted)')}<br><span class="muted">${esc(r.reporter_email)}</span></td><td>${esc(r.reason)}<br>${esc(r.room_code || '')}</td><td>${esc(r.details)}<br><i>${esc(r.message)}</i></td><td>${act('/admin/report', { id: r.report_id, status: 'reviewed' }, 'Mark reviewed')}${r.reported ? act('/admin/ban-user', { userId: r.reported }, 'Ban user') : ''}</td></tr>`).join('')}</table>
<h2>Support &amp; deletion requests</h2><table><tr><th>When</th><th>Kind</th><th>Email</th><th>Message</th><th></th></tr>${requests.map(r => `<tr><td>${esc(new Date(r.created_at).toISOString().slice(0, 16))}<br>${esc(r.status)}</td><td>${esc(r.kind)}<br>${esc(r.topic)}</td><td>${esc(r.email)}</td><td>${esc(r.message)}</td><td>${act('/admin/request', { id: r.request_id, status: 'done' }, 'Mark done')}${r.kind === 'deletion' ? act('/admin/delete-email', { email: r.email, id: r.request_id }, 'Delete this account') : ''}</td></tr>`).join('')}</table>`));
  });
  router.post('/admin/report', form, async (req, res) => {
    if (!authorized(req)) return res.status(404).send('Not found');
    const { sqlStore } = require('../services/safety');
    await sqlStore(db()).setReportStatus(req.body.id, String(req.body.status || 'reviewed').slice(0, 20));
    res.redirect(303, `/admin?token=${encodeURIComponent(req.body.token)}`);
  });
  router.post('/admin/request', form, async (req, res) => {
    if (!authorized(req)) return res.status(404).send('Not found');
    await db().$executeRawUnsafe('UPDATE support_requests SET status = $2 WHERE request_id = $1', Number(req.body.id), String(req.body.status || 'done').slice(0, 20));
    res.redirect(303, `/admin?token=${encodeURIComponent(req.body.token)}`);
  });
  const erase = async (userId) => { const { eraseAccount } = require('../services/accountDeletion'); await eraseAccount(db(), userId); };
  // Ban: the account is locked (sign-in refused) and every session ends. Their data stays for the review trail.
  router.post('/admin/ban-user', form, async (req, res) => {
    if (!authorized(req)) return res.status(404).send('Not found');
    const userId = Number(req.body.userId);
    await db().users.update({ where: { user_id: userId }, data: { account_locked: true, locked_until: null } }).catch(error => console.error('ban failed', error.message));
    await db().user_sessions.updateMany({ where: { user_id: userId }, data: { is_active: false } }).catch(() => {});
    res.redirect(303, `/admin?token=${encodeURIComponent(req.body.token)}`);
  });
  router.post('/admin/delete-email', form, async (req, res) => {
    if (!authorized(req)) return res.status(404).send('Not found');
    const user = await db().users.findUnique({ where: { email: String(req.body.email || '').trim() } }).catch(() => null);
    if (user) await erase(user.user_id).catch(error => console.error('admin delete failed', error.message));
    await db().$executeRawUnsafe("UPDATE support_requests SET status = $2 WHERE request_id = $1", Number(req.body.id), user ? 'deleted' : 'no account').catch(() => {});
    res.redirect(303, `/admin?token=${encodeURIComponent(req.body.token)}`);
  });
  return router;
}
module.exports = { createLegalRouter };
