/* =====================================================
   room.js — Couple's Room Logic
   WebRTC via PeerJS + YouTube IFrame API
   Room-code-only — no PIN required
   ===================================================== */

const myName = sessionStorage.getItem('ourspace_name') || localStorage.getItem('ourspace_name') || 'You';
const roomId = sessionStorage.getItem('currentRoomCode') || sessionStorage.getItem('ourspace_room') || localStorage.getItem('currentRoomCode') || localStorage.getItem('ourspace_room') || '';
const myAvatar = sessionStorage.getItem('ourspace_avatar') || localStorage.getItem('ourspace_avatar') || '';
const currentUserId = sessionStorage.getItem('ourspace_userId') || localStorage.getItem('ourspace_userId') || '';
const pendingRequestId = sessionStorage.getItem('pendingRequestId') || localStorage.getItem('pendingRequestId') || '';
let isAlreadyMember = localStorage.getItem('member_of_' + roomId) === 'true';

if (!roomId) { window.location.href = 'index.html'; }

// ─── DATABASE INTEGRATION ────────────────────────────
let currentRoomId = sessionStorage.getItem('currentRoomId') || localStorage.getItem('currentRoomId');
if (currentRoomId) {
    currentRoomId = parseInt(currentRoomId);
    console.log('[DATABASE] Current room ID:', currentRoomId);
} else {
    currentRoomId = null;
    console.log('[DATABASE] No room ID found in session or local storage');
}
let roomStartTime = Date.now();
let messageCache = [];
let currentPlaylistId = null;
// Map playlist names to their database IDs
let playlistIdMap = {}; // { "playlistName": "playlistId" }

// ─── END-TO-END ENCRYPTION (AES-256-GCM) ─────────────
// Encrypts all messages, files, and sync data BEFORE sending via WebRTC
// Key derived from room ID — all participants with the same room code can decrypt
let encryptionKey = null;

async function deriveEncryptionKey() {
    // Derive encryption key from roomId only (no PIN)
    const keyMaterial = roomId + '::ourspace_v2_nopin';
    const encoder = new TextEncoder();
    const keyData = encoder.encode(keyMaterial);

    const baseKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        'PBKDF2',
        false,
        ['deriveBits', 'deriveKey']
    );

    const salt = encoder.encode('ourspace_salt_v2_' + roomId);

    encryptionKey = await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: 10000,
            hash: 'SHA-256'
        },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );

    console.log('[ENCRYPTION] 🔐 AES-256-GCM key derived from room code');

    const encryptionStatus = document.getElementById('encryptionStatus');
    if (encryptionStatus) {
        encryptionStatus.style.display = 'block';
        encryptionStatus.title = 'All messages, files, and sync data are encrypted with AES-256-GCM';
    }
}

async function encryptData(data) {
    if (!encryptionKey) await deriveEncryptionKey();

    // Convert data to JSON string then to bytes
    const encoder = new TextEncoder();
    const dataString = typeof data === 'string' ? data : JSON.stringify(data);
    const dataBytes = encoder.encode(dataString);

    // Generate random IV (initialization vector) for each message
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Encrypt with AES-256-GCM
    const encryptedData = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        encryptionKey,
        dataBytes
    );

    // Combine IV + encrypted data for transmission
    const combined = new Uint8Array(iv.length + encryptedData.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encryptedData), iv.length);

    // Convert to base64 for easy transmission
    return btoa(String.fromCharCode(...combined));
}

async function decryptData(encryptedString) {
    if (!encryptionKey) await deriveEncryptionKey();

    try {
        // Decode from base64
        const combined = Uint8Array.from(atob(encryptedString), c => c.charCodeAt(0));

        // Extract IV and encrypted data
        const iv = combined.slice(0, 12);
        const encryptedData = combined.slice(12);

        // Decrypt with AES-256-GCM
        const decryptedData = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            encryptionKey,
            encryptedData
        );

        // Convert bytes back to string
        const decoder = new TextDecoder();
        const dataString = decoder.decode(decryptedData);

        // Try to parse as JSON, otherwise return as string
        try {
            return JSON.parse(dataString);
        } catch {
            return dataString;
        }
    } catch (err) {
        console.error('[ENCRYPTION] ❌ Decryption failed:', err);
        return null; // Invalid key or corrupted data
    }
}

// Encrypt file data (for image/file sharing)
async function encryptFile(arrayBuffer, fileName) {
    if (!encryptionKey) await deriveEncryptionKey();

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encryptedData = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        encryptionKey,
        arrayBuffer
    );

    // Return both IV and encrypted data
    return {
        iv: btoa(String.fromCharCode(...iv)),
        data: btoa(String.fromCharCode(...new Uint8Array(encryptedData))),
        fileName: fileName
    };
}

async function decryptFile(encryptedFile) {
    if (!encryptionKey) await deriveEncryptionKey();

    try {
        const iv = Uint8Array.from(atob(encryptedFile.iv), c => c.charCodeAt(0));
        const data = Uint8Array.from(atob(encryptedFile.data), c => c.charCodeAt(0));

        const decryptedData = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            encryptionKey,
            data
        );

        return {
            data: decryptedData,
            fileName: encryptedFile.fileName
        };
    } catch (err) {
        console.error('[ENCRYPTION] ❌ File decryption failed:', err);
        return null;
    }
}

// ─── ENHANCED STAR BACKGROUND ─────────────────────────
(function initStars() {
    const canvas = document.getElementById('starCanvas');
    const ctx = canvas.getContext('2d');
    let stars = [], W, H;
    const starColors = [
        [255, 255, 255],   // white
        [200, 220, 255],   // blue-white
        [255, 240, 220],   // warm
        [180, 200, 255],   // blue
        [255, 220, 200],   // amber
    ];
    function resize() {
        W = canvas.width = window.innerWidth;
        H = canvas.height = window.innerHeight;
        stars = [];
        for (let i = 0; i < 400; i++) {
            const col = starColors[Math.floor(Math.random() * starColors.length)];
            const isBright = Math.random() < 0.08; // 8% are bright feature stars
            stars.push({
                x: Math.random() * W,
                y: Math.random() * H,
                r: isBright ? Math.random() * 2 + 1.5 : Math.random() * 1.2 + 0.2,
                alpha: Math.random(),
                speed: isBright ? Math.random() * 0.008 + 0.004 : Math.random() * 0.004 + 0.001,
                dir: Math.random() > 0.5 ? 1 : -1,
                col,
                glow: isBright,
            });
        }
    }
    function draw() {
        ctx.clearRect(0, 0, W, H);
        for (const s of stars) {
            s.alpha += s.speed * s.dir;
            if (s.alpha >= 1) { s.alpha = 1; s.dir = -1; }
            if (s.alpha <= 0.03) { s.alpha = 0.03; s.dir = 1; }
            const [r, g, b] = s.col;
            if (s.glow) {
                ctx.shadowBlur = 8;
                ctx.shadowColor = `rgba(${r},${g},${b},${(s.alpha * 0.7).toFixed(2)})`;
            }
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${r},${g},${b},${s.alpha.toFixed(2)})`;
            ctx.fill();
            if (s.glow) ctx.shadowBlur = 0;
        }
        requestAnimationFrame(draw);
    }
    window.addEventListener('resize', resize); resize(); draw();
})();

// ─── REALISTIC SHOOTING STARS ─────────────────────────
(function initShootingStars() {
    const container = document.getElementById('shootingStars');
    function spawn() {
        const el = document.createElement('div');
        el.className = 'shooting-star';
        const angle = Math.random() * 25 + 25;
        const len = Math.random() * 120 + 60;
        const dur = Math.random() * 0.6 + 0.5;
        el.style.setProperty('--angle', angle + 'deg');
        el.style.setProperty('--trail-len', len + 'px');
        el.style.top = Math.random() * 50 + '%';
        el.style.left = Math.random() * 70 + 10 + '%';
        el.style.animationDuration = dur + 's';
        container.appendChild(el);
        setTimeout(() => el.remove(), 1800);
    }
    // Spawn more frequently with occasional bursts
    setInterval(spawn, 2200);
    setTimeout(spawn, 500);
    setTimeout(spawn, 1200);
    // Occasional double
    setInterval(() => { spawn(); setTimeout(spawn, 200); }, 7000);
})();

// ─── EXPAND / MINIMIZE PANELS ─────────────────────────
const myVideoPanel = document.getElementById('myVideoPanel');
const ytPlayerWrapper = document.getElementById('ytPlayerWrapper');

const originalParents = new Map();
let ancestorOverrides = []; // track ancestors we modified

function clearAncestorOverrides() {
    ancestorOverrides.forEach(el => {
        el.style.removeProperty('transform');
        el.style.removeProperty('backdrop-filter');
        el.style.removeProperty('-webkit-backdrop-filter');
        el.style.removeProperty('filter');
        el.style.removeProperty('overflow');
        el.style.removeProperty('contain');
    });
    ancestorOverrides = [];
}

function overrideAncestors(el) {
    // Walk up from el to body, disable properties that create containing blocks
    let node = el.parentElement;
    while (node && node !== document.body) {
        node.style.setProperty('transform', 'none', 'important');
        node.style.setProperty('backdrop-filter', 'none', 'important');
        node.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
        node.style.setProperty('filter', 'none', 'important');
        node.style.setProperty('overflow', 'visible', 'important');
        node.style.setProperty('contain', 'none', 'important');
        ancestorOverrides.push(node);
        node = node.parentElement;
    }
}

function collapseAll() {
    // Restore moved video panels
    originalParents.forEach((info, el) => {
        if (el.parentNode === document.body) {
            info.parent.insertBefore(el, info.next);
        }
    });
    originalParents.clear();
    clearAncestorOverrides();
    document.querySelectorAll('.expanded, .pip, .hidden-expanded').forEach(el => el.classList.remove('expanded', 'pip', 'hidden-expanded'));
    document.querySelectorAll('.expand-btn').forEach(b => { b.textContent = '⛶'; b.title = 'Maximize'; });

    const ytBtn = document.getElementById('ytExpandBtn');
    if (ytBtn) {
        ytBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>`;
        ytBtn.title = 'Maximize';
    }

    document.body.classList.remove('has-expanded');
}

function makePanelPip(vp) {
    vp.classList.add('pip');
    if (!originalParents.has(vp)) {
        originalParents.set(vp, { parent: vp.parentNode, next: vp.nextSibling });
    }
    document.body.appendChild(vp);
}

// Custom listener for the ytExpandBtn 
document.getElementById('ytExpandBtn').addEventListener('click', () => {
    const panel = document.getElementById('ytPlayerWrapper');
    if (panel.classList.contains('expanded')) {
        collapseAll();
        return;
    }
    collapseAll();
    overrideAncestors(panel);
    panel.classList.add('expanded');

    const ytBtn = document.getElementById('ytExpandBtn');
    ytBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>`;
    ytBtn.title = 'Minimize';

    document.body.classList.add('has-expanded');

    // Make video panels PIP and move to body
    Array.from(document.querySelectorAll('.video-panel')).forEach(vp => {
        makePanelPip(vp);
    });
});

const ytCollapseBtn = document.getElementById('ytCollapseBtn');
if (ytCollapseBtn) ytCollapseBtn.addEventListener('click', collapseAll);

function togglePanelExpand(targetId, btn) {
    const panel = document.getElementById(targetId);
    if (!panel) return;

    if (panel.classList.contains('expanded')) {
        collapseAll();
        return;
    }

    collapseAll();

    // For YT player: don't move, override ancestors instead (moving kills iframe)
    if (targetId === 'ytPlayerWrapper') {
        overrideAncestors(panel);
    } else {
        // Video panels can be safely moved to body
        originalParents.set(panel, { parent: panel.parentNode, next: panel.nextSibling });
        document.body.appendChild(panel);
    }

    panel.classList.add('expanded');
    btn.textContent = '✕';
    btn.title = 'Minimize';
    document.body.classList.add('has-expanded');

    // Make other video panels PIP and move to body
    Array.from(document.querySelectorAll('.video-panel')).forEach(vp => {
        if (vp.id !== targetId) {
            makePanelPip(vp);
        }
    });
}

document.querySelectorAll('.expand-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        togglePanelExpand(targetId, btn);
    });
});

// Add click listener using event delegation to allow switching between video panels when in PIP mode (works for dynamic remote panels too)
document.addEventListener('click', (e) => {
    const pipPanel = e.target.closest('.video-panel.pip');
    if (pipPanel) {
        // If clicking the expand button itself, let its own listener handle it
        if (e.target.closest('.expand-btn')) return;

        e.preventDefault();
        e.stopPropagation();
        const btn = pipPanel.querySelector('.expand-btn');
        if (btn) {
            togglePanelExpand(pipPanel.id, btn);
        }
    }
});



// ─── DOM REFS ─────────────────────────────────────────
const roomCodeDisplay = document.getElementById('roomCodeDisplay');
const myNameDisplay = document.getElementById('myNameDisplay');
const connectionStatus = document.getElementById('connectionStatus');
const statusDot = connectionStatus.querySelector('.status-dot');
const statusText = connectionStatus.querySelector('.status-text');
const myVideo = document.getElementById('myVideo');
const myPlaceholder = document.getElementById('myPlaceholder');
const muteBtn = document.getElementById('muteBtn');
const videoBtn = document.getElementById('videoBtn');
const startCallBtn = document.getElementById('startCallBtn');
const leaveBtn = document.getElementById('leaveBtn');
const copyRoomBtn = document.getElementById('copyRoomBtn');
const screenShareBtn = document.getElementById('screenShareBtn');
const screenShareMenu = document.getElementById('screenShareMenu');
const presentingBanner = document.getElementById('presentingBanner');
const stopPresentingBtn = document.getElementById('stopPresentingBtn');

// YouTube DOM
const ytUrlInput = document.getElementById('ytUrlInput');
const ytLoadBtn = document.getElementById('ytLoadBtn');
const musicIdle = document.getElementById('musicIdle');
const ytNowPlayingCard = document.getElementById('ytNowPlayingCard');
const ytNowPlayingWho = document.getElementById('ytNowPlayingWho');
const ytTrackTitle = document.getElementById('ytTrackTitle');
const ytProgressBg = document.getElementById('ytProgressBg');
const ytProgressFill = document.getElementById('ytProgressFill');
const ytCurrentTimeEl = document.getElementById('ytCurrentTime');
const ytTotalTimeEl = document.getElementById('ytTotalTime');
const ytPlayPauseBtn = document.getElementById('ytPlayPauseBtn');
const ytVolumeSlider = document.getElementById('ytVolumeSlider');
const ytSyncText = document.getElementById('ytSyncText');

// ─── INIT UI ──────────────────────────────────────────
roomCodeDisplay.textContent = roomId;
myNameDisplay.textContent = myName;

// ─── TOAST ────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3500) {
    const el = document.createElement('div');
    el.className = `toast ${type}`; el.textContent = msg;
    document.getElementById('toastContainer').appendChild(el);
    setTimeout(() => { el.style.animation = 'toastOut 0.3s ease forwards'; setTimeout(() => el.remove(), 300); }, duration);
}

// ─── COPY / LEAVE ─────────────────────────────────────
copyRoomBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(roomId).then(() => toast('Room code copied! 📋', 'success'));
});

leaveBtn.addEventListener('click', () => {
    if (peer) peer.destroy();
    if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
    sessionStorage.clear();
    window.location.href = 'index.html';
});

// ─── STATUS ───────────────────────────────────────────
function setStatus(state, text) {
    statusDot.className = 'status-dot ' + state;
    statusText.textContent = text;
}

// ─── AUTH MODAL ───────────────────────────────────────
let pendingAuthConns = {};

document.getElementById('authAcceptBtn').addEventListener('click', () => {
    document.getElementById('authModal').classList.remove('show');
    for (const peerId in pendingAuthConns) {
        const p = pendingAuthConns[peerId];
        acceptPeer(p.conn, p.name, p.requestId);
    }
    pendingAuthConns = {};
    updatePendingBadge();
    updateMembersPanel();
});

document.getElementById('authRejectBtn').addEventListener('click', () => {
    document.getElementById('authModal').classList.remove('show');
    for (const peerId in pendingAuthConns) {
        const p = pendingAuthConns[peerId];
        p.conn.send({ type: 'auth_rejected' });
        if (p.requestId && typeof api !== 'undefined') {
            api.approveJoinRequest(p.requestId, false)
                .catch(err => console.error('[DATABASE] Failed to reject join request in db:', err));
        }
        setTimeout(() => p.conn.close(), 1000);
    }
    pendingAuthConns = {};
    updatePendingBadge();
    updateMembersPanel();
});

// ─────────────────────────────────────────────────────
//  MEMBERS PANEL
// ─────────────────────────────────────────────────────
const membersBtn = document.getElementById('membersBtn');
const membersPanel = document.getElementById('membersPanel');
const membersOverlay = document.getElementById('membersOverlay');
const closeMembersPanel = document.getElementById('closeMembersPanel');
const pendingCountBadge = document.getElementById('pendingCountBadge');

// Toggle members panel
membersBtn.addEventListener('click', () => {
    membersPanel.classList.add('show');
    membersOverlay.classList.add('show');
    updateMembersPanel();
});

// Close panel
closeMembersPanel.addEventListener('click', closeMembersPanelFunc);
membersOverlay.addEventListener('click', closeMembersPanelFunc);

function closeMembersPanelFunc() {
    membersPanel.classList.remove('show');
    membersOverlay.classList.remove('show');
}

// Update members panel content
function updateMembersPanel() {
    // Update pending requests
    const pendingRequestsList = document.getElementById('pendingRequestsList');
    const pendingRequestsSection = document.getElementById('pendingRequestsSection');
    const pendingRequestsCount = document.getElementById('pendingRequestsCount');
    const pendingCount = Object.keys(pendingAuthConns).length;

    if (pendingCount > 0) {
        pendingRequestsSection.style.display = 'block';
        pendingRequestsCount.textContent = pendingCount;
        pendingRequestsList.innerHTML = '';

        for (const peerId in pendingAuthConns) {
            const p = pendingAuthConns[peerId];
            const itemDiv = document.createElement('div');
            itemDiv.className = 'member-item pending-item';
            itemDiv.innerHTML = `
                <div class="member-avatar">👤</div>
                <div class="member-info">
                    <div class="member-name">${p.name || 'Guest'}</div>
                    <div class="member-status">
                        <span class="status-dot"></span>
                        Waiting for approval
                    </div>
                </div>
                <div class="member-actions">
                    <button class="member-action-btn reject-btn" onclick="rejectPeerFromPanel('${peerId}')">Reject</button>
                    <button class="member-action-btn accept-btn" onclick="acceptPeerFromPanel('${peerId}')">Accept</button>
                </div>
            `;
            pendingRequestsList.appendChild(itemDiv);
        }
    } else {
        pendingRequestsSection.style.display = 'none';
    }

    // Update current members
    const currentMembersList = document.getElementById('currentMembersList');
    const currentMembersCount = document.getElementById('currentMembersCount');
    const memberCount = Object.keys(peersMap).length + 1; // +1 for self
    currentMembersCount.textContent = memberCount;
    currentMembersList.innerHTML = '';

    // Add self
    const selfDiv = document.createElement('div');
    selfDiv.className = 'member-item';
    selfDiv.innerHTML = `
        <div class="member-avatar">${myAvatar ? `<img src="${myAvatar}" alt="${myName}">` : '👤'}</div>
        <div class="member-info">
            <div class="member-name">
                ${myName} (You)
                ${isHost ? '<span class="host-badge">HOST</span>' : ''}
            </div>
            <div class="member-status">
                <span class="status-dot"></span>
                Connected
            </div>
        </div>
    `;
    currentMembersList.appendChild(selfDiv);

    // Add other members
    for (const peerId in peersMap) {
        const peer = peersMap[peerId];
        const memberDiv = document.createElement('div');
        memberDiv.className = 'member-item';
        memberDiv.innerHTML = `
            <div class="member-avatar">👤</div>
            <div class="member-info">
                <div class="member-name">
                    ${peer.name || 'Guest'}
                    ${peerId === hostId ? '<span class="host-badge">HOST</span>' : ''}
                </div>
                <div class="member-status">
                    <span class="status-dot"></span>
                    Connected
                </div>
            </div>
        `;
        currentMembersList.appendChild(memberDiv);
    }

    if (memberCount === 1) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-state';
        emptyDiv.innerHTML = `
            <div class="empty-state-icon">🌙</div>
            <div>You're the only one here.<br>Share the room code to invite others!</div>
        `;
        currentMembersList.appendChild(emptyDiv);
    }

    // Update badge on members button
    updatePendingBadge();
}

// Update pending count badge
function updatePendingBadge() {
    const pendingCount = Object.keys(pendingAuthConns).length;
    if (pendingCount > 0) {
        pendingCountBadge.textContent = pendingCount;
        pendingCountBadge.style.display = 'block';
    } else {
        pendingCountBadge.style.display = 'none';
    }
}

// Accept peer from panel
window.acceptPeerFromPanel = function (peerId) {
    const p = pendingAuthConns[peerId];
    if (p) {
        acceptPeer(p.conn, p.name, p.requestId);
        delete pendingAuthConns[peerId];
        updateMembersPanel();

        // Close modal if no more pending requests
        if (Object.keys(pendingAuthConns).length === 0) {
            document.getElementById('authModal').classList.remove('show');
        }
    }
};

// Reject peer from panel
window.rejectPeerFromPanel = function (peerId) {
    const p = pendingAuthConns[peerId];
    if (p) {
        p.conn.send({ type: 'auth_rejected' });
        if (p.requestId && typeof api !== 'undefined') {
            api.approveJoinRequest(p.requestId, false)
                .catch(err => console.error('[DATABASE] Failed to reject join request in db:', err));
        }
        setTimeout(() => p.conn.close(), 1000);
        delete pendingAuthConns[peerId];
        updateMembersPanel();

        // Close modal if no more pending requests
        if (Object.keys(pendingAuthConns).length === 0) {
            document.getElementById('authModal').classList.remove('show');
        }
    }
};

// ─────────────────────────────────────────────────────
//  WEBRTC / PEERJS
// ─────────────────────────────────────────────────────
let peer = null, localStream = null;
let isMuted = false, isVideoOff = false, isInCall = false;
let isScreenSharing = false;
let screenStream = null;
let originalLocalStream = null;
let audioContext = null;

let hostId = '';
let isHost = false;
const peersMap = {};

async function hashRoomId(str) {
    const data = new TextEncoder().encode(str);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 20);
}

// Secure send wrapper - encrypts messages before sending
async function secureSend(conn, msg) {
    // Don't encrypt join/welcome and handshake messages
    if (msg.type === 'join' || msg.type === 'welcome' ||
        msg.type === 'peer_intro' ||
        msg.type === 'sync_ping' || msg.type === 'sync_pong') {
        conn.send(msg);
        return;
    }

    // Encrypt all other messages
    try {
        const encrypted = await encryptData(msg);
        conn.send({ type: 'encrypted', data: encrypted });
    } catch (err) {
        console.error('[SYNC] ❌ Failed to encrypt/send message:', msg.type, err);
        toast('Failed to send sync message — encryption error', 'error');
    }
}

// Secure broadcast - encrypts and sends to all peers
async function broadcast(msg, excludeId = null) {
    const peers = Object.entries(peersMap);
    let sentCount = 0;
    for (const [id, p] of peers) {
        if (p.dataConn && p.dataConn.open && p.dataConn.peer !== excludeId) {
            await secureSend(p.dataConn, msg);
            sentCount++;
        } else if (p.dataConn && !p.dataConn.open) {
            console.warn(`[SYNC] ⚠️ Skipping peer ${p.name} (${id}) — connection not open`);
        }
    }
    if (sentCount === 0 && peers.length > 0) {
        console.warn(`[SYNC] ⚠️ Broadcast ${msg.type} sent to 0 peers! All ${peers.length} connections are closed.`);
    }
    console.log(`[SYNC] 📤 Broadcast ${msg.type} to ${sentCount}/${peers.length} peers`);
}

async function sendSync(msg) { await broadcast(msg); }

// Connection health check — verifies encrypted messaging works after auth
function sendSyncPing(conn) {
    const pingData = { type: 'sync_ping', ts: Date.now(), nonce: Math.random().toString(36).slice(2) };
    conn.send(pingData);
    console.log('[SYNC] 🏓 Sent sync_ping to verify connection');
}

// ─── PEERJS RECONNECTION MANAGER ─────────────────────────
let reconnectTimer = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

function attemptReconnect() {
    if (!peer || peer.destroyed) return;

    if (peer.open) {
        reconnectAttempts = 0;
        return;
    }

    if (reconnectTimer) {
        return; // Already scheduled
    }

    reconnectAttempts++;
    if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        console.error('[PEER] Max reconnect attempts reached. Please reload the page.');
        toast('Connection to signaling server lost. Please refresh the page.', 'error', 10000);
        setStatus('disconnected', 'Connection lost. Please refresh.');
        return;
    }

    const delay = Math.min(1500 * Math.pow(2, reconnectAttempts - 1) + Math.random() * 1000, 15000);
    console.warn(`[PEER] Attempting reconnect ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${Math.round(delay)}ms...`);

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (!peer || peer.destroyed) return;
        peer.reconnect();
    }, delay);
}

async function setupPeer() {
    setStatus('connecting', 'Connecting…');
    hostId = (await hashRoomId(roomId)) + 'h'; // PeerJS IDs: alphanumeric only, no underscores

    let isHostOnline = true;
    // Fetch room details to identify the true host
    try {
        console.log('[PEER] Fetching room details to identify host...');
        const roomDetails = await api.getRoomByCode(roomId);
        if (roomDetails && roomDetails.success && roomDetails.room) {
            const dbHostUserId = roomDetails.room.host.userId;
            isHost = (currentUserId.toString() === dbHostUserId.toString());
            isAlreadyMember = roomDetails.room.members.some(m => m.userId.toString() === currentUserId.toString());
            if (isAlreadyMember) {
                localStorage.setItem('member_of_' + roomId, 'true');
            } else {
                localStorage.removeItem('member_of_' + roomId);
            }

            const hostMember = roomDetails.room.members.find(m => m.userId.toString() === dbHostUserId.toString());
            isHostOnline = hostMember ? hostMember.isOnline : false;

            currentRoomId = parseInt(roomDetails.room.roomId);
            sessionStorage.setItem('currentRoomId', currentRoomId);
            localStorage.setItem('currentRoomId', currentRoomId);

            console.log('[PEER] Room host user ID:', dbHostUserId, 'My user ID:', currentUserId, 'Am I Host?', isHost, 'Am I already a member?', isAlreadyMember, 'Is Host Online?', isHostOnline, 'Room ID:', currentRoomId);
        } else {
            console.warn('[PEER] Could not identify host from database response');
        }
    } catch (err) {
        console.error('[PEER] Failed to fetch room details from API:', err);
    }

    // Auto-detect: use local server if running on localhost/custom port, otherwise use cloud
    const isLocalServer = window.location.protocol === 'http:' &&
        (window.location.hostname === 'localhost' ||
            window.location.hostname === '127.0.0.1' ||
            window.location.port !== '');

    // Build the ICE server list: always include public STUN servers so a direct
    // P2P connection is attempted first (fast, no relay).  TURN credentials are
    // fetched from the backend and ADDED to the list as a fallback — they are
    // only used when the direct/STUN path cannot be established (e.g. mobile
    // carrier-grade NAT).  The previous code replaced STUN with TURN, forcing
    // all traffic through the relay even when a direct route was available.
    let iceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
    ];
    try {
        const turnConfig = await api.getIceServers();
        if (turnConfig?.success && Array.isArray(turnConfig.iceServers)) {
            const cloudflareServers = turnConfig.iceServers.map(server => ({
                ...server,
                // Cloudflare documents port 53 as blocked by major browsers;
                // omit it to avoid slow candidate timeouts.
                urls: (Array.isArray(server.urls) ? server.urls : [server.urls])
                    .filter(url => url && !url.includes(':53'))
            })).filter(server => server.urls.length > 0);

            // ADD TURN to the existing STUN list — do NOT replace it.
            // WebRTC will try all candidates in parallel and use the fastest route.
            iceServers = [...iceServers, ...cloudflareServers];
            console.log('[PEER] TURN fallback added; direct/STUN routes are still preferred.');
        }
    } catch (error) {
        // Calls may still succeed via STUN/direct. This preserves service if the
        // TURN credential endpoint or Cloudflare is temporarily unavailable.
        console.warn('[PEER] TURN fallback unavailable; trying direct/STUN connectivity only.', error.message);
    }

    const peerConfig = {
        config: {
            iceServers,
            iceTransportPolicy: 'all'
        },
        debug: 0 // Set to 3 for verbose debugging if needed
    };

    // Configure PeerJS server dynamically based on environment and API configuration
    if (window.location.hostname === 'divya777777.github.io') {
        // Production/Staging: Use PeerJS cloud server to prevent Railway WebSocket / firewall blocks in Germany
        console.log('[PEER] Using PeerJS cloud server (free, reliable, global availability)');
    } else if (typeof api !== 'undefined' && api.baseURL) {
        try {
            const baseOrigin = api.baseURL.replace(/\/api\/?$/, '');
            const url = new URL(baseOrigin);

            peerConfig.host = url.hostname;
            peerConfig.port = url.port ? parseInt(url.port) : (url.protocol === 'https:' ? 443 : 80);
            peerConfig.path = '/peerjs';
            peerConfig.secure = (url.protocol === 'https:');

            console.log('[PEER] Dynamically configured PeerJS using api.baseURL:',
                `${peerConfig.secure ? 'https' : 'http'}://${peerConfig.host}:${peerConfig.port}${peerConfig.path}`);
        } catch (err) {
            console.error('[PEER] Failed to parse api.baseURL for PeerJS configuration:', err);
            // Fallback to PeerJS Cloud
            delete peerConfig.host;
            delete peerConfig.port;
            delete peerConfig.path;
            delete peerConfig.secure;
        }
    } else {
        // Fallback: Use default PeerJS cloud
        console.log('[PEER] Using CLOUD PeerJS server (default)');
    }

    return new Promise((resolve) => {
        if (isHost) {
            console.log('[PEER] Initializing as Host with ID:', hostId);
            peer = new Peer(hostId, peerConfig);

            peer.on('open', id => {
                isHost = true;
                reconnectAttempts = 0;
                if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
                console.log('[HOST] Successfully registered as host with ID:', id);
                toast(`Connected as Host. 🌙`, 'success', 5000);
                setStatus('connected', 'Waiting for guests…');
                setupHostListeners();
                resolve();
            });

            peer.on('error', err => {
                console.error('[HOST] PeerJS error:', err.type || err);
                if (err.type === 'unavailable-id') {
                    if (reconnectAttempts > 0) {
                        console.warn('[HOST] Reconnect hit stale session on server. Retrying...');
                        attemptReconnect();
                    } else {
                        // Host ID is already taken (e.g. page reload or duplicate tab)
                        toast('You are already connected to this room in another tab or device.', 'warning', 5000);
                        setStatus('disconnected', 'Already connected elsewhere.');
                        resolve();
                    }
                } else if (err.type === 'peer-unavailable') {
                    console.log('[HOST] Tried to connect to offline guest (normal).');
                } else {
                    toast('Network error connecting to server. Check console for details.', 'error');
                    if (reconnectAttempts > 0 || !peer.open) {
                        attemptReconnect();
                    }
                }
            });

            peer.on('disconnected', () => {
                console.warn('[HOST] Disconnected from signaling server, attempting reconnect...');
                attemptReconnect();
            });
        } else {
            // Generate predictable PeerJS ID based on room and user ID
            hashRoomId(roomId).then(hashedRoom => {
                const guestPeerId = hashedRoom + 'u' + currentUserId;
                console.log('[PEER] Initializing as Guest with ID:', guestPeerId);
                peer = new Peer(guestPeerId, peerConfig);

                // Set up guest-to-guest connection listener (exactly once)
                peer.on('connection', conn => {
                    console.log('[GUEST] Incoming connection from peer:', conn.peer);
                    conn.on('data', async msg => {
                        // Handle unencrypted peer intro
                        if (msg.type === 'peer_intro') {
                            setupGuestToGuest(conn, msg.name);
                            toast(`${msg.name} joined!`, 'info');
                            return;
                        }
                        // Handle sync health check
                        if (msg.type === 'sync_ping') {
                            conn.send({ type: 'sync_pong', ts: msg.ts, nonce: msg.nonce });
                            return;
                        }
                        if (msg.type === 'sync_pong') {
                            console.log('[SYNC] ✅ sync_pong from peer', conn.peer);
                            return;
                        }

                        // Decrypt encrypted messages
                        if (msg.type === 'encrypted') {
                            const decrypted = await decryptData(msg.data);
                            if (decrypted && peersMap[conn.peer]) {
                                handleSyncMessage(decrypted, conn.peer);
                            } else if (!decrypted) {
                                console.error('[SYNC] ❌ Decryption FAILED from peer', conn.peer);
                                toast('Sync error: could not decrypt message from partner', 'error');
                            }
                        } else if (peersMap[conn.peer]) {
                            // Fallback for unencrypted messages
                            handleSyncMessage(msg, conn.peer);
                        }
                    });
                    conn.on('close', () => handlePeerDisconnect(conn.peer, conn));
                });

                peer.on('call', call => handleIncomingCall(call));

                peer.on('open', id => {
                    reconnectAttempts = 0;
                    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
                    console.log('[GUEST] Successfully registered as guest with ID:', id);
                    if (isAlreadyMember) {
                        console.log('[GUEST] I am already a member. Entering room immediately and establishing silent connections.');
                        setStatus('connected', isHostOnline ? 'Connected' : 'Connected (Host Offline)');
                        if (!isHostOnline) {
                            toast('Connected to room! The host is currently offline.', 'info', 5000);
                        }
                        sessionStorage.removeItem('pendingRequestId');

                        connectToOtherMembers();
                        setInterval(connectToOtherMembers, 10000);
                        resolve();
                    } else {
                        setStatus('connecting', 'Connecting to Host…');
                        connectToHost();
                        resolve();
                    }
                });

                peer.on('error', err => {
                    console.error('[GUEST] PeerJS error:', err.type || err);
                    if (err.type === 'unavailable-id') {
                        if (reconnectAttempts > 0) {
                            console.warn('[GUEST] Reconnect hit stale session on server. Retrying...');
                            attemptReconnect();
                        } else {
                            toast('You are already connected to this room in another tab or device.', 'warning', 5000);
                            setStatus('disconnected', 'Already connected elsewhere.');
                            resolve();
                        }
                    } else if (err.type === 'peer-unavailable') {
                        console.log('[GUEST] Background reconnection target is offline (normal).');
                    } else {
                        toast('Network error connecting to server. Check console for details.', 'error');
                        if (reconnectAttempts > 0 || !peer.open) {
                            attemptReconnect();
                        }
                    }
                });

                peer.on('disconnected', () => {
                    console.warn('[GUEST] Disconnected from signaling server, attempting reconnect...');
                    attemptReconnect();
                });
            });
        }
    });
}

