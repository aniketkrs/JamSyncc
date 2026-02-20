// JamSync v3 — Background Service Worker
// Multi-tab music detection, tab switching, chat relay, playback controls

let offscreenCreated = false;
let currentState = { mode: 'idle' };

// Restore session state after service worker restart
let storageReady = new Promise((resolve) => {
  try {
    chrome.storage.session.get(['jamsync_session'], (r) => {
      if (r?.jamsync_session?.mode && r.jamsync_session.mode !== 'idle') {
        currentState = r.jamsync_session;
        console.log('[BG] Session restored:', currentState.mode);
        // Ask offscreen for fresh state (it persists across sw restarts)
        ensureOffscreen().then(() => {
          setTimeout(() => {
            try {
              chrome.runtime.sendMessage({ target: 'offscreen', type: 'REQUEST_STATE' }).catch(() => { });
            } catch (e) { }
          }, 500);
        });
      }
      resolve();
    });
  } catch (e) { resolve(); }
});
let watchingTabId = null;
let musicTabPollInterval = null;
let knownMusicTabs = [];

const MUSIC_DOMAINS = [
  'open.spotify.com',
  'music.youtube.com',
  'www.youtube.com',
  'music.apple.com',
  'music.amazon.com',
  'music.amazon.in',
  'music.amazon.co.uk',
  'soundcloud.com'
];

const PLATFORM_MAP = {
  'open.spotify.com': { name: 'Spotify', icon: '🟢' },
  'music.youtube.com': { name: 'YouTube Music', icon: '🔴' },
  'www.youtube.com': { name: 'YouTube', icon: '▶️' },
  'music.apple.com': { name: 'Apple Music', icon: '🍎' },
  'music.amazon.com': { name: 'Amazon Music', icon: '📦' },
  'music.amazon.in': { name: 'Amazon Music', icon: '📦' },
  'music.amazon.co.uk': { name: 'Amazon Music', icon: '📦' },
  'soundcloud.com': { name: 'SoundCloud', icon: '☁️' }
};

// ===== OFFSCREEN DOCUMENT =====
async function ensureOffscreen() {
  if (offscreenCreated) return;
  try {
    const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (ctx.length > 0) { offscreenCreated = true; return; }
  } catch (e) { }
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['AUDIO_PLAYBACK', 'USER_MEDIA'],
      justification: 'Audio capture and streaming for JamSync'
    });
    offscreenCreated = true;
  } catch (err) {
    if (err.message?.includes('Only a single offscreen')) offscreenCreated = true;
    else console.error('[BG] Offscreen error:', err);
  }
}

// ===== PUBLIC IP → ROOM ID =====
async function getPublicIP() {
  try {
    const r = await fetch('https://api.ipify.org?format=text');
    return (await r.text()).trim();
  } catch (e) { return null; }
}

function ipToRoomId(ip) {
  let h = 0;
  for (let i = 0; i < ip.length; i++) {
    h = ((h << 5) - h) + ip.charCodeAt(i);
    h |= 0;
  }
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  let v = Math.abs(h);
  for (let i = 0; i < 6; i++) {
    code += chars[v % chars.length];
    v = Math.floor(v / chars.length);
  }
  return code;
}

// ===== MUSIC TAB DETECTION =====
async function detectMusicTabs() {
  try {
    const allTabs = await chrome.tabs.query({});
    const musicTabs = [];

    for (const tab of allTabs) {
      if (!tab.url) continue;
      let url;
      try { url = new URL(tab.url); } catch { continue; }

      const domain = MUSIC_DOMAINS.find(d => url.hostname === d || url.hostname.endsWith('.' + d));
      if (!domain) continue;

      const platform = PLATFORM_MAP[domain] || { name: 'Music', icon: '🎵' };

      // Try to get track info from content script
      let trackInfo = null;
      try {
        trackInfo = await chrome.tabs.sendMessage(tab.id, {
          target: 'controller',
          action: 'GET_TRACK_INFO'
        });
      } catch (e) {
        // Content script not loaded yet, use tab title
      }

      musicTabs.push({
        tabId: tab.id,
        platform: platform.name,
        icon: platform.icon,
        title: tab.title,
        audible: tab.audible || false,
        trackName: trackInfo?.track || tab.title,
        artistName: trackInfo?.artist || '',
        isPlaying: trackInfo?.playing || tab.audible || false,
        favIconUrl: tab.favIconUrl || '',
        isActive: tab.id === watchingTabId
      });
    }

    knownMusicTabs = musicTabs;
    return musicTabs;
  } catch (err) {
    console.error('[BG] detectMusicTabs error:', err);
    return [];
  }
}

