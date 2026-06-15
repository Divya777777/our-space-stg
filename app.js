/* =====================================================
   app.js — Index page logic
   Google Sign-In + Room Code system (no PIN)
   ===================================================== */

// ──────────────────────────────────────────────────────
//  GOOGLE SIGN-IN
// ──────────────────────────────────────────────────────

/*
 * ⚠️  SETUP REQUIRED: Replace the CLIENT_ID below with your own.
 *
 * 1. Go to https://console.cloud.google.com/apis/credentials
 * 2. Create an OAuth 2.0 Client ID (Web application)
 * 3. Add your origins: http://localhost:3000 (and your production domain)
 * 4. Paste the Client ID below
 */
const GOOGLE_CLIENT_ID = 'YOUR_CLIENT_ID_HERE.apps.googleusercontent.com';

let currentUser = null; // { name, email, avatar }

function initGoogleSignIn() {
  if (typeof google === 'undefined' || !google.accounts) {
    console.warn('[AUTH] Google Identity Services not loaded — using name-only fallback');
    return;
  }

  if (GOOGLE_CLIENT_ID.includes('YOUR_CLIENT_ID_HERE')) {
    console.warn('[AUTH] Google Client ID not configured — using name-only fallback');
    return;
  }

  try {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleSignIn,
      auto_select: true,
    });

    google.accounts.id.renderButton(
      document.getElementById('googleSignInBtn'),
      {
        theme: 'filled_black',
        size: 'large',
        type: 'standard',
        text: 'signin_with',
        shape: 'pill',
        width: 300,
      }
    );
    console.log('[AUTH] Google Sign-In initialized');
  } catch (err) {
    console.error('[AUTH] Failed to initialize Google Sign-In:', err);
  }
}

function handleGoogleSignIn(response) {
  try {
    // Decode JWT payload (no verification needed — we only use name/avatar)
    const payload = JSON.parse(atob(response.credential.split('.')[1]));
    currentUser = {
      name: payload.name || payload.given_name || 'User',
      email: payload.email || '',
      avatar: payload.picture || '',
    };

    localStorage.setItem('ourspace_name', currentUser.name);
    localStorage.setItem('ourspace_avatar', currentUser.avatar);
    localStorage.setItem('ourspace_email', currentUser.email);

    showRoomStep();
    console.log('[AUTH] Google Sign-In successful:', currentUser.name);
  } catch (err) {
    console.error('[AUTH] Failed to parse Google credential:', err);
  }
}

// ──────────────────────────────────────────────────────
//  UI STEPS
// ──────────────────────────────────────────────────────

function showRoomStep() {
  document.getElementById('signInStep').style.display = 'none';
  document.getElementById('roomStep').style.display = 'block';

  const name = currentUser?.name || localStorage.getItem('ourspace_name') || 'You';
  const avatar = currentUser?.avatar || localStorage.getItem('ourspace_avatar') || '';

  document.getElementById('userName').textContent = name;
  if (avatar) {
    const img = document.getElementById('userAvatar');
    img.src = avatar;
    img.style.display = 'block';
  }
}

function showSignInStep() {
  document.getElementById('signInStep').style.display = 'block';
  document.getElementById('roomStep').style.display = 'none';
  currentUser = null;
  localStorage.removeItem('ourspace_name');
  localStorage.removeItem('ourspace_avatar');
  localStorage.removeItem('ourspace_email');
}

// Check if user is already signed in (page reload)
function checkExistingSession() {
  const name = localStorage.getItem('ourspace_name');
  if (name) {
    currentUser = {
      name,
      avatar: localStorage.getItem('ourspace_avatar') || '',
      email: localStorage.getItem('ourspace_email') || '',
    };
    showRoomStep();
    return true;
  }
  return false;
}

// ──────────────────────────────────────────────────────
//  ROOM CODE GENERATION (short 6-char codes)
// ──────────────────────────────────────────────────────

function generateRoomCode() {
  // Use uppercase letters + digits, excluding ambiguous: 0/O, 1/I/l
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const array = new Uint8Array(6);
  crypto.getRandomValues(array);
  for (let i = 0; i < 6; i++) {
    code += chars[array[i] % chars.length];
  }
  return code;
}

// ──────────────────────────────────────────────────────
//  ROOM ACTIONS
// ──────────────────────────────────────────────────────