function setupHostListeners() {
    console.log('[HOST] Setting up listeners for incoming connections');
    console.log('[HOST] Host ID:', hostId);

    peer.on('connection', conn => {
        console.log('[HOST] Incoming connection from peer:', conn.peer, 'serialization:', conn.serialization);
        console.log('[HOST] Current isHost status:', isHost);

        conn.on('data', async msg => {
            // Guest sends 'auth_request'
            if (msg.type === 'auth_request') {
                console.log('[HOST] Auth request from:', msg.name, 'avatar:', msg.avatar, 'requestId:', msg.requestId);

                // If guest is already a member, auto-accept immediately
                try {
                    const roomDetails = await api.getRoomByCode(roomId);
                    if (roomDetails && roomDetails.success && roomDetails.room) {
                        const isGuestAlreadyMember = roomDetails.room.members.some(m => m.userId.toString() === msg.userId.toString());
                        if (isGuestAlreadyMember) {
                            console.log('[HOST] Guest is already a member. Auto-accepting connection!');
                            acceptPeer(conn, msg.name || 'Guest', msg.requestId);
                            return;
                        }
                    }
                } catch (err) {
                    console.error('[HOST] Failed to verify guest membership status:', err);
                }

                pendingAuthConns[conn.peer] = {
                    conn,
                    name: msg.name || 'Guest',
                    userId: msg.userId || null,
                    requestId: msg.requestId || null
                };

                // Validate modal elements exist before showing
                const authModal = document.getElementById('authModal');
                const authDesc = document.getElementById('authDesc');

                if (!authModal) {
                    console.error('[HOST] authModal element not found! Cannot show knock-knock notification.');
                    return;
                }

                if (authDesc) {
                    authDesc.textContent = `${msg.name || 'Someone'} wants to join the room.`;
                }

                authModal.classList.add('show');
                console.log('[HOST] Knock-knock modal displayed for:', msg.name);

                // Update members panel and badge
                updatePendingBadge();
                return;
            }

            // Handle sync health check
            if (msg.type === 'sync_ping') {
                conn.send({ type: 'sync_pong', ts: msg.ts, nonce: msg.nonce });
                console.log('[SYNC] 🏓 Replied to sync_ping from', conn.peer);
                return;
            }
            if (msg.type === 'sync_pong') {
                console.log('[SYNC] ✅ sync_pong received from', conn.peer, '- connection verified!');
                try {
                    const testMsg = { type: 'sync_test', ts: Date.now() };
                    const encrypted = await encryptData(testMsg);
                    conn.send({ type: 'encrypted', data: encrypted });
                    console.log('[SYNC] 🔐 Sent encrypted test message to', conn.peer);
                } catch (err) {
                    console.error('[SYNC] ❌ Encryption test failed:', err);
                    toast('Encryption not working — sync may fail!', 'error');
                }
                return;
            }

            // Decrypt encrypted messages
            if (msg.type === 'encrypted') {
                const decrypted = await decryptData(msg.data);
                if (decrypted && peersMap[conn.peer]) {
                    if (decrypted.type === 'sync_test') {
                        console.log('[SYNC] ✅ Encrypted test from', conn.peer, 'decrypted OK — E2E working!');
                        toast('Sync connection verified ✅', 'success', 2000);
                        return;
                    }
                    handleSyncMessage(decrypted, conn.peer);
                } else if (!decrypted) {
                    console.error('[SYNC] ❌ Decryption FAILED for message from', conn.peer);
                    toast('Sync error: could not decrypt message from partner', 'error');
                }
            } else if (peersMap[conn.peer]) {
                handleSyncMessage(msg, conn.peer);
            }
        });

        conn.on('close', () => {
            console.log('[HOST] Peer disconnected:', conn.peer);
            handlePeerDisconnect(conn.peer, conn);
        });

        conn.on('error', (err) => {
            console.error('[HOST] Connection error with peer:', conn.peer, err);
        });
    });

    peer.on('call', call => {
        console.log('[HOST] Incoming call from:', call.peer);
        handleIncomingCall(call);
    });
}




// ─── AUDIT LOGGING SYSTEM ─────────────────────────────
const AUDIT_LOG_DB = 'OurSpaceAuditLog';
let auditDB = null;

function initAuditLog() {
    const request = indexedDB.open(AUDIT_LOG_DB, 1);

    request.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('logs')) {
            const store = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
            store.createIndex('timestamp', 'timestamp', { unique: false });
            store.createIndex('event', 'event', { unique: false });
            store.createIndex('roomId', 'roomId', { unique: false });
        }
    };

    request.onsuccess = e => {
        auditDB = e.target.result;
        console.log('[AUDIT] 📋 Audit logging initialized');
    };

    request.onerror = e => {
        console.error('[AUDIT] Failed to initialize audit log:', e);
    };
}

function logAuthEvent(event, details) {
    if (!auditDB) return;

    const logEntry = {
        timestamp: Date.now(),
        event: event,
        roomId: roomId,
        peerId: details.peerId || 'unknown',
        guestName: details.guestName || 'unknown',
        success: details.success !== false,
        reason: details.reason || null,
        method: details.method || null
    };

    try {
        const tx = auditDB.transaction(['logs'], 'readwrite');
        const store = tx.objectStore('logs');
        store.add(logEntry);

        console.log(`[AUDIT] ${logEntry.success ? '✅' : '⚠️'} ${event}:`, details);

        // Cleanup old logs (keep last 1000 entries)
        tx.oncomplete = () => {
            cleanupOldLogs();
        };
    } catch (err) {
        console.error('[AUDIT] Failed to write log:', err);
    }
}

function cleanupOldLogs() {
    if (!auditDB) return;

    try {
        const tx = auditDB.transaction(['logs'], 'readwrite');
        const store = tx.objectStore('logs');
        const countRequest = store.count();

        countRequest.onsuccess = () => {
            const count = countRequest.result;
            if (count > 1000) {
                // Delete oldest entries
                const deleteCount = count - 1000;
                const index = store.index('timestamp');
                const cursorRequest = index.openCursor();
                let deleted = 0;

                cursorRequest.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor && deleted < deleteCount) {
                        cursor.delete();
                        deleted++;
                        cursor.continue();
                    }
                };
            }
        };
    } catch (err) {
        console.error('[AUDIT] Failed to cleanup logs:', err);
    }
}

// Get recent audit logs (for debugging/admin view)
function getAuditLogs(limit = 50) {
    return new Promise((resolve, reject) => {
        if (!auditDB) {
            resolve([]);
            return;
        }

        try {
            const tx = auditDB.transaction(['logs'], 'readonly');
            const store = tx.objectStore('logs');
            const index = store.index('timestamp');
            const request = index.openCursor(null, 'prev');  // Reverse order (newest first)

            const logs = [];
            request.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor && logs.length < limit) {
                    logs.push(cursor.value);
                    cursor.continue();
                } else {
                    resolve(logs);
                }
            };

            request.onerror = () => reject(request.error);
        } catch (err) {
            reject(err);
        }
    });
}

// Initialize audit logging
initAuditLog();

// ─── LOCALSTORAGE ENCRYPTION ──────────────────────────
// Encrypt sensitive localStorage data (playlists, tokens, recent rooms)

async function encryptLocalStorage(key, data) {
    try {
        const encrypted = await encryptData(data);
        localStorage.setItem(key, encrypted);
        return true;
    } catch (err) {
        console.error('[STORAGE] Failed to encrypt data:', err);
        return false;
    }
}

async function decryptLocalStorage(key) {
    try {
        const encrypted = localStorage.getItem(key);
        if (!encrypted) return null;

        // Try to decrypt
        const decrypted = await decryptData(encrypted);
        if (decrypted) return decrypted;

        // If decryption fails, might be old unencrypted data
        // Try to parse as JSON
        try {
            return JSON.parse(encrypted);
        } catch {
            return null;
        }
    } catch (err) {
        console.error('[STORAGE] Failed to decrypt data:', err);
        return null;
    }
}

// Wrapper functions for secure storage
async function saveSecureData(key, data) {
    await encryptLocalStorage(key, data);
}

async function loadSecureData(key) {
    return await decryptLocalStorage(key);
}

// ─── AUTOMATIC CLEANUP UTILITIES ──────────────────────

function cleanupOldRoomData() {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('ourspace_playlist_')) {
            const roomCode = key.replace('ourspace_playlist_', '');
            if (roomCode !== roomId) {
                keysToRemove.push(key);
            }
        }
    }
    if (keysToRemove.length > 0) {
        console.log(`[CLEANUP] 🧹 Found ${keysToRemove.length} old room data entries`);
    }
}

function deleteAllRoomData() {
    if (!confirm('Delete ALL room data including chat history and playlists? This cannot be undone!')) {
        return;
    }
    Object.keys(localStorage).forEach(key => {
        if (key.startsWith('ourspace_')) {
            localStorage.removeItem(key);
        }
    });
    indexedDB.deleteDatabase(CHAT_DB_NAME);
    indexedDB.deleteDatabase(AUDIT_LOG_DB);
    console.log('[CLEANUP] 🧹 All room data deleted');
    toast('All data deleted successfully', 'success');
    setTimeout(() => { window.location.href = 'index.html'; }, 1000);
}

// Run cleanup every hour
setInterval(() => { cleanupOldRoomData(); }, 60 * 60 * 1000);

window.deleteAllRoomData = deleteAllRoomData;

