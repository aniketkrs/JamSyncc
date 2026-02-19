// JamSync v3 — Popup Logic
// Music tabs, chat, reactions, playback controls, theme toggle

// ===== VIEWS & ELEMENTS =====
const views = {
    idle: document.getElementById('idleView'),
    selectPlayer: document.getElementById('selectPlayerView'),
    player: document.getElementById('playerView'),
    listener: document.getElementById('listenerView')
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let currentView = 'idle';
let userName = '';
let chatUnreadPlayer = 0;
let chatUnreadListener = 0;
let chatOpenPlayer = false;
let chatOpenListener = false;
let isPausedForMe = false;
let pauseChoiceRole = null; // 'player' or 'listener'

// Web app URL for sharing (update this when you have a permanent URL)
const WEB_APP_URL = 'https://degree-authors-arnold-lace.trycloudflare.com';

// ===== MINIMAL QR CODE GENERATOR =====
function generateQR(text, canvas, size = 160) {
    // Simple QR code generator using canvas
    // Uses QR code algorithm for alphanumeric mode
    const ctx = canvas.getContext('2d');
    canvas.width = size;
    canvas.height = size;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    // Use Google Charts API for reliable QR generation
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);
    };
    img.onerror = () => {
        // Fallback: draw room code as text
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = '#1a1a2e';
        ctx.font = 'bold 14px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('QR Unavailable', size / 2, size / 2 - 10);
        ctx.font = '11px Inter, sans-serif';
        ctx.fillText('Share via link below', size / 2, size / 2 + 10);
    };
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}&format=png&margin=4`;
}

function getRoomShareUrl(roomCode) {
    return `${WEB_APP_URL}/#${roomCode}`;
}

// ===== THEME =====
function initTheme() {
    const saved = localStorage.getItem('jamsync_theme') || 'dark';
    document.body.setAttribute('data-theme', saved);
}

function toggleTheme() {
    const current = document.body.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', next);
    localStorage.setItem('jamsync_theme', next);
}

initTheme();
document.querySelectorAll('.theme-toggle').forEach(btn => btn.addEventListener('click', toggleTheme));

// ===== VIEW SWITCHING =====
function showView(name) {
    Object.entries(views).forEach(([k, el]) => {
        el.classList.toggle('active', k === name);
    });
    currentView = name;
}

// ===== LOAD SAVED NAME =====
chrome.storage.local.get(['jamsync_name'], (r) => {
    if (r.jamsync_name) {
        $('nameInput').value = r.jamsync_name;
        userName = r.jamsync_name;
    }
});

function saveName() {
    userName = $('nameInput').value.trim() || 'Anonymous';
    chrome.storage.local.set({ jamsync_name: userName });
}

// ===== ROLE SELECTION =====
$('btnPlayer').addEventListener('click', async () => {
    saveName();
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
        chrome.runtime.sendMessage({
            type: 'START_PLAYER',
            streamId, tabId: tab.id, tabTitle: tab.title, userName
        }, (resp) => {
            if (resp?.success) {
                $('playerRoomCode').textContent = resp.roomId;
                showView('player');
                requestMusicTabs();
                // Generate QR code for sharing
                const shareUrl = getRoomShareUrl(resp.roomId);
                generateQR(shareUrl, $('qrCanvas'), 160);
            }
        });
    } catch (err) {
        console.error('Player start error:', err);
    }
});

$('btnListener').addEventListener('click', () => {
    saveName();
    chrome.runtime.sendMessage({ type: 'START_LISTENER', userName }, (resp) => {
        if (resp?.success) showView('selectPlayer');
    });
});

$('btnJoinManual').addEventListener('click', () => {
    saveName();
    const code = $('manualRoomCode').value.trim().toUpperCase();
    if (!code) return;
    chrome.runtime.sendMessage({ type: 'START_LISTENER', userName, roomId: code }, (resp) => {
        if (resp?.success) showView('selectPlayer');
    });
});

// ===== SCANNING / PLAYER SELECTION =====
$('btnRescan').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'START_LISTENER', userName, roomId: null });
});

$('btnCancelScan').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'STOP_SESSION' });
    showView('idle');
});