function enterRoom(roomCode) {
  const name = currentUser?.name || localStorage.getItem('ourspace_name') || 'You';
  if (!name || name === 'You') return;
  if (!roomCode) return;

  const cleanCode = roomCode.trim().toUpperCase();
  if (cleanCode.length < 4) return;

  saveRecentRoom(name, cleanCode);
  localStorage.setItem('ourspace_name', name);
  sessionStorage.setItem('ourspace_room', cleanCode); // Room code remains session-only

  window.location.href = 'room.html';
}

// ──────────────────────────────────────────────────────
//  RECENT ROOMS
// ──────────────────────────────────────────────────────

const RECENT_KEY = 'ourspace_recent_rooms';

function getRecentRooms() {
  return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
}

function saveRecentRoom(name, room) {
  let recent = getRecentRooms().filter(r => r.room !== room);
  recent.unshift({ name, room, ts: Date.now() });
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, 6)));
}

function renderRecentRooms() {
  const recent = getRecentRooms();
  const section = document.getElementById('recentSection');
  const container = document.getElementById('recentRooms');
  if (!recent.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  container.innerHTML = recent.map(r => `
    <button class="recent-room-btn" onclick="joinRecent('${escHtml(r.room)}')">
      <span class="recent-moon">🌙</span>
      <div class="recent-info">
        <div class="recent-room-name">${escHtml(r.name)}</div>
        <div class="recent-room-code">${escHtml(r.room)}</div>
      </div>
      <span class="recent-arrow">→</span>
    </button>
  `).join('');
}

function escHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

window.joinRecent = function (room) {
  if (!localStorage.getItem('ourspace_name')) {
    document.getElementById('roomInput').value = room;
    return;
  }
  enterRoom(room);
};

// ──────────────────────────────────────────────────────
//  STAR CANVAS
// ──────────────────────────────────────────────────────

(function initStars() {
  const canvas = document.getElementById('starCanvas');
  const ctx = canvas.getContext('2d');
  let stars = [], W, H;
  function resize() {
    W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight;
    stars = [];
    for (let i = 0; i < 180; i++)
      stars.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.5 + 0.2, alpha: Math.random(), speed: Math.random() * 0.005 + 0.002, dir: Math.random() > 0.5 ? 1 : -1 });
  }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    for (const s of stars) { s.alpha += s.speed * s.dir; if (s.alpha >= 1 || s.alpha <= 0.05) s.dir *= -1; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fillStyle = `rgba(255,255,255,${s.alpha.toFixed(2)})`; ctx.fill(); }
    requestAnimationFrame(draw);
  }
  window.addEventListener('resize', resize); resize(); draw();
})();

// Shooting stars
(function () {
  const c = document.getElementById('shootingStars');
  function spawn() {
    const el = document.createElement('div'); el.className = 'shooting-star';
    el.style.setProperty('--angle', (Math.random() * 30 + 20) + 'deg');
    el.style.top = Math.random() * 60 + '%'; el.style.left = Math.random() * 80 + '%';
    el.style.animationDuration = (Math.random() * 0.8 + 0.6) + 's';
    c.appendChild(el); setTimeout(() => el.remove(), 1500);
  }
  setInterval(spawn, 2800); setTimeout(spawn, 600);
})();

// ──────────────────────────────────────────────────────
//  EVENT LISTENERS
// ──────────────────────────────────────────────────────

// Create room
document.getElementById('createBtn').addEventListener('click', () => {
  const code = generateRoomCode();
  enterRoom(code);
});

// Join room
document.getElementById('joinBtn').addEventListener('click', () => {
  const code = document.getElementById('roomInput').value.trim();
  if (!code) { shake('roomInput'); return; }
  enterRoom(code);
});

document.getElementById('roomInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('joinBtn').click();
});

// Sign out
document.getElementById('signOutBtn').addEventListener('click', showSignInStep);

// ──────────────────────────────────────────────────────
//  INIT
// ──────────────────────────────────────────────────────

renderRecentRooms();

// Check existing session first, then init Google
if (!checkExistingSession()) {
  // Wait for Google script to load, then init
  if (document.readyState === 'complete') {
    initGoogleSignIn();
  } else {
    window.addEventListener('load', initGoogleSignIn);
  }
}

// Utility
function shake(id) {
  const el = document.getElementById(id).closest('.input-wrapper');
  el.style.animation = 'none'; el.offsetHeight; el.style.animation = 'shake 0.4s ease';
  document.getElementById(id).focus();
}
const s = document.createElement('style');
s.textContent = `@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-5px)}80%{transform:translateX(5px)}}`;
document.head.appendChild(s);
