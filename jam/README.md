# JamSync — Listen Together

A cross-platform music sharing system. The **Chrome Extension** captures audio from any music tab (Spotify, YouTube, Apple Music, etc.) and streams it to **listeners** who can join via the extension or the **web app (PWA)**.

## How It Works

```
┌─────────────────────┐     PeerJS (WebRTC)     ┌──────────────────┐
│  Chrome Extension   │ ◄──────────────────────► │   Web Listener   │
│  (Player/Host)      │                          │   (PWA)          │
│                     │                          │                  │
│  • tabCapture audio │     Audio + Data         │  • Receives audio│
│  • Playback control │ ◄──────────────────────► │  • Chat/Reactions│
│  • Music tab detect │                          │  • Volume control│
│  • Chat/Reactions   │                          │  • Play/Pause    │
└─────────────────────┘                          └──────────────────┘
```

### Player (Extension)
1. Install the Chrome Extension
2. Open any music site (Spotify, YouTube, etc.)
3. Click JamSync → Enter name → Click **Player**
4. Share the **Room Code** with friends

### Listener (Web App or Extension)
**From the web:**
1. Open the JamSync web app URL
2. Enter your name + Room Code
3. Tap **Join Room** → hear the music!

**From the extension:**
1. Click JamSync → Enter name → Click **Listener**
2. Or paste the Room Code → Join

## Project Structure

```
jam/
├── extension/          # Chrome Extension (Player + Listener)
│   ├── manifest.json
│   ├── background.js
│   ├── offscreen/      # Audio capture & PeerJS engine
│   ├── popup/          # Extension UI
│   ├── content/        # Playback controller for music sites
│   └── lib/            # PeerJS library
└── web/                # PWA Web Listener
    ├── server/         # Express static server
    └── public/         # HTML/CSS/JS + PeerJS client
```

## Running the Web App

```bash
cd web/server
npm install
PORT=8080 node index.js
```

## Installing the Extension

1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder

## Tech Stack

- **PeerJS** — WebRTC peer-to-peer audio streaming + data channels
- **Chrome Extensions API** — `tabCapture`, `offscreen`, content scripts
- **Express** — Static file server for the web listener
- No custom signaling server needed — PeerJS cloud handles it