function renderPlayerList(players) {
    const list = $('playerList');
    if (!players || players.length === 0) {
        list.innerHTML = '<div class="empty-state">No Players found. Ask someone to start broadcasting!</div>';
        return;
    }
    list.innerHTML = players.map(p => {
        const initial = (p.name || 'P').charAt(0).toUpperCase();
        const track = cleanTitle(p.nowPlaying) || 'Playing music…';
        return `
      <div class="player-card" data-peer-id="${esc(p.peerId)}" data-name="${esc(p.name)}">
        <div class="player-avatar">${initial}</div>
        <div class="player-info">
          <div class="player-name">${esc(p.name)}</div>
          <div class="player-track">${esc(track)}</div>
        </div>
        <div class="player-meta">👥 ${p.listenerCount || 0}</div>
      </div>`;
    }).join('');

    list.querySelectorAll('.player-card').forEach(card => {
        card.addEventListener('click', () => {
            const peerId = card.dataset.peerId;
            const name = card.dataset.name;
            chrome.runtime.sendMessage({ type: 'SELECT_PLAYER', peerId, playerName: name });
            showView('listener');
        });
    });
}

// ===== MUSIC TABS =====
function requestMusicTabs() {
    chrome.runtime.sendMessage({ type: 'GET_MUSIC_TABS' }, (resp) => {
        if (resp?.tabs) renderMusicTabs(resp.tabs);
    });
}

function renderMusicTabs(tabs) {
    const list = $('musicTabsList');
    if (!tabs || tabs.length === 0) {
        list.innerHTML = '<div class="empty-state">No music tabs detected. Open Spotify, YouTube Music, etc.</div>';
        return;
    }
    list.innerHTML = tabs.map(t => {
        const activeClass = t.isActive ? ' active' : '';
        const isPlaying = t.isPlaying || t.audible;

        // Status badge
        let statusHTML = '';
        if (t.isActive) {
            statusHTML = '<span class="tab-status tab-status-broadcasting">🔊 Broadcasting</span>';
        } else if (isPlaying) {
            statusHTML = '<span class="tab-status tab-status-playing">♪ Playing</span>';
        } else {
            statusHTML = '<span class="tab-status tab-status-paused">⏸ Paused</span>';
        }

        // Play/Pause button
        const controlIcon = isPlaying ? '⏸' : '▶';
        const controlAction = isPlaying ? 'PAUSE' : 'PLAY';
        const controlTitle = isPlaying ? 'Pause' : 'Play';

        return `
      <div class="music-tab-item${activeClass}" data-tab-id="${t.tabId}">
        <span class="tab-icon">${esc(t.icon)}</span>
        <div class="tab-info">
          <div class="tab-platform">${esc(t.platform)}</div>
          <div class="tab-title">${esc(t.trackName || t.title)}</div>
          ${statusHTML}
        </div>
        <button class="tab-control-btn" data-action="${controlAction}" data-tab-id="${t.tabId}" title="${controlTitle}">${controlIcon}</button>
      </div>`;
    }).join('');

    // Per-tab play/pause buttons
    list.querySelectorAll('.tab-control-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation(); // Don't trigger tab row click
            const tabId = parseInt(btn.dataset.tabId);
            const action = btn.dataset.action;

            if (action === 'PLAY') {
                // Play this tab — background will auto-pause others
                chrome.runtime.sendMessage({
                    type: 'CONTROL_PLAYBACK', action: 'PLAY', tabId,
                    pauseOthers: true
                });
            } else {
                // Pause just this tab
                chrome.runtime.sendMessage({
                    type: 'CONTROL_PLAYBACK', action: 'PAUSE', tabId
                });
            }

            // Refresh tabs after a short delay to update UI
            setTimeout(requestMusicTabs, 600);
        });
    });

    // Tab row click = switch broadcasting stream
    list.querySelectorAll('.music-tab-item').forEach(item => {
        item.addEventListener('click', async () => {
            const tabId = parseInt(item.dataset.tabId);
            try {
                const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
                chrome.runtime.sendMessage({ type: 'SWITCH_TAB', tabId, streamId });
                // Highlight immediately
                list.querySelectorAll('.music-tab-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                // Refresh tabs to update badges
                setTimeout(requestMusicTabs, 800);
            } catch (err) {
                console.error('Switch tab error:', err);
            }
        });
    });
}

