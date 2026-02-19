# 🎵 JamSync — Listen Together, Anywhere.

**JamSync** is a Chrome Extension that lets you stream your music tab audio to friends in real-time. Whether you're on Spotify, YouTube Music, or Apple Music, your friends can listen along, chat, and react — all perfectly synced.

![JamSync Icon](icons/icon128.png)

## ✨ Features

- **Universal Sync:** Works with **Spotify, YouTube, YouTube Music, Apple Music, Amazon Music, and SoundCloud**.
- **Real-Time Audio:** Peer-to-peer streaming for low-latency, high-quality audio.
- **Playback Control:** Listeners can **Play, Pause, and Skip tracks** (with the Host's permission).
- **Tab Switching:** Host can switch the music source (e.g., from Spotify to YouTube) and Listeners follow automatically.
- **Live Chat & Reactions:** Built-in chat room and floating emoji reactions.
- **No Login Required:** Just share a simplistic **Room ID** to connect.

## 🚀 How to Install

Since this is a developer extension, you'll need to load it manually into Chrome:

1.  **Download** or **Clone** this repository to your computer.
2.  Open **Google Chrome** and navigate to `chrome://extensions`.
3.  Enable **Developer mode** (toggle in the top-right corner).
4.  Click **Load unpacked**.
5.  Select the **`electric-shuttle`** folder (or wherever you extracted the files).
6.  The **JamSync** icon should appear in your toolbar!

## 🎧 How to Use

### 🎸 As a Host (Player)
1.  Open a music tab (e.g., [Spotify](https://open.spotify.com) or [YouTube](https://www.youtube.com)).
2.  Click the **JamSync** extension icon.
3.  Click **"Start Streaming"**.
4.  Copy the **Room ID** (e.g., `funky-walrus-42`) and send it to your friends.
5.  Keep the extension popup open or minimize it, but **do not close the music tab**.

### 👂 As a Listener
1.  Click the **JamSync** extension icon.
2.  Enter the **Room ID** your friend shared.
3.  Click **"Start Listening"**.
4.  You'll hear the music instantly! You can also:
    -   **Chat** with the group.
    -   **React** with emojis.
    -   **Control** the music (Play/Pause/Next) using the buttons in the extension.

## 🛠 Supported Platforms
JamSync automatically detects and controls playback on:
-   ✅ Spotify
-   ✅ YouTube / YouTube Music
-   ✅ Apple Music
-   ✅ Amazon Music
-   ✅ SoundCloud

## 🔧 Troubleshooting
-   **Audio not syncing?** Refresh the page or click "Resync" in the extension.
-   **Controls not working?** Refresh the music tab to ensure the controller script is loaded.
-   **Connection failed?** Ensure both you and the host are on a stable internet connection.

## 🤝 Contributing
Feel free to fork this repo and submit Pull Requests! We're always looking to add support for more platforms and features.

---
*Built with ❤️ for music lovers.*
