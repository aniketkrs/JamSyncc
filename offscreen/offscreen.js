// JamSync v3 — Offscreen Audio Engine
// Multi-player slots, tab switching, chat relay, reactions

const MAX_PLAYER_SLOTS = 20;
const SCAN_TIMEOUT = 8000;

let peer = null;
let audioStream = null;
let mode = null;
let connections = new Map();
let activeCalls = new Map();
let nowPlaying = '';
let userName = '';
let roomId = '';
let mySlot = 0;
let scanConnections = [];
let chatHistory = [];
let currentPlayerName = '';

// ===== MESSAGE HANDLER =====
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.target !== 'offscreen') return;

    switch (msg.type) {
        case 'START_PLAYER':
            startPlayer(msg.streamId, msg.roomId, msg.userName);
            break;
        case 'START_LISTENER':
            startScanning(msg.roomId, msg.userName);
            break;
        case 'SELECT_PLAYER':
            connectToPlayer(msg.peerId, msg.playerName);
            break;
        case 'SWITCH_TAB':
            switchTab(msg.streamId);
            break;
        case 'STOP':
            stopAll();
            break;
        case 'UPDATE_NOW_PLAYING':
            nowPlaying = msg.tabTitle || '';
            broadcastToAll({ type: 'NOW_PLAYING', title: nowPlaying, playerName: userName });
            if (mode === 'player') updatePlayerState();
            break;
        case 'SET_VOLUME':
            const ra = document.getElementById('remoteAudio');
            if (ra) ra.volume = (msg.volume || 80) / 100;
            break;
        case 'SEND_CHAT':
            handleOutgoingChat(msg.text, msg.sender);
            break;
        case 'SEND_REACTION':
            handleOutgoingReaction(msg.emoji, msg.sender);
            break;
        case 'BROADCAST_MUSIC_TABS':
            // Player's background sends us the music tabs list; broadcast to all listeners
            if (mode === 'player') {
                broadcastToAll({ type: 'MUSIC_TABS', tabs: msg.tabs || [] });
            }
            break;
        case 'LISTENER_CONTROL':
            // Listener requesting playback control — forward to player via data channel
            if (mode === 'listener' && playerDataConn && playerDataConn.open) {
                playerDataConn.send({ type: 'CONTROL_REQUEST', action: msg.action, sender: userName });
            }
            break;
        case 'LISTENER_TAB_REQUEST':
            // Listener requesting a tab switch — forward to player via data channel
            if (mode === 'listener' && playerDataConn && playerDataConn.open) {
                playerDataConn.send({ type: 'TAB_SWITCH_REQUEST', tabId: msg.tabId, sender: userName });
            }
            break;
        case 'LISTENER_REQUEST_TABS':
            // Listener asking player for music tabs list
            if (mode === 'listener' && playerDataConn && playerDataConn.open) {
                playerDataConn.send({ type: 'REQUEST_MUSIC_TABS', sender: userName });
            }
            break;
        case 'REQUEST_STATE':
            // Popup opened and wants fresh state
            if (mode === 'player') {
                updatePlayerState();
            } else if (mode === 'listener') {
                // Re-send whatever the current listener state is
                if (playerDataConn && playerDataConn.open) {
                    sendStateUpdate({
                        mode: 'listener', scanning: false, connected: true,
                        playerName: currentPlayerName || 'Player',
                        nowPlaying: nowPlaying, roomId: roomId
                    });
                } else {
                    sendStateUpdate({
                        mode: 'listener', scanning: false, connected: false,
                        roomId: roomId
                    });
                }
            }
            break;
        case 'PAUSE_FOR_ME':
            // Mute/unmute loopback audio locally (player only, doesn't affect listeners)
            if (mode === 'player') {
                const lb = document.getElementById('loopback');
                if (lb) lb.muted = !!msg.muted;
            }
            break;
        case 'LISTENER_SEARCH':
            // Listener requesting search
            if (mode === 'listener' && playerDataConn && playerDataConn.open) {
                playerDataConn.send({ type: 'SEARCH_REQUEST', query: msg.query, sender: userName });
            }
            break;
    }
});

try { chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' }); } catch (e) { }

// ================================================================
// PLAYER MODE
// ================================================================
async function startPlayer(streamId, rid, name) {
    mode = 'player';
    roomId = rid;
    userName = name;
    mySlot = 0;
    chatHistory = [];

    for (let slot = 1; slot <= MAX_PLAYER_SLOTS; slot++) {
        const peerId = `jamsync-${roomId}-p${slot}`;
        const result = await tryCreatePeer(peerId);
        if (result.success) {
            peer = result.peer;
            mySlot = slot;
            console.log(`[Player] ✅ Slot ${slot}`);
            break;
        }
    }

    if (!peer) {
        sendStateUpdate({ mode: 'error', error: 'All player slots full!' });
        return;
    }

    setupPlayerHandler();
    if (streamId) await captureAudio(streamId);
    updatePlayerState();
}

function tryCreatePeer(peerId) {
    return new Promise((resolve) => {
        let done = false;
        const p = new Peer(peerId, {
            debug: 0,
            config: {
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
            }
        });
        p.on('open', () => { if (!done) { done = true; resolve({ success: true, peer: p }); } });
        p.on('error', (e) => { if (!done) { done = true; try { p.destroy(); } catch (x) { } resolve({ success: false }); } });
        setTimeout(() => { if (!done) { done = true; try { p.destroy(); } catch (x) { } resolve({ success: false }); } }, 5000);
    });
}

function setupPlayerHandler() {
    peer.on('connection', (conn) => {
        conn.on('open', () => console.log('[Player] Conn:', conn.peer));

        conn.on('data', (data) => {
            if (data.type === 'WHO_ARE_YOU') {
                conn.send({
                    type: 'PLAYER_INFO',
                    name: userName,
                    nowPlaying: nowPlaying,
                    listenerCount: connections.size,
                    slot: mySlot,
                    peerId: peer.id
                });
                setTimeout(() => { try { if (conn.open) conn.close(); } catch (e) { } }, 1000);
                return;
            }

            if (data.type === 'JOIN') {
                connections.set(conn.peer, { conn, name: data.name });
                conn.send({
                    type: 'WELCOME',
                    playerName: userName,
                    nowPlaying: nowPlaying,
                    roomId: roomId,
                    chatHistory: chatHistory.slice(-50)
                });

                // Stream audio
                if (audioStream) {
                    try {
                        const call = peer.call(conn.peer, audioStream);
                        activeCalls.set(conn.peer, call);
                    } catch (e) { }
                }

                // Announce to others
                broadcastToAll({
                    type: 'USER_JOINED',
                    name: data.name,
                    listenerCount: connections.size
                });

                updatePlayerState();
            }

            // Chat from listener
            if (data.type === 'CHAT_MSG') {
                const chatMsg = { sender: data.sender, text: data.text, time: Date.now() };
                chatHistory.push(chatMsg);
                if (chatHistory.length > 200) chatHistory = chatHistory.slice(-100);

                // Relay to all (including sender echo)
                broadcastToAll({ type: 'CHAT_MSG', ...chatMsg });
                // Also notify popup
                notifyChat(chatMsg);
            }

            // Reaction from listener
            if (data.type === 'REACTION') {
                broadcastToAll({ type: 'REACTION', emoji: data.emoji, sender: data.sender });
                notifyReaction(data.emoji, data.sender);
            }

            // Listener requesting playback control
            if (data.type === 'CONTROL_REQUEST') {
                // Forward to background which talks to content script
                try {
                    chrome.runtime.sendMessage({
                        type: 'CONTROL_PLAYBACK',
                        action: data.action
                    });
                } catch (e) { }
            }

            // Listener requesting tab switch
            if (data.type === 'TAB_SWITCH_REQUEST') {
                try {
                    const info = connections.get(conn.peer);
                    chrome.runtime.sendMessage({
                        type: 'SWITCH_TAB_REQUEST_FROM_LISTENER',
                        tabId: data.tabId,
                        requester: info?.name || data.sender || 'A listener'
                    });
                } catch (e) { }
            }

            // Listener requesting music tabs list
            if (data.type === 'REQUEST_MUSIC_TABS') {
                try {
                    chrome.runtime.sendMessage({ type: 'REQUEST_MUSIC_TABS_FROM_LISTENER' });
                } catch (e) { }
            }

            // Listener requesting search
            if (data.type === 'SEARCH_REQUEST') {
                try {
                    chrome.runtime.sendMessage({ type: 'SEARCH_SONG', query: data.query });
                } catch (e) { }
            }
        });

        conn.on('close', () => {
            const info = connections.get(conn.peer);
            connections.delete(conn.peer);
            activeCalls.delete(conn.peer);
            if (info) broadcastToAll({ type: 'USER_LEFT', name: info.name, listenerCount: connections.size });
            updatePlayerState();
        });

        conn.on('error', () => {
            connections.delete(conn.peer);
            activeCalls.delete(conn.peer);
            updatePlayerState();
        });
    });

    peer.on('disconnected', () => { if (peer && !peer.destroyed) peer.reconnect(); });
}

async function captureAudio(streamId) {
    try {
        audioStream = await navigator.mediaDevices.getUserMedia({
            audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }
        });

        const loopback = document.getElementById('loopback');
        loopback.srcObject = audioStream;
        loopback.volume = 1.0;
        await loopback.play().catch(() => { });

        // Stream to existing listeners via WebRTC call
        connections.forEach(({ conn }, peerId) => {
            if (!activeCalls.has(peerId)) {
                try {
                    const call = peer.call(peerId, audioStream);
                    activeCalls.set(peerId, call);
                } catch (e) { }
            }
        });

        // Start data channel audio relay (fallback for mobile networks)
        startAudioRelay();
    } catch (err) {
        console.error('[Player] Capture failed:', err);
    }
}