$('btnRefreshTabs').addEventListener('click', requestMusicTabs);

// ===== LISTENER MUSIC TABS =====
function requestListenerMusicTabs() {
    chrome.runtime.sendMessage({ type: 'LISTENER_REQUEST_TABS' });
}

function renderListenerMusicTabs(tabs) {
    const list = $('listenerMusicTabsList');
    if (!tabs || tabs.length === 0) {
        list.innerHTML = '<div class="empty-state">No music tabs from Player yet</div>';
        return;
    }
    list.innerHTML = tabs.map(t => {
        const activeClass = t.isActive ? ' active' : '';
        const audibleText = t.audible ? '♪ Playing' : '';
        return `
      <div class="music-tab-item${activeClass}" data-tab-id="${t.tabId}">
        <span class="tab-icon">${esc(t.icon)}</span>
        <div class="tab-info">
          <div class="tab-platform">${esc(t.platform)}</div>
          <div class="tab-title">${esc(t.trackName || t.title)}</div>
        </div>
        ${audibleText ? `<span class="tab-audible">${audibleText}</span>` : '<span class="tab-request-badge">Request</span>'}
      </div>`;
    }).join('');

    list.querySelectorAll('.music-tab-item').forEach(item => {
        item.addEventListener('click', () => {
            const tabId = parseInt(item.dataset.tabId);
            // Send request to Player via data channel
            chrome.runtime.sendMessage({ type: 'LISTENER_TAB_REQUEST', tabId });
            // Visual feedback
            list.querySelectorAll('.music-tab-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
        });
    });
}

$('btnListenerRefreshTabs').addEventListener('click', requestListenerMusicTabs);

// ===== PLAYBACK CONTROLS (Player) =====
$('btnTogglePlay').addEventListener('click', () => {
    showPauseChoice('player');
});
$('btnPrev').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CONTROL_PLAYBACK', action: 'PREV' });
});
$('btnNext').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CONTROL_PLAYBACK', action: 'NEXT' });
});

// ===== PLAYBACK CONTROLS (Listener — sends to Player via data channel) =====
$('btnListenerTogglePlay').addEventListener('click', () => {
    showPauseChoice('listener');
});
$('btnListenerPrev').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'LISTENER_CONTROL', action: 'PREV' });
});
$('btnListenerNext').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'LISTENER_CONTROL', action: 'NEXT' });
});

// ===== REACTIONS =====
document.querySelectorAll('.reaction-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const emoji = btn.dataset.emoji;
        chrome.runtime.sendMessage({ type: 'SEND_REACTION', emoji, sender: userName });
        showFloatingReaction(emoji);
        // Animate button
        btn.style.transform = 'scale(1.4)';
        setTimeout(() => { btn.style.transform = ''; }, 200);
    });
});

function showFloatingReaction(emoji) {
    const overlay = $('reactionOverlay');
    const el = document.createElement('div');
    el.className = 'floating-reaction';
    el.textContent = emoji;
    el.style.left = (100 + Math.random() * 180) + 'px';
    el.style.bottom = '80px';
    overlay.appendChild(el);
    setTimeout(() => el.remove(), 1500);
}

// ===== CHAT =====
function setupChat(role) {
    const prefix = role === 'player' ? 'Player' : 'Listener';
    const toggleEl = $(`chatToggle${prefix}`);
    const bodyEl = $(`chatBody${prefix}`);
    const inputEl = $(`chatInput${prefix}`);
    const sendEl = $(`chatSend${prefix}`);
    const badgeEl = $(`chatBadge${prefix}`);

    toggleEl.addEventListener('click', () => {
        const isOpen = bodyEl.style.display !== 'none';
        bodyEl.style.display = isOpen ? 'none' : 'block';
        toggleEl.classList.toggle('open', !isOpen);
        if (!isOpen) {
            if (role === 'player') { chatUnreadPlayer = 0; chatOpenPlayer = true; }
            else { chatUnreadListener = 0; chatOpenListener = true; }
            badgeEl.style.display = 'none';
            inputEl.focus();
        } else {
            if (role === 'player') chatOpenPlayer = false;
            else chatOpenListener = false;
        }
    });

    sendEl.addEventListener('click', () => sendChat(role));
    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendChat(role);
    });
}

