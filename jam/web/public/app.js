/* JamSync v3.1 — Final Version — Bulletproof Audio + Connection */

const $ = id => document.getElementById(id);
const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ===== STATE =====
let peer = null;
let playerConn = null;
let playerCall = null;
let userName = '';
let roomId = '';
let currentPlayerName = '';
let chatOpen = false;
let chatUnread = 0;
let audioUnlocked = false;
let isConnecting = false;
let isConnected = false;
let webrtcAudioActive = false;
let relayAudioActive = false;
let relayAudioCtx = null;
let relayPlayBuffer = [];
let scanProbes = [];
let connectRetries = 0;
let pausedForMe = false;
const MAX_RETRIES = 3;

// ===== ICE CONFIG =====
const ICE_CONFIG = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
    ]
};

// ===== VIEWS =====
function showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const el = $(name + 'View');
    if (el) el.classList.add('active');
}

function isMobile() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

// ===== INIT =====
window.addEventListener('DOMContentLoaded', () => {
    userName = localStorage.getItem('jamsync_name') || '';
    const nameInput = $('nameInput');
    if (nameInput) nameInput.value = userName;

    const hash = location.hash.replace('#', '').trim().toUpperCase();
    if (hash) {
        const rcInput = $('roomCodeInput');
        if (rcInput) rcInput.value = hash;
    }

    showView(isMobile() ? 'join' : (hash ? 'join' : 'desktop'));

    setupJoinListeners();
    setupChatListeners();
    setupControlListeners();
    setupShareListeners();
});

// ===== JOIN FLOW =====
function setupJoinListeners() {
    $('btnJoinRoom')?.addEventListener('click', () => {
        userName = $('nameInput')?.value?.trim() || 'Listener';
        roomId = $('roomCodeInput')?.value?.trim().toUpperCase() || '';
        if (!roomId) {
            showToast('⚠️', 'Error', 'Enter a room code');
            return;
        }
        localStorage.setItem('jamsync_name', userName);
        unlockAudio();
        showView('scan');
        startScanning(roomId);
    });
}

// ===== AUDIO UNLOCK =====
function unlockAudio() {
    if (audioUnlocked) return;
    const audio = $('remoteAudio');
    if (!audio) return;

    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const buf = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start(0);
        ctx.resume();
    } catch (e) { }

    audio.volume = 1.0;
    audio.muted = false;
    const p = audio.play();
    if (p) p.then(() => { audio.pause(); audio.currentTime = 0; audioUnlocked = true; }).catch(() => { });
}

// ================================================================
// SCANNING — Find hosts in the room
// ================================================================
function startScanning(rid) {
    cleanup(); // Clean up any previous state
    isConnecting = false;
    isConnected = false;
    connectRetries = 0;

    const sid = 'jamsync-web-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
    peer = new Peer(sid, { debug: 0, config: ICE_CONFIG });

    peer.on('open', () => {
        console.log('[Scan] Peer ready:', sid);
        $('scanStatus').textContent = 'Scanning for host…';
        doScan(rid);
    });

    peer.on('error', (err) => {
        // CRITICAL: Ignore peer-unavailable — these are from scan probes hitting empty slots
        if (err.type === 'peer-unavailable') return;
        console.error('[Peer] Error:', err.type);
        // Only restart on fatal errors AND if not connecting/connected
        if (!isConnecting && !isConnected) {
            $('scanStatus').textContent = 'Connection error. Retrying…';
            setTimeout(() => startScanning(rid), 3000);
        }
    });

    // Set up incoming call handler EARLY
    peer.on('call', (call) => {
        console.log('[Audio] ☎️ Incoming call from:', call.peer);
        call.answer();
        playerCall = call;

        call.on('stream', (stream) => {
            console.log('[Audio] 🎵 Stream received!');
            playWebRTCAudio(stream);
        });

        call.on('close', () => {
            if (webrtcAudioActive) {
                webrtcAudioActive = false;
                showAudioStatus('🔇', 'Audio stream ended', true);
                stopVisualizer();
            }
        });

        call.on('error', (e) => console.warn('[Audio] Call error:', e));
    });

    // Button handlers (onclick prevents duplicates)
    const rescanBtn = $('btnRescan');
    if (rescanBtn) rescanBtn.onclick = () => doScan(rid);
    const cancelBtn = $('btnCancelScan');
    if (cancelBtn) cancelBtn.onclick = () => { cleanup(); showView('join'); };
}

