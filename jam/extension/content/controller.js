// JamSync — Content Script: Playback Controller
// Injected into music tabs to enable play/pause/next/prev from the extension
// Uses multi-selector fallback chains + keyboard simulation as ultimate fallback

const PLATFORM = detectPlatform();

// ===== PLATFORM DETECTION =====
function detectPlatform() {
    const host = window.location.hostname;
    if (host.includes('spotify.com')) return 'spotify';
    if (host.includes('music.youtube.com')) return 'youtube-music';
    if (host.includes('youtube.com')) return 'youtube';
    if (host.includes('music.apple.com')) return 'apple-music';
    if (host.includes('music.amazon')) return 'amazon-music';
    if (host.includes('soundcloud.com')) return 'soundcloud';
    return 'unknown';
}

// ===== SELECTORS PER PLATFORM (multiple fallbacks) =====
const SELECTORS = {
    'spotify': {
        play: [
            'button[data-testid="control-button-playpause"]',
            'button[aria-label="Play"]',
            'button[aria-label="Pause"]',
            '.player-controls__buttons button:nth-child(3)',
            '.player-controls button[data-testid="control-button-play"]'
        ],
        next: [
            'button[data-testid="control-button-skip-forward"]',
            'button[aria-label="Next"]',
            '.player-controls__buttons button:nth-child(4)',
            '.player-controls button[data-testid="control-button-forward"]'
        ],
        prev: [
            'button[data-testid="control-button-skip-back"]',
            'button[aria-label="Previous"]',
            '.player-controls__buttons button:nth-child(2)',
            '.player-controls button[data-testid="control-button-back"]'
        ],
        trackName: [
            'a[data-testid="context-item-link"]',
            '[data-testid="nowplaying-track-link"]',
            '.Root__now-playing-bar a[href*="/track/"]',
            '.now-playing-bar .track-info__name a',
            '.player-controls__container a[data-testid*="track"]'
        ],
        artistName: [
            'a[data-testid="context-item-info-artist"]',
            '[data-testid="nowplaying-artist"]',
            '.Root__now-playing-bar a[href*="/artist/"]',
            '.now-playing-bar .track-info__artists a'
        ],
        isPlaying: () => {
            // Method 1: check aria-label
            const btn = queryFirst([
                'button[data-testid="control-button-playpause"]',
                '.player-controls__buttons button:nth-child(3)'
            ]);
            if (btn) {
                const label = btn.getAttribute('aria-label')?.toLowerCase() || '';
                if (label.includes('pause')) return true;
                if (label.includes('play')) return false;
            }
            // Method 2: check if audio is playing via document
            const audios = document.querySelectorAll('audio, video');
            for (const a of audios) {
                if (!a.paused && !a.muted) return true;
            }
            return false;
        }
    },
    'youtube-music': {
        play: [
            'tp-yt-paper-icon-button.play-pause-button',
            '#play-pause-button',
            '.play-pause-button',
            'ytmusic-player-bar tp-yt-paper-icon-button#play-pause-button',
            '.middle-controls .play-pause-button'
        ],
        next: [
            'tp-yt-paper-icon-button.next-button',
            '.next-button',
            'ytmusic-player-bar .next-button',
            '.middle-controls .next-button'
        ],
        prev: [
            'tp-yt-paper-icon-button.previous-button',
            '.previous-button',
            'ytmusic-player-bar .previous-button',
            '.middle-controls .previous-button'
        ],
        trackName: [
            'ytmusic-player-bar .title.ytmusic-player-bar',
            '.title.ytmusic-player-bar',
            'ytmusic-player-bar .content-info-wrapper .title',
            '.player-bar .title'
        ],
        artistName: [
            'ytmusic-player-bar .byline.ytmusic-player-bar a',
            '.byline.ytmusic-player-bar a',
            'ytmusic-player-bar .content-info-wrapper .byline a',
            '.player-bar .byline a'
        ],
        isPlaying: () => {
            const btn = queryFirst([
                '#play-pause-button',
                '.play-pause-button',
                'tp-yt-paper-icon-button.play-pause-button'
            ]);
            if (btn) {
                const label = btn.getAttribute('aria-label')?.toLowerCase() || '';
                const title = btn.getAttribute('title')?.toLowerCase() || '';
                if (label.includes('pause') || title.includes('pause')) return true;
                if (label.includes('play') || title.includes('play')) return false;
            }
            const video = document.querySelector('video');
            return video ? !video.paused : false;
        }
    },
    'youtube': {
        play: [
            '.ytp-play-button',
            'button.ytp-play-button',
            '[data-title-no-tooltip="Play"]',
            '[data-title-no-tooltip="Pause"]'
        ],
        next: [
            '.ytp-next-button',
            'a.ytp-next-button'
        ],
        prev: [],
        trackName: [
            '#title h1 yt-formatted-string',
            'h1.ytd-video-primary-info-renderer',
            '#title h1',
            'ytd-watch-metadata h1 yt-formatted-string'
        ],
        artistName: [
            '#owner-name a',
            '#channel-name a',
            'ytd-channel-name a',
            '#text-container.ytd-channel-name a'
        ],
        isPlaying: () => {
            const btn = document.querySelector('.ytp-play-button');
            if (btn) {
                const label = btn.getAttribute('aria-label')?.toLowerCase() || '';
                const title = btn.getAttribute('data-title-no-tooltip')?.toLowerCase() || '';
                if (label.includes('pause') || title.includes('pause')) return true;
                if (label.includes('play') || title.includes('play')) return false;
            }
            const video = document.querySelector('video');
            return video ? !video.paused : false;
        }
    },
    'apple-music': {
        play: [
            '.web-chrome-playback-controls__playback-btn',
            'button[aria-label="Play"]',
            'button[aria-label="Pause"]',
            '.playback-play'
        ],
        next: [
            '.web-chrome-playback-controls__skip-forward-btn',
            'button[aria-label="Next"]',
            '.playback-next'
        ],
        prev: [
            '.web-chrome-playback-controls__skip-back-btn',
            'button[aria-label="Previous"]',
            '.playback-previous'
        ],
        trackName: [
            '.web-chrome-playback-lcd__song-name-scroll-inner',
            '.web-chrome-playback-lcd__song-name',
            '.song-name'
        ],
        artistName: [
            '.web-chrome-playback-lcd__sub-copy-scroll-inner a',
            '.web-chrome-playback-lcd__sub-copy a',
            '.artist-name'
        ],
        isPlaying: () => {
            const btn = queryFirst([
                '.web-chrome-playback-controls__playback-btn',
                'button[aria-label="Pause"]'
            ]);
            if (btn) {
                const label = btn.getAttribute('aria-label')?.toLowerCase() || '';
                if (label.includes('pause')) return true;
                if (label.includes('play')) return false;
            }
            const audios = document.querySelectorAll('audio, video');
            for (const a of audios) {
                if (!a.paused) return true;
            }
            return false;
        }
    },
    'amazon-music': {
        play: [
            'button[data-testid="playback-control-bar-play-pause"]',
            '.playerIconButton--play',
            'button[aria-label="Play"]',
            'button[aria-label="Pause"]'
        ],
        next: [
            'button[data-testid="playback-control-bar-skip-forward"]',
            '.playerIconButton--next',
            'button[aria-label="Next"]'
        ],
        prev: [
            'button[data-testid="playback-control-bar-skip-backwards"]',
            '.playerIconButton--previous',
            'button[aria-label="Previous"]'
        ],
        trackName: [
            '[data-testid="playback-control-bar-track-title"]',
            '.playbackControlsView .trackTitle',
            '.now-playing-title'
        ],
        artistName: [
            '[data-testid="playback-control-bar-artist"]',
            '.playbackControlsView .artistLink',
            '.now-playing-artist'
        ],
        isPlaying: () => {
            const btn = queryFirst([
                'button[data-testid="playback-control-bar-play-pause"]',
                'button[aria-label="Pause"]'
            ]);
            if (btn) {
                const label = btn.getAttribute('aria-label')?.toLowerCase() || '';
                if (label.includes('pause')) return true;
                if (label.includes('play')) return false;
            }
            return false;
        }
    },
    'soundcloud': {
        play: [
            '.playControl',
            'button.playControl',
            '.playControls__play'
        ],
        next: [
            '.skipControl__next',
            '.playControls__next'
        ],
        prev: [
            '.skipControl__previous',
            '.playControls__previous'
        ],
        trackName: [
            '.playbackSoundBadge__titleLink span',
            '.playbackSoundBadge__title span'
        ],
        artistName: [
            '.playbackSoundBadge__lightLink',
            '.playbackSoundBadge__artist'
        ],
        isPlaying: () => {
            const btn = queryFirst(['.playControl', '.playControls__play']);
            return btn ? btn.classList.contains('playing') : false;
        }
    }
};