function sendChat(role) {
    const prefix = role === 'player' ? 'Player' : 'Listener';
    const inputEl = $(`chatInput${prefix}`);
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    chrome.runtime.sendMessage({ type: 'SEND_CHAT', text, sender: userName });
}

function appendChatMessage(msg, role) {
    const prefix = role === 'player' ? 'Player' : 'Listener';
    const messagesEl = $(`chatMessages${prefix}`);
    const badgeEl = $(`chatBadge${prefix}`);
    const isMine = msg.sender === userName;
    const isOpen = role === 'player' ? chatOpenPlayer : chatOpenListener;

    const time = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${isMine ? 'mine' : 'other'}`;
    bubble.innerHTML = `
    ${!isMine ? `<div class="chat-sender">${esc(msg.sender)}</div>` : ''}
    <div class="chat-text">${esc(msg.text)}</div>
    <div class="chat-time">${time}</div>`;
    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    if (!isOpen && !isMine) {
        if (role === 'player') chatUnreadPlayer++;
        else chatUnreadListener++;
        const count = role === 'player' ? chatUnreadPlayer : chatUnreadListener;
        badgeEl.textContent = count;
        badgeEl.style.display = 'inline-flex';
    }
}

setupChat('player');
setupChat('listener');

// ===== SEARCH (Player) =====
function doSearchPlayer() {
    const input = $('searchInputPlayer');
    const query = input.value.trim();
    if (!query) return;
    chrome.runtime.sendMessage({ type: 'SEARCH_SONG', query });
    input.value = '';
}
$('btnSearchPlayer').addEventListener('click', doSearchPlayer);
$('searchInputPlayer').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearchPlayer();
});

// ===== SEARCH (Listener) =====
function doSearchListener() {
    const input = $('searchInputListener');
    const query = input.value.trim();
    if (!query) return;
    chrome.runtime.sendMessage({ type: 'LISTENER_SEARCH', query });
    input.value = '';
}
$('btnSearchListener').addEventListener('click', doSearchListener);
$('searchInputListener').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearchListener();
});

// ===== STOP =====
$('btnStopPlayer').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'STOP_SESSION' });
    showView('idle');
});
$('btnStopListener').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'STOP_SESSION' });
    showView('idle');
});

// ===== STATE LISTENER =====
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'STATE_UPDATE') {
        handleStateUpdate(msg.state);
    }
    if (msg.type === 'MUSIC_TABS_UPDATE') {
        if (currentView === 'player') renderMusicTabs(msg.tabs);
    }
    if (msg.type === 'LISTENER_MUSIC_TABS') {
        if (currentView === 'listener') renderListenerMusicTabs(msg.tabs);
    }
    if (msg.type === 'CHAT_MESSAGE') {
        if (currentView === 'player') {
            appendChatMessage(msg, 'player');
            if (msg.sender !== userName) showToast('💬', msg.sender, msg.text);
        } else if (currentView === 'listener') {
            appendChatMessage(msg, 'listener');
            if (msg.sender !== userName) showToast('💬', msg.sender, msg.text);
        }
    }
    if (msg.type === 'REACTION_RECEIVED') {
        showFloatingReaction(msg.emoji);
        if (msg.sender !== userName) showToast(msg.emoji, msg.sender, 'reacted');
    }
    // Tab switch approval request (shown on Player's popup)
    if (msg.type === 'TAB_SWITCH_APPROVAL') {
        if (currentView === 'player') {
            showTabSwitchApproval(msg);
        }
    }
});

function handleStateUpdate(state) {
    if (!state) return;

    if (state.mode === 'player') {
        showView('player');
        $('playerRoomCode').textContent = state.roomId || '------';
        $('playerNowPlaying').textContent = cleanTitle(state.nowPlaying) || 'Waiting for audio…';
        $('playerListenerCount').textContent = `${state.listenerCount || 0} listener${(state.listenerCount || 0) !== 1 ? 's' : ''}`;
        // Regenerate QR code
        if (state.roomId) {
            generateQR(getRoomShareUrl(state.roomId), $('qrCanvas'), 160);
        }

        // Listeners list
        const listEl = $('listenersList');
        if (state.listeners && state.listeners.length > 0) {
            listEl.innerHTML = state.listeners.map(n => `<span class="listener-chip">${esc(n)}</span>`).join('');
        } else {
            listEl.innerHTML = '<div class="empty-state">No one yet…</div>';
        }
    }

    if (state.mode === 'listener') {
        if (state.selectPlayer && state.players) {
            showView('selectPlayer');
            renderPlayerList(state.players);
            $('scanStatus').innerHTML = state.scanning
                ? '<div class="scan-spinner"></div><span>Scanning for Players…</span>'
                : `<span>Found ${state.players.length} player${state.players.length !== 1 ? 's' : ''}</span>`;
        } else if (state.connected) {
            showView('listener');
            $('listenerStatusPill').innerHTML = `<div class="status-dot connected"></div><span>Connected to ${esc(state.playerName || 'Player')}</span>`;
            $('listenerPlayerName').textContent = `🎧 ${state.playerName || 'Player'}`;
            $('listenerNowPlaying').textContent = cleanTitle(state.nowPlaying) || 'Waiting…';
            // Request music tabs list from player on first connect
            requestListenerMusicTabs();
        } else if (state.error) {
            showView('selectPlayer');
            $('scanStatus').innerHTML = `<span style="color:var(--danger)">${esc(state.error)}</span>`;
        } else if (state.scanning) {
            showView('selectPlayer');
        } else {
            showView('listener');
            $('listenerStatusPill').innerHTML = '<div class="status-dot connecting"></div><span>Connecting…</span>';
        }
    }

    if (state.mode === 'error') {
        showView('idle');
    }
}

// ===== INIT: CHECK STATE ON POPUP OPEN =====
chrome.runtime.sendMessage({ type: 'GET_STATE' }, (state) => {
    if (state && state.mode && state.mode !== 'idle') {
        handleStateUpdate(state);
    } else {
        // Fallback: try chrome.storage.session
        try {
            chrome.storage.session.get(['jamsync_session'], (r) => {
                if (r?.jamsync_session?.mode && r.jamsync_session.mode !== 'idle') {
                    handleStateUpdate(r.jamsync_session);
                }
            });
        } catch (e) { }
    }
});

// ===== PAUSE CHOICE MODAL =====
function showPauseChoice(role) {
    // If already paused for me, just unpause
    if (isPausedForMe) {
        isPausedForMe = false;
        if (role === 'player') {
            chrome.runtime.sendMessage({ type: 'PAUSE_FOR_ME', muted: false });
        } else {
            chrome.runtime.sendMessage({ type: 'SET_VOLUME', volume: 80 });
        }
        showToast('🔊', 'Audio', 'Resumed for you');
        return;
    }
    pauseChoiceRole = role;
    $('pauseChoiceModal').style.display = 'flex';
}

function hidePauseChoice() {
    $('pauseChoiceModal').style.display = 'none';
    pauseChoiceRole = null;
}

$('btnPauseForMe').addEventListener('click', () => {
    isPausedForMe = true;
    if (pauseChoiceRole === 'player') {
        // Mute loopback audio locally — stream keeps going to listeners
        chrome.runtime.sendMessage({ type: 'PAUSE_FOR_ME', muted: true });
    } else {
        // Listener: mute the remote audio element
        chrome.runtime.sendMessage({ type: 'SET_VOLUME', volume: 0 });
    }
    showToast('🔇', 'Paused', 'Paused for you (others still hear it)');
    hidePauseChoice();
});

$('btnPauseForAll').addEventListener('click', () => {
    if (pauseChoiceRole === 'player') {
        chrome.runtime.sendMessage({ type: 'CONTROL_PLAYBACK', action: 'TOGGLE' });
    } else {
        chrome.runtime.sendMessage({ type: 'LISTENER_CONTROL', action: 'TOGGLE' });
    }
    showToast('⏸', 'Paused', 'Paused for everyone');
    hidePauseChoice();
});

$('btnPauseCancel').addEventListener('click', hidePauseChoice);

// ===== UTILS =====
function cleanTitle(raw) {
    if (!raw) return '';
    return raw
        .replace(/\s*[-–—|]\s*(YouTube( Music)?|Spotify|Apple Music|Amazon Music|SoundCloud)\s*$/i, '')
        .replace(/\s*·\s*\d+\s*$/, '')
        .trim();
}

// ===== TAB SWITCH APPROVAL =====
function showTabSwitchApproval(msg) {
    const banner = $('tabSwitchApproval');
    if (!banner) return;
    const tabName = msg.tabTitle || `Tab #${msg.tabId}`;
    const requester = msg.requester || 'A listener';
    banner.innerHTML = `
        <div class="approval-text">
            <span class="approval-icon">🔄</span>
            <span><strong>${esc(requester)}</strong> wants to switch to <strong>${esc(tabName)}</strong></span>
        </div>
        <div class="approval-actions">
            <button class="btn-approve" id="btnApproveSwitch">✓ Allow</button>
            <button class="btn-deny" id="btnDenySwitch">✕ Deny</button>
        </div>`;
    banner.style.display = 'flex';
    banner.dataset.tabId = msg.tabId;

    $('btnApproveSwitch').addEventListener('click', async () => {
        const tabId = parseInt(banner.dataset.tabId);
        try {
            const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
            chrome.runtime.sendMessage({ type: 'SWITCH_TAB', tabId, streamId });
        } catch (err) {
            console.error('Approve switch error:', err);
        }
        banner.style.display = 'none';
    });

    $('btnDenySwitch').addEventListener('click', () => {
        banner.style.display = 'none';
    });

    // Auto-dismiss after 15 seconds
    setTimeout(() => { banner.style.display = 'none'; }, 15000);
}