// Security status command
window.showSecurityStatus = async function () {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔐 SECURITY STATUS REPORT');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📊 Encryption:');
    console.log(`  ✅ E2E Encryption: ${encryptionKey ? 'ACTIVE (AES-256-GCM)' : 'INACTIVE'}`);
    console.log(`  ✅ Room Hash: SHA-256`);
    console.log('\n🛡️ Authentication: Room-code-only (auto-accept)');
    console.log('\n👥 Active Connections:');
    console.log(`  • Role: ${isHost ? 'HOST' : 'GUEST'}`);
    console.log(`  • Peers: ${Object.keys(peersMap).length}`);
    Object.values(peersMap).forEach((peer, i) => {
        console.log(`    ${i + 1}. ${peer.name} ${peer.dataConn.open ? '🟢' : '🔴'}`);
    });
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
};

setTimeout(() => {
    console.log('\n🔐 Room-code auth active! Type showSecurityStatus() for details.\n');
}, 2000);

function acceptPeer(conn, guestName, requestId) {
    const newPeerId = conn.peer;
    if (isHost) {
        setStatus('connected', 'Connected');
    }

    // Approve the request in the database if there is a requestId
    if (requestId && typeof api !== 'undefined') {
        console.log('[DATABASE] Approving pending join request', requestId, 'for guest', guestName);
        api.approveJoinRequest(requestId, true)
            .then(res => {
                console.log('[DATABASE] Successfully approved join request in db:', res);
            })
            .catch(err => {
                console.error('[DATABASE] Failed to approve join request in db:', err);
            });
    }

    // Add to peersMap BEFORE sending welcome to avoid race conditions
    peersMap[newPeerId] = { dataConn: conn, name: guestName, callConn: null, stream: null };

    // Get list of other peers (excluding the new guest)
    const activePeers = Object.keys(peersMap)
        .filter(id => id !== newPeerId)
        .map(id => ({ id, name: peersMap[id].name }));

    // Send welcome message with error handling
    try {
        conn.send({
            type: 'welcome',
            hostName: myName,
            roomId: currentRoomId, // Send database room ID!
            peers: activePeers,
            hostPlaylists: roomPlaylists,
            ytState: {
                videoId: ytVideoId,
                // Stamp the wall-clock so the joining device can add elapsed
                // travel time when it finally starts playing, keeping them in sync.
                time: ytPlayer?.getCurrentTime?.() || 0,
                sentAt: Date.now(),
                playing: ytPlaying,
                stateVersion: ytStateVersion,
            }
        });
        console.log('[HOST] Welcome message sent to:', guestName);
    } catch (err) {
        console.error('[HOST] Failed to send welcome message to', guestName, ':', err);
        delete peersMap[newPeerId];  // Clean up if welcome failed
        toast(`Failed to accept ${guestName}`, 'error');
        return;
    }

    broadcast({ type: 'guest_joined', id: newPeerId, name: guestName }, newPeerId);

    toast(`${guestName} joined! 🌙`, 'success');
    renderChatRecipientDropdown();

    // Update members panel when guest joins
    if (typeof updateMembersPanel === 'function') {
        updateMembersPanel();
    }

    // Send sync ping to verify the connection works
    setTimeout(() => sendSyncPing(conn), 1000);

    if (isInCall && localStream && peersMap[newPeerId] && !peersMap[newPeerId].callConn) {
        const call = createMediaCall(newPeerId, localStream);
        if (call) handleOutboundCall(call, newPeerId);
    }
}

let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 5;
let connectionTimeout = null;

function connectToHost(retryCount = 0) {
    const delay = retryCount === 0 ? 2000 : 2000 + (retryCount * 1000);

    console.log(`[GUEST] Attempting to connect to host (attempt ${retryCount + 1}/${MAX_CONNECTION_ATTEMPTS}) in ${delay}ms...`);
    setStatus('connecting', `Connecting to host... (attempt ${retryCount + 1}/${MAX_CONNECTION_ATTEMPTS})`);

    setTimeout(() => {
        connectionAttempts = retryCount;

        const hostConn = peer.connect(hostId, {
            reliable: true,
            serialization: 'json'
        });

        connectionTimeout = setTimeout(() => {
            if (!peersMap[hostId]) {
                console.warn('[GUEST] Connection timeout, host not responding');
                hostConn.close();
                handleConnectionFailure(retryCount);
            }
        }, 10000);

        hostConn.on('open', () => {
            console.log('[GUEST] Data channel opened to host');
            console.log('[GUEST] Sending auth_request with name:', myName, 'avatar:', myAvatar);
            clearTimeout(connectionTimeout);
            connectionAttempts = 0;
            setStatus('connecting', 'Waiting for host approval...');
            hostConn.send({
                type: 'auth_request',
                name: myName,
                avatar: myAvatar,
                userId: currentUserId,
                requestId: pendingRequestId
            });
            console.log('[GUEST] auth_request sent successfully with requestId:', pendingRequestId);
        });

        hostConn.on('error', err => {
            console.error('[GUEST] Connection error:', err);
            clearTimeout(connectionTimeout);
            handleConnectionFailure(retryCount, err);
        });

        hostConn.on('data', async msg => {
            // Handle sync health check
            if (msg.type === 'sync_ping') {
                hostConn.send({ type: 'sync_pong', ts: msg.ts, nonce: msg.nonce });
                console.log('[SYNC] 🏓 Replied to sync_ping from host');
                return;
            }
            if (msg.type === 'sync_pong') {
                console.log('[SYNC] ✅ sync_pong received from host - connection verified!');
                try {
                    const testMsg = { type: 'sync_test', ts: Date.now() };
                    const encrypted = await encryptData(testMsg);
                    hostConn.send({ type: 'encrypted', data: encrypted });
                    console.log('[SYNC] 🔐 Sent encrypted test message to host');
                } catch (err) {
                    console.error('[SYNC] ❌ Encryption test failed:', err);
                    toast('Encryption not working — sync may fail!', 'error');
                }
                return;
            }

            // Host rejected us
            if (msg.type === 'auth_rejected') {
                console.warn('[GUEST] Host rejected connection');
                setStatus('disconnected', 'Host rejected request.');
                toast('The host declined your request to join.', 'error', 5000);
                setTimeout(() => { window.location.href = 'index.html'; }, 3000);
                return;
            }

            // Host accepted us
            if (msg.type === 'welcome') {
                clearTimeout(connectionTimeout);
                setStatus('connected', 'Connected to Room.');
                toast('Joined Room successfully! 🌙', 'success');
                console.log('[GUEST] Welcome received from host:', msg.hostName);

                peersMap[hostId] = { dataConn: hostConn, name: msg.hostName || 'Host', callConn: null, stream: null };

                if (msg.roomId) {
                    currentRoomId = parseInt(msg.roomId);
                    sessionStorage.setItem('currentRoomId', currentRoomId);
                    console.log('[DATABASE] Received and stored room ID from host:', currentRoomId);
                }
                sessionStorage.removeItem('pendingRequestId');

                if (msg.hostPlaylists) {
                    roomPlaylists = msg.hostPlaylists;
                    savePlaylist(); renderPlaylist();
                    console.log('[SYNC] 📥 Received initial playlists from host:', Object.keys(msg.hostPlaylists));
                }
                if (msg.ytState && msg.ytState.videoId) {
                    ytStateVersion = Math.max(ytStateVersion, Number(msg.ytState.stateVersion) || 0);
                    // Compensate for travel time: if the video was playing when the
                    // welcome was sent, offset the start position by the elapsed ms
                    // so mobile doesn't start seconds behind the host.
                    let joinStartTime = msg.ytState.time || 0;
                    if (msg.ytState.playing && msg.ytState.sentAt) {
                        const elapsedSec = (Date.now() - msg.ytState.sentAt) / 1000;
                        joinStartTime = Math.max(0, joinStartTime + elapsedSec);
                    }
                    ytRemoteStateTarget = {
                        playing: Boolean(msg.ytState.playing),
                        expiresAt: performance.now() + 8000,
                    };
                    // syncLockMs=6000: prevents the PLAYING event (fired after
                    // buffering completes on TURN) from echoing back to the host.
                    loadYouTubeVideo(msg.ytState.videoId, joinStartTime, msg.ytState.playing, 6000);
                }

                if (msg.peers) {
                    msg.peers.forEach(p => {
                        const conn = peer.connect(p.id, { reliable: true, serialization: 'json' });
                        setupGuestToGuest(conn, p.name);
                    });
                }

                renderChatRecipientDropdown();

                // Update members panel when joining room
                if (typeof updateMembersPanel === 'function') {
                    updateMembersPanel();
                }

                setTimeout(() => sendSyncPing(hostConn), 1000);

                if (isInCall && localStream && peersMap[hostId] && !peersMap[hostId].callConn) {
                    console.log('[GUEST] Calling host...');
                    const call = createMediaCall(hostId, localStream);
                    if (call) handleOutboundCall(call, hostId);
                }

                // Start periodic member connection check
                connectToOtherMembers();
                if (!window.memberConnectInterval) {
                    window.memberConnectInterval = setInterval(connectToOtherMembers, 10000);
                }
                return;
            }

            // Decrypt encrypted messages
            if (msg.type === 'encrypted') {
                const decrypted = await decryptData(msg.data);
                if (decrypted && peersMap[hostId]) {
                    if (decrypted.type === 'sync_test') {
                        console.log('[SYNC] ✅ Encrypted test from host decrypted OK — E2E working!');
                        toast('Sync connection verified ✅', 'success', 2000);
                        return;
                    }
                    handleSyncMessage(decrypted, hostId);
                } else if (!decrypted) {
                    console.error('[SYNC] ❌ Decryption FAILED for message from host');
                    toast('Sync error: could not decrypt message from host', 'error');
                }
            } else if (peersMap[hostId]) {
                handleSyncMessage(msg, hostId);
            }
        });

        hostConn.on('close', () => {
            console.log('[GUEST] Host connection closed');
            clearTimeout(connectionTimeout);
            handlePeerDisconnect(hostId, hostConn);
        });
    }, delay);
}

function handleConnectionFailure(retryCount, error = null) {
    if (error) {
        console.error('[GUEST] Connection failed with error:', error.type || error);
    }

    if (retryCount < MAX_CONNECTION_ATTEMPTS - 1) {
        console.log(`[GUEST] Retrying connection (${retryCount + 1}/${MAX_CONNECTION_ATTEMPTS - 1})...`);
        toast(`Connecting to room... (${retryCount + 2}/${MAX_CONNECTION_ATTEMPTS})`, 'info', 3000);
        connectToHost(retryCount + 1);
    } else {
        if (isAlreadyMember) {
            console.log('[GUEST] Max connection attempts reached, but user is an approved member. Access allowed (Host Offline).');
            setStatus('connected', 'Connected (Host Offline)');
            toast('Connected to room! The host is currently offline.', 'info', 5000);
            sessionStorage.removeItem('pendingRequestId');

            // Periodically check/connect to other online members
            connectToOtherMembers();
            setInterval(connectToOtherMembers, 10000);
        } else {
            console.error('[GUEST] Max connection attempts reached. Giving up.');
            setStatus('disconnected', 'Room does not exist.');
            toast('Room does not exist or Host disconnected. Redirecting...', 'error', 5000);

            setTimeout(() => {
                window.location.href = 'index.html';
            }, 3000);
        }
    }
}

let pendingHostReconnect = false;

async function connectToOtherMembers() {
    try {
        console.log('[P2P] Attempting to discover other online members...');
        const roomDetails = await api.getRoomByCode(roomId);
        if (roomDetails && roomDetails.success && roomDetails.room) {
            const members = roomDetails.room.members;
            const hashedRoom = await hashRoomId(roomId);

            // Try connecting to Host silently if they are online in DB but not connected in our peersMap
            const dbHostUserId = roomDetails.room.host.userId;
            const hostMember = members.find(m => m.userId.toString() === dbHostUserId.toString());
            const isHostOnlineInDb = hostMember ? hostMember.isOnline : false;

            if (!isHost && !peersMap[hostId] && isHostOnlineInDb && !pendingHostReconnect) {
                pendingHostReconnect = true;
                console.log('[P2P] Host is online in database but not connected. Attempting silent background reconnection to host...');
                const hostConn = peer.connect(hostId, {
                    reliable: true,
                    serialization: 'json'
                });

                let silentTimeout = setTimeout(() => {
                    console.log('[P2P] Silent host reconnection timeout.');
                    pendingHostReconnect = false;
                    hostConn.close();
                }, 5000);

                hostConn.on('open', () => {
                    clearTimeout(silentTimeout);
                    console.log('[P2P] Silent host reconnection opened. Authenticating...');
                    hostConn.send({
                        type: 'auth_request',
                        name: myName,
                        avatar: myAvatar,
                        userId: currentUserId,
                        requestId: pendingRequestId
                    });
                });

                hostConn.on('error', err => {
                    clearTimeout(silentTimeout);
                    pendingHostReconnect = false;
                    console.warn('[P2P] Silent host reconnection error:', err);
                });

                hostConn.on('close', () => {
                    console.log('[GUEST] Host connection closed (silent)');
                    pendingHostReconnect = false;
                    handlePeerDisconnect(hostId, hostConn);
                });

                hostConn.on('data', async msg => {
                    if (msg.type === 'welcome') {
                        clearTimeout(silentTimeout);
                        pendingHostReconnect = false;
                        setStatus('connected', 'Connected to Room.');
                        toast('Connected to Host! 🌙', 'success');

                        peersMap[hostId] = { dataConn: hostConn, name: msg.hostName || 'Host', callConn: null, stream: null };

                        if (msg.roomId) {
                            currentRoomId = parseInt(msg.roomId);
                            sessionStorage.setItem('currentRoomId', currentRoomId);
                        }
                        sessionStorage.removeItem('pendingRequestId');

                        if (msg.hostPlaylists) {
                            roomPlaylists = msg.hostPlaylists;
                            savePlaylist(); renderPlaylist();
                        }
                        if (msg.ytState && msg.ytState.videoId) {
                            ytStateVersion = Math.max(ytStateVersion, Number(msg.ytState.stateVersion) || 0);
                            let joinStartTime = msg.ytState.time || 0;
                            if (msg.ytState.playing && msg.ytState.sentAt) {
                                const elapsedSec = (Date.now() - msg.ytState.sentAt) / 1000;
                                joinStartTime = Math.max(0, joinStartTime + elapsedSec);
                            }
                            ytRemoteStateTarget = {
                                playing: Boolean(msg.ytState.playing),
                                expiresAt: performance.now() + 8000,
                            };
                            loadYouTubeVideo(msg.ytState.videoId, joinStartTime, msg.ytState.playing, 6000);
                        }

                        if (msg.peers) {
                            msg.peers.forEach(p => {
                                const conn = peer.connect(p.id, { reliable: true, serialization: 'json' });
                                conn.on('data', async m => {
                                    if (m.type === 'peer_intro') {
                                        setupGuestToGuest(conn, m.name);
                                        toast(`${m.name} joined!`, 'info');
                                        return;
                                    }
                                    if (m.type === 'encrypted') {
                                        const dec = await decryptData(m.data);
                                        if (dec && peersMap[conn.peer]) handleSyncMessage(dec, conn.peer);
                                    } else if (peersMap[conn.peer]) {
                                        handleSyncMessage(m, conn.peer);
                                    }
                                });
                                conn.on('close', () => handlePeerDisconnect(conn.peer, conn));
                            });
                        }

                        renderChatRecipientDropdown();
                        if (typeof updateMembersPanel === 'function') {
                            updateMembersPanel();
                        }
                        setTimeout(() => sendSyncPing(hostConn), 1000);

                        if (isInCall && localStream && peersMap[hostId] && !peersMap[hostId].callConn) {
                            console.log('[GUEST] Calling host silently...');
                            const call = createMediaCall(hostId, localStream);
                            if (call) handleOutboundCall(call, hostId);
                        }
                        return;
                    }

                    // Handle all subsequent encrypted and sync messages from host
                    if (msg.type === 'encrypted') {
                        const decrypted = await decryptData(msg.data);
                        if (decrypted && peersMap[hostId]) {
                            if (decrypted.type === 'sync_test') {
                                console.log('[SYNC] ✅ Encrypted test from host decrypted OK — E2E working!');
                                toast('Sync connection verified ✅', 'success', 2000);
                                return;
                            }
                            handleSyncMessage(decrypted, hostId);
                        } else if (!decrypted) {
                            console.error('[SYNC] ❌ Decryption FAILED for message from host');
                        }
                    } else if (peersMap[hostId]) {
                        handleSyncMessage(msg, hostId);
                    }
                });
            }

            for (const member of members) {
                const memberUserId = member.userId;
                // Don't connect to ourselves, and only connect if the other member is online
                if (memberUserId.toString() !== currentUserId.toString() && member.isOnline) {
                    // Prevent duplicate P2P connection logic:
                    // Only initiate connection if my userId is smaller than the other user's id
                    if (parseInt(currentUserId) < parseInt(memberUserId)) {
                        const targetPeerId = hashedRoom + 'u' + memberUserId;

                        if (peersMap[targetPeerId]) {
                            continue;
                        }

                        console.log(`[P2P] Connecting to peer member ${member.displayName} (${targetPeerId})...`);
                        const conn = peer.connect(targetPeerId, { reliable: true, serialization: 'json' });

                        conn.on('open', () => {
                            console.log(`[P2P] Connection opened to peer member ${member.displayName}`);
                            conn.send({ type: 'peer_intro', name: myName });
                            setupGuestToGuest(conn, member.displayName);
                        });

                        conn.on('error', err => {
                            console.warn(`[P2P] Connection error to peer member ${member.displayName}:`, err);
                        });
                    }
                }
            }
        }
    } catch (err) {
        console.error('[P2P] Failed to connect to other members:', err);
    }
}

function setupGuestToGuest(conn, peerName) {
    const onOpen = () => {
        conn.send({ type: 'peer_intro', name: myName });
        if (isInCall && localStream && peersMap[conn.peer] && !peersMap[conn.peer].callConn) {
            console.log(`[P2P] Calling peer ${peerName} (${conn.peer})...`);
            const call = createMediaCall(conn.peer, localStream);
            if (call) handleOutboundCall(call, conn.peer);
        }
    };

    if (conn.open) {
        onOpen();
    } else {
        conn.on('open', onOpen);
    }
    peersMap[conn.peer] = { dataConn: conn, name: peerName, callConn: null, stream: null };

    // Update members panel when guest-to-guest connection established
    if (typeof updateMembersPanel === 'function') {
        updateMembersPanel();
    }

    conn.on('data', async msg => {
        if (msg.type === 'peer_intro') return; // Ignore duplicate intros
        if (msg.type === 'sync_ping') {
            conn.send({ type: 'sync_pong', ts: msg.ts, nonce: msg.nonce });
            return;
        }
        if (msg.type === 'sync_pong') {
            console.log('[SYNC] ✅ sync_pong from guest peer', conn.peer);
            return;
        }

        // Decrypt encrypted messages
        if (msg.type === 'encrypted') {
            const decrypted = await decryptData(msg.data);
            if (decrypted) {
                if (decrypted.type === 'sync_test') {
                    console.log('[SYNC] ✅ Encrypted test from peer', conn.peer, 'decrypted OK');
                    return;
                }
                handleSyncMessage(decrypted, conn.peer);
            } else {
                console.error('[SYNC] ❌ Decryption FAILED for message from peer', conn.peer);
                toast('Sync error: could not decrypt message from partner', 'error');
            }
        } else {
            // Fallback for unencrypted messages (backward compatibility)
            handleSyncMessage(msg, conn.peer);
        }
    });
    conn.on('close', () => handlePeerDisconnect(conn.peer, conn));
    renderChatRecipientDropdown();
}

function handlePeerDisconnect(id, closingConn) {
    if (peersMap[id]) {
        // If a specific connection was provided, verify it is still the active one.
        // A stale/timed-out connection closing should NOT tear down a newer active connection.
        if (closingConn && peersMap[id].dataConn && peersMap[id].dataConn !== closingConn) {
            console.log(`[PEER] Ignoring stale close event for ${peersMap[id].name} (${id}) — a newer connection is active.`);
            return;
        }
        toast(`${peersMap[id].name} left.`, 'info');
        if (peersMap[id].callConn) {
            try { peersMap[id].callConn.close(); } catch (e) { }
        }
        removeVideoPanel(id);
        delete peersMap[id];
        if (ytRemoteAdWaiters.delete(id)) updateAdBarrierUi();
        renderChatRecipientDropdown();

        // Update members panel when someone leaves
        if (typeof updateMembersPanel === 'function') {
            updateMembersPanel();
        }

        // Update status for Guest if Host disconnected
        if (!isHost && id === hostId) {
            setStatus('connected', 'Connected (Host Offline)');
        }

        // Reset host status if no more guests connected
        if (isHost && Object.keys(peersMap).length === 0) {
            setStatus('connected', 'Waiting for guests…');
        }
    }
}

// ─── CALL ─────────────────────────────────────────────
startCallBtn.addEventListener('click', () => {
    if (isInCall) endCall(); else startCall();
});

// ─── RINGTONE SYSTEM (Web Audio API, no files needed) ───
let ringtoneOscillators = [];
let ringtoneInterval = null;

function playRingtone() {
    stopRingtone();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    function ring() {
        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(0, ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.04);
        gainNode.gain.setValueAtTime(0.18, ctx.currentTime + 0.15);
        gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.25);
        gainNode.connect(ctx.destination);

        [880, 1100].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, ctx.currentTime);
            osc.connect(gainNode);
            osc.start(ctx.currentTime + i * 0.06);
            osc.stop(ctx.currentTime + 0.3);
            ringtoneOscillators.push(osc);
        });
    }

    ring();
    ringtoneInterval = setInterval(ring, 1800);
    // Auto-stop after 30 seconds
    setTimeout(stopRingtone, 30000);
}

function stopRingtone() {
    if (ringtoneInterval) { clearInterval(ringtoneInterval); ringtoneInterval = null; }
    ringtoneOscillators.forEach(o => { try { o.stop(); } catch (_) { } });
    ringtoneOscillators = [];
}

// ─── INCOMING CALL NOTIFICATION UI ───────────────────
let pendingIncomingCall = null;

