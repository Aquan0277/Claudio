require('dotenv').config({ override: true });

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const broadcast = require('./src/broadcast');
const { handle } = require('./src/router');
const player = require('./src/player');
const state = require('./src/state');
const scheduler = require('./src/scheduler');
const { CACHE_DIR } = require('./src/tts');
const ncm = require('./src/ncm');
const { getNcmProfileCache, refreshNcmTaste, warmNcmTaste } = require('./src/context');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Init broadcast
broadcast.init(wss);

function startBundledNcmApi() {
  // Vercel/serverless cannot bind a second long-running local port. In that
  // environment NCM_API must point to an external NeteaseCloudMusicApi service.
  if (process.env.VERCEL) return;

  try {
    const { serveNcmApi } = require('./ncm-server/node_modules/NeteaseCloudMusicApi');
    const ncmPort = parseInt(new URL(process.env.NCM_API || 'http://localhost:3001').port) || 3001;
    serveNcmApi({ port: ncmPort, host: '127.0.0.1' });
    console.log(`[NCM] 网易云音乐 API 启动: http://localhost:${ncmPort}`);
  } catch (err) {
    console.warn('[NCM] 网易云音乐 API 启动失败，请手动运行: npm run ncm');
    console.warn('[NCM]', err.message);
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve TTS audio cache
app.use('/tts', express.static(CACHE_DIR));

// ─── WebSocket ───────────────────────────────────────────────────────────────
wss.on('connection', async (ws) => {
  console.log('[WS] Client connected');

  // Send current state to new client
  const nowPlaying = await player.getNowPlaying();
  if (nowPlaying) {
    ws.send(JSON.stringify({ type: 'now_playing', ...nowPlaying }));
  } else {
    ws.send(JSON.stringify({ type: 'idle' }));
  }

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'song_ended') {
        await player.onSongEnd();
      }
    } catch {}
  });

  ws.on('close', () => console.log('[WS] Client disconnected'));
});

// ─── HTTP API ────────────────────────────────────────────────────────────────

// GET /api/now — current playing song
app.get('/api/now', async (req, res) => {
  const nowPlaying = await player.getNowPlaying();
  res.json(nowPlaying || { song: null, queueLength: 0 });
});

// GET /api/queue — current queue
app.get('/api/queue', (req, res) => {
  res.json({ queue: player.getQueue() });
});

// GET /api/taste — user taste files
app.get('/api/taste', (req, res) => {
  const userDir = path.join(__dirname, 'user');
  const files = {};
  ['taste.md', 'routines.md', 'mood-rules.md', 'playlists.json'].forEach(f => {
    const fp = path.join(userDir, f);
    if (fs.existsSync(fp)) files[f] = fs.readFileSync(fp, 'utf-8');
  });
  res.json(files);
});

// POST /api/taste — update a user taste file
app.post('/api/taste', (req, res) => {
  const { filename, content } = req.body;
  const allowed = ['taste.md', 'routines.md', 'mood-rules.md', 'playlists.json'];
  if (!allowed.includes(filename)) return res.status(400).json({ error: 'Invalid filename' });

  const fp = path.join(__dirname, 'user', filename);
  fs.writeFileSync(fp, content, 'utf-8');
  res.json({ ok: true });
});

// POST /api/chat — user sends message to DJ
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  res.json({ ok: true, message: 'DJ is thinking...' });

  // Process async
  handle(message, 'user').catch(err => {
    console.error('[API] chat error:', err.message);
  });
});

// POST /api/play-now — trigger immediate playback
app.post('/api/play-now', async (req, res) => {
  const { prompt } = req.body;
  const trigger = prompt || '现在帮我选几首好歌播放';

  res.json({ ok: true });

  handle(trigger, 'scheduled').catch(err => {
    console.error('[API] play-now error:', err.message);
  });
});

// GET /api/plan/today — today's play plan
app.get('/api/plan/today', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const plan = state.getPlan(today);
  const plays = state.getTodayPlays();
  res.json({ date: today, plan, plays });
});