// ===== HELPERS =====

// Try multiple selectors, return first matching element
function queryFirst(selectors) {
    if (!selectors || !Array.isArray(selectors)) return null;
    for (const sel of selectors) {
        try {
            const el = document.querySelector(sel);
            if (el) return el;
        } catch (e) { }
    }
    return null;
}

function clickButton(selectors) {
    if (!selectors) return false;
    // Handle both array and single-string selectors
    const sels = Array.isArray(selectors) ? selectors : [selectors];
    const btn = queryFirst(sels);
    if (btn) {
        btn.click();
        return true;
    }
    return false;
}

// ===== KEYBOARD FALLBACK =====
// Universal keyboard shortcuts work on most platforms
function simulateKey(key, code, keyCode) {
    const events = ['keydown', 'keypress', 'keyup'];
    for (const type of events) {
        document.dispatchEvent(new KeyboardEvent(type, {
            key, code, keyCode, which: keyCode,
            bubbles: true, cancelable: true
        }));
    }
}

function fallbackToggle() {
    // Try spacebar (works on YouTube, Spotify)
    simulateKey(' ', 'Space', 32);
    // Also try to find and toggle any <video> or <audio> directly
    const media = document.querySelector('video') || document.querySelector('audio');
    if (media) {
        if (media.paused) media.play().catch(() => { });
        else media.pause();
        return true;
    }
    return false;
}