function showIncomingCallUI(callerName, callObj) {
    pendingIncomingCall = callObj;
    document.getElementById('callerName').textContent = callerName;
    const modal = document.getElementById('incomingCallModal');
    modal.style.display = 'flex';
    playRingtone();

    // Request browser notification if app is in background
    if (document.hidden && Notification.permission === 'granted') {
        new Notification(`📞 Call from ${callerName}`, {
            body: 'Tap to open Our Space and answer',
            icon: '/favicon.ico'
        });
    } else if (Notification.permission === 'default') {
        Notification.requestPermission();
    }

    document.getElementById('acceptCallBtn').onclick = () => {
        stopRingtone();
        modal.style.display = 'none';
        if (pendingIncomingCall) answerIncomingCall(pendingIncomingCall);
        pendingIncomingCall = null;
    };
    document.getElementById('declineCallBtn').onclick = () => {
        stopRingtone();
        modal.style.display = 'none';
        if (pendingIncomingCall) { pendingIncomingCall.close(); }
        pendingIncomingCall = null;
    };
}

async function answerIncomingCall(call) {
    const id = call.peer;
    if (!peersMap[id]) return;

    if (localStream) {
        call.answer(localStream, { sdpTransform: optimiseOpusSdp });
        configureCallAudio(call);
        peersMap[id].callConn = call;
        call.on('stream', stream => addVideoPanel(id, stream));
        call.on('close', () => removeVideoPanel(id));
    } else {
        try {
            const constraints = getMediaConstraints();
            const stream = await acquireLocalMedia(constraints);
            localStream = stream;
            myVideo.srcObject = stream;
            myVideo.classList.add('active');
            myPlaceholder.style.display = 'none';
            isInCall = true;
            startCallBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg> End Call`;
            startCallBtn.classList.add('end-call');
            call.answer(stream, { sdpTransform: optimiseOpusSdp });
            configureCallAudio(call);
            peersMap[id].callConn = call;
            call.on('stream', s => addVideoPanel(id, s));
            call.on('close', () => removeVideoPanel(id));
            // Start speaking monitor for local mic
            startSpeakingMonitor('myVideoPanel', stream);
        } catch (e) {
            toast('Could not access camera/mic.', 'error');
        }
    }
}

async function startCall() {
    try {
        const constraints = getMediaConstraints();
        localStream = await acquireLocalMedia(constraints);
        myVideo.srcObject = localStream;
        myVideo.classList.add('active');
        myPlaceholder.style.display = 'none';

        startCallBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg> End Call`;
        startCallBtn.classList.add('end-call');
        isInCall = true;

        // Start speaking monitor for local mic so the user sees their own indicator
        startSpeakingMonitor('myVideoPanel', localStream);

        // Directly call all connected peers — no ringtone needed when everyone is in the room
        setTimeout(() => {
            Object.keys(peersMap).forEach(id => {
                const call = createMediaCall(id, localStream);
                if (call) handleOutboundCall(call, id);
            });
        }, 400);

    } catch (err) { toast('Could not access camera/mic.', 'error'); }
}

function handleOutboundCall(call, id) {
    peersMap[id].callConn = call;
    configureCallAudio(call);
    call.on('stream', stream => { addVideoPanel(id, stream); });
    call.on('close', () => { removeVideoPanel(id); });
    call.on('error', () => { removeVideoPanel(id); });
}

// ─────────────────────────────────────────────────────
//  SPEAKING INDICATOR  (Google Meet-style sound waves)
// ─────────────────────────────────────────────────────
// Map of panelId -> { ctx, source, analyser, rafId }
const speakingMonitors = new Map();

// Threshold: 0–255 RMS scale.
// 22 is well above mic self-noise / background hum but clearly below speech.
const SPEAK_THRESHOLD = 22;
// Require the signal to stay above threshold for N consecutive animation
// frames before showing the indicator (prevents single-frame plosive flicker).
const SPEAK_ON_FRAMES  = 4;
// Keep indicator visible for N frames after going quiet (natural tail-off).
const SPEAK_OFF_FRAMES = 14;

/**
 * Attach a Web Audio analyser to `stream` and drive the
 * `.speaking-indicator` element inside `panelEl`.
 */
function startSpeakingMonitor(panelId, stream) {
    stopSpeakingMonitor(panelId); // clean up any previous monitor for this panel

    const panelEl = document.getElementById(panelId);
    if (!panelEl) return;

    // Ensure the speaking indicator exists in this panel
    let indicator = panelEl.querySelector('.speaking-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.className = 'speaking-indicator';
        indicator.setAttribute('aria-hidden', 'true');
        indicator.innerHTML = '<span class="speak-bar"></span>'.repeat(5);
        // Insert after video-label so it sits at the top
        const label = panelEl.querySelector('.video-label');
        if (label) label.after(indicator);
        else panelEl.prepend(indicator);
    }

    // Need at least one audio track
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) return;

    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.5;
        source.connect(analyser);

        const data = new Uint8Array(analyser.frequencyBinCount);
        let speaking = false;
        let onCount  = 0;
        let offCount = 0;

        function tick() {
            analyser.getByteFrequencyData(data);

            // RMS across all frequency bins
            let sum = 0;
            for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
            const rms = Math.sqrt(sum / data.length);

            if (rms > SPEAK_THRESHOLD) {
                onCount++;
                offCount = 0;
                if (!speaking && onCount >= SPEAK_ON_FRAMES) {
                    speaking = true;
                    indicator.classList.add('speaking');
                }
            } else {
                offCount++;
                onCount = 0;
                if (speaking && offCount >= SPEAK_OFF_FRAMES) {
                    speaking = false;
                    indicator.classList.remove('speaking');
                }
            }

            monitor.rafId = requestAnimationFrame(tick);
        }

        const monitor = { ctx, source, analyser, rafId: requestAnimationFrame(tick) };
        speakingMonitors.set(panelId, monitor);
    } catch (e) {
        console.warn('[SPEAK] Could not create speaking monitor for', panelId, e);
    }
}

function stopSpeakingMonitor(panelId) {
    const m = speakingMonitors.get(panelId);
    if (!m) return;
    cancelAnimationFrame(m.rafId);
    try { m.source.disconnect(); } catch (e) {}
    try { m.ctx.close(); } catch (e) {}
    speakingMonitors.delete(panelId);

    // Remove the speaking class so the indicator fades out cleanly
    const panelEl = document.getElementById(panelId);
    if (panelEl) {
        const indicator = panelEl.querySelector('.speaking-indicator');
        indicator?.classList.remove('speaking');
    }
}

function stopAllSpeakingMonitors() {
    for (const panelId of speakingMonitors.keys()) stopSpeakingMonitor(panelId);
}

function optimiseOpusSdp(sdp) {
    if (!sdp || typeof sdp !== 'string') return sdp;

    const opusMatch = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i);
    if (!opusMatch) return sdp;

    const payloadType = opusMatch[1];
    const desiredParameters = {
        minptime: '10',
        useinbandfec: '1',
        usedtx: '1',
        stereo: '0',
        'sprop-stereo': '0',
        maxaveragebitrate: '64000',
        cbr: '0'
    };
    const fmtpPattern = new RegExp(`a=fmtp:${payloadType} ([^\\r\\n]*)`, 'i');
    const fmtpMatch = sdp.match(fmtpPattern);

    if (fmtpMatch) {
        const parameters = new Map();
        fmtpMatch[1].split(';').forEach(part => {
            const [key, value] = part.trim().split('=');
            if (key) parameters.set(key.toLowerCase(), value || '');
        });
        Object.entries(desiredParameters).forEach(([key, value]) => parameters.set(key, value));
        const updated = Array.from(parameters, ([key, value]) => `${key}=${value}`).join(';');
        return sdp.replace(fmtpPattern, `a=fmtp:${payloadType} ${updated}`);
    }

    const rtpmapPattern = new RegExp(`(a=rtpmap:${payloadType} opus/48000/2\\r?\\n)`, 'i');
    const parameters = Object.entries(desiredParameters)
        .map(([key, value]) => `${key}=${value}`)
        .join(';');
    return sdp.replace(rtpmapPattern, `$1a=fmtp:${payloadType} ${parameters}\r\n`);
}

function createMediaCall(peerId, stream) {
    return peer.call(peerId, stream, { sdpTransform: optimiseOpusSdp });
}

async function tuneAudioSender(peerConnection) {
    if (!peerConnection || !peerConnection.getSenders) return;
    const sender = peerConnection.getSenders().find(item => item.track?.kind === 'audio');
    if (!sender || !sender.getParameters || !sender.setParameters) return;

    const parameters = sender.getParameters();
    if (!parameters.encodings?.length) parameters.encodings = [{}];
    parameters.encodings[0].maxBitrate = 64000;
    parameters.encodings[0].priority = 'high';

    try {
        await sender.setParameters(parameters);
    } catch (error) {
        // Some Safari/Firefox versions reject priority but accept the bitrate.
        try {
            const fallback = sender.getParameters();
            if (!fallback.encodings?.length) fallback.encodings = [{}];
            fallback.encodings[0].maxBitrate = 64000;
            await sender.setParameters(fallback);
        } catch (fallbackError) {
            console.warn('Could not apply optional audio sender tuning', fallbackError);
        }
    }
}

function configureCallAudio(call) {
    const peerConnection = call?.peerConnection;
    if (!peerConnection) return;

    tuneAudioSender(peerConnection);
    peerConnection.addEventListener('connectionstatechange', () => {
        if (peerConnection.connectionState === 'connected') tuneAudioSender(peerConnection);
    });
}

function handleIncomingCall(call) {
    const id = call.peer;
    if (!peersMap[id]) return;
    const callerName = peersMap[id]?.name || 'Someone';

    if (!document.hidden) {
        // Tab is active — user is already in the room, auto-answer with no interruption
        answerIncomingCall(call);
    } else {
        // Tab is hidden — user is away, show ring overlay + sound + browser notification
        showIncomingCallUI(callerName, call);
    }
}

function addVideoPanel(id, stream) {
    let panel = document.getElementById(`panel_${id}`);
    if (!panel) {
        panel = document.createElement('div');
        panel.className = 'video-panel';
        panel.id = `panel_${id}`;
        panel.innerHTML = `
            <video id="video_${id}" autoplay playsinline class="video-element active"></video>
            <div class="video-label">${peersMap[id].name}</div>
            <div class="speaking-indicator" aria-hidden="true">
                <span class="speak-bar"></span>
                <span class="speak-bar"></span>
                <span class="speak-bar"></span>
                <span class="speak-bar"></span>
                <span class="speak-bar"></span>
            </div>
            <button class="expand-btn" data-target="panel_${id}" title="Expand">⛶</button>
        `;
        document.getElementById('videoGrid').appendChild(panel);

        panel.querySelector('.expand-btn').addEventListener('click', (e) => {
            togglePanelExpand(`panel_${id}`, e.target);
        });
    }
    const vid = document.getElementById(`video_${id}`);
    if (vid) {
        vid.srcObject = stream;
        // Chromium can automatically retain an eligible playing video when the
        // user backgrounds the page after granting Picture-in-Picture once.
        vid.autoPictureInPicture = true;

        // Apply selected speaker if available
        const selectedAudioOutput = localStorage.getItem('ourspace_audio_out');
        if (selectedAudioOutput && selectedAudioOutput !== 'default' && typeof vid.setSinkId !== 'undefined') {
            try {
                vid.setSinkId(selectedAudioOutput);
            } catch (e) {
                console.warn('Cannot set sink id for new video', e);
            }
        }
    }
    // Start speaking monitor for this peer's incoming stream
    startSpeakingMonitor(`panel_${id}`, stream);
    document.querySelector('.video-grid').classList.remove('alone');
}

function removeVideoPanel(id) {
    stopSpeakingMonitor(`panel_${id}`);
    const panel = document.getElementById(`panel_${id}`);
    if (panel) panel.remove();

    if (document.querySelectorAll('.video-panel').length <= 1) {
        document.querySelector('.video-grid').classList.add('alone');
    }
}

function endCall() {
    if (isScreenSharing) {
        if (screenStream) {
            screenStream.getTracks().forEach(t => t.stop());
            screenStream = null;
        }
        if (audioContext) {
            audioContext.close();
            audioContext = null;
        }
        isScreenSharing = false;
        originalLocalStream = null;
    }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    myVideo.srcObject = null; myVideo.classList.remove('active'); myPlaceholder.style.display = 'flex';

    // Stop all speaking monitors
    stopAllSpeakingMonitors();

    Object.keys(peersMap).forEach(id => {
        if (peersMap[id].callConn) {
            peersMap[id].callConn.close();
            peersMap[id].callConn = null;
        }
        removeVideoPanel(id);
    });

    isInCall = false;
    startCallBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg> Start Call`;
    startCallBtn.classList.remove('end-call');
    toast('Call ended', 'info');
}

function renderChatRecipientDropdown() {
    let sel = document.getElementById('chatRecipient');
    if (!sel) {
        sel = document.createElement('select');
        sel.id = 'chatRecipient';
        // Inline styles so it matches the dark glass theme regardless of caching
        sel.setAttribute('style', [
            'appearance: none',
            'background: rgba(255,255,255,0.07)',
            'border: 1px solid rgba(255,255,255,0.15)',
            'border-radius: 20px',
            'color: rgba(255,255,255,0.85)',
            'font-family: Inter, sans-serif',
            'font-size: 0.78rem',
            'padding: 4px 28px 4px 12px',
            'cursor: pointer',
            'outline: none',
            'margin-right: 6px',
            'max-width: 120px',
            'background-image: url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\'%3E%3Cpath d=\'M0 0l5 6 5-6z\' fill=\'rgba(255,255,255,0.5)\'/%3E%3C/svg%3E")',
            'background-repeat: no-repeat',
            'background-position: right 10px center',
        ].join(';'));

        const header = document.querySelector('.chat-header');
        if (header) header.insertBefore(sel, header.querySelector('.chat-close-btn'));
    }

    const currVal = sel.value;
    let optionsHtml = `<option value="all">🌍 Everyone</option>`;
    Object.keys(peersMap).forEach(id => {
        optionsHtml += `<option value="${id}">🔒 ${peersMap[id].name}</option>`;
    });
    sel.innerHTML = optionsHtml;

    if (currVal && Array.from(sel.options).find(o => o.value === currVal)) {
        sel.value = currVal;
    }
}

// ─────────────────────────────────────────────────────
//  DEVICE SETTINGS
// ─────────────────────────────────────────────────────
const settingsBtn = document.getElementById('settingsBtn');
const deviceModal = document.getElementById('deviceModal');
const audioInputSelect = document.getElementById('audioInputSelect');
const audioOutputSelect = document.getElementById('audioOutputSelect');
const videoInputSelect = document.getElementById('videoInputSelect');
const saveDeviceBtn = document.getElementById('saveDeviceBtn');

let selectedAudioInput = localStorage.getItem('ourspace_audio_in') || 'default';
let selectedAudioOutput = localStorage.getItem('ourspace_audio_out') || 'default';
let selectedVideoInput = localStorage.getItem('ourspace_video_in') || 'default';

function getMediaConstraints() {
    const supported = navigator.mediaDevices.getSupportedConstraints
        ? navigator.mediaDevices.getSupportedConstraints()
        : {};
    let audioConstraints = {};

    // Ask the browser's native WebRTC audio-processing pipeline for a
    // speech-first signal. Unsupported constraints are deliberately omitted.
    if (supported.echoCancellation) audioConstraints.echoCancellation = { ideal: true };
    if (supported.noiseSuppression) audioConstraints.noiseSuppression = { ideal: true };
    if (supported.autoGainControl) audioConstraints.autoGainControl = { ideal: true };
    if (supported.channelCount) audioConstraints.channelCount = { ideal: 1 };
    if (supported.sampleRate) audioConstraints.sampleRate = { ideal: 48000 };
    if (supported.sampleSize) audioConstraints.sampleSize = { ideal: 16 };
    if (supported.latency) audioConstraints.latency = { ideal: 0.01 };

    // Some browsers expose stronger, hardware/ML-backed voice isolation before
    // it is part of the cross-browser MediaTrackSupportedConstraints type.
    if (supported.voiceIsolation) audioConstraints.voiceIsolation = { ideal: true };

    if (selectedAudioInput && selectedAudioInput !== 'default') {
        audioConstraints.deviceId = selectedAudioInput;
    }

    let videoConstraints = true;
    if (selectedVideoInput && selectedVideoInput !== 'default') {
        videoConstraints = { deviceId: selectedVideoInput };
    }

    return { video: videoConstraints, audio: audioConstraints };
}

function optimiseSpeechTrack(track) {
    if (!track) return;

    // Lets the WebRTC encoder favour intelligible speech over music fidelity.
    if ('contentHint' in track) track.contentHint = 'speech';

    // getUserMedia constraints are preferences. Re-apply supported processing
    // to the selected track so browsers have another opportunity to enable it.
    const supported = navigator.mediaDevices.getSupportedConstraints
        ? navigator.mediaDevices.getSupportedConstraints()
        : {};
    const constraints = {};
    if (supported.echoCancellation) constraints.echoCancellation = true;
    if (supported.noiseSuppression) constraints.noiseSuppression = true;
    if (supported.autoGainControl) constraints.autoGainControl = true;
    if (supported.channelCount) constraints.channelCount = { ideal: 1 };
    if (supported.voiceIsolation) constraints.voiceIsolation = true;

    if (Object.keys(constraints).length && track.applyConstraints) {
        track.applyConstraints(constraints).catch(error => {
            console.warn('Some microphone enhancements were unavailable', error);
        });
    }
}

async function acquireLocalMedia(constraints = getMediaConstraints()) {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    stream.getAudioTracks().forEach(optimiseSpeechTrack);
    return stream;
}

async function populateDeviceLists() {
    try {
        // Request permissions first to get device labels and IDs (skip if already active)
        if (!localStream) {
            const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
            tempStream.getTracks().forEach(t => t.stop());
        }

        const devices = await navigator.mediaDevices.enumerateDevices();

        audioInputSelect.innerHTML = '<option value="default">Default</option>';
        audioOutputSelect.innerHTML = '<option value="default">Default</option>';
        videoInputSelect.innerHTML = '<option value="default">Default</option>';

        devices.forEach(device => {
            if (!device.deviceId) return;
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.text = device.label || `${device.kind} (${device.deviceId.substring(0, 5)}...)`;

            if (device.kind === 'audioinput') {
                audioInputSelect.appendChild(option);
            } else if (device.kind === 'audiooutput') {
                audioOutputSelect.appendChild(option);
            } else if (device.kind === 'videoinput') {
                videoInputSelect.appendChild(option);
            }
        });

        if (selectedAudioInput) audioInputSelect.value = selectedAudioInput;
        if (selectedAudioOutput) audioOutputSelect.value = selectedAudioOutput;
        if (selectedVideoInput) videoInputSelect.value = selectedVideoInput;

    } catch (e) {
        console.error('Error enumerating devices', e);
        toast('Please allow camera/mic permissions to see devices', 'error');
    }
}

async function applyDeviceSettings() {
    selectedAudioInput = audioInputSelect.value;
    selectedAudioOutput = audioOutputSelect.value;
    selectedVideoInput = videoInputSelect.value;

    localStorage.setItem('ourspace_audio_in', selectedAudioInput);
    localStorage.setItem('ourspace_audio_out', selectedAudioOutput);
    localStorage.setItem('ourspace_video_in', selectedVideoInput);

    // Apply output speaker to all remote videos
    if (typeof HTMLMediaElement.prototype.setSinkId !== 'undefined') {
        const videos = document.querySelectorAll('video');
        for (let v of videos) {
            if (v.id !== 'myVideo') {
                try {
                    await v.setSinkId(selectedAudioOutput === 'default' ? '' : selectedAudioOutput);
                } catch (e) {
                    console.warn('Cannot set sink id', e);
                }
            }
        }
    }

    if (isInCall && localStream) {
        try {
            const constraints = getMediaConstraints();

            // Release hardware locks BEFORE requesting new streams.
            // This is critical for macOS and Linux to switch cameras/mics successfully.
            localStream.getTracks().forEach(t => t.stop());

            const newStream = await acquireLocalMedia(constraints);

            // Replace tracks for local video
            myVideo.srcObject = newStream;

            // Replace tracks for all active peer connections
            const newAudioTrack = newStream.getAudioTracks()[0];
            const newVideoTrack = newStream.getVideoTracks()[0];

            // Restore previous mute states
            if (newAudioTrack) newAudioTrack.enabled = !isMuted;
            if (newVideoTrack) newVideoTrack.enabled = !isVideoOff;

            Object.values(peersMap).forEach(p => {
                if (p.callConn && p.callConn.peerConnection) {
                    const senders = p.callConn.peerConnection.getSenders();
                    const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
                    const videoSender = senders.find(s => s.track && s.track.kind === 'video');

                    if (audioSender && newAudioTrack) audioSender.replaceTrack(newAudioTrack);
                    if (videoSender && newVideoTrack) videoSender.replaceTrack(newVideoTrack);
                }
            });

            localStream = newStream;

            // Restart the local speaking monitor with the fresh stream.
            // The old AudioContext source is now stale (old tracks were stopped).
            if (isInCall) {
                startSpeakingMonitor('myVideoPanel', newStream);
                // Re-apply mute visual state on the fresh indicator
                const myInd = document.querySelector('#myVideoPanel .speaking-indicator');
                if (myInd) myInd.style.display = isMuted ? 'none' : '';
            }

            toast('Device settings updated', 'success');
        } catch (e) {
            console.error('Error applying devices', e);
            toast('Failed to change devices', 'error');
        }
    } else {
        toast('Settings saved', 'success');
    }
}

if (settingsBtn) {
    settingsBtn.addEventListener('click', async () => {
        await populateDeviceLists();
        deviceModal.classList.add('show');
    });
}

if (saveDeviceBtn) {
    saveDeviceBtn.addEventListener('click', () => {
        applyDeviceSettings();
        deviceModal.classList.remove('show');
    });
}

deviceModal.addEventListener('click', e => {
    if (e.target === deviceModal) deviceModal.classList.remove('show');
});


muteBtn.addEventListener('click', () => {
    if (!localStream) return;
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
    muteBtn.classList.toggle('muted', isMuted);
    muteBtn.innerHTML = isMuted
        ? `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm0 2a2 2 0 0 0-2 2v6a2 2 0 0 0 4 0V5a2 2 0 0 0-2-2zm-1 14.93V21h2v-3.07A8.001 8.001 0 0 0 20 10h-2a6 6 0 0 1-12 0H4a8.001 8.001 0 0 0 7 7.93z"/></svg>`;

    // Force-hide the speaking indicator when muted so background noise
    // doesn't trigger a false positive on the analyser.
    const myIndicator = document.querySelector('#myVideoPanel .speaking-indicator');
    if (myIndicator) {
        if (isMuted) {
            myIndicator.classList.remove('speaking');
            myIndicator.style.display = 'none';
        } else {
            myIndicator.style.display = '';  // restore, analyser takes over again
        }
    }
});

