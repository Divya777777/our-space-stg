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
const GOOGLE_CLIENT_ID = '351421523260-04n8q3b4g79ofjpins9sd4m12933b9rl.apps.googleusercontent.com';

let currentUser = null; // { name, email, avatar }

function initGoogleSignIn() {
  if (typeof google === 'undefined' || !google.accounts) {
    console.warn('[AUTH] Google Identity Services not loaded');
    return;
  }

  if (GOOGLE_CLIENT_ID.includes('YOUR_CLIENT_ID_HERE')) {
    console.warn('[AUTH] Google Client ID not configured — sign-in button will not work');
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

async function handleGoogleSignIn(response) {
  try {
    // Authenticate with backend
    const result = await api.loginWithGoogle(response.credential);

    if (!result.success) {
      throw new Error('Backend authentication failed');
    }

    // Store user data
    currentUser = {
      name: result.user.displayName,
      email: result.user.email,
      avatar: result.user.avatarUrl,
      userId: result.user.userId
    };

    // Store in localStorage
    localStorage.setItem('ourspace_avatar', currentUser.avatar);
    localStorage.setItem('ourspace_email', currentUser.email);
    localStorage.setItem('ourspace_userId', currentUser.userId);
    localStorage.setItem('ourspace_name', currentUser.name);

    // Go to name selection step first to confirm/choose name
    showNameStep();

    // Load suggested rooms from database
    await loadSuggestedRooms();

    console.log('[AUTH] Google Sign-In successful:', currentUser.email);

  } catch (err) {
    console.error('[AUTH] Failed to authenticate with backend:', err);
    alert('Sign-in failed. Please try again.');
  }
}

// ──────────────────────────────────────────────────────
//  UI STEPS
// ──────────────────────────────────────────────────────

function showNameStep() {
  document.getElementById('signInStep').style.display = 'none';
  document.getElementById('nameStep').style.display = 'block';

  const avatar = currentUser?.avatar || localStorage.getItem('ourspace_avatar') || '';

  // Show avatar in name step
  if (avatar) {
    const img = document.getElementById('nameStepAvatar');
    img.src = avatar;
    img.style.display = 'block';
  }

  // Pre-fill with Google name as suggestion
  const displayNameInput = document.getElementById('displayNameInput');
  displayNameInput.value = currentUser?.name || localStorage.getItem('ourspace_name') || '';
  displayNameInput.focus();
  displayNameInput.select();
}

function showRoomStep() {
  document.getElementById('signInStep').style.display = 'none';
  document.getElementById('nameStep').style.display = 'none';
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
  document.getElementById('nameStep').style.display = 'none';
  document.getElementById('roomStep').style.display = 'none';
  currentUser = null;
  localStorage.removeItem('ourspace_name');
  localStorage.removeItem('ourspace_avatar');
  localStorage.removeItem('ourspace_email');
}

// Check if user is already signed in (page reload)
async function checkExistingSession() {
  const name = localStorage.getItem('ourspace_name');
  const accessToken = localStorage.getItem('accessToken');

  if (name && accessToken) {
    try {
      // Verify token with backend
      const result = await api.verifyToken();

      if (result.success) {
        currentUser = {
          name: result.user.displayName,
          email: result.user.email,
          avatar: result.user.avatarUrl,
          userId: result.user.userId
        };
        showRoomStep();
        return true;
      }
    } catch (err) {
      console.log('[AUTH] Session expired, need to sign in again');
      // Clear invalid tokens
      api.clearTokens();
    }
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

async function enterRoom(roomCode) {
  const name = currentUser?.name || localStorage.getItem('ourspace_name') || 'You';
  if (!name || name === 'You') return;
  if (!roomCode) return;

  const cleanCode = roomCode.trim().toUpperCase();
  if (cleanCode.length < 4) return;

  // Show loading indicator on join button only
  const joinBtn = document.getElementById('joinBtn');
  const originalJoinText = joinBtn?.textContent;
  if (joinBtn) joinBtn.textContent = 'Joining...';

  try {
    // Join room via backend API
    const result = await api.joinRoom(cleanCode);

    if (!result.success) {
      throw new Error(result.error || 'Failed to join room');
    }

    // Save to recent rooms (localStorage for quick access)
    const displayRoomName = result.room?.roomName || `Room ${cleanCode}`;
    saveRecentRoom(displayRoomName, cleanCode);
    localStorage.setItem('ourspace_name', name);

    // Store all user data in sessionStorage for room.js
    sessionStorage.setItem('currentRoomCode', cleanCode);
    const roomIdToStore = result.room?.roomId || result.roomId || '';
    console.log('[JOIN] Storing roomId in sessionStorage:', roomIdToStore, 'from result:', result);
    sessionStorage.setItem('currentRoomId', roomIdToStore);
    if (result.requestId) {
      sessionStorage.setItem('pendingRequestId', result.requestId);
    } else {
      sessionStorage.removeItem('pendingRequestId');
    }
    sessionStorage.setItem('ourspace_name', name);
    sessionStorage.setItem('ourspace_userId', currentUser?.userId || localStorage.getItem('ourspace_userId') || '');
    sessionStorage.setItem('ourspace_avatar', currentUser?.avatar || localStorage.getItem('ourspace_avatar') || '');
    sessionStorage.setItem('ourspace_email', currentUser?.email || localStorage.getItem('ourspace_email') || '');

    // Navigate to room
    window.location.href = 'room.html';

  } catch (err) {
    console.error('[ROOM] Failed to join room:', err);
    alert(err.message || 'Failed to join room. Please try again.');

    // Reset button text
    if (joinBtn) joinBtn.textContent = originalJoinText;
  }
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

// Load suggested rooms from backend
async function loadSuggestedRooms() {
  try {
    const result = await api.getSuggestedRooms(5);

    if (result.success && result.rooms.length > 0) {
      const section = document.getElementById('recentSection');
      const container = document.getElementById('recentRooms');

      if (!container) return;

      section.style.display = 'block';
      container.innerHTML = result.rooms.map(room => `
        <button class="recent-room-btn" onclick="joinRecent('${escHtml(room.roomCode)}')">
          <span class="recent-moon">${room.visitInfo.isFavorite ? '⭐' : '🌙'}</span>
          <div class="recent-info">
            <div class="recent-room-name">${escHtml(room.roomName || room.roomCode)}</div>
            <div class="recent-room-code">Visited ${room.visitInfo.visitCount} times</div>
          </div>
          <span class="recent-arrow">→</span>
        </button>
      `).join('');

      console.log(`[ROOMS] Loaded ${result.rooms.length} suggested rooms from database`);
    } else {
      // Fall back to localStorage recent rooms
      renderRecentRooms();
    }
  } catch (err) {
    console.log('[ROOMS] Could not load suggested rooms:', err);
    // Fall back to localStorage recent rooms
    renderRecentRooms();
  }
}

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

// Continue from name step to room step
document.getElementById('continueToRoomBtn').addEventListener('click', async () => {
  const displayName = document.getElementById('displayNameInput').value.trim();
  if (!displayName) {
    shake('displayNameInput');
    return;
  }

  const continueBtn = document.getElementById('continueToRoomBtn');
  const originalText = continueBtn.textContent;
  continueBtn.disabled = true;
  continueBtn.textContent = 'Saving...';

  try {
    const result = await api.updateProfile({ displayName });
    if (result.success) {
      console.log('[PROFILE] Updated display name in database successfully');
    }
  } catch (err) {
    console.error('[PROFILE] Failed to update display name in database:', err);
  } finally {
    continueBtn.disabled = false;
    continueBtn.textContent = originalText;

    // Store the user-chosen name
    if (currentUser) {
      currentUser.name = displayName;
    }
    localStorage.setItem('ourspace_name', displayName);

    showRoomStep();
  }
});

// Edit name button from room selection screen
document.getElementById('editNameBtn').addEventListener('click', () => {
  showNameStep();
});

// Allow Enter key to submit name
document.getElementById('displayNameInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('continueToRoomBtn').click();
});

// Create room
document.getElementById('createBtn').addEventListener('click', async () => {
  console.log('[CREATE] Create button clicked');
  const name = currentUser?.name || localStorage.getItem('ourspace_name') || 'You';
  console.log('[CREATE] User name:', name);
  if (!name || name === 'You') {
    console.log('[CREATE] No name, returning early');
    return;
  }

  const createBtn = document.getElementById('createBtn');
  const originalText = createBtn?.textContent;
  if (createBtn) createBtn.textContent = 'Creating...';

  try {
    console.log('[CREATE] Calling API to create room...');
    // Create room via backend API
    const result = await api.createRoom({
      // Don't send roomName at all if not set
      maxMembers: 10,
      isPublic: false,
      requiresApproval: true
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to create room');
    }

    const roomCode = result.room.roomCode;
    const roomId = result.room.roomId;
    console.log('[CREATE] Created room with code:', roomCode, 'and ID:', roomId);

    // Save to recent rooms
    const displayRoomName = result.room?.roomName || `Room ${roomCode}`;
    saveRecentRoom(displayRoomName, roomCode);
    localStorage.setItem('ourspace_name', name);

    // Store all room data in sessionStorage for room.js
    sessionStorage.setItem('currentRoomCode', roomCode);
    console.log('[CREATE] Storing roomId in sessionStorage:', roomId);
    sessionStorage.setItem('currentRoomId', roomId);
    sessionStorage.setItem('ourspace_name', name);
    sessionStorage.setItem('ourspace_userId', currentUser?.userId || localStorage.getItem('ourspace_userId') || '');
    sessionStorage.setItem('ourspace_avatar', currentUser?.avatar || localStorage.getItem('ourspace_avatar') || '');
    sessionStorage.setItem('ourspace_email', currentUser?.email || localStorage.getItem('ourspace_email') || '');

    // Navigate to room
    window.location.href = 'room.html';

  } catch (err) {
    console.error('[ROOM] Failed to create room:', err);
    alert(err.message || 'Failed to create room. Please try again.');
    if (createBtn) createBtn.textContent = originalText;
  }
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
(async function initApp() {
  const hasSession = await checkExistingSession();

  if (!hasSession) {
    // Wait for Google script to load, then init
    if (document.readyState === 'complete') {
      initGoogleSignIn();
    } else {
      window.addEventListener('load', initGoogleSignIn);
    }
  } else {
    // Load suggested rooms from backend
    await loadSuggestedRooms();
  }
})();

// Utility
function shake(id) {
  const el = document.getElementById(id).closest('.input-wrapper');
  el.style.animation = 'none'; el.offsetHeight; el.style.animation = 'shake 0.4s ease';
  document.getElementById(id).focus();
}
const s = document.createElement('style');
s.textContent = `@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-5px)}80%{transform:translateX(5px)}}`;
document.head.appendChild(s);