// ===== TOAST ALERTS =====
function showToast(icon, sender, text) {
    const container = $('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
        <span class="toast-icon">${icon}</span>
        <span class="toast-text"><span class="toast-sender">${esc(sender)}</span> ${esc(text)}</span>`;
    container.appendChild(toast);
    // Auto-remove after animation completes
    setTimeout(() => toast.remove(), 3000);
    // Limit to 3 toasts max
    while (container.children.length > 3) {
        container.firstChild.remove();
    }
}

// ===== SHARE / COPY URL (Player) =====
$('btnShareUrl').addEventListener('click', () => {
    const roomCode = $('playerRoomCode')?.textContent?.trim();
    if (!roomCode || roomCode === '------') return;
    const url = getRoomShareUrl(roomCode);
    const text = `🎵 Join my JamSync room!\n\nRoom Code: ${roomCode}\nOpen this link on your phone to listen:\n${url}\n\nOr scan the QR code in the extension!`;

    if (navigator.share) {
        navigator.share({
            title: 'JamSync — Join my music room!',
            text: text,
            url: url
        }).catch(() => {
            // Fallback to clipboard
            copyToClipboard(text, 'btnShareUrl');
        });
    } else {
        copyToClipboard(text, 'btnShareUrl');
    }
});

$('btnCopyUrl').addEventListener('click', () => {
    const roomCode = $('playerRoomCode')?.textContent?.trim();
    if (!roomCode || roomCode === '------') return;
    const url = getRoomShareUrl(roomCode);
    copyToClipboard(url, 'btnCopyUrl');
});

function copyToClipboard(text, btnId) {
    navigator.clipboard.writeText(text).then(() => {
        const btn = $(btnId);
        if (btn) {
            const orig = btn.innerHTML;
            btn.innerHTML = '✅ Copied!';
            btn.classList.add('copied');
            setTimeout(() => {
                btn.innerHTML = orig;
                btn.classList.remove('copied');
            }, 2000);
        }
    }).catch(() => {
        // Fallback for older browsers
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('📋', 'JamSync', 'Link copied!');
    });
}
