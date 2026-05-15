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