function startMusicTabPolling() {
  if (musicTabPollInterval) return;
  musicTabPollInterval = setInterval(async () => {
    const tabs = await detectMusicTabs();
    // Broadcast to popup
    try {
      chrome.runtime.sendMessage({
        type: 'MUSIC_TABS_UPDATE',
        tabs: tabs
      }).catch(() => { });
    } catch (e) { }
    // Also broadcast to offscreen so Player can relay to Listeners
    try {
      chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'BROADCAST_MUSIC_TABS',
        tabs: tabs
      }).catch(() => { });
    } catch (e) { }

    // Poll active track info from content script for Now Playing sync
    if (watchingTabId) {
      try {
        const trackInfo = await chrome.tabs.sendMessage(watchingTabId, {
          target: 'controller',
          action: 'GET_TRACK_INFO'
        });
        if (trackInfo?.track) {
          const displayTitle = trackInfo.artist
            ? `${trackInfo.track} — ${trackInfo.artist}`
            : trackInfo.track;
          chrome.runtime.sendMessage({
            target: 'offscreen',
            type: 'UPDATE_NOW_PLAYING',
            tabTitle: displayTitle
          }).catch(() => { });
        }
      } catch (e) {
        // Content script might not be available - fall back to tab title
        chrome.tabs.get(watchingTabId, (tab) => {
          if (tab && tab.title) {
            chrome.runtime.sendMessage({
              target: 'offscreen',
              type: 'UPDATE_NOW_PLAYING',
              tabTitle: tab.title
            }).catch(() => { });
          }
        });
      }
    }
  }, 3000);
}

function stopMusicTabPolling() {
  if (musicTabPollInterval) {
    clearInterval(musicTabPollInterval);
    musicTabPollInterval = null;
  }
}

// ===== TAB WATCHING =====
function startWatchingTab(tabId) {
  watchingTabId = tabId;
  chrome.tabs.onUpdated.addListener(tabUpdateListener);
  startMusicTabPolling();
}

function stopWatchingTab() {
  watchingTabId = null;
  chrome.tabs.onUpdated.removeListener(tabUpdateListener);
  stopMusicTabPolling();
}

function tabUpdateListener(tabId, changeInfo) {
  if (tabId === watchingTabId && changeInfo.title) {
    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'UPDATE_NOW_PLAYING',
      tabTitle: changeInfo.title
    }).catch(() => { });
  }
}

