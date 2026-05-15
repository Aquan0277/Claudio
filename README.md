# Claudio

Claudio is a personal AI radio station. It connects to your NetEase Cloud Music account, builds a cached listening profile, lets an AI DJ choose songs, speaks short DJ lines with TTS, and plays everything in a local web app.

## Features

- NetEase Cloud Music QR login
- Recent plays, weekly ranking, all-time ranking, playlists, and daily recommendations
- Cached music profile for fast startup
- AI DJ chat and song selection
- TTS DJ voice cache
- Local PWA-style web player
- Local service scripts for start, stop, restart, and status

## Local Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env` with your own API keys.

Start Claudio:

```bash
npm run local:start
```

Open:

```text
http://localhost:8080/?v=4
```

Useful commands:

```bash
npm run local:status
npm run local:restart
npm run local:stop
```

## Privacy

Do not commit these files:

- `.env`
- `user/ncm-cookie.json`
- `user/ncm-profile-cache.json`
- `state.json`
- `logs/`
- `cache/`

They may contain API keys, NetEase login cookies, listening history, chat history, or generated audio.

## NetEase Profile Cache

After login, Claudio writes a local profile cache to:

```text
user/ncm-profile-cache.json
```

The app uses this file first, then refreshes NetEase data in the background. This keeps DJ responses fast while still updating your listening profile.

## Vercel

This repository includes a `vercel.json` so the static web UI can deploy on Vercel without invoking the local long-running server entrypoint.

Important limitation: the full Claudio radio experience is designed for a persistent Node process. Vercel serverless functions do not provide long-lived WebSockets, local background schedulers, persistent file writes, or a bundled sidecar NetEaseCloudMusicApi port. For the complete experience, run Claudio locally or deploy the Node service to a long-running host such as a VPS, Railway, Render, or Fly.io.

On Vercel, use it mainly as a static frontend unless you also provide:

- an external `NCM_API` service
- environment variables for AI/TTS/weather APIs
- a persistent storage layer for user cookies, listening profile cache, and state
- a realtime layer or polling replacement for WebSocket updates