videoBtn.addEventListener('click', () => {
    if (!localStream) return;
    isVideoOff = !isVideoOff;
    localStream.getVideoTracks().forEach(t => t.enabled = !isVideoOff);
    videoBtn.classList.toggle('video-off', isVideoOff);
    myVideo.classList.toggle('active', !isVideoOff);
    myPlaceholder.style.display = isVideoOff ? 'flex' : 'none';
});

// Screen sharing functions & listeners
function mergeAudioStreams(micStream, screenStream) {
    const micAudioTrack = micStream ? micStream.getAudioTracks()[0] : null;
    const screenAudioTrack = screenStream ? screenStream.getAudioTracks()[0] : null;

    if (micAudioTrack && screenAudioTrack) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();

        const micSource = audioContext.createMediaStreamSource(new MediaStream([micAudioTrack]));
        const screenSource = audioContext.createMediaStreamSource(new MediaStream([screenAudioTrack]));

        const mixerDestination = audioContext.createMediaStreamDestination();

        micSource.connect(mixerDestination);
        screenSource.connect(mixerDestination);

        return mixerDestination.stream.getAudioTracks()[0];
    } else if (micAudioTrack) {
        return micAudioTrack;
    } else if (screenAudioTrack) {
        return screenAudioTrack;
    }
    return null;
}

async function startScreenShare(displaySurface, shareAudio) {
    try {
        if (!isInCall) {
            toast('You must be in a call to share your screen', 'error');
            return;
        }

        const constraints = {
            video: {
                displaySurface: displaySurface,
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 30 }
            },
            audio: shareAudio ? {
                echoCancellation: true,
                noiseSuppression: true
            } : false
        };

        const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
        screenStream = stream;
        isScreenSharing = true;

        originalLocalStream = localStream;

        const screenVideoTrack = stream.getVideoTracks()[0];
        let audioTrackToSend = null;

        if (localStream) {
            const micTrack = localStream.getAudioTracks()[0];
            const screenAudioTrack = stream.getAudioTracks()[0];

            if (micTrack && screenAudioTrack) {
                audioTrackToSend = mergeAudioStreams(localStream, stream);
            } else if (micTrack) {
                audioTrackToSend = micTrack;
            } else if (screenAudioTrack) {
                audioTrackToSend = screenAudioTrack;
            }
        } else {
            audioTrackToSend = stream.getAudioTracks()[0] || null;
        }

        const newLocalStream = new MediaStream();
        if (screenVideoTrack) newLocalStream.addTrack(screenVideoTrack);
        if (audioTrackToSend) newLocalStream.addTrack(audioTrackToSend);

        myVideo.srcObject = newLocalStream;
        myPlaceholder.style.display = 'none';
        myVideo.classList.add('active');

        // Replace tracks for all active peer connections
        Object.values(peersMap).forEach(p => {
            if (p.callConn && p.callConn.peerConnection) {
                const senders = p.callConn.peerConnection.getSenders();
                const videoSender = senders.find(s => s.track && s.track.kind === 'video');
                const audioSender = senders.find(s => s.track && s.track.kind === 'audio');

                if (videoSender && screenVideoTrack) {
                    videoSender.replaceTrack(screenVideoTrack);
                }
                if (audioSender && audioTrackToSend) {
                    audioSender.replaceTrack(audioTrackToSend);
                }
            }
        });

        localStream = newLocalStream;

        presentingBanner.style.display = 'flex';
        screenShareBtn.classList.add('active');
        screenShareBtn.style.background = 'rgba(155, 109, 255, 0.4)';
        document.querySelector('#myVideoPanel .video-label').textContent = 'You (Presenting)';

        screenVideoTrack.onended = () => {
            stopScreenShare();
        };

        toast('Screen sharing started', 'success');
    } catch (e) {
        console.error('Error starting screen share:', e);
        toast('Failed to share screen', 'error');
        cleanupScreenShareState();
    }
}

async function stopScreenShare() {
    if (!isScreenSharing) return;

    try {
        if (screenStream) {
            screenStream.getTracks().forEach(t => t.stop());
            screenStream = null;
        }

        if (audioContext) {
            audioContext.close();
            audioContext = null;
        }

        if (originalLocalStream) {
            myVideo.srcObject = originalLocalStream;

            const micTrack = originalLocalStream.getAudioTracks()[0];
            const videoTrack = originalLocalStream.getVideoTracks()[0];

            if (videoTrack) {
                videoTrack.enabled = !isVideoOff;
                if (isVideoOff) {
                    myPlaceholder.style.display = 'flex';
                    myVideo.classList.remove('active');
                } else {
                    myPlaceholder.style.display = 'none';
                    myVideo.classList.add('active');
                }
            }
            if (micTrack) {
                micTrack.enabled = !isMuted;
            }

            Object.values(peersMap).forEach(p => {
                if (p.callConn && p.callConn.peerConnection) {
                    const senders = p.callConn.peerConnection.getSenders();
                    const videoSender = senders.find(s => s.track && s.track.kind === 'video');
                    const audioSender = senders.find(s => s.track && s.track.kind === 'audio');

                    if (videoSender && videoTrack) {
                        videoSender.replaceTrack(videoTrack);
                    }
                    if (audioSender && micTrack) {
                        audioSender.replaceTrack(micTrack);
                    }
                }
            });

            localStream = originalLocalStream;
        } else {
            myVideo.srcObject = null;
            myPlaceholder.style.display = 'flex';
            myVideo.classList.remove('active');
        }

        presentingBanner.style.display = 'none';
        screenShareBtn.classList.remove('active');
        screenShareBtn.style.background = '';
        document.querySelector('#myVideoPanel .video-label').textContent = 'You';

        isScreenSharing = false;
        originalLocalStream = null;
        toast('Screen sharing stopped', 'success');
    } catch (e) {
        console.error('Error stopping screen share:', e);
        cleanupScreenShareState();
    }
}

function cleanupScreenShareState() {
    isScreenSharing = false;
    screenStream = null;
    originalLocalStream = null;
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    presentingBanner.style.display = 'none';
    screenShareBtn.classList.remove('active');
    screenShareBtn.style.background = '';
    document.querySelector('#myVideoPanel .video-label').textContent = 'You';
}

if (screenShareBtn) {
    screenShareBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isScreenSharing) {
            stopScreenShare();
        } else {
            screenShareMenu.classList.toggle('show');
        }
    });
}

if (stopPresentingBtn) {
    stopPresentingBtn.addEventListener('click', stopScreenShare);
}

// Close menu when clicking outside
document.addEventListener('click', (e) => {
    if (screenShareMenu && !screenShareMenu.contains(e.target) && e.target !== screenShareBtn) {
        screenShareMenu.classList.remove('show');
    }
});

// Handle item selection in menu
document.querySelectorAll('.ss-menu-item').forEach(item => {
    item.addEventListener('click', () => {
        const surface = item.getAttribute('data-surface');
        const audio = item.getAttribute('data-audio') === 'true';
        screenShareMenu.classList.remove('show');
        startScreenShare(surface, audio);
    });
});

// ─────────────────────────────────────────────────────
//  YOUTUBE IFRAME API
// ─────────────────────────────────────────────────────
let ytPlayer = null;
let ytReady = false;
let ytVideoId = null;
let ytPlaying = false;
let ytDuration = 0;
let ytTimer = null;
let isSyncing = false;
let ytSyncHeartbeat = null;
let ytStateVersion = 0;
let ytRemoteStateTarget = null;

// ─── AD DETECTION & SYNC ──────────────────────────────
let ytAdPlaying = false;       // True when THIS user's player is showing an ad
let ytAdOverlayShown = false;  // True when the overlay is shown (local OR remote ad)
let ytAdCheckInterval = null;  // Polling interval for ad detection
let ytWasPlayingBeforeAd = false; // Tracks if video was playing before ad interrupted
let ytManualAdPlaying = false; // Manual fallback because YouTube exposes no public ad event
let ytAdLastContentTime = null;
let ytAdLastProgressAt = 0;
let ytAdCandidateSince = 0;
let ytAdClearSince = 0;
let ytAdLastStatusSentAt = 0;
let ytBarrierPauseInProgress = false;
const ytRemoteAdWaiters = new Map(); // peerId -> { name, lastSeen }

const YT_AD_CHECK_MS = 500;
const YT_AD_STALL_MS = 3000;
const YT_AD_START_CONFIRM_MS = 1000;
const YT_AD_END_CONFIRM_MS = 1500;
const YT_AD_STATUS_MS = 2000;
const YT_AD_WAITER_TIMEOUT_MS = 15000;

// Load YouTube IFrame script dynamically
const ytScript = document.createElement('script');
ytScript.src = 'https://www.youtube.com/iframe_api';
document.head.appendChild(ytScript);

window.onYouTubeIframeAPIReady = function () {
    ytPlayer = new YT.Player('ytPlayer', {
        height: '200',
        width: '100%',
        playerVars: {
            autoplay: 0,
            controls: 1,  // Enable YouTube native controls for better UX
            modestbranding: 1,
            rel: 0,
            iv_load_policy: 3,
            enablejsapi: 1,
            origin: window.location.origin,
        },
        events: {
            onReady: () => {
                ytReady = true;
                console.log('[YT] YouTube player ready');
            },
            onStateChange: onYtStateChange,
        },
    });
};

function onYtStateChange(event) {
    const state = event.data;
    const stateNames = {
        '-1': 'UNSTARTED',
        '0': 'ENDED',
        '1': 'PLAYING',
        '2': 'PAUSED',
        '3': 'BUFFERING',
        '5': 'CUED'
    };
    console.log('[YT] State change:', stateNames[state] || state, 'isSyncing:', isSyncing);

    // Ignore BUFFERING state changes — they are transient and cause echo loops
    if (state === YT.PlayerState.BUFFERING) return;

    const videoId = (ytPlayer.getVideoData && ytPlayer.getVideoData().video_id) || ytVideoId || '';
    const currentTime = ytPlayer.getCurrentTime() || 0;
    const nextPlaying = state === YT.PlayerState.PLAYING;
    const remoteTriggered = Boolean(
        ytRemoteStateTarget &&
        ytRemoteStateTarget.playing === nextPlaying &&
        performance.now() < ytRemoteStateTarget.expiresAt
    );
    if (remoteTriggered) ytRemoteStateTarget = null;

    // ALWAYS update local UI state, regardless of isSyncing flag
    // This ensures timeline updates even when using YouTube native controls
    ytPlaying = nextPlaying;
    updateYtIcon();

    console.log('[YT] ytPlaying set to:', ytPlaying, 'Starting/stopping timer...');
    if (ytPlaying) {
        startYtTimer();
        startSyncHeartbeat();
        startAdDetection();
    } else {
        clearInterval(ytTimer);
        stopSyncHeartbeat();
        // Update progress bar one final time when stopped/paused
        // This ensures the timeline shows the correct position even when not playing
        if (ytPlayer && ytReady) {
            const cur = ytPlayer.getCurrentTime() || 0;
            const dur = ytPlayer.getDuration() || 0;
            const pct = dur > 0 ? (cur / dur) * 100 : 0;
            ytProgressFill.style.width = pct + '%';
            ytCurrentTimeEl.textContent = secToTime(cur);
            ytTotalTimeEl.textContent = secToTime(dur);
        }
    }

    // Only send sync to peers if this wasn't triggered by a sync message, and the state is PLAYING or PAUSED.
    // This prevents echo loops and avoids sending spurious pause syncs during loading/UNSTARTED transitions.
    if (!remoteTriggered && !isSyncing && !ytAdPlaying && !ytAdOverlayShown && (state === YT.PlayerState.PLAYING || state === YT.PlayerState.PAUSED)) {
        ytStateVersion += 1;
        console.log('[YT] Sending sync to peers:', { playing: ytPlaying, currentTime });
        sendSync({
            type: 'yt_state',
            videoId,
            currentTime,
            playing: ytPlaying,
            stateVersion: ytStateVersion,
            sentBy: myName,
        });
    } else {
        console.log('[YT] Skipping sync broadcast (triggered by peer sync, ad playing, or transient state)');
    }
}

// Extract video ID from any YouTube/YouTube Music URL or bare ID
function extractYouTubeId(input) {
    const patterns = [
        /[?&]v=([a-zA-Z0-9_-]{11})/,
        /youtu\.be\/([a-zA-Z0-9_-]{11})/,
        /embed\/([a-zA-Z0-9_-]{11})/,
        /^([a-zA-Z0-9_-]{11})$/,
    ];
    for (const p of patterns) { const m = input.match(p); if (m) return m[1]; }
    return null;
}

// syncLockMs: how long to suppress outgoing yt_state echoes after a remote-triggered load.
// Needs to be long enough for the player to buffer & fire PLAYING on high-latency TURN links.
async function loadYouTubeVideo(videoId, startSeconds = 0, autoplay = true, syncLockMs = 0) {
    if (!ytReady || !ytPlayer) {
        setTimeout(() => loadYouTubeVideo(videoId, startSeconds, autoplay, syncLockMs), 500);
        return;
    }
    ytVideoId = videoId;
    ytDuration = 0; // Reset video duration

    // Reset ad state when loading a new video
    ytAdPlaying = false;
    ytAdOverlayShown = false;
    ytManualAdPlaying = false;
    ytRemoteAdWaiters.clear();
    ytAdLastContentTime = null;
    ytAdLastProgressAt = performance.now();
    ytAdCandidateSince = 0;
    ytAdClearSince = 0;
    ytWasPlayingBeforeAd = false;
    updateAdReportButton();
    stopAdDetection();
    hideAdOverlay();

    // Show player card
    musicIdle.style.display = 'none';
    ytNowPlayingCard.style.display = 'flex';
    ytHeaderBtn?.classList.add('has-song');

    // Fetch title via oEmbed (no API key required)
    try {
        const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
        const d = await r.json();
        ytTrackTitle.textContent = d.title || '—';
        ytNowPlayingWho.textContent = 'Now Playing';
    } catch (e) { ytTrackTitle.textContent = '—'; }

    // Hold isSyncing for the full syncLockMs window so that the PLAYING event
    // fired after buffering (which can take 3-6 s on TURN relay) is not echoed
    // back to the host as a new play command, causing the host to replay.
    if (syncLockMs > 0) {
        isSyncing = true;
        setTimeout(() => { isSyncing = false; }, syncLockMs);
    }

    if (autoplay) {
        ytPlayer.loadVideoById({ videoId, startSeconds });
    } else {
        ytPlayer.cueVideoById({ videoId, startSeconds });
    }
    startAdDetection();
}

// Load button
ytLoadBtn.addEventListener('click', () => {
    const videoId = extractYouTubeId(ytUrlInput.value.trim());
    if (!videoId) { toast('Paste a valid YouTube link 🔗', 'error'); return; }
    loadYouTubeVideo(videoId, 0, true);
    ytStateVersion += 1;
    sendSync({ type: 'yt_load', videoId, stateVersion: ytStateVersion, sentBy: myName });
    ytUrlInput.value = '';
});
ytUrlInput.addEventListener('keydown', e => { if (e.key === 'Enter') ytLoadBtn.click(); });

// Play/pause
ytPlayPauseBtn.addEventListener('click', () => {
    if (!ytPlayer || !ytReady) return;
    if (ytPlaying) ytPlayer.pauseVideo(); else ytPlayer.playVideo();
});

const ytReportAdBtn = document.getElementById('ytReportAdBtn');
if (ytReportAdBtn) {
    ytReportAdBtn.addEventListener('click', () => {
        ytManualAdPlaying = !ytManualAdPlaying;
        setLocalAdState(ytManualAdPlaying, 'manual');
        updateAdReportButton();
    });
}

// Volume
ytVolumeSlider.addEventListener('input', () => {
    if (ytPlayer) ytPlayer.setVolume(ytVolumeSlider.value);
});

// Seek
ytProgressBg.addEventListener('click', e => {
    if (!ytPlayer || !ytDuration) return;
    const rect = ytProgressBg.getBoundingClientRect();
    const seekTime = ((e.clientX - rect.left) / rect.width) * ytDuration;
    ytPlayer.seekTo(seekTime, true);
    // Send seek position to partner so they stay in sync
    const videoId = (ytPlayer.getVideoData && ytPlayer.getVideoData().video_id) || ytVideoId || '';
    ytStateVersion += 1;
    sendSync({
        type: 'yt_state',
        videoId,
        currentTime: seekTime,
        playing: ytPlaying,
        stateVersion: ytStateVersion,
        sentBy: myName,
    });
});

function updateYtIcon() {
    ytPlayPauseBtn.querySelector('.play-icon').style.display = ytPlaying ? 'none' : 'block';
    ytPlayPauseBtn.querySelector('.pause-icon').style.display = ytPlaying ? 'block' : 'none';
    musicToggleBtn?.classList.toggle(
        'playing',
        musicSection?.classList.contains('mobile-minimized') && Boolean(ytVideoId) && ytPlaying
    );
}

function startYtTimer() {
    clearInterval(ytTimer);
    console.log('[YT] Starting progress timer');
    ytTimer = setInterval(() => {
        if (!ytPlayer || !ytReady) {
            console.warn('[YT] Timer running but player not ready');
            return;
        }
        if (ytAdPlaying) return;

        const cur = ytPlayer.getCurrentTime() || 0;
        const dur = ytPlayer.getDuration() || 0;

        // Prevent ad durations from overwriting the main video duration
        if (dur > 0 && !ytAdPlaying) {
            if (ytDuration === 0 || dur >= ytDuration) {
                ytDuration = dur;
            }
        }

        const pct = dur > 0 ? (cur / dur) * 100 : 0;

        // Update progress bar
        ytProgressFill.style.width = pct + '%';

        // Update time displays
        ytCurrentTimeEl.textContent = secToTime(cur);
        ytTotalTimeEl.textContent = secToTime(dur);
    }, 300);  // Update more frequently for smoother progress
}

function secToTime(s) {
    const m = Math.floor(s / 60); const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
}

// Periodic heartbeat to keep players in sync and prevent drift.
// Interval is 8 s (not 5 s) to reduce churn over high-latency TURN relays;
// the yt_state handler already corrects drifts > 4 s, so frequent pings are unnecessary.
function startSyncHeartbeat() {
    stopSyncHeartbeat();
    ytSyncHeartbeat = setInterval(() => {
        if (!ytPlayer || !ytReady || !ytPlaying || isSyncing || ytAdPlaying || ytAdOverlayShown) return;
        const videoId = (ytPlayer.getVideoData && ytPlayer.getVideoData().video_id) || ytVideoId || '';
        const currentTime = ytPlayer.getCurrentTime() || 0;
        sendSync({
            type: 'yt_state',
            videoId,
            currentTime,
            playing: true,
            stateVersion: ytStateVersion,
            sentBy: myName,
        });
    }, 8000); // Sync every 8 seconds — generous window for TURN relay latency
}

function stopSyncHeartbeat() {
    if (ytSyncHeartbeat) { clearInterval(ytSyncHeartbeat); ytSyncHeartbeat = null; }
}

// ─── AD DETECTION & SYNC ──────────────────────────────
// YouTube's public IFrame API exposes no ad start/end event. Keep this monitor
// alive for the whole loaded video and combine several signals. The time-stall
// signal uses only public player methods; the other signals are optional hints
// that are used only when a particular YouTube player build exposes them.

function startAdDetection() {
    if (ytAdCheckInterval) return;
    ytAdLastProgressAt = performance.now();

    const checkAd = () => {
        if (!ytPlayer || !ytReady || !ytVideoId) return;

        const now = performance.now();
        const wallNow = Date.now();
        const state = ytPlayer.getPlayerState();
        const currentTime = ytPlayer.getCurrentTime() || 0;
        const currentDuration = ytPlayer.getDuration() || 0;
        let strongAdSignal = false;
        let heuristicAdSignal = false;

        if (ytAdLastContentTime === null ||
            currentTime > ytAdLastContentTime + 0.15 ||
            currentTime < ytAdLastContentTime - 0.5) {
            ytAdLastProgressAt = now;
        }
        ytAdLastContentTime = currentTime;

        // Optional hint present in some player builds (not part of the public API).
        if (typeof ytPlayer.getAdState === 'function') {
            try {
                const adState = ytPlayer.getAdState();
                strongAdSignal = (adState === 1 || adState === 2 || adState === 3);
            } catch (error) {
                console.debug('[YT-AD] Optional getAdState hint unavailable', error);
            }
        }

        // Optional metadata hints. These fail safely when YouTube continues to
        // report the content video's metadata while an ad is playing.
        if (!strongAdSignal && typeof ytPlayer.getVideoData === 'function') {
            try {
                const data = ytPlayer.getVideoData();
                const currentId = data?.video_id || '';
                if (currentId && currentId !== ytVideoId) {
                    if (state === YT.PlayerState.PLAYING || state === YT.PlayerState.BUFFERING) {
                        strongAdSignal = true;
                    }
                }
            } catch (error) {
                console.debug('[YT-AD] Optional video metadata hint unavailable', error);
            }
        }

        if (!strongAdSignal && ytDuration > 0) {
            if (currentDuration > 0 && currentDuration < ytDuration * 0.3 && ytDuration > 60) {
                if (state === YT.PlayerState.PLAYING || state === YT.PlayerState.BUFFERING) {
                    strongAdSignal = true;
                }
            }
        }

        // During an iframe ad, the content clock commonly stops even though the
        // player reports PLAYING. Debounce this to avoid short network stalls.
        const notNearEnd = !currentDuration || currentTime < currentDuration - 2;
        heuristicAdSignal = state === YT.PlayerState.PLAYING &&
            notNearEnd && now - ytAdLastProgressAt >= YT_AD_STALL_MS;

        const adSignal = strongAdSignal || heuristicAdSignal;
        if (adSignal) {
            ytAdClearSince = 0;
            if (!ytAdCandidateSince) ytAdCandidateSince = now;
            const confirmed = strongAdSignal || now - ytAdCandidateSince >= YT_AD_START_CONFIRM_MS;
            if (confirmed && !ytAdPlaying) setLocalAdState(true, 'automatic');
        } else {
            ytAdCandidateSince = 0;
            if (ytAdPlaying && !ytManualAdPlaying) {
                if (!ytAdClearSince) ytAdClearSince = now;
                const contentAdvancing = now - ytAdLastProgressAt < 1200;
                if (contentAdvancing && now - ytAdClearSince >= YT_AD_END_CONFIRM_MS) {
                    setLocalAdState(false, 'automatic');
                }
            }
        }

        // Repeat active state for late joiners and recover from a dropped event.
        if (ytAdPlaying && wallNow - ytAdLastStatusSentAt >= YT_AD_STATUS_MS) {
            ytAdLastStatusSentAt = wallNow;
            sendAdStatus(true);
        }

        // A disconnected peer must not leave the whole room blocked forever.
        let removedStaleWaiter = false;
        for (const [peerId, waiter] of ytRemoteAdWaiters) {
            if (wallNow - waiter.lastSeen > YT_AD_WAITER_TIMEOUT_MS) {
                ytRemoteAdWaiters.delete(peerId);
                removedStaleWaiter = true;
            }
        }
        if (removedStaleWaiter) updateAdBarrierUi();
    };

    checkAd();
    ytAdCheckInterval = setInterval(checkAd, YT_AD_CHECK_MS);
}