function doScan(rid) {
    const list = $('playerList');
    if (list) list.innerHTML = '';
    $('scanStatus').textContent = 'Scanning…';

    // Close old probes
    scanProbes.forEach(c => { try { c.close(); } catch (e) { } });
    scanProbes = [];

    let found = 0;
    let done = 0;
    const total = 3; // FIXED: Reduced from 20 to 3 to prevent PeerJS cloud server IP rate-limiting

    for (let slot = 1; slot <= total; slot++) {
        const peerId = `jamsync-${rid}-p${slot}`;
        let conn;
        try {
            conn = peer.connect(peerId, { reliable: true });
        } catch (e) { done++; continue; }
        scanProbes.push(conn);

        const timeout = setTimeout(() => {
            try { conn.close(); } catch (e) { }
            done++;
            updateScanStatus(found, done, total);
        }, 6000);

        conn.on('open', () => conn.send({ type: 'WHO_ARE_YOU' }));

        conn.on('data', (data) => {
            if (data.type === 'PLAYER_INFO') {
                clearTimeout(timeout);
                found++;
                done++;
                addPlayerCard(data, peerId);
                updateScanStatus(found, done, total);
            }
        });

        conn.on('error', () => {
            clearTimeout(timeout);
            done++;
            updateScanStatus(found, done, total);
        });
    }
}

function updateScanStatus(found, done, total) {
    if (found > 0) {
        $('scanStatus').textContent = `Found ${found} host${found > 1 ? 's' : ''}! Tap to connect.`;
    } else if (done >= total) {
        $('scanStatus').textContent = 'No host found. Make sure someone is broadcasting!';
    }
}

function addPlayerCard(info, peerId) {
    const list = $('playerList');
    if (!list) return;
    const card = document.createElement('div');
    card.className = 'player-card';
    card.innerHTML = `
        <div class="player-avatar">${esc(info.name?.[0] || '?')}</div>
        <div class="player-info">
            <div class="player-name">${esc(info.name || 'Host')}</div>
            <div class="player-track">${esc(info.nowPlaying || 'Playing music')}</div>
        </div>
        <div class="player-meta">${info.listenerCount || 0} 🎧</div>`;

    card.addEventListener('click', () => {
        if (isConnecting) return; // Prevent double-click
        unlockAudio();
        connectToPlayer(peerId, info.name);
    });
    list.appendChild(card);
}

// ================================================================
// CONNECT TO PLAYER
// ================================================================
function connectToPlayer(targetId, playerName) {
    isConnecting = true;
    currentPlayerName = playerName || 'Host';
    $('scanStatus').textContent = `Connecting to ${currentPlayerName}…`;

    // Close all scan probes FIRST
    scanProbes.forEach(c => { try { c.close(); } catch (e) { } });
    scanProbes = [];

    // Wait for probes to fully close, then create permanent connection
    setTimeout(() => {
        if (!peer || peer.destroyed) {
            isConnecting = false;
            showToast('❌', 'Error', 'Connection lost');
            showView('join');
            return;
        }

        try {
            playerConn = peer.connect(targetId, { reliable: true });
        } catch (e) {
            retryConnect(targetId, playerName);
            return;
        }

        // Connection timeout
        const connectTimeout = setTimeout(() => {
            if (!isConnected) {
                console.warn('[Connect] Timeout — retrying');
                retryConnect(targetId, playerName);
            }
        }, 8000);

        playerConn.on('open', () => {
            clearTimeout(connectTimeout);
            console.log('[Connect] ✅ Data channel open');
            playerConn.send({ type: 'JOIN', name: userName });
        });

        playerConn.on('data', (data) => handlePlayerMessage(data));

        playerConn.on('close', () => {
            if (isConnected) {
                isConnected = false;
                isConnecting = false;
                // Auto-reconnect instead of giving up
                showToast('⏳', 'Reconnecting', 'Host connection lost — retrying...');
                stopVisualizer();
                stopRelayPlayback();
                autoReconnect(targetId, playerName);
            }
        });

        playerConn.on('error', (err) => {
            clearTimeout(connectTimeout);
            console.error('[Connect] Error:', err);
            retryConnect(targetId, playerName);
        });
    }, 600);
}