// ===== DATA CHANNEL AUDIO RELAY (fallback for mobile) =====
let relayCtx = null;
let relayProcessor = null;

function startAudioRelay() {
    if (!audioStream || relayCtx) return;
    try {
        relayCtx = new AudioContext({ sampleRate: 22050 });
        const source = relayCtx.createMediaStreamSource(audioStream);
        relayProcessor = relayCtx.createScriptProcessor(4096, 1, 1);

        source.connect(relayProcessor);
        relayProcessor.connect(relayCtx.destination);

        relayProcessor.onaudioprocess = (e) => {
            if (connections.size === 0) return;
            const samples = e.inputBuffer.getChannelData(0);
            // Float32 → Int16 for compression
            const int16 = new Int16Array(samples.length);
            for (let i = 0; i < samples.length; i++) {
                int16[i] = Math.max(-32768, Math.min(32767, samples[i] * 32768));
            }
            const b64 = bufToBase64(int16.buffer);
            connections.forEach(({ conn }) => {
                if (conn.open) {
                    try { conn.send({ type: 'AUDIO_RELAY', d: b64 }); } catch (e) { }
                }
            });
        };
        console.log('[Player] ✅ Audio relay started (data channel fallback)');
    } catch (e) {
        console.error('[Player] Audio relay failed:', e);
    }
}

function stopAudioRelay() {
    if (relayProcessor) { try { relayProcessor.disconnect(); } catch (e) { } relayProcessor = null; }
    if (relayCtx) { try { relayCtx.close(); } catch (e) { } relayCtx = null; }
}

function bufToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

// ===== TAB SWITCHING =====
async function switchTab(newStreamId) {
    // Stop old stream tracks
    if (audioStream) {
        audioStream.getTracks().forEach(t => t.stop());
        audioStream = null;
    }

    // Capture new tab audio
    await captureAudio(newStreamId);

    // Replace audio track on existing calls instead of closing them
    if (audioStream && activeCalls.size > 0) {
        const newTrack = audioStream.getAudioTracks()[0];
        if (newTrack) {
            activeCalls.forEach(call => {
                try {
                    const sender = call.peerConnection
                        ?.getSenders()
                        ?.find(s => s.track?.kind === 'audio');
                    if (sender) {
                        sender.replaceTrack(newTrack);
                    }
                } catch (e) {
                    console.warn('[Offscreen] replaceTrack failed:', e);
                }
            });
        }
    }

    // Notify listeners
    broadcastToAll({ type: 'TAB_SWITCHED', nowPlaying: nowPlaying, playerName: userName });
}