function sendAdStatus(active) {
    const currentTime = ytPlayer && ytReady ? ytPlayer.getCurrentTime() || 0 : 0;
    sendSync({
        type: 'yt_ad_status',
        active,
        videoId: ytVideoId,
        currentTime,
        playing: ytPlaying,
        sentBy: myName,
    });
}

function setLocalAdState(active, source = 'automatic') {
    if (ytAdPlaying === active) return;
    ytAdPlaying = active;

    if (active) {
        console.log(`[YT-AD] 📺 Ad detected (${source}) — broadcasting to peers`);
        stopSyncHeartbeat();
        ytAdLastStatusSentAt = Date.now();
        sendAdStatus(true);
    } else {
        if (ytRemoteAdWaiters.size > 0 && ytPlaying) {
            ytWasPlayingBeforeAd = true;
        }
        console.log(`[YT-AD] ✅ Ad finished (${source}) — broadcasting to peers`);
        ytAdLastStatusSentAt = Date.now();
        sendAdStatus(false);
        if (ytPlaying) startSyncHeartbeat();
    }

    updateAdReportButton();
    updateAdBarrierUi();
}

function setRemoteAdState(senderId, name, active, lastPosition = null) {
    if (!senderId) return;
    const wasWaiting = ytRemoteAdWaiters.size > 0;

    if (active) {
        if (!wasWaiting && !ytAdPlaying) {
            ytWasPlayingBeforeAd = ytPlaying;
        }
        ytRemoteAdWaiters.set(senderId, {
            name: name || peersMap[senderId]?.name || 'a room member',
            lastSeen: Date.now(),
        });
    } else {
        ytRemoteAdWaiters.delete(senderId);
    }

    updateAdBarrierUi(!active ? lastPosition : null);
}

function stopAdDetection() {
    if (ytAdCheckInterval) { clearInterval(ytAdCheckInterval); ytAdCheckInterval = null; }
}

function showAdOverlay(message) {
    const overlay = document.getElementById('ytAdOverlay');
    if (!overlay) return;
    const textEl = overlay.querySelector('.ad-overlay-text');
    if (textEl && message) textEl.textContent = message;

    overlay.style.display = 'flex';
    const iframe = document.querySelector('#ytPlayerWrapper iframe');
    if (iframe) iframe.style.visibility = 'hidden';
    ytAdOverlayShown = true;
}

function hideAdOverlay() {
    const overlay = document.getElementById('ytAdOverlay');
    if (!overlay) return;
    overlay.style.display = 'none';
    const iframe = document.querySelector('#ytPlayerWrapper iframe');
    if (iframe) iframe.style.visibility = 'visible';
}

function updateAdBarrierUi(resumePosition = null) {
    const remoteWaiters = [...ytRemoteAdWaiters.values()];
    const hasRemoteWaiter = remoteWaiters.length > 0;
    const barrierActive = ytAdPlaying || hasRemoteWaiter;
    ytAdOverlayShown = barrierActive;

    // The member who has the local ad must continue seeing YouTube's ad. Other
    // members see our waiting panel with the iframe hidden, not covered.
    if (hasRemoteWaiter && !ytAdPlaying) {
        const names = remoteWaiters.map(waiter => waiter.name);
        const label = names.length === 1 ? names[0] : `${names.length} room members`;
        showAdOverlay(`Ad playing for ${label}…`);
        ytSyncText.textContent = `⏸ Waiting for ${label}'s ad to finish`;

        if (ytPlayer && ytReady &&
            ytPlayer.getPlayerState() === YT.PlayerState.PLAYING &&
            !ytBarrierPauseInProgress) {
            ytBarrierPauseInProgress = true;
            isSyncing = true;
            try { ytPlayer.pauseVideo(); } catch (e) { }
            setTimeout(() => {
                ytBarrierPauseInProgress = false;
                isSyncing = false;
            }, 750);
        }
        return;
    }

    hideAdOverlay();

    if (ytAdPlaying) {
        ytSyncText.textContent = 'Ad playing on your device…';
        return;
    }

    ytAdOverlayShown = false;
    ytSyncText.textContent = 'Listening together 🌙';

    if (ytWasPlayingBeforeAd && ytPlayer && ytReady) {
        ytWasPlayingBeforeAd = false;
        isSyncing = true;
        if (Number.isFinite(resumePosition) &&
            Math.abs((ytPlayer.getCurrentTime() || 0) - resumePosition) > 2) {
            ytPlayer.seekTo(resumePosition, true);
        }
        try { ytPlayer.playVideo(); } catch (e) { }
        setTimeout(() => { isSyncing = false; }, 1000);
    }
}

function updateAdReportButton() {
    const button = document.getElementById('ytReportAdBtn');
    if (!button) return;
    button.classList.toggle('active', ytManualAdPlaying);
    button.textContent = ytManualAdPlaying ? 'Ad finished' : 'Ad not detected?';
    button.setAttribute('aria-pressed', ytManualAdPlaying ? 'true' : 'false');
}

// ─────────────────────────────────────────────────────
//  SYNC MESSAGE HANDLER
// ─────────────────────────────────────────────────────
async function handleSyncMessage(msg, senderId) {
    if (!msg || !msg.type) return;

    if (msg.type === 'guest_joined') {
        console.log('[SYNC] 📥 guest_joined:', msg.name, msg.id);
        if (msg.id !== hostId && msg.id !== peer?.id) {
            const conn = peer.connect(msg.id, { reliable: true, serialization: 'json' });
            setupGuestToGuest(conn, msg.name);
        }

        // Update members panel when a new guest joins
        if (typeof updateMembersPanel === 'function') {
            updateMembersPanel();
        }
        return;
    }

    // ── Secure Chat Messaging ─────────────────────────────────
    if (msg.type === 'chat_msg') {
        const chatMsg = msg.message;
        chatMsg.senderLabel = msg.sentBy || "Unknown";

        if (chatMsg.to && chatMsg.to !== 'all' && chatMsg.to !== peer?.id) {
            return;
        }
        // Check for duplicates
        if (!chatDB_ready || !document.querySelector(`[data-chat-id="${chatMsg.id}"]`)) {
            appendChatMessage(chatMsg, true);
            const panel = document.getElementById('chatPanel');
            if (!panel || !panel.classList.contains('show')) {
                toast(`New message from ${chatMsg.senderLabel} 💬`, 'info');
            }
        }
        return;
    }

    // ── Call coordination / ring notification ──────────
    if (msg.type === 'call_ring' || msg.type === 'call_request') {
        // The actual WebRTC call arrives via peer.on('call') — this is just the ring notification
        const callerName = msg.callerName || peersMap[senderId]?.name || 'Someone';
        toast(`📞 ${callerName} is calling…`, 'info', 5000);
        playRingtone();
        // Ring will stop automatically when WebRTC call arrives via handleIncomingCall
        return;
    }

    // ── Playlist sync from partner ─────────────────────────
    if (msg.type === 'playlist_sync') {
        console.log('[SYNC] 📥 Received playlist_sync from', senderId);
        if (msg.roomPlaylists) {
            // merge or replace
            for (const [name, list] of Object.entries(msg.roomPlaylists)) {
                if (!roomPlaylists[name]) roomPlaylists[name] = [];
                for (const item of list) {
                    if (!roomPlaylists[name].find(p => p.videoId === item.videoId)) {
                        roomPlaylists[name].push(item);
                    }
                }
            }
            savePlaylist(); renderPlaylist(); toast('Playlists synced 📋', 'info');
        } else if (msg.playlist) {
            // legacy array merge to "Room Playlist"
            if (!roomPlaylists["Room Playlist"]) roomPlaylists["Room Playlist"] = [];
            for (const item of msg.playlist) {
                if (!roomPlaylists["Room Playlist"].find(p => p.videoId === item.videoId)) {
                    roomPlaylists["Room Playlist"].push(item);
                }
            }
            savePlaylist(); renderPlaylist(); toast('Playlists synced 📋', 'info');
        }
        return;
    }

    if (msg.type === 'playlist_add') {
        console.log('[SYNC] 📥 Received playlist_add from', senderId, ':', msg.item?.title);
        const name = msg.playlistName || "Room Playlist";
        if (!roomPlaylists[name]) roomPlaylists[name] = [];
        if (msg.item && !roomPlaylists[name].find(p => p.videoId === msg.item.videoId)) {
            roomPlaylists[name].push(msg.item);
            savePlaylist();
            renderPlaylist();
            toast(`${msg.item.title.slice(0, 30)}… added to ${name} 🎵`, 'info');
        }
        return;
    }

    if (msg.type === 'playlist_remove') {
        console.log('[SYNC] 📥 Received playlist_remove from', senderId);
        const name = msg.playlistName || "Room Playlist";
        if (roomPlaylists[name]) {
            const idx = roomPlaylists[name].findIndex(p => p.videoId === msg.videoId);
            if (idx !== -1) { roomPlaylists[name].splice(idx, 1); savePlaylist(); renderPlaylist(); }
        }
        return;
    }

    // ── Partner stopped the song ───────────────────────
    if (msg.type === 'yt_stop') {
        toast(`${msg.sentBy} stopped the music`, 'info');
        stopYouTube(false); // false = don't re-broadcast back
        return;
    }

    // ── Partner loaded a new song ─────────────────────
    if (msg.type === 'yt_load') {
        ytStateVersion = Math.max(ytStateVersion, Number(msg.stateVersion) || 0);
        ytRemoteStateTarget = { playing: true, expiresAt: performance.now() + 5000 };
        toast(`${msg.sentBy} is playing a song 🎵`, 'info');
        ytNowPlayingWho.textContent = `${msg.sentBy} picked this`;
        loadYouTubeVideo(msg.videoId, 0, true);
        return;
    }

    // ── YouTube playback sync ─────────────────────────
    if (msg.type === 'yt_state') {
        if (ytAdPlaying || ytAdOverlayShown) {
            console.log('[YT-AD] Ignoring incoming yt_state sync during ad playback');
            return;
        }
        const incomingVersion = Number(msg.stateVersion) || 0;
        if (incomingVersion && incomingVersion < ytStateVersion) {
            console.log('[YT] Ignoring stale playback sync', { incomingVersion, ytStateVersion });
            return;
        }
        ytStateVersion = Math.max(ytStateVersion, incomingVersion);
        ytSyncText.textContent = `${msg.sentBy} ${msg.playing ? 'is playing' : 'paused'} 🌙`;

        if (msg.videoId && msg.videoId !== ytVideoId) {
            // Different video — load it.
            // syncLockMs = 6000: keeps isSyncing=true for 6 s so that the PLAYING
            // event the player fires after buffering (slow on TURN relay) is not
            // echoed back as a new play command that makes the other device replay.
            ytRemoteStateTarget = { playing: Boolean(msg.playing), expiresAt: performance.now() + 8000 };
            await loadYouTubeVideo(msg.videoId, msg.currentTime, msg.playing, 6000);
        } else if (ytPlayer && ytReady) {
            // Same video — sync position only if drifted > 4 s.
            // Threshold raised from 2 s: TURN relay adds round-trip latency so
            // small drifts are expected and correcting them constantly creates
            // replay loops on mobile.
            if (Math.abs((ytPlayer.getCurrentTime() || 0) - msg.currentTime) > 4) {
                isSyncing = true;
                ytPlayer.seekTo(msg.currentTime, true);
                setTimeout(() => { isSyncing = false; }, 2000);
            }
            if (msg.playing && ytPlayer.getPlayerState() !== YT.PlayerState.PLAYING) {
                isSyncing = true;
                ytRemoteStateTarget = { playing: true, expiresAt: performance.now() + 4000 };
                ytPlayer.playVideo();
                setTimeout(() => { isSyncing = false; }, 2000);
            } else if (!msg.playing && ytPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
                isSyncing = true;
                ytRemoteStateTarget = { playing: false, expiresAt: performance.now() + 4000 };
                ytPlayer.pauseVideo();
                setTimeout(() => { isSyncing = false; }, 2000);
            }
        }
        ytPlaying = msg.playing;
        updateYtIcon();
        if (ytPlaying) startYtTimer(); else clearInterval(ytTimer);
        return;
    }

    // ── YouTube ad sync ───────────────────────────────
    if (msg.type === 'yt_ad_playing' || (msg.type === 'yt_ad_status' && msg.active)) {
        if (msg.videoId && ytVideoId && msg.videoId !== ytVideoId) return;
        console.log(`[YT-AD] 📺 ${msg.sentBy} is watching an ad — pausing & showing overlay`);
        setRemoteAdState(senderId, msg.sentBy, true);
        return;
    }

    if (msg.type === 'yt_ad_ended' || (msg.type === 'yt_ad_status' && !msg.active)) {
        if (msg.videoId && ytVideoId && msg.videoId !== ytVideoId) return;
        console.log(`[YT-AD] ✅ ${msg.sentBy}'s ad finished — resuming playback`);
        setRemoteAdState(senderId, msg.sentBy, false, msg.currentTime);
        return;
    }

    // ── Partner name ──────────────────────────────────
    if (msg.type === 'peer_name') {
        partnerLabel.textContent = msg.name + ' 💫';
        partnerPlaceholderName.textContent = msg.name;
    }
}

// ─────────────────────────────────────────────────────
//  PLAYLIST  (persisted per room in localStorage)
// ─────────────────────────────────────────────────────
const PLAYLIST_KEY = `ourspace_playlist_${roomId}`;
const PERSONAL_PLAYLIST_KEY = 'ourspace_personal_playlist';

let roomPlaylists = { "Room Playlist": [] };
let personalPlaylists = { "Random": [] };
let activePlaylistTab = 'room'; // 'room' | 'personal'
let activePlaylistName = 'Room Playlist';

async function loadPlaylist() {
    try {
        const parsedRoom = await loadSecureData(PLAYLIST_KEY);
        if (Array.isArray(parsedRoom)) roomPlaylists = { "Room Playlist": parsedRoom };
        else if (parsedRoom && typeof parsedRoom === 'object') roomPlaylists = parsedRoom;
    } catch (e) {
        console.error('[STORAGE] Failed to load room playlists:', e);
    }

    try {
        const parsedPersonal = await loadSecureData(PERSONAL_PLAYLIST_KEY);
        if (Array.isArray(parsedPersonal)) personalPlaylists = { "Random": parsedPersonal };
        else if (parsedPersonal && typeof parsedPersonal === 'object') personalPlaylists = parsedPersonal;
    } catch (e) {
        console.error('[STORAGE] Failed to load personal playlists:', e);
    }

    ensureActivePlaylist();
    renderPlaylist();
}

function ensureActivePlaylist() {
    if (Object.keys(roomPlaylists).length === 0) roomPlaylists["Room Playlist"] = [];
    if (Object.keys(personalPlaylists).length === 0) personalPlaylists["Random"] = [];

    const dict = activePlaylistTab === 'room' ? roomPlaylists : personalPlaylists;
    if (!dict[activePlaylistName]) {
        activePlaylistName = Object.keys(dict)[0];
    }
}

async function savePlaylist() {
    await saveSecureData(PLAYLIST_KEY, roomPlaylists);
    await saveSecureData(PERSONAL_PLAYLIST_KEY, personalPlaylists);
}

function getActiveList() {
    ensureActivePlaylist();
    const dict = activePlaylistTab === 'room' ? roomPlaylists : personalPlaylists;
    return dict[activePlaylistName];
}

function renderPlaylist() {
    ensureActivePlaylist();
    const list = getActiveList();
    const container = document.getElementById('playlistItems');
    const empty = document.getElementById('playlistEmpty');
    const count = document.getElementById('playlistCount');
    const dropdown = document.getElementById('playlistDropdown');

    if (count) count.textContent = list.length + (list.length === 1 ? ' song' : ' songs');

    document.querySelectorAll('.pl-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === activePlaylistTab));

    const dict = activePlaylistTab === 'room' ? roomPlaylists : personalPlaylists;
    if (dropdown) {
        dropdown.innerHTML = Object.keys(dict).map(name => `<option value="${name}" ${name === activePlaylistName ? 'selected' : ''}>${name}</option>`).join('');
    }

    if (list.length === 0) {
        container.innerHTML = ''; empty.style.display = 'block'; return;
    }
    empty.style.display = 'none';
    container.innerHTML = list.map((item, i) => `
        <div class="pl-item ${ytVideoId === item.videoId ? 'pl-item--active' : ''}" data-i="${i}">
            <img class="pl-thumb" src="https://img.youtube.com/vi/${item.videoId}/mqdefault.jpg" alt="" loading="lazy" />
            <div class="pl-title" title="${item.title}">${item.title}</div>
            <div class="pl-btns">
                <button class="pl-play" onclick="playFromPlaylist(${i})" title="Play">▶</button>
                <button class="pl-del"  onclick="deleteFromPlaylist(${i})" title="Remove">✕</button>
            </div>
        </div>
    `).join('');
}

// Tab listeners
document.querySelectorAll('.pl-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        activePlaylistTab = tab.dataset.tab;

        // Set default playlist name based on tab
        if (activePlaylistTab === 'personal') {
            activePlaylistName = 'Random';
        } else {
            activePlaylistName = 'Room Playlist';
        }

        ensureActivePlaylist();
        renderPlaylist();
    });
});

document.getElementById('playlistDropdown').addEventListener('change', (e) => {
    activePlaylistName = e.target.value;
    renderPlaylist();
});

document.getElementById('newPlaylistBtn').addEventListener('click', async () => {
    const name = prompt("Enter new playlist name:");
    if (name && name.trim()) {
        const cleanName = name.trim();
        const playlistType = activePlaylistTab === 'room' ? 'room' : 'personal';

        // Create playlist in database if we have a room ID
        if (currentRoomId) {
            try {
                const result = await api.createPlaylist(currentRoomId, cleanName, playlistType);
                if (result.success && result.playlist) {
                    // Store the playlist ID in the map
                    playlistIdMap[cleanName] = result.playlist.playlistId;
                    console.log(`[PLAYLIST] Created ${playlistType} playlist "${cleanName}" (ID: ${result.playlist.playlistId}) in database`);
                }
            } catch (err) {
                console.error('[PLAYLIST] Failed to create playlist in database:', err);
                // Continue anyway - save locally
            }
        }

        // Create locally
        if (activePlaylistTab === 'room') {
            if (!roomPlaylists[cleanName]) roomPlaylists[cleanName] = [];
        } else {
            if (!personalPlaylists[cleanName]) personalPlaylists[cleanName] = [];
        }

        activePlaylistName = cleanName;
        savePlaylist();
        renderPlaylist();

        if (activePlaylistTab === 'room') {
            sendSync({ type: 'playlist_sync', roomPlaylists });
        }
    }
});

document.getElementById('addToPlaylistBtn').addEventListener('click', async () => {
    if (!ytVideoId) return;
    const list = getActiveList();
    if (list.find(p => p.videoId === ytVideoId)) { toast('Already in playlist!', 'info'); return; }

    const titleEL = document.getElementById('ytTrackTitle');
    const title = titleEL.textContent && titleEL.textContent !== '—' ? titleEL.textContent : ytVideoId;

    // Get duration from YouTube player
    const duration = ytPlayer && ytPlayer.getDuration ? Math.floor(ytPlayer.getDuration()) : 0;

    // Try to parse artist from title (format: "Artist - Title")
    let artist = null;
    if (title.includes(' - ')) {
        const parts = title.split(' - ');
        if (parts.length >= 2) {
            artist = parts[0].trim();
        }
    }

    // Build thumbnail URL
    const thumbnail = `https://img.youtube.com/vi/${ytVideoId}/mqdefault.jpg`;

    const item = {
        videoId: ytVideoId,
        title,
        artist,
        duration,
        thumbnail,
        addedAt: Date.now()
    };
    list.push(item);
    savePlaylist();
    renderPlaylist();

    // Save to database - use the playlist ID from the map for the current active playlist
    const activePlaylistId = playlistIdMap[activePlaylistName];
    if (activePlaylistId) {
        try {
            const result = await api.addSongToPlaylist(activePlaylistId, {
                videoId: ytVideoId,
                title: title,
                artist: artist || 'Unknown',
                durationSeconds: duration || 0,
                thumbnailUrl: thumbnail
            });

            if (result.success && result.playlistSong) {
                // Store the playlistSongId for future deletion
                item.playlistSongId = result.playlistSong.playlistSongId;
                console.log(`[PLAYLIST] Song saved to playlist "${activePlaylistName}" (ID: ${activePlaylistId}) in database:`, title);
            }
        } catch (err) {
            console.error('[PLAYLIST] Failed to save song to database:', err);
            // Continue anyway - song is saved locally
        }
    } else {
        console.warn(`[PLAYLIST] No playlist ID found for "${activePlaylistName}", song not saved to database`);
    }

    // Sync to partner only if acting on Room playlist
    if (activePlaylistTab === 'room') {
        sendSync({ type: 'playlist_add', item, playlistName: activePlaylistName });
    }
    toast(`Added to ${activePlaylistName} 📋`, 'success');
});