// ===== TRACK INFO =====
function getTrackInfo() {
    const sel = SELECTORS[PLATFORM];
    if (!sel) return { track: document.title, artist: '', platform: PLATFORM, playing: false };

    const trackEl = queryFirst(sel.trackName);
    const artistEl = queryFirst(sel.artistName);

    return {
        track: trackEl?.textContent?.trim() || document.title,
        artist: artistEl?.textContent?.trim() || '',
        platform: PLATFORM,
        playing: sel.isPlaying ? sel.isPlaying() : false
    };
}

// ===== MESSAGE HANDLER =====
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.target !== 'controller') return;

    const sel = SELECTORS[PLATFORM];

    switch (msg.action) {
        case 'PLAY':
            if (sel && !sel.isPlaying()) {
                if (!clickButton(sel.play)) fallbackToggle();
            }
            sendResponse({ success: true });
            break;

        case 'PAUSE':
            if (sel && sel.isPlaying()) {
                if (!clickButton(sel.play)) fallbackToggle();
            }
            sendResponse({ success: true });
            break;

        case 'TOGGLE':
            if (!clickButton(sel?.play)) fallbackToggle();
            sendResponse({ success: true });
            break;

        case 'NEXT':
            if (!clickButton(sel?.next)) {
                // Keyboard fallback: Shift+N on YouTube
                if (PLATFORM === 'youtube' || PLATFORM === 'youtube-music') {
                    simulateKey('N', 'KeyN', 78);
                }
            }
            sendResponse({ success: true });
            break;

        case 'PREV':
            if (!clickButton(sel?.prev)) {
                // Keyboard fallback: Shift+P on YouTube
                if (PLATFORM === 'youtube' || PLATFORM === 'youtube-music') {
                    simulateKey('P', 'KeyP', 80);
                }
            }
            sendResponse({ success: true });
            break;

        case 'GET_TRACK_INFO':
            sendResponse(getTrackInfo());
            break;

        case 'GET_PLATFORM':
            sendResponse({ platform: PLATFORM });
            break;

        default:
            sendResponse({ success: false, error: 'Unknown action' });
    }

    return true;
});

// ===== ANNOUNCE PRESENCE =====
try {
    chrome.runtime.sendMessage({
        type: 'MUSIC_TAB_DETECTED',
        platform: PLATFORM,
        tabTitle: document.title
    });
} catch (e) { }

// ===== TRACK CHANGES =====
let lastTitle = document.title;
let lastTrack = '';

// Observe tab title changes
const titleObserver = new MutationObserver(() => {
    if (document.title !== lastTitle) {
        lastTitle = document.title;
        try {
            chrome.runtime.sendMessage({
                type: 'MUSIC_TAB_UPDATED',
                platform: PLATFORM,
                tabTitle: document.title,
                trackInfo: getTrackInfo()
            });
        } catch (e) { }
    }
});

titleObserver.observe(document.querySelector('title') || document.head, {
    subtree: true,
    childList: true,
    characterData: true
});

// Also poll track info every 2 seconds (catches changes the title observer misses)
setInterval(() => {
    try {
        const info = getTrackInfo();
        const key = `${info.track}|${info.artist}`;
        if (key !== lastTrack && info.track !== document.title) {
            lastTrack = key;
            chrome.runtime.sendMessage({
                type: 'MUSIC_TAB_UPDATED',
                platform: PLATFORM,
                tabTitle: document.title,
                trackInfo: info
            });
        }
    } catch (e) { }
}, 2000);

console.log(`[JamSync] 🎵 Controller loaded for ${PLATFORM}`);