// ===== MESSAGE HANDLER =====
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // GET STATE — return stored state AND ask offscreen for a fresh one
  if (msg.type === 'GET_STATE') {
    storageReady.then(() => {
      // First, immediately respond with what we have
      const storedState = { ...currentState };
      // Also ask offscreen to send a fresh STATE_UPDATE
      try {
        chrome.runtime.sendMessage({ target: 'offscreen', type: 'REQUEST_STATE' }).catch(() => { });
      } catch (e) { }
      sendResponse(storedState);
    });
    return true;
  }

  // STATE UPDATE (from offscreen)
  if (msg.type === 'STATE_UPDATE') {
    currentState = msg.state;
    // Also store in chrome.storage.session for persistence after service worker restart
    try {
      chrome.storage.session.set({ jamsync_session: msg.state }).catch(() => { });
    } catch (e) { }
    return false;
  }

  // OFFSCREEN READY
  if (msg.type === 'OFFSCREEN_READY') return false;

  // MUSIC TAB DETECTED (from content script)
  if (msg.type === 'MUSIC_TAB_DETECTED') return false;

  // MUSIC TAB UPDATED — content script detected a title/track change
  if (msg.type === 'MUSIC_TAB_UPDATED') {
    if (sender.tab && sender.tab.id === watchingTabId) {
      const title = msg.trackInfo?.track || msg.tabTitle || sender.tab?.title;
      chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'UPDATE_NOW_PLAYING',
        tabTitle: title
      }).catch(() => { });
    }
    return false;
  }

  // GET MUSIC TABS
  if (msg.type === 'GET_MUSIC_TABS') {
    detectMusicTabs().then(tabs => sendResponse({ tabs }));
    return true;
  }

  // START PLAYER
  if (msg.type === 'START_PLAYER') {
    handleStartPlayer(msg, sendResponse);
    return true;
  }

  // START LISTENER
  if (msg.type === 'START_LISTENER') {
    handleStartListener(msg, sendResponse);
    return true;
  }

  // SELECT PLAYER
  if (msg.type === 'SELECT_PLAYER') {
    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'SELECT_PLAYER',
      peerId: msg.peerId,
      playerName: msg.playerName
    }).catch(() => { });
    return false;
  }

  // SWITCH TAB
  if (msg.type === 'SWITCH_TAB') {
    handleSwitchTab(msg, sendResponse);
    return true;
  }

  // PLAYBACK CONTROL
  if (msg.type === 'CONTROL_PLAYBACK') {
    handlePlaybackControl(msg, sendResponse);
    return true;
  }

  // PAUSE FOR ME (mute tab locally, stream keeps going to listeners)
  if (msg.type === 'PAUSE_FOR_ME') {
    const tabId = watchingTabId;
    if (tabId) {
      // Mute/unmute the actual browser tab — player hears from tab, not loopback
      chrome.tabs.update(tabId, { muted: !!msg.muted }).catch(() => { });
    }
    // Also mute offscreen loopback as backup
    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'PAUSE_FOR_ME',
      muted: msg.muted
    }).catch(() => { });
    return false;
  }

  // CHAT MESSAGE (from popup → offscreen)
  if (msg.type === 'SEND_CHAT') {
    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'SEND_CHAT',
      text: msg.text,
      sender: msg.sender
    }).catch(() => { });
    return false;
  }

  // REACTION (from popup → offscreen)
  if (msg.type === 'SEND_REACTION') {
    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'SEND_REACTION',
      emoji: msg.emoji,
      sender: msg.sender
    }).catch(() => { });
    return false;
  }

  // SEARCH SONG (from popup → content script in active music tab)
  if (msg.type === 'SEARCH_SONG') {
    const tabId = watchingTabId;
    if (!tabId) return false;
    const command = { target: 'controller', action: 'SEARCH', query: msg.query };
    chrome.tabs.sendMessage(tabId, command).catch(async () => {
      // Content script not present — inject and retry
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content/controller.js'] });
        await new Promise(r => setTimeout(r, 200));
        chrome.tabs.sendMessage(tabId, command).catch(() => { });
      } catch (e) { console.warn('[JamSync] Search inject failed:', e); }
    });
    return false;
  }

  // STOP
  if (msg.type === 'STOP_SESSION') {
    handleStop(sendResponse);
    return true;
  }



  // Listener requesting tab switch (from offscreen → background)
  if (msg.type === 'SWITCH_TAB_REQUEST_FROM_LISTENER') {
    // Send approval request to Player's popup instead of auto-switching
    (async () => {
      try {
        const tab = await chrome.tabs.get(msg.tabId);
        chrome.runtime.sendMessage({
          type: 'TAB_SWITCH_APPROVAL',
          tabId: msg.tabId,
          tabTitle: tab?.title || `Tab #${msg.tabId}`,
          requester: msg.requester || 'A listener'
        }).catch(() => { });
      } catch (e) {
        chrome.runtime.sendMessage({
          type: 'TAB_SWITCH_APPROVAL',
          tabId: msg.tabId,
          tabTitle: `Tab #${msg.tabId}`,
          requester: msg.requester || 'A listener'
        }).catch(() => { });
      }
    })();
    return false;
  }

  // Listener requesting music tabs list (from offscreen → background)
  if (msg.type === 'REQUEST_MUSIC_TABS_FROM_LISTENER') {
    detectMusicTabs().then(tabs => {
      try {
        chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'BROADCAST_MUSIC_TABS',
          tabs: tabs
        }).catch(() => { });
      } catch (e) { }
    });
    return false;
  }

  // Listener music tabs forwarded from offscreen → popup
  if (msg.type === 'LISTENER_MUSIC_TABS') {
    // Just let it pass through to popup (popup listens for this)
    return false;
  }

  // Listener control request from popup → offscreen
  if (msg.type === 'LISTENER_CONTROL' || msg.type === 'LISTENER_TAB_REQUEST' || msg.type === 'LISTENER_REQUEST_TABS' || msg.type === 'LISTENER_SEARCH') {
    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: msg.type,
      action: msg.action,
      tabId: msg.tabId,
      query: msg.query // Forward query for search
    }).catch(() => { });
    return false;
  }

  return false;
});

// ===== START PLAYER =====
async function handleStartPlayer(msg, sendResponse) {
  try {
    const ip = await getPublicIP();
    if (!ip) { sendResponse({ success: false, error: 'Could not detect WiFi.' }); return; }

    const roomId = msg.roomId || ipToRoomId(ip);
    await ensureOffscreen();
    await new Promise(r => setTimeout(r, 300));

    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'START_PLAYER',
      streamId: msg.streamId,
      roomId: roomId,
      userName: msg.userName
    }).catch(() => { });

    if (msg.tabId) startWatchingTab(msg.tabId);

    if (msg.tabTitle) {
      setTimeout(() => {
        chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'UPDATE_NOW_PLAYING',
          tabTitle: msg.tabTitle
        }).catch(() => { });
      }, 1000);
    }

    currentState = { mode: 'player', roomId: roomId };
    sendResponse({ success: true, roomId: roomId });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// ===== START LISTENER =====
