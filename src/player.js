const state = require('./state');
const ncm = require('./ncm');
const { synthesize } = require('./tts');
const { broadcast } = require('./broadcast');

// Playback queue state
let queue = [];       // { id, name, artist, url, ttsUrl, say, segue }
let current = null;
let isProcessing = false;
const SONG_URL_TTL = 20 * 60 * 1000;
const TTS_FIRST_WAIT_MS = parseInt(process.env.TTS_FIRST_WAIT_MS || '1800', 10);

function withTimeout(promise, ms, fallback = null) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise(resolve => {
      timer = setTimeout(() => resolve(fallback), ms);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function shouldRefreshUrl(entry) {
  return !!entry?.id && (!entry.url || !entry.urlFetchedAt || Date.now() - entry.urlFetchedAt > SONG_URL_TTL);
}

async function ensureFreshUrl(entry) {
  if (!shouldRefreshUrl(entry)) return entry;

  const freshUrl = await ncm.getSongUrl(entry.id).catch(err => {
    console.error('[Player] refresh URL failed:', err.message);
    return null;
  });

  if (freshUrl) {
    entry.url = freshUrl;
    entry.urlFetchedAt = Date.now();
  }

  return entry;
}

async function enqueue(claudeResult) {
  const { say, play, segue } = claudeResult;
  const startedAt = Date.now();

  // dj_say is already broadcast by router (streaming early) — skip if sent
  if (say && !claudeResult._saySentEarly) {
    broadcast({ type: 'dj_say', say, reason: claudeResult.reason });
  }

  // Run TTS synthesis and NCM song resolution in parallel. If TTS is slow, start
  // the music first and let the DJ voice arrive as a non-blocking overlay.
  const ttsPromise = say
    ? synthesize(say).catch(err => { console.error('[Player] TTS failed:', err.message); return null; })
    : Promise.resolve(null);
  const songs = await ncm.resolvePlaylist(play);

  if (songs.length === 0) {
    console.warn('[Player] No songs resolved from:', play);
    return;
  }

  // If a song is already playing, broadcast TTS immediately (don't wait for queue)
  // If nothing is playing, attach TTS to first song so it plays before that song starts
  const shouldAttachTts = !current;
  const attachedTtsUrl = shouldAttachTts
    ? await withTimeout(ttsPromise, TTS_FIRST_WAIT_MS, null)
    : null;

  if (!shouldAttachTts || !attachedTtsUrl) {
    ttsPromise.then(ttsUrl => {
      if (ttsUrl) broadcast({ type: 'dj_tts', ttsUrl, say });
    });
  }

  // Build queue entries
  const entries = songs.map((song, i) => ({
    id: song.id,
    name: song.name,
    artist: song.artist,
    url: song.url,
    urlFetchedAt: Date.now(),
    ttsUrl: i === 0 ? attachedTtsUrl : null,
    say: i === 0 ? say : null,
    segue: i === songs.length - 1 ? segue : null
  }));

  queue.push(...entries);

  broadcast({
    type: 'queue_updated',
    queue: queue.map(e => ({ name: e.name, artist: e.artist }))
  });

  if (!current) {
    await playNext();
  }

  console.log(`[Player] enqueue done in ${Date.now() - startedAt}ms`);
}

async function playNext() {
  while (queue.length > 0) {
    current = queue.shift();
    await ensureFreshUrl(current);

    if (current.url) break;

    console.warn(`[Player] Skip unavailable song: ${current.name} - ${current.artist}`);
    current = null;
  }

  if (!current) {
    current = null;
    broadcast({ type: 'idle' });
    return;
  }

  // Record play
  state.recordPlay(current.name, current.artist, current.id);

  broadcast({
    type: 'now_playing',
    song: {
      id: current.id,
      name: current.name,
      artist: current.artist,
      url: current.url
    },
    say: current.say,
    ttsUrl: current.ttsUrl,
    segue: current.segue,
    queueLength: queue.length,
    queue: queue.map(e => ({ name: e.name, artist: e.artist }))
  });

  console.log(`[Player] Now playing: ${current.name} - ${current.artist}`);
}

async function getNowPlaying() {
  if (!current) return null;
  await ensureFreshUrl(current);

  return {
    song: { id: current.id, name: current.name, artist: current.artist, url: current.url },
    queueLength: queue.length,
    queue: queue.map(e => ({ name: e.name, artist: e.artist }))
  };
}

function getQueue() {
  return queue.map(e => ({ name: e.name, artist: e.artist }));
}

// Called by frontend when a song ends
function onSongEnd() {
  return playNext();
}

module.exports = { enqueue, playNext, onSongEnd, getNowPlaying, getQueue };