function updatePlayerState() {
    const names = [];
    connections.forEach(({ name }) => names.push(name));
    sendStateUpdate({
        mode: 'player', roomId, userName, nowPlaying,
        listeners: names, listenerCount: connections.size, slot: mySlot
    });
}

// ================================================================
// LISTENER MODE — Scan then Select
// ================================================================
function startScanning(rid, name) {
    mode = 'scanning';
    roomId = rid;
    userName = name;
    chatHistory = [];

    const scannerId = `jamsync-scan-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    peer = new Peer(scannerId, {
        debug: 0,
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        }
    });

    peer.on('open', () => scanForPlayers());
    peer.on('error', (err) => {
        if (err.type === 'peer-unavailable') return;
        console.error('[Scanner]', err);
    });
}

function scanForPlayers() {
    const found = [];
    scanConnections = [];

    sendStateUpdate({ mode: 'listener', scanning: true, connected: false, roomId });

    for (let slot = 1; slot <= MAX_PLAYER_SLOTS; slot++) {
        const peerId = `jamsync-${roomId}-p${slot}`;
        try {
            const conn = peer.connect(peerId, { reliable: true });
            scanConnections.push(conn);
            conn.on('open', () => conn.send({ type: 'WHO_ARE_YOU' }));
            conn.on('data', (data) => {
                if (data.type === 'PLAYER_INFO') {
                    found.push({
                        slot: data.slot || slot,
                        peerId: data.peerId || peerId,
                        name: data.name || `Player ${slot}`,
                        nowPlaying: data.nowPlaying || '',
                        listenerCount: data.listenerCount || 0
                    });
                    sendStateUpdate({ mode: 'listener', scanning: true, selectPlayer: true, players: [...found], roomId });
                }
            });
        } catch (e) { }
    }

    setTimeout(() => {
        scanConnections.forEach(c => { try { if (c.open) c.close(); } catch (e) { } });
        scanConnections = [];
        if (found.length > 0) {
            sendStateUpdate({ mode: 'listener', scanning: false, selectPlayer: true, players: found, roomId });
        } else {
            sendStateUpdate({ mode: 'listener', scanning: false, connected: false, error: 'No Players found. Ask someone to start broadcasting!' });
        }
    }, SCAN_TIMEOUT);
}

// ================================================================
// CONNECT TO SELECTED PLAYER
// ================================================================
let playerDataConn = null;

function connectToPlayer(targetPeerId, playerName) {
    mode = 'listener';
    currentPlayerName = playerName || 'Player';

    sendStateUpdate({ mode: 'listener', scanning: true, connected: false, roomId });

    peer.on('call', (call) => {
        call.answer();
        call.on('stream', (stream) => {
            const ra = document.getElementById('remoteAudio');
            ra.srcObject = stream;
            ra.volume = 0.8;
            ra.play().catch(() => { });
            sendStateUpdate({ mode: 'listener', connected: true, scanning: false, playerName, roomId });
        });
        call.on('close', () => {
            sendStateUpdate({ mode: 'listener', connected: false, error: 'Player stopped' });
        });
    });

    const conn = peer.connect(targetPeerId, { reliable: true });
    playerDataConn = conn;

    conn.on('open', () => {
        conn.send({ type: 'JOIN', name: userName });
    });

    conn.on('data', (data) => {
        if (data.type === 'WELCOME') {
            if (data.chatHistory) chatHistory = data.chatHistory;
            sendStateUpdate({
                mode: 'listener', scanning: false, connected: true,
                playerName: data.playerName || playerName,
                nowPlaying: data.nowPlaying, roomId: data.roomId
            });
        }
        if (data.type === 'NOW_PLAYING') {
            sendStateUpdate({
                mode: 'listener', connected: true, scanning: false,
                playerName: data.playerName || playerName,
                nowPlaying: data.title
            });
        }
        if (data.type === 'TAB_SWITCHED') {
            sendStateUpdate({
                mode: 'listener', connected: true, scanning: false,
                playerName: data.playerName || playerName,
                nowPlaying: data.nowPlaying
            });
        }
        if (data.type === 'CHAT_MSG') {
            // Skip echo of our own messages (we already showed them locally)
            if (data.sender !== userName) {
                notifyChat({ sender: data.sender, text: data.text, time: data.time || Date.now() });
            }
        }
        if (data.type === 'REACTION') {
            notifyReaction(data.emoji, data.sender);
        }
        if (data.type === 'MUSIC_TABS') {
            // Player broadcasting their music tabs to us
            try {
                chrome.runtime.sendMessage({ type: 'LISTENER_MUSIC_TABS', tabs: data.tabs });
            } catch (e) { }
        }
        if (data.type === 'USER_JOINED' || data.type === 'USER_LEFT') {
            // Could update listener list in UI
        }
    });

    conn.on('close', () => {
        sendStateUpdate({ mode: 'listener', connected: false, error: 'Disconnected' });
    });
}

// ================================================================
// CHAT & REACTIONS
// ================================================================
function handleOutgoingChat(text, sender) {
    const chatMsg = { sender: sender || userName, text, time: Date.now() };
    chatHistory.push(chatMsg);

    if (mode === 'player') {
        // Player sends to all listeners
        broadcastToAll({ type: 'CHAT_MSG', ...chatMsg });
        notifyChat(chatMsg);
    } else if (mode === 'listener' && playerDataConn && playerDataConn.open) {
        // Listener sends to player (who relays)
        playerDataConn.send({ type: 'CHAT_MSG', sender: chatMsg.sender, text: chatMsg.text });
        notifyChat(chatMsg);
    }
}

function handleOutgoingReaction(emoji, sender) {
    if (mode === 'player') {
        broadcastToAll({ type: 'REACTION', emoji, sender: sender || userName });
        notifyReaction(emoji, sender || userName);
    } else if (mode === 'listener' && playerDataConn && playerDataConn.open) {
        playerDataConn.send({ type: 'REACTION', emoji, sender: sender || userName });
        notifyReaction(emoji, sender || userName);
    }
}

function notifyChat(msg) {
    try {
        chrome.runtime.sendMessage({ type: 'CHAT_MESSAGE', ...msg });
    } catch (e) { }
}

function notifyReaction(emoji, sender) {
    try {
        chrome.runtime.sendMessage({ type: 'REACTION_RECEIVED', emoji, sender });
    } catch (e) { }
}

// ===== BROADCAST =====
function broadcastToAll(data) {
    connections.forEach(({ conn }) => {
        try { if (conn && conn.open) conn.send(data); } catch (e) { }
    });
}

function sendStateUpdate(state) {
    try { chrome.runtime.sendMessage({ type: 'STATE_UPDATE', state }); } catch (e) { }
}

// ===== CLEANUP =====
function stopAll() {
    scanConnections.forEach(c => { try { c.close(); } catch (e) { } });
    scanConnections = [];
    activeCalls.forEach(c => { try { c.close(); } catch (e) { } });
    activeCalls.clear();
    connections.forEach(({ conn }) => { try { conn.close(); } catch (e) { } });
    connections.clear();
    if (audioStream) { audioStream.getTracks().forEach(t => t.stop()); audioStream = null; }
    const lb = document.getElementById('loopback');
    const ra = document.getElementById('remoteAudio');
    if (lb) lb.srcObject = null;
    if (ra) ra.srcObject = null;
    if (peer) { try { peer.destroy(); } catch (e) { } peer = null; }
    playerDataConn = null;
    mode = null;
    mySlot = 0;
    chatHistory = [];
}