async function handleStartListener(msg, sendResponse) {
  try {
    let roomId = msg.roomId;
    if (!roomId) {
      const ip = await getPublicIP();
      if (!ip) { sendResponse({ success: false, error: 'Could not detect WiFi.' }); return; }
      roomId = ipToRoomId(ip);
    }
    await ensureOffscreen();
    await new Promise(r => setTimeout(r, 300));

    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'START_LISTENER',
      roomId: roomId,
      userName: msg.userName
    }).catch(() => { });

    currentState = { mode: 'listener', scanning: true, roomId: roomId };
    sendResponse({ success: true, roomId: roomId });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// ===== PAUSE A TAB =====
async function pauseTab(tabId) {
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, { target: 'controller', action: 'PAUSE' });
  } catch (e) {
    // Content script may not be there; try injecting first
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/controller.js']
      });
      await new Promise(r => setTimeout(r, 200));
      await chrome.tabs.sendMessage(tabId, { target: 'controller', action: 'PAUSE' });
    } catch (e2) {
      console.warn('[JamSync] Could not pause tab', tabId, e2.message);
    }
  }
}

// ===== SWITCH TAB =====
async function handleSwitchTab(msg, sendResponse) {
  try {
    const newTabId = msg.tabId;

    // 1. Pause ALL other music tabs (not just old watchingTabId)
    if (knownMusicTabs && knownMusicTabs.length > 0) {
      const pausePromises = knownMusicTabs
        .filter(t => t.tabId !== newTabId)
        .map(t => pauseTab(t.tabId));
      await Promise.allSettled(pausePromises);
    } else if (watchingTabId && watchingTabId !== newTabId) {
      // Fallback: pause old watchingTabId if no knownMusicTabs
      await pauseTab(watchingTabId);
    }

    // 2. Update watchingTabId
    watchingTabId = newTabId;

    // 3. Forward new stream to offscreen
    if (msg.streamId) {
      chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'SWITCH_TAB',
        streamId: msg.streamId,
        tabId: newTabId
      }).catch(() => { });
    }

    // 4. Update Now Playing with new tab's title
    try {
      const tab = await chrome.tabs.get(newTabId);
      if (tab) {
        setTimeout(() => {
          chrome.runtime.sendMessage({
            target: 'offscreen',
            type: 'UPDATE_NOW_PLAYING',
            tabTitle: tab.title
          }).catch(() => { });
        }, 500);
      }
    } catch (e) { }

    sendResponse({ success: true });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// ===== PLAYBACK CONTROL =====
async function handlePlaybackControl(msg, sendResponse) {
  const tabId = msg.tabId || watchingTabId;
  if (!tabId) {
    console.warn('[JamSync] No tabId for playback control');
    sendResponse({ success: false, error: 'No active music tab' });
    return;
  }

  // If playing a tab and pauseOthers is set, pause all other music tabs first
  if (msg.action === 'PLAY' && msg.pauseOthers && knownMusicTabs) {
    const pausePromises = knownMusicTabs
      .filter(t => t.tabId !== tabId)
      .map(t => pauseTab(t.tabId));
    await Promise.allSettled(pausePromises);
  }

  const command = {
    target: 'controller',
    action: msg.action // PLAY, PAUSE, TOGGLE, NEXT, PREV
  };

  try {
    // Try sending to existing content script first
    const response = await chrome.tabs.sendMessage(tabId, command);
    sendResponse(response || { success: true });
  } catch (e) {
    // Content script not present — inject it and retry
    console.log('[JamSync] Injecting controller into tab', tabId);
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/controller.js']
      });
      // Wait a moment for script to initialize
      await new Promise(r => setTimeout(r, 200));
      const response = await chrome.tabs.sendMessage(tabId, command);
      sendResponse(response || { success: true });
    } catch (e2) {
      console.error('[JamSync] Playback control failed:', e2);
      sendResponse({ success: false, error: e2.message });
    }
  }
}

// ===== STOP =====
async function handleStop(sendResponse) {
  stopWatchingTab();
  try {
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'STOP' }).catch(() => { });
  } catch (e) { }
  currentState = { mode: 'idle' };
  if (sendResponse) sendResponse({ success: true });
}

// ===== SWITCH TAB FOR LISTENER (Player-side) =====
async function handleSwitchTabForListener(tabId) {
  if (!tabId) return;
  try {
    // Capture the new tab's audio
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    watchingTabId = tabId;

    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'SWITCH_TAB',
      streamId: streamId,
      tabId: tabId
    }).catch(() => { });

    // Update now playing with the tab's title
    const tab = await chrome.tabs.get(tabId);
    if (tab) {
      setTimeout(() => {
        chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'UPDATE_NOW_PLAYING',
          tabTitle: tab.title
        }).catch(() => { });
      }, 500);
    }
  } catch (err) {
    console.error('[BG] handleSwitchTabForListener error:', err);
  }
}