// GET /api/history — recent plays
app.get('/api/history', (req, res) => {
  res.json({ plays: state.getRecentPlays(30) });
});

// GET /api/settings — get settings
app.get('/api/settings', (req, res) => {
  const profile = ncm.getProfile();
  res.json({
    ncmApi: process.env.NCM_API || 'http://localhost:3001',
    ncmLoggedIn: ncm.isLoggedIn(),
    ncmUser: profile ? profile.nickname : null,
    weatherCity: process.env.WEATHER_CITY || '',
    hasTTS: !!(process.env.VOLC_APP_ID && process.env.VOLC_ACCESS_TOKEN),
    hasWeatherKey: !!(process.env.WEATHER_API_KEY),
    claudeMode: process.env.CLAUDE_MODE || 'subprocess'
  });
});

// GET /api/ncm/profile — NCM user taste profile
app.get('/api/ncm/profile', async (req, res) => {
  if (!ncm.isLoggedIn()) return res.json({ loggedIn: false });
  try {
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';

    if (forceRefresh) {
      await refreshNcmTaste({ force: true });
    } else {
      const cached = getNcmProfileCache();
      if (cached) {
        if (!cached.fresh) {
          refreshNcmTaste({ force: true }).catch(err => {
            console.error('[API] NCM profile background refresh error:', err.message);
          });
        }

        return res.json({
          loggedIn: true,
          cached: true,
          fresh: cached.fresh,
          updatedAt: cached.updatedAt,
          profile: cached.profile
        });
      }

      await refreshNcmTaste({ force: true });
    }

    const cached = getNcmProfileCache();
    res.json({
      loggedIn: true,
      cached: !!cached,
      fresh: cached?.fresh ?? true,
      updatedAt: cached?.updatedAt || Date.now(),
      profile: cached?.profile || null
    });
  } catch (err) {
    res.json({ loggedIn: false, error: err.message });
  }
});

// GET /api/ncm/playlists — user playlists
app.get('/api/ncm/playlists', async (req, res) => {
  if (!ncm.isLoggedIn()) return res.json({ loggedIn: false, playlists: [] });
  const playlists = await ncm.getUserPlaylists();
  res.json({ loggedIn: true, playlists });
});

// ─── QR Code Login ───
// GET /api/ncm/qr — generate QR code for login
app.get('/api/ncm/qr', async (req, res) => {
  const key = await ncm.qrGetKey();
  if (!key) return res.json({ error: 'Failed to get QR key' });
  const qrimg = await ncm.qrCreate(key);
  res.json({ key, qrimg });
});

// GET /api/ncm/qr/check — check QR scan status
app.get('/api/ncm/qr/check', async (req, res) => {
  const { key } = req.query;
  if (!key) return res.json({ status: 'error', message: 'key required' });
  const result = await ncm.qrCheck(key);
  if (result.status === 'success') {
    warmNcmTaste().catch(err => {
      console.error('[Context] 网易云画像预热失败:', err.message);
    });
  }
  res.json(result);
});

// ─── Start ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;

function startLocalServer() {
  startBundledNcmApi();

  server.listen(PORT, () => {
    console.log(`\n🎵 AI 电台启动成功！`);
    console.log(`   本地访问: http://localhost:${PORT}`);
    console.log(`   PWA 安装: 在浏览器中打开后点击安装按钮\n`);

    // Login to NCM if credentials provided
    ncm.login().then(ok => {
      if (ok) {
        console.log('[NCM] 网易云账号已连接，音乐画像已激活');
        warmNcmTaste().catch(err => {
          console.error('[Context] 网易云画像预热失败:', err.message);
        });
      }
    });

    // Start scheduler
    scheduler.start();
    console.log('[Scheduler] Time-based triggers active\n');
  });
}

if (require.main === module) {
  startLocalServer();
}

module.exports = app;