window.playFromPlaylist = function (i) {
    const item = getActiveList()[i];
    if (!item) return;
    loadYouTubeVideo(item.videoId, 0, true);
    ytStateVersion += 1;
    sendSync({ type: 'yt_load', videoId: item.videoId, stateVersion: ytStateVersion, sentBy: myName });
};

window.deleteFromPlaylist = async function (i) {
    const list = getActiveList();
    const removed = list[i];
    if (!removed) return;

    // Delete from database if it's a room playlist and has playlistSongId
    if (activePlaylistTab === 'room' && removed.playlistSongId) {
        try {
            await api.removeSongFromPlaylist(removed.playlistSongId);
            console.log('[PLAYLIST] Song removed from database:', removed.title);
        } catch (err) {
            console.error('[PLAYLIST] Failed to remove song from database:', err);
            // Continue anyway - we'll remove it locally
        }
    }

    list.splice(i, 1);
    savePlaylist();
    renderPlaylist();

    // Sync removal to partner only if acting on Room playlist
    if (activePlaylistTab === 'room' && removed) {
        sendSync({ type: 'playlist_remove', videoId: removed.videoId, playlistName: activePlaylistName });
    }
};

// ── Playlist Management Menu ────────────────────────────────
const plMenuBtn = document.getElementById('plMenuBtn');
const plMenuPopup = document.getElementById('plMenuPopup');

if (plMenuBtn && plMenuPopup) {
    plMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetTab = activePlaylistTab === 'room' ? 'Personal' : 'Room';
        document.getElementById('plMenuMove').innerHTML = `↔️ Move to ${targetTab}`;
        const copyBtn = document.getElementById('plMenuCopy');
        if (copyBtn) copyBtn.innerHTML = `↗️ Send copy to ${targetTab}`;
        plMenuPopup.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
        if (!plMenuPopup.contains(e.target) && e.target !== plMenuBtn) {
            plMenuPopup.classList.remove('show');
        }
    });

    document.getElementById('plMenuRename').addEventListener('click', () => {
        plMenuPopup.classList.remove('show');
        const newName = prompt(`Rename "${activePlaylistName}" to:`, activePlaylistName);
        if (newName && newName.trim() && newName !== activePlaylistName) {
            const cleanName = newName.trim();
            const dict = activePlaylistTab === 'room' ? roomPlaylists : personalPlaylists;
            if (dict[cleanName]) {
                toast('Name already exists!', 'error');
                return;
            }
            dict[cleanName] = dict[activePlaylistName];
            delete dict[activePlaylistName];
            activePlaylistName = cleanName;
            savePlaylist();
            renderPlaylist();
            if (activePlaylistTab === 'room') sendSync({ type: 'playlist_sync', roomPlaylists });
            toast('Playlist renamed!', 'success');
        }
    });

    const copyBtnClick = document.getElementById('plMenuCopy');
    if (copyBtnClick) {
        copyBtnClick.addEventListener('click', () => {
            plMenuPopup.classList.remove('show');
            const sourceDict = activePlaylistTab === 'room' ? roomPlaylists : personalPlaylists;
            const targetDict = activePlaylistTab === 'room' ? personalPlaylists : roomPlaylists;

            if (targetDict[activePlaylistName]) {
                toast(`Playlist "${activePlaylistName}" already exists there.`, 'error');
                return;
            }

            targetDict[activePlaylistName] = [...(sourceDict[activePlaylistName] || [])];
            savePlaylist();

            if (activePlaylistTab === 'personal') {
                sendSync({ type: 'playlist_sync', roomPlaylists });
            }
            toast('Playlist copied! 📋', 'success');
        });
    }

    document.getElementById('plMenuMove').addEventListener('click', () => {
        plMenuPopup.classList.remove('show');
        if (activePlaylistName === 'Room Playlist' || activePlaylistName === 'Random') {
            toast('Cannot move default playlist.', 'info');
            return;
        }
        const sourceDict = activePlaylistTab === 'room' ? roomPlaylists : personalPlaylists;
        const targetDict = activePlaylistTab === 'room' ? personalPlaylists : roomPlaylists;
        const targetTab = activePlaylistTab === 'room' ? 'personal' : 'room';

        if (targetDict[activePlaylistName]) {
            toast('A playlist with this name already exists in destination.', 'error');
            return;
        }

        targetDict[activePlaylistName] = sourceDict[activePlaylistName];
        delete sourceDict[activePlaylistName];

        savePlaylist();

        if (activePlaylistTab === 'room' || targetTab === 'room') {
            sendSync({ type: 'playlist_sync', roomPlaylists });
        }

        activePlaylistTab = targetTab;
        renderPlaylist();
        toast('Playlist moved!', 'success');
    });

    document.getElementById('plMenuDelete').addEventListener('click', () => {
        plMenuPopup.classList.remove('show');
        if (activePlaylistName === 'Room Playlist' || activePlaylistName === 'Random') {
            toast('Cannot delete default playlist.', 'info');
            return;
        }
        if (confirm(`Are you sure you want to delete "${activePlaylistName}"?`)) {
            const dict = activePlaylistTab === 'room' ? roomPlaylists : personalPlaylists;
            delete dict[activePlaylistName];
            activePlaylistName = activePlaylistTab === 'room' ? "Room Playlist" : "Random";
            savePlaylist();
            renderPlaylist();
            if (activePlaylistTab === 'room') sendSync({ type: 'playlist_sync', roomPlaylists });
            toast('Playlist deleted.', 'info');
        }
    });
}

// ─────────────────────────────────────────────────────
//  CINEMA MODE — fullscreen + auto-hide UI on idle
// ─────────────────────────────────────────────────────
let cinemaActive = false;
let cinemaTimer = null;

const cinemaBtn = document.getElementById('cinemaBtn');
cinemaBtn.addEventListener('click', toggleCinema);

// Also toggle on F key, and handle Escape for un-expanding
document.addEventListener('keydown', e => {
    if (e.key === 'f' || e.key === 'F') { if (!e.target.matches('input,textarea')) toggleCinema(); }
    if (e.key === 'Escape') {
        if (document.body.classList.contains('has-expanded')) {
            collapseAll();
        }
    }
});

function toggleCinema() {
    if (!cinemaActive) {
        document.documentElement.requestFullscreen().catch(() => {
            // Fullscreen blocked — still do UI hiding
        });
        cinemaActive = true;
        document.body.classList.add('cinema');
        cinemaBtn.textContent = '✕ Exit';
        startCinemaTimer();
        toast('Cinema mode — move your mouse to show controls 🎬', 'info', 3000);
    } else {
        exitCinema();
    }
}

function exitCinema() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
    cinemaActive = false;
    clearTimeout(cinemaTimer);
    document.body.classList.remove('cinema', 'cinema-hidden');
    cinemaBtn.textContent = '🎬';
}

function startCinemaTimer() {
    clearTimeout(cinemaTimer);
    document.body.classList.remove('cinema-hidden');
    cinemaTimer = setTimeout(() => {
        if (cinemaActive) document.body.classList.add('cinema-hidden');
    }, 3000);
}

document.addEventListener('mousemove', () => { if (cinemaActive) startCinemaTimer(); });
document.addEventListener('touchstart', () => { if (cinemaActive) startCinemaTimer(); });
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && cinemaActive) exitCinema(); });

// ─────────────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────────────
(async () => {
    // Ensure the database knows we are in the room and online
    if (roomId && typeof api !== 'undefined') {
        try {
            console.log('[BOOT] Registering room entry in database for room:', roomId);
            const joinResult = await api.joinRoom(roomId);
            if (joinResult && joinResult.success && joinResult.room) {
                currentRoomId = parseInt(joinResult.room.roomId);
                sessionStorage.setItem('currentRoomId', currentRoomId);
                localStorage.setItem('currentRoomId', currentRoomId);
                isAlreadyMember = true;
                localStorage.setItem('member_of_' + roomId, 'true');
                console.log('[BOOT] Database room entry successful, room ID:', currentRoomId);
            }
        } catch (err) {
            console.error('[BOOT] Failed to register room entry in database:', err);
        }
    }

    await setupPeer();
    loadPlaylist();

    const sendName = () => { broadcast({ type: 'peer_name', name: myName }); };
    setTimeout(sendName, 1500);

})();

// ─────────────────────────────────────────────────────
//  SECURE LOCAL CHAT (IndexedDB + PeerJS Data Channel)
// ─────────────────────────────────────────────────────
const CHAT_DB_NAME = `OurSpaceChat_${roomId}`;
const CHAT_DB_VERSION = 1;
let chatDB;
let chatDB_ready = false;
let unreadChatCount = 0;

let currentReplyTo = null;

window.clearReplyTo = function () {
    currentReplyTo = null;
    document.getElementById('chatReplyPreview').style.display = 'none';
    const input = document.getElementById('chatInput');
    if (input) input.focus();
};

window.setReplyTo = function (id, text, senderLabel) {
    currentReplyTo = { id, text, senderLabel };
    const preview = document.getElementById('chatReplyPreview');
    preview.style.display = 'flex';
    preview.innerHTML = `
        <div class="reply-preview-text">
            <strong>${senderLabel}</strong>
            ${text.substring(0, 60)}${text.length > 60 ? '...' : ''}
        </div>
        <button class="chat-reply-close" onclick="clearReplyTo()">✕</button>
    `;
    document.getElementById('chatInput').focus();
};

window.scrollToMsg = function (id) {
    const el = document.querySelector(`[data-chat-id="${id}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else toast('Message is not loaded or too old.', 'info');
};

window.openImageModal = function (src, fileName) {
    document.getElementById('imageModalImg').src = src;
    const dl = document.getElementById('imageModalDownload');
    dl.href = src;
    dl.download = fileName;
    document.getElementById('imageModal').classList.add('show');
};

function initChatDB() {
    const request = indexedDB.open(CHAT_DB_NAME, CHAT_DB_VERSION);
    request.onupgradeneeded = e => {
        chatDB = e.target.result;
        if (!chatDB.objectStoreNames.contains('messages')) {
            chatDB.createObjectStore('messages', { keyPath: 'id' });
        }
    };
    request.onsuccess = e => {
        chatDB = e.target.result;
        chatDB_ready = true;
        loadChatHistory();
    };
    request.onerror = e => console.error("Chat DB error:", e);
}

async function loadChatHistory() {
    if (!chatDB) return;
    const tx = chatDB.transaction('messages', 'readonly');
    const store = tx.objectStore('messages');
    const req = store.getAll();
    req.onsuccess = async () => {
        const msgs = req.result;
        const container = document.getElementById('chatMessages');
        container.innerHTML = '';

        for (const encryptedMsg of msgs) {
            try {
                // Decrypt message
                let msg;
                if (encryptedMsg.encrypted) {
                    const decrypted = await decryptData(encryptedMsg.encrypted);
                    if (decrypted) {
                        msg = { ...decrypted, id: encryptedMsg.id, timestamp: encryptedMsg.timestamp };
                    } else {
                        console.warn('[SECURITY] Failed to decrypt chat message, skipping');
                        continue;
                    }
                } else {
                    // Old unencrypted message
                    msg = encryptedMsg;
                }

                await appendChatMessage(msg, false);
            } catch (err) {
                console.error('[SECURITY] Error loading chat message:', err);
            }
        }

        container.scrollTop = container.scrollHeight;
        console.log('[SECURITY] 🔐 Chat history loaded and decrypted');
    };
}

async function appendChatMessage(msg, saveToDb = true) {
    if (saveToDb && chatDB) {
        try {
            // Encrypt message before storing
            const encryptedMsg = {
                id: msg.id,
                timestamp: msg.timestamp,
                encrypted: await encryptData({
                    sender: msg.sender,
                    sentBy: msg.sentBy,
                    senderLabel: msg.senderLabel,
                    type: msg.type,
                    content: msg.content,
                    fileName: msg.fileName,
                    replyTo: msg.replyTo,
                    to: msg.to,
                    toName: msg.toName
                })
            };

            const tx = chatDB.transaction('messages', 'readwrite');
            tx.objectStore('messages').put(encryptedMsg);
            console.log('[SECURITY] 🔐 Chat message encrypted and stored');
        } catch (err) {
            console.error('[SECURITY] Failed to encrypt chat message:', err);
        }
    }

    const container = document.getElementById('chatMessages');
    const div = document.createElement('div');
    const isMe = msg.sender === myName;
    div.className = `chat-msg ${isMe ? 'me' : 'partner'}`;
    div.dataset.chatId = msg.id;

    let replyHtml = '';
    if (msg.replyTo) {
        replyHtml = `
            <div class="chat-quoted" onclick="scrollToMsg('${msg.replyTo.id}')">
                <strong>${msg.replyTo.senderLabel}</strong>
                <div>${msg.replyTo.text.substring(0, 60)}${msg.replyTo.text.length > 60 ? '...' : ''}</div>
            </div>
        `;
    }

    let contentHtml = '';
    let rawTextForReply = '';
    if (msg.type === 'image') {
        contentHtml = `
            <div class="chat-img-wrapper">
                <img src="${msg.content}" class="chat-img-preview" alt="Image" onclick="openImageModal('${msg.content}', '${msg.fileName || 'image.jpg'}')" />
            </div>
        `;
        rawTextForReply = '📷 Image';
    } else if (msg.type === 'file') {
        contentHtml = `<a href="${msg.content}" download="${msg.fileName}" class="chat-file-preview" target="_blank">📄 ${msg.fileName} <span style="margin-left:auto">⬇️</span></a>`;
        rawTextForReply = `📄 ${msg.fileName}`;
    } else {
        const safeText = msg.content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        contentHtml = `<span>${safeText}</span>`;
        rawTextForReply = safeText;
    }

    const safeReplyStr = rawTextForReply.replace(/'/g, "\\'").replace(/"/g, "&quot;");
    const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const privFlag = msg.to && msg.to !== 'all' ? `<small style="color:var(--accent-purple);margin-left:5px;">[Private]</small>` : '';

    div.innerHTML = `
        <div class="chat-bubble">
            ${replyHtml}
            ${contentHtml}
        </div>
        <div class="chat-meta">
            <span>${isMe ? 'You' : msg.senderLabel}${privFlag}</span>
            <span>${timeStr}</span>
            <button class="chat-action-btn" title="Reply" onclick="setReplyTo('${msg.id}', '${safeReplyStr}', '${isMe ? 'You' : msg.senderLabel}')">↩️</button>
        </div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;

    const panel = document.getElementById('chatPanel');
    if (panel && !panel.classList.contains('show') && !isMe) {
        unreadChatCount++;
        const badge = document.getElementById('chatBadge');
        if (badge) {
            badge.textContent = unreadChatCount;
            badge.style.display = 'block';
        }
    }
}

async function sendChatMessage(text, type = 'text', fileData = null, fileName = null) {
    const toId = document.getElementById('chatRecipient')?.value || 'all';
    const toName = toId === 'all' ? 'Everyone' : (peersMap[toId] ? peersMap[toId].name : 'Unknown');

    // Save to database first (if room ID exists)
    if (currentRoomId && type === 'text' && toId === 'all') {
        try {
            await api.sendMessage(currentRoomId, {
                content: text,
                messageType: 'text'
            });
            console.log('[MESSAGES] Saved to database');
        } catch (err) {
            console.error('[MESSAGES] Failed to save to database:', err);
            // Continue with P2P even if database save fails
        }
    }

    const msg = {
        id: Date.now() + '-' + Math.random().toString(36).substr(2, 5),
        sender: myName,
        sentBy: myName,
        senderLabel: myName,
        type: type,
        content: type === 'text' ? text : fileData,
        fileName: fileName,
        replyTo: currentReplyTo,
        timestamp: Date.now(),
        to: toId,
        toName: toName
    };
    clearReplyTo();
    appendChatMessage(msg, true);

    if (toId === 'all') {
        broadcast({ type: 'chat_msg', message: msg, sentBy: myName });
    } else if (peersMap[toId] && peersMap[toId].dataConn) {
        secureSend(peersMap[toId].dataConn, { type: 'chat_msg', message: msg, sentBy: myName });
    }
}

// GUI Listeners
const chatToggleBtn = document.getElementById('chatToggleBtn');
const chatPanel = document.getElementById('chatPanel');
const chatCloseBtn = document.getElementById('chatCloseBtn');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');
const chatFileInput = document.getElementById('chatFileInput');
const musicSection = document.getElementById('musicSection');
const musicToggleBtn = document.getElementById('musicToggleBtn');
const musicCloseBtn = document.getElementById('musicCloseBtn');
const ytStopBtn = document.getElementById('ytStopBtn');
const ytHeaderBtn = document.getElementById('ytHeaderBtn');

// Start with the YouTube panel hidden — user opens it via the floating YT button.
// On mobile the panel is already off-screen (no mobile-open); on desktop we add
// desktop-hidden so the grid collapses and videos fill the full width by default.
if (musicSection && !window.matchMedia('(max-width: 600px), (pointer: coarse) and (max-width: 900px)').matches) {
    musicSection.classList.add('desktop-hidden');
}

function isMobileRoomLayout() {
    return window.matchMedia('(max-width: 600px), (pointer: coarse) and (max-width: 900px)').matches;
}

function syncMobileDrawerState() {
    const drawerOpen = chatPanel?.classList.contains('show') || musicSection?.classList.contains('mobile-open');
    document.body.classList.toggle('mobile-drawer-open', isMobileRoomLayout() && drawerOpen);
}

function closeMobileMusic() {
    const keepPlayerAlive = isMobileRoomLayout() && Boolean(ytVideoId);
    musicSection?.classList.remove('mobile-open');
    musicSection?.classList.toggle('mobile-minimized', keepPlayerAlive);
    musicToggleBtn?.classList.remove('active');
    musicToggleBtn?.classList.toggle('playing', keepPlayerAlive && ytPlaying);
    syncMobileDrawerState();
}

// ── stopYouTube: stops playback, clears all state, returns to idle.
// Broadcasts yt_stop so both devices dismiss the player in sync.
function stopYouTube(broadcast = true) {
    // Stop & reset the YouTube player
    if (ytPlayer && ytReady) {
        try { ytPlayer.stopVideo(); } catch (e) { }
    }
    stopSyncHeartbeat();
    stopAdDetection();
    clearInterval(ytTimer);

    // Reset all YT state variables
    ytVideoId = null;
    ytPlaying = false;
    ytDuration = 0;
    ytStateVersion = 0;
    ytRemoteStateTarget = null;
    ytAdPlaying = false;
    ytAdOverlayShown = false;
    ytManualAdPlaying = false;
    ytRemoteAdWaiters.clear();
    ytWasPlayingBeforeAd = false;

    // Hide the now-playing card, show idle screen
    ytNowPlayingCard.style.display = 'none';
    musicIdle.style.display = 'flex';
    hideAdOverlay();
    updateAdReportButton();
    updateYtIcon();

    // Reset progress display
    ytProgressFill.style.width = '0%';
    ytCurrentTimeEl.textContent = '0:00';
    ytTotalTimeEl.textContent = '0:00';
    ytSyncText.textContent = 'Listening together 🌙';

    // Update mobile toggle button state
    musicToggleBtn?.classList.remove('playing');
    ytHeaderBtn?.classList.remove('has-song');

    if (broadcast) {
        sendSync({ type: 'yt_stop', sentBy: myName });
    }
    toast('Stopped playing 🎵', 'info');
}

if (ytStopBtn) {
    ytStopBtn.addEventListener('click', () => stopYouTube(true));
}

// ── Unified YouTube panel toggle
// Desktop: toggles the desktop-hidden class so the panel slides in/out and
//          the video grid column expands to fill the space.
// Mobile:  uses the existing mobile drawer (mobile-open class).
function toggleMusicPanel() {
    if (!musicSection) return;

    if (isMobileRoomLayout()) {
        // Mobile: use the drawer system
        const opening = !musicSection.classList.contains('mobile-open');
        if (!opening) {
            closeMobileMusic();
        } else {
            chatPanel?.classList.remove('show');
            musicSection.classList.remove('mobile-minimized');
            musicSection.classList.add('mobile-open');
            musicToggleBtn?.classList.add('active');
            musicToggleBtn?.classList.remove('playing');
            syncMobileDrawerState();
        }
    } else {
        // Desktop: show/hide the side panel
        const isHidden = musicSection.classList.contains('desktop-hidden');
        musicSection.classList.toggle('desktop-hidden', !isHidden);
        musicToggleBtn?.classList.toggle('active', isHidden); // active = panel open
    }
}

if (musicToggleBtn && musicSection) {
    musicToggleBtn.addEventListener('click', toggleMusicPanel);
}

musicCloseBtn?.addEventListener('click', closeMobileMusic);

if (chatToggleBtn && chatPanel) {
    chatToggleBtn.addEventListener('click', () => {
        closeMobileMusic();
        chatPanel.classList.toggle('show');
        syncMobileDrawerState();
        if (chatPanel.classList.contains('show')) {
            unreadChatCount = 0;
            const badge = document.getElementById('chatBadge');
            if (badge) badge.style.display = 'none';
            chatInput.focus();
            const container = document.getElementById('chatMessages');
            container.scrollTop = container.scrollHeight;
        }
    });
    chatCloseBtn.addEventListener('click', () => {
        chatPanel.classList.remove('show');
        syncMobileDrawerState();
    });
}

function updateMobileVisualViewport() {
    if (!isMobileRoomLayout()) return;
    const viewport = window.visualViewport;
    const height = viewport?.height || window.innerHeight;
    const keyboardOffset = viewport
        ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
        : 0;
    document.documentElement.style.setProperty('--mobile-viewport-height', `${height}px`);
    document.documentElement.style.setProperty('--mobile-keyboard-offset', `${keyboardOffset}px`);
}

updateMobileVisualViewport();
window.addEventListener('resize', updateMobileVisualViewport);
window.visualViewport?.addEventListener('resize', updateMobileVisualViewport);
window.visualViewport?.addEventListener('scroll', updateMobileVisualViewport);
chatInput?.addEventListener('focus', () => {
    updateMobileVisualViewport();
    setTimeout(() => {
        updateMobileVisualViewport();
        chatInput.scrollIntoView({ block: 'nearest' });
    }, 250);
});

if (chatSendBtn && chatInput) {
    chatSendBtn.addEventListener('click', () => {
        const val = chatInput.value.trim();
        if (val) {
            sendChatMessage(val);
            chatInput.value = '';
        }
    });
    chatInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') chatSendBtn.click();
    });
}