function retryConnect(targetId, playerName) {
    connectRetries++;
    if (connectRetries > MAX_RETRIES) {
        isConnecting = false;
        $('scanStatus').textContent = 'Could not connect. Try rescanning.';
        showToast('❌', 'Error', 'Connection failed after retries');
        return;
    }
    $('scanStatus').textContent = `Retrying… (${connectRetries}/${MAX_RETRIES})`;
    setTimeout(() => connectToPlayer(targetId, playerName), 1500);
}

// ===== AUTO-RECONNECT (for host disconnect/sleep) =====
let reconnectAttempts = 0;
let reconnectTimer = null;
const MAX_RECONNECT = 10;
const RECONNECT_DELAY = 3000;

function autoReconnect(targetId, playerName) {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

    reconnectAttempts++;
    if (reconnectAttempts > MAX_RECONNECT) {
        showToast('🔌', 'Disconnected', 'Could not reconnect to host');
        reconnectAttempts = 0;
        setTimeout(() => showView('join'), 2000);
        return;
    }

    const statusEl = $('nowPlayingTitle') || $('scanStatus');
    if (statusEl) statusEl.textContent = `Reconnecting... (${reconnectAttempts}/${MAX_RECONNECT})`;

    reconnectTimer = setTimeout(() => {
        // Recreate peer if destroyed
        if (!peer || peer.destroyed) {
            const listenerId = `jamsync-web-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
            peer = new Peer(listenerId, { debug: 0, config: ICE_CONFIG });
            peer.on('open', () => doAutoReconnect(targetId, playerName));
            peer.on('error', (err) => {
                if (err.type === 'peer-unavailable') return;
                autoReconnect(targetId, playerName);
            });
        } else {
            doAutoReconnect(targetId, playerName);
        }
    }, RECONNECT_DELAY);
}

function doAutoReconnect(targetId, playerName) {
    // Set up audio call handler
    peer.off('call');
    peer.on('call', (call) => {
        call.answer();
        call.on('stream', (stream) => {
            playRemoteStream(stream);
            reconnectAttempts = 0;
            isConnected = true;
            showToast('✅', 'Reconnected', 'Audio resumed!');
        });
        call.on('close', () => {
            if (isConnected) {
                isConnected = false;
                showToast('⏳', 'Reconnecting', 'Host connection lost — retrying...');
                stopVisualizer();
                stopRelayPlayback();
                autoReconnect(targetId, playerName);
            }
        });
    });

    playerConn = peer.connect(targetId, { reliable: true });

    playerConn.on('open', () => {
        playerConn.send({ type: 'JOIN', name: userName });
    });

    playerConn.on('data', (data) => handlePlayerMessage(data));

    playerConn.on('close', () => {
        if (isConnected) {
            isConnected = false;
            autoReconnect(targetId, playerName);
        }
    });

    playerConn.on('error', () => {
        autoReconnect(targetId, playerName);
    });

    // Timeout
    setTimeout(() => {
        if (!playerConn?.open) {
            try { playerConn?.close(); } catch (e) { }
            autoReconnect(targetId, playerName);
        }
    }, 8000);
}

// ================================================================
// HANDLE MESSAGES FROM PLAYER
// ================================================================
function handlePlayerMessage(data) {
    switch (data.type) {
        case 'WELCOME':
            console.log('[Session] ✅ Welcome received!');
            isConnected = true;
            isConnecting = false;
            connectRetries = 0;
            showView('listener');
            $('npPlayerName').textContent = `Hosted by ${data.playerName || 'Host'}`;
            $('listenerRoomCode').textContent = data.roomId || roomId;
            $('npTrack').textContent = data.nowPlaying || 'Waiting for audio…';
            $('connText').textContent = 'Connected';
            if (data.chatHistory) {
                data.chatHistory.forEach(msg => appendChat(msg));
            }
            showAudioStatus('🎵', 'Connected! Waiting for audio…');

            // Auto-fallback: if no WebRTC audio in 5s, activate relay
            setTimeout(() => {
                if (!webrtcAudioActive && !relayAudioActive && isConnected) {
                    console.log('[Audio] WebRTC timeout → activating relay');
                    relayAudioActive = true;
                    initRelayPlayback();
                    showAudioStatus('📡', 'Using relay audio');
                    startVisualizer();
                }
            }, 5000);
            break;

        case 'NOW_PLAYING':
            $('npTrack').textContent = data.title || 'Playing…';
            $('npPlayerName').textContent = `Hosted by ${data.playerName || currentPlayerName}`;
            break;

        case 'TAB_SWITCHED':
            $('npTrack').textContent = data.nowPlaying || 'Switching…';
            break;

        case 'CHAT_MSG':
            appendChat(data);
            if (data.sender !== userName) {
                showToast('💬', data.sender, data.text);
                if (!chatOpen) { chatUnread++; updateChatBadge(); }
            }
            break;

        case 'REACTION':
            showFloatingReaction(data.emoji);
            if (data.sender !== userName) showToast(data.emoji, data.sender, 'reacted');
            break;

        case 'USER_JOINED':
            showToast('👋', data.name, 'joined the room');
            break;

        case 'USER_LEFT':
            showToast('👋', data.name, 'left the room');
            break;

        case 'AUDIO_RELAY':
            // Data channel audio relay (fallback for mobile networks)
            if (webrtcAudioActive) break; // WebRTC working, skip relay
            if (!relayAudioActive) {
                relayAudioActive = true;
                initRelayPlayback();
                showAudioStatus('📡', 'Audio via relay');
                startVisualizer();
            }
            handleRelayChunk(data.d);
            break;
    }
}

// ================================================================
// WEBRTC AUDIO — Primary path (P2P, low latency)
// ================================================================
function playWebRTCAudio(stream) {
    const audio = $('remoteAudio');
    if (!audio) return;

    console.log('[Audio] Setting up WebRTC stream…');
    audio.srcObject = null;
    audio.srcObject = stream;
    audio.volume = 1.0;
    audio.muted = false;

    const p = audio.play();
    if (p) {
        p.then(() => {
            console.log('[Audio] ✅ WebRTC audio playing!');
            webrtcAudioActive = true;
            // Kill relay if it was active
            if (relayAudioActive) {
                relayAudioActive = false;
                stopRelayPlayback();
            }
            showAudioStatus('🔊', 'Audio is playing!');
            startVisualizer();
            setTimeout(() => {
                const card = $('audioStatusCard');
                if (card && !card.classList.contains('error')) card.style.display = 'none';
            }, 3000);
        }).catch(() => showTapBanner(stream));
    }

    stream.getAudioTracks().forEach(t => {
        t.onended = () => {
            webrtcAudioActive = false;
            showAudioStatus('🔇', 'Stream ended', true);
            stopVisualizer();
        };
    });
}

function showTapBanner(stream) {
    document.querySelectorAll('.tap-play-banner').forEach(b => b.remove());
    const banner = document.createElement('div');
    banner.className = 'tap-play-banner';
    banner.textContent = '🔊 TAP HERE TO HEAR AUDIO';
    document.body.appendChild(banner);
    showAudioStatus('🔇', 'Tap the banner below to hear audio');

    const handler = () => {
        const audio = $('remoteAudio');
        if (!audio) return;
        audio.srcObject = stream;
        audio.volume = 1.0;
        audio.muted = false;
        audio.play().then(() => {
            banner.remove();
            webrtcAudioActive = true;
            showAudioStatus('🔊', 'Audio is playing!');
            startVisualizer();
        }).catch(() => { banner.textContent = '🔇 TAP AGAIN'; });
    };
    banner.addEventListener('click', handler);
}

// ================================================================
// RELAY AUDIO — Fallback path (data channel, works on mobile data)
// ================================================================
function initRelayPlayback() {
    if (relayAudioCtx) return;
    try {
        relayAudioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 22050 });
        const processor = relayAudioCtx.createScriptProcessor(4096, 0, 1);
        processor.connect(relayAudioCtx.destination);
        processor.onaudioprocess = (e) => {
            const out = e.outputBuffer.getChannelData(0);
            if (relayPlayBuffer.length > 0) {
                const chunk = relayPlayBuffer.shift();
                const len = Math.min(out.length, chunk.length);
                for (let i = 0; i < len; i++) out[i] = chunk[i];
                for (let i = len; i < out.length; i++) out[i] = 0;
            } else {
                for (let i = 0; i < out.length; i++) out[i] = 0;
            }
        };
        relayAudioCtx.resume();
        console.log('[Relay] ✅ Playback initialized');
    } catch (e) {
        console.error('[Relay] Init failed:', e);
    }
}

function handleRelayChunk(b64) {
    try {
        const raw = atob(b64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        const int16 = new Int16Array(bytes.buffer);
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
        relayPlayBuffer.push(float32);
        while (relayPlayBuffer.length > 5) relayPlayBuffer.shift(); // Prevent delay buildup
    } catch (e) { }
}

function stopRelayPlayback() {
    relayPlayBuffer = [];
    if (relayAudioCtx) { try { relayAudioCtx.close(); } catch (e) { } relayAudioCtx = null; }
}

// ================================================================
// AUDIO STATUS + VISUALIZER
// ================================================================
function showAudioStatus(icon, text, isError = false) {
    const card = $('audioStatusCard');
    if (!card) return;
    card.style.display = 'flex';
    card.className = 'glass-card audio-status-card' + (isError ? ' error' : '');
    $('audioStatusText').textContent = text;
    const iconEl = card.querySelector('.audio-status-icon');
    if (iconEl) iconEl.textContent = icon;
}

function startVisualizer() {
    const v = $('visualizer');
    if (v) v.classList.add('active');
}

function stopVisualizer() {
    const v = $('visualizer');
    if (v) v.classList.remove('active');
}

// ================================================================
// CONTROLS
// ================================================================
function setupControlListeners() {
    $('btnPrev')?.addEventListener('click', () => sendControl('PREV'));
    $('btnToggle')?.addEventListener('click', () => {
        // Show pause choice modal
        if (pausedForMe) {
            // Already paused for me — just unpause
            pausedForMe = false;
            const audio = $('remoteAudio');
            if (audio) { audio.muted = false; audio.volume = 1.0; }
            showToast('🔊', 'Audio', 'Resumed for you');
            return;
        }
        const modal = $('pauseModal');
        if (modal) modal.style.display = 'flex';
    });
    $('btnNext')?.addEventListener('click', () => sendControl('NEXT'));

    // Pause choice modal handlers
    $('btnPauseMe')?.addEventListener('click', () => {
        pausedForMe = true;
        const audio = $('remoteAudio');
        if (audio) audio.muted = true;
        showToast('🔇', 'Paused', 'Paused for you (others still hear it)');
        const modal = $('pauseModal');
        if (modal) modal.style.display = 'none';
    });

    $('btnPauseAll')?.addEventListener('click', () => {
        sendControl('TOGGLE');
        showToast('⏸', 'Paused', 'Paused for everyone');
        const modal = $('pauseModal');
        if (modal) modal.style.display = 'none';
    });

    $('btnPauseDismiss')?.addEventListener('click', () => {
        const modal = $('pauseModal');
        if (modal) modal.style.display = 'none';
    });

    document.querySelectorAll('.rx-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const emoji = btn.dataset.emoji;
            if (playerConn?.open) playerConn.send({ type: 'REACTION', emoji, sender: userName });
            showFloatingReaction(emoji);
        });
    });

    $('btnDisconnect')?.addEventListener('click', () => {
        cleanup();
        showView('join');
    });
}

function sendControl(action) {
    if (playerConn?.open) {
        playerConn.send({ type: 'CONTROL_REQUEST', action, sender: userName });
        showToast('🎮', 'Control', action.toLowerCase());
    }
}

// ================================================================
// SHARE
// ================================================================
function setupShareListeners() {
    $('btnListenerShare')?.addEventListener('click', () => {
        const rc = $('listenerRoomCode')?.textContent?.trim();
        const url = location.origin + '/#' + rc;
        const text = `🎵 Join my JamSync room!\nCode: ${rc}\n${url}`;
        if (navigator.share) {
            navigator.share({ title: 'JamSync', text, url }).catch(() => copyText(text, 'btnListenerShare'));
        } else {
            copyText(text, 'btnListenerShare');
        }
    });

    $('btnListenerCopy')?.addEventListener('click', () => {
        const rc = $('listenerRoomCode')?.textContent?.trim();
        copyText(location.origin + '/#' + rc, 'btnListenerCopy');
    });
}

function copyText(text, btnId) {
    navigator.clipboard.writeText(text).then(() => {
        const btn = $(btnId);
        if (btn) {
            const orig = btn.textContent;
            btn.textContent = '✅ Copied!';
            btn.classList.add('copied');
            setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 2000);
        }
    }).catch(() => showToast('📋', 'JamSync', 'Link copied!'));
}

// ================================================================
// CHAT
// ================================================================
function setupChatListeners() {
    $('chatToggle')?.addEventListener('click', () => {
        chatOpen = !chatOpen;
        const body = $('chatBody');
        if (body) body.style.display = chatOpen ? 'block' : 'none';
        $('chatChevron')?.classList.toggle('open', chatOpen);
        if (chatOpen) { chatUnread = 0; updateChatBadge(); }
    });

    $('chatSend')?.addEventListener('click', sendChat);
    $('chatInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
}

function sendChat() {
    const input = $('chatInput');
    const text = input?.value?.trim();
    if (!text || !playerConn?.open) return;
    playerConn.send({ type: 'CHAT_MSG', text, sender: userName });
    input.value = '';
}

function appendChat(msg) {
    const container = $('chatMessages');
    if (!container) return;
    const isMine = msg.sender === userName;
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble ' + (isMine ? 'chat-mine' : 'chat-other');
    bubble.innerHTML = `${!isMine ? `<div class="chat-sender">${esc(msg.sender)}</div>` : ''}${esc(msg.text)}`;
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
}

function updateChatBadge() {
    const badge = $('chatBadge');
    if (!badge) return;
    badge.style.display = chatUnread > 0 ? 'inline-flex' : 'none';
    badge.textContent = chatUnread;
}

// ================================================================
// FLOATING REACTIONS
// ================================================================
function showFloatingReaction(emoji) {
    const overlay = $('reactionOverlay');
    if (!overlay) return;
    const el = document.createElement('div');
    el.className = 'floating-reaction';
    el.textContent = emoji;
    el.style.left = (Math.random() * 60 + 20) + '%';
    el.style.bottom = '20%';
    overlay.appendChild(el);
    setTimeout(() => el.remove(), 1600);
}

// ================================================================
// TOASTS
// ================================================================
function showToast(icon, sender, text) {
    const container = $('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span class="toast-icon">${icon}</span><span><span class="toast-sender">${esc(sender)}</span> ${esc(text)}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
    while (container.children.length > 3) container.firstChild.remove();
}

// ================================================================
// CLEANUP
// ================================================================
function cleanup() {
    // Clear reconnect first
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    reconnectAttempts = 0;

    scanProbes.forEach(c => { try { c.close(); } catch (e) { } });
    scanProbes = [];
    if (playerConn) { try { playerConn.close(); } catch (e) { } playerConn = null; }
    if (playerCall) { try { playerCall.close(); } catch (e) { } playerCall = null; }
    if (peer) { try { peer.destroy(); } catch (e) { } peer = null; }
    const audio = $('remoteAudio');
    if (audio) { audio.pause(); audio.srcObject = null; }
    document.querySelectorAll('.tap-play-banner').forEach(b => b.remove());
    stopVisualizer();
    stopRelayPlayback();
    isConnecting = false;
    isConnected = false;
    webrtcAudioActive = false;
    relayAudioActive = false;
    connectRetries = 0;
    pausedForMe = false;
}

// ================================================================
// PWA
// ================================================================
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    const hint = $('installHint');
    if (hint) hint.style.display = 'block';
});

$('btnInstall')?.addEventListener('click', async () => {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        const hint = $('installHint');
        if (hint) hint.style.display = 'none';
    }
});

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => { });
}