if (chatFileInput) {
    chatFileInput.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > 2 * 1024 * 1024) {
            toast('File too large! Keep under 2MB for syncing.', 'error');
            e.target.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = ev => {
            const base64 = ev.target.result;
            const type = file.type.startsWith('image/') ? 'image' : 'file';
            sendChatMessage('', type, base64, file.name);
            e.target.value = '';
        };
        reader.readAsDataURL(file);
    });
}

// ═══════════════════════════════════════════════════════
//  DATABASE INTEGRATION FUNCTIONS
// ═══════════════════════════════════════════════════════

// Load message history from database
async function loadMessageHistory() {
    if (!currentRoomId) return;

    try {
        const result = await api.getRoomMessages(currentRoomId, 100);

        if (result.success && result.messages.length > 0) {
            messageCache = result.messages;

            // Display messages in chat
            result.messages.forEach(msg => {
                const chatMsg = {
                    id: msg.messageId,
                    sender: msg.sender.displayName,
                    sentBy: msg.sender.displayName,
                    senderLabel: msg.sender.displayName,
                    type: 'text',
                    content: msg.content,
                    timestamp: new Date(msg.sentAt).getTime(),
                    to: 'all',
                    toName: 'Everyone'
                };
                appendChatMessage(chatMsg, false);
            });

            console.log(`[MESSAGES] Loaded ${result.messages.length} messages from database`);
        }
    } catch (err) {
        console.error('[MESSAGES] Failed to load message history:', err);
    }
}

// Load playlists from database
async function loadPlaylists() {
    console.log('[PLAYLIST] loadPlaylists called, currentRoomId:', currentRoomId);
    if (!currentRoomId) {
        console.log('[PLAYLIST] No currentRoomId, skipping playlist load');
        return;
    }

    try {
        console.log('[PLAYLIST] Fetching playlists for room:', currentRoomId);
        const result = await api.getRoomPlaylists(currentRoomId);
        console.log('[PLAYLIST] API response:', result);

        if (result.success && result.playlists && result.playlists.length > 0) {
            // Initialize playlists objects if needed
            if (!roomPlaylists) roomPlaylists = {};
            if (!personalPlaylists) personalPlaylists = {};

            let defaultPlaylistName = 'Room Playlist';
            let roomPlaylistCount = 0;
            let personalPlaylistCount = 0;

            // Load ALL playlists and separate by type
            result.playlists.forEach(playlist => {
                const playlistName = playlist.playlistName || 'Room Playlist';
                const playlistType = playlist.playlistType || 'room'; // Default to 'room' if not specified

                console.log(`[PLAYLIST] Processing playlist "${playlistName}" with type: "${playlistType}"`);

                // Store playlist ID in the map
                playlistIdMap[playlistName] = playlist.playlistId;

                // Convert songs to local playlist format
                const songs = (playlist.songs || []).map(song => ({
                    videoId: song.videoId,
                    title: song.title,
                    artist: song.artist,
                    duration: song.durationSeconds,
                    thumbnail: song.thumbnailUrl,
                    addedAt: new Date(song.addedAt).getTime(),
                    playlistSongId: song.playlistSongId // Store for deletion
                }));

                // Separate by playlist type - MUST be exactly 'personal' to go to personal section
                if (playlistType === 'personal') {
                    personalPlaylists[playlistName] = songs;
                    personalPlaylistCount++;
                    console.log(`[PLAYLIST] ✓ Loaded PERSONAL playlist "${playlistName}" (ID: ${playlist.playlistId}, type: ${playlistType}) with ${songs.length} songs`);
                } else {
                    // Room playlist (includes 'room' or any other value)
                    roomPlaylists[playlistName] = songs;
                    roomPlaylistCount++;
                    console.log(`[PLAYLIST] ✓ Loaded ROOM playlist "${playlistName}" (ID: ${playlist.playlistId}, type: ${playlistType}) with ${songs.length} songs`);

                    // Track the default playlist
                    if (playlist.isDefault) {
                        defaultPlaylistName = playlistName;
                        currentPlaylistId = playlist.playlistId;
                    }
                }
            });

            // Ensure default playlists exist in the database
            if (!playlistIdMap['Room Playlist']) {
                try {
                    const result = await api.createPlaylist(currentRoomId, 'Room Playlist', 'room');
                    if (result.success && result.playlist) {
                        playlistIdMap['Room Playlist'] = result.playlist.playlistId;
                        roomPlaylists['Room Playlist'] = [];
                        console.log('[PLAYLIST] Created default "Room Playlist" in database');
                    }
                } catch (err) {
                    console.error('[PLAYLIST] Failed to create default room playlist:', err);
                }
            }

            if (!playlistIdMap['Random']) {
                try {
                    const result = await api.createPlaylist(currentRoomId, 'Random', 'personal');
                    if (result.success && result.playlist) {
                        playlistIdMap['Random'] = result.playlist.playlistId;
                        personalPlaylists['Random'] = [];
                        console.log('[PLAYLIST] Created default "Random" personal playlist in database');
                    }
                } catch (err) {
                    console.error('[PLAYLIST] Failed to create default personal playlist:', err);
                }
            }

            // Set the default room playlist as active
            activePlaylistName = defaultPlaylistName;
            activePlaylistTab = 'room';

            // Re-render the playlist UI
            if (typeof renderPlaylist === 'function') {
                renderPlaylist();
            }

            console.log(`[PLAYLIST] Loaded ${roomPlaylistCount} room playlists and ${personalPlaylistCount} personal playlists from database`);
        } else {
            console.log('[PLAYLIST] No playlists found or empty response');

            // Create default playlists if no playlists exist at all
            if (!playlistIdMap['Room Playlist']) {
                try {
                    const result = await api.createPlaylist(currentRoomId, 'Room Playlist', 'room');
                    if (result.success && result.playlist) {
                        playlistIdMap['Room Playlist'] = result.playlist.playlistId;
                        roomPlaylists['Room Playlist'] = [];
                        console.log('[PLAYLIST] Created default "Room Playlist" in database');
                    }
                } catch (err) { }
            }

            if (!playlistIdMap['Random']) {
                try {
                    const result = await api.createPlaylist(currentRoomId, 'Random', 'personal');
                    if (result.success && result.playlist) {
                        playlistIdMap['Random'] = result.playlist.playlistId;
                        personalPlaylists['Random'] = [];
                        console.log('[PLAYLIST] Created default "Random" personal playlist in database');
                    }
                } catch (err) { }
            }
        }
    } catch (err) {
        console.error('[PLAYLIST] Failed to load playlists:', err);
    }
}

// Track room leave
window.addEventListener('beforeunload', async (e) => {
    if (!currentRoomId) return;

    const timeSpent = Math.floor((Date.now() - roomStartTime) / 1000);

    // Use sendBeacon for reliable delivery
    const data = JSON.stringify({
        timeSpentSeconds: timeSpent
    });

    const accessToken = localStorage.getItem('accessToken');
    if (accessToken) {
        navigator.sendBeacon(
            `${api.baseURL}/rooms/${currentRoomId}/leave`,
            new Blob([data], { type: 'application/json' })
        );
    }
});

// Initialize database integration
async function initDatabaseIntegration() {
    console.log('[DATABASE] initDatabaseIntegration called, currentRoomId:', currentRoomId);
    if (!currentRoomId) {
        console.log('[DATABASE] No room ID, skipping database integration');
        return;
    }

    try {
        console.log('[DATABASE] Starting database integration for room:', currentRoomId);

        // Load message history
        console.log('[DATABASE] Loading message history...');
        await loadMessageHistory();

        // Load playlists
        console.log('[DATABASE] Loading playlists...');
        await loadPlaylists();

        console.log('[DATABASE] Integration initialized successfully');
    } catch (err) {
        console.error('[DATABASE] Failed to initialize:', err);
    }
}

// Start database integration after a short delay (let P2P initialize first)
setTimeout(() => {
    console.log('[DATABASE] Starting database integration in 2 seconds...');
    initDatabaseIntegration();
}, 2000);

// Start Chat DB
initChatDB();

// ─────────────────────────────────────────────────────
//  PICTURE-IN-PICTURE (OS-level floating video call preview)
// ─────────────────────────────────────────────────────
let pipInterval = null;
let pipWindow = null;
let pipCanvas = null;
let pipCtx = null;
let pipAnimationId = null;

// Utility helper to draw video with object-fit: cover
function drawVideoFitCover(activeCtx, activeCanvas, video, dx, dy, dWidth, dHeight, mirror = false) {
    const videoWidth = video.videoWidth || 640;
    const videoHeight = video.videoHeight || 360;
    const videoRatio = videoWidth / videoHeight;
    const destRatio = dWidth / dHeight;

    let sx, sy, sWidth, sHeight;
    if (videoRatio > destRatio) {
        sHeight = videoHeight;
        sWidth = videoHeight * destRatio;
        sx = (videoWidth - sWidth) / 2;
        sy = 0;
    } else {
        sWidth = videoWidth;
        sHeight = videoWidth / destRatio;
        sx = 0;
        sy = (videoHeight - sHeight) / 2;
    }

    if (mirror) {
        activeCtx.save();
        activeCtx.translate(dx + dWidth / 2, dy + dHeight / 2);
        activeCtx.scale(-1, 1);
        activeCtx.drawImage(video, sx, sy, sWidth, sHeight, -dWidth / 2, -dHeight / 2, dWidth, dHeight);
        activeCtx.restore();
    } else {
        activeCtx.drawImage(video, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight);
    }
}

function renderPipFrame() {
    const canvas = document.getElementById('pipCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const activeCanvas = pipCanvas || canvas;
    const activeCtx = pipCtx || ctx;

    const myVideo = document.getElementById('myVideo');
    const remoteVideos = Array.from(document.querySelectorAll('.video-panel video:not(#myVideo)'))
        .filter(v => v.srcObject && v.srcObject.getVideoTracks().some(track => track.enabled) && v.readyState >= 2);

    // Clear canvas
    activeCtx.fillStyle = '#0d0c1d';
    activeCtx.fillRect(0, 0, activeCanvas.width, activeCanvas.height);

    if (remoteVideos.length > 0) {
        // Draw remote video as main video (fit: cover) - not mirrored
        drawVideoFitCover(activeCtx, activeCanvas, remoteVideos[0], 0, 0, activeCanvas.width, activeCanvas.height, false);

        // Draw local video as small box in bottom right corner (1/4 of size) - mirrored
        if (myVideo && myVideo.srcObject && myVideo.srcObject.getVideoTracks().some(track => track.enabled) && myVideo.readyState >= 2) {
            const localVideoWidth = activeCanvas.width / 4;
            const localVideoHeight = activeCanvas.height / 4;

            // Draw a subtle border/outline around the local pip feed
            activeCtx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            activeCtx.lineWidth = 2;

            const px = activeCanvas.width - localVideoWidth - 8;
            const py = activeCanvas.height - localVideoHeight - 8;

            activeCtx.strokeRect(px, py, localVideoWidth, localVideoHeight);
            drawVideoFitCover(activeCtx, activeCanvas, myVideo, px, py, localVideoWidth, localVideoHeight, true);
        }
    } else if (myVideo && myVideo.srcObject && myVideo.srcObject.getVideoTracks().some(track => track.enabled) && myVideo.readyState >= 2) {
        // If no remote video, draw local video as main video - mirrored
        drawVideoFitCover(activeCtx, activeCanvas, myVideo, 0, 0, activeCanvas.width, activeCanvas.height, true);
    } else {
        activeCtx.fillStyle = '#ffffff';
        activeCtx.font = '14px sans-serif';
        activeCtx.textAlign = 'center';
        activeCtx.textBaseline = 'middle';
        activeCtx.fillText('No active cameras', activeCanvas.width / 2, activeCanvas.height / 2);
    }

    if (pipWindow) {
        pipAnimationId = pipWindow.requestAnimationFrame(renderPipFrame);
    }
}

function startPipCanvasRender() {
    const canvas = document.getElementById('pipCanvas');
    if (!canvas) return;
    const pipVideo = document.getElementById('pipVideo');
    if (!pipVideo) return;

    // Set dynamic size based on user's current display/screen size
    const screenWidth = window.screen.width || 1920;
    const pipWidth = Math.max(280, Math.round(screenWidth * 0.15)); // 15% of screen width, minimum 280px
    const pipHeight = Math.round(pipWidth * (9 / 16));

    canvas.width = pipWidth;
    canvas.height = pipHeight;
    console.log(`[PIP] Canvas dimensions set to: ${pipWidth}x${pipHeight} based on screen width: ${screenWidth}`);

    // Unconditionally set the canvas capture stream to warm up the video element
    if (!pipVideo.srcObject) {
        pipVideo.srcObject = canvas.captureStream(30);
    }

    if (pipInterval) clearInterval(pipInterval);

    pipInterval = setInterval(() => {
        if (pipWindow) return; // Ignore if Document PiP is rendering instead
        renderPipFrame();
    }, 1000 / 30); // 30 FPS
}

// Open Document Picture-in-Picture (Chrome/Edge)
async function enterDocumentPip() {
    if (pipWindow) return;

    const screenWidth = window.screen.width || 1920;
    const pipWidth = Math.max(320, Math.round(screenWidth * 0.20)); // 20% of screen width
    const pipHeight = Math.round(pipWidth * (9 / 16));

    try {
        pipWindow = await window.documentPictureInPicture.requestWindow({
            width: pipWidth,
            height: pipHeight,
            disallowReturnToOpener: true,
        });

        console.log('[PIP] Document PiP window opened:', pipWidth, 'x', pipHeight);

        const doc = pipWindow.document;
        doc.body.style.margin = '0';
        doc.body.style.padding = '0';
        doc.body.style.overflow = 'hidden';
        doc.body.style.backgroundColor = '#0d0c1d';
        doc.body.style.display = 'flex';
        doc.body.style.alignItems = 'center';
        doc.body.style.justifyContent = 'center';
        doc.body.style.position = 'relative';

        const style = doc.createElement('style');
        style.textContent = `
            .pip-container {
                position: relative;
                width: 100vw;
                height: 100vh;
                overflow: hidden;
            }
            canvas {
                width: 100%;
                height: 100%;
                display: block;
            }
            .pip-overlay {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
                opacity: 0;
                transition: opacity 0.2s ease;
                display: flex;
                align-items: center;
                justify-content: center;
                pointer-events: none;
            }
            .pip-container:hover .pip-overlay {
                opacity: 1;
                pointer-events: auto;
            }
            .expand-btn {
                background: rgba(255, 255, 255, 0.2);
                border: 1px solid rgba(255, 255, 255, 0.3);
                border-radius: 50%;
                width: 52px;
                height: 52px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                transition: all 0.2s ease;
                color: #ffffff;
                backdrop-filter: blur(8px);
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
            }
            .expand-btn:hover {
                background: rgba(255, 255, 255, 0.4);
                transform: scale(1.1);
            }
            .expand-btn svg {
                width: 26px;
                height: 26px;
                fill: currentColor;
            }
        `;
        doc.head.appendChild(style);

        const container = doc.createElement('div');
        container.className = 'pip-container';
        doc.body.appendChild(container);

        pipCanvas = doc.createElement('canvas');
        pipCanvas.width = 640;
        pipCanvas.height = 360;
        container.appendChild(pipCanvas);
        pipCtx = pipCanvas.getContext('2d');

        const overlay = doc.createElement('div');
        overlay.className = 'pip-overlay';

        const btn = doc.createElement('button');
        btn.className = 'expand-btn';
        btn.title = 'Back to Room';
        btn.innerHTML = `
            <svg viewBox="0 0 24 24">
                <path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
            </svg>
        `;

        btn.addEventListener('click', () => {
            console.log('[PIP] Back to room button clicked.');
            window.focus();
            pipWindow.close();
        });

        overlay.appendChild(btn);
        container.appendChild(overlay);

        // Start rendering loop
        renderPipFrame();

        pipWindow.addEventListener('pagehide', () => {
            console.log('[PIP] Document PiP window closed.');
            if (pipAnimationId) {
                pipWindow.cancelAnimationFrame(pipAnimationId);
                pipAnimationId = null;
            }
            pipWindow = null;
            pipCanvas = null;
            pipCtx = null;
        });

    } catch (err) {
        console.warn('[PIP] Document PiP failed, falling back to Video PiP:', err);
        throw err;
    }
}

// Trigger PiP in whichever mode is supported
async function triggerPip() {
    // Only trigger if we have active camera feeds
    const activeVideos = Array.from(document.querySelectorAll('.video-panel video'))
        .filter(v => v.srcObject && v.srcObject.getVideoTracks().some(track => track.enabled) && v.readyState >= 2);

    if (activeVideos.length === 0) {
        console.log('[PIP] No active video streams to pop out.');
        return;
    }

    const mobileLayout = window.matchMedia('(max-width: 768px), (pointer: coarse)').matches;
    const remoteVideo = activeVideos.find(video => video.id !== 'myVideo');
    const compositeVideo = document.getElementById('pipVideo');
    const targetVideo = mobileLayout && remoteVideo ? remoteVideo : compositeVideo;

    // Document PiP can show a composed call on desktop. Mobile browsers do not
    // support it reliably, so use the actual remote video to avoid canvas
    // capture/background-throttling issues.
    if (!mobileLayout && 'documentPictureInPicture' in window) {
        try {
            await enterDocumentPip();
            return;
        } catch (e) {
            // Fall through to Video PiP on failure
        }
    }

    // Fallback to standard Video PiP
    if (targetVideo && typeof targetVideo.requestPictureInPicture === 'function') {
        if (document.pictureInPictureElement) {
            console.log('[PIP] Already in Video Picture-in-Picture.');
            return;
        }
        try {
            console.log('[PIP] Requesting standard Video Picture-in-Picture...');
            if (targetVideo === compositeVideo) startPipCanvasRender();
            targetVideo.autoPictureInPicture = true;
            await targetVideo.play();
            await targetVideo.requestPictureInPicture();
        } catch (err) {
            if (err.name === 'NotAllowedError') {
                console.log('[PIP] ℹ️ Auto-PIP requires user gesture or browser permission settings.');
            } else {
                console.error('[PIP] ❌ Video PiP failed:', err);
            }
        }
    } else if (targetVideo && typeof targetVideo.webkitSetPresentationMode === 'function') {
        // Safari/iOS exposes its native video presentation mode instead of the
        // standard requestPictureInPicture method on some versions.
        try {
            await targetVideo.play();
            targetVideo.webkitSetPresentationMode('picture-in-picture');
        } catch (err) {
            console.warn('[PIP] Safari Picture-in-Picture requires a direct user tap.', err);
        }
    }
}

// Hook up PIP module
setTimeout(() => {
    console.log('[PIP] Initializing Picture-in-Picture module...');
    const pipVideo = document.getElementById('pipVideo');
    if (!pipVideo) {
        console.error('[PIP] ❌ pipVideo element not found in DOM!');
        return;
    }

    const isPipSupported = typeof HTMLVideoElement.prototype.requestPictureInPicture === 'function'
        || typeof HTMLVideoElement.prototype.webkitSetPresentationMode === 'function';
    console.log('[PIP] Browser support check - isPipSupported:', isPipSupported);

    // Warm up the canvas rendering loop immediately on page load
    startPipCanvasRender();

    const pipModeBtn = document.getElementById('pipModeBtn');
    if (pipModeBtn) {
        if (!isPipSupported && !('documentPictureInPicture' in window)) {
            pipModeBtn.style.display = 'none';
        } else {
            // This explicit tap is important on mobile: browsers generally
            // reject the first PiP request after the page is already hidden.
            pipModeBtn.addEventListener('click', triggerPip);
        }
    }

    if (isPipSupported) {
        // Declarative auto-PiP support on active tiny video
        pipVideo.autoPictureInPicture = true;

        // Force play when exiting PiP or paused by browser to keep stream active for next tab switch
        pipVideo.addEventListener('leavepictureinpicture', () => {
            console.log('[PIP] Left Picture-in-Picture. Replaying stream to keep it active...');
            pipVideo.play().catch(e => console.log('[PIP] Failed to play after PiP exit:', e));
        });

        pipVideo.addEventListener('pause', () => {
            console.log('[PIP] Video paused. Resuming to keep stream active...');
            pipVideo.play().catch(e => { });
        });

        // Register MediaSession enterpictureinpicture action handler for Chrome/Edge integration
        if ('mediaSession' in navigator) {
            try {
                navigator.mediaSession.setActionHandler('enterpictureinpicture', async () => {
                    console.log('[MediaSession] enterpictureinpicture action triggered by browser');
                    await triggerPip();
                });
                console.log('[MediaSession] Registered enterpictureinpicture action handler.');
            } catch (err) {
                console.warn('[MediaSession] Failed to register action handler:', err);
            }
        }
    } else {
        console.log('[PIP] Note: Programmatic PiP not supported in Firefox. Firefox users can hover over any active camera feed and click Firefox\'s native blue PiP button instead!');
    }

    // Auto PIP on switching tabs
    document.addEventListener('visibilitychange', async () => {
        console.log('[PIP] 👁️ Visibility changed to:', document.visibilityState, '| active call:', isInCall);

        if (document.visibilityState === 'hidden') {
            await triggerPip();
        } else {
            console.log('[PIP] Document visible again. Let browser handle native auto-PiP close.');
            if (typeof pipWindow !== 'undefined' && pipWindow) {
                console.log('[PIP] Explicitly closing Document PiP on visibility restored.');
                pipWindow.close();
            }
        }
    });

    // Handle switching back to the app on macOS (window focus)
    window.addEventListener('focus', () => {
        if (typeof pipWindow !== 'undefined' && pipWindow) {
            console.log('[PIP] Window focused. Explicitly closing Document PiP.');
            pipWindow.close();
        }
    });
}, 1000);
