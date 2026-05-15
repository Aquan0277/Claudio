const fs = require('fs');
const path = require('path');
const state = require('./state');
const { getWeather } = require('./weather');
const ncm = require('./ncm');

const USER_DIR = path.join(__dirname, '..', 'user');
const PROMPTS_DIR = path.join(__dirname, '..', 'prompts');
const NCM_PROFILE_CACHE_FILE = path.join(USER_DIR, 'ncm-profile-cache.json');

// Cache NCM taste profile (refresh every 30min)
let ncmTasteCache = null;
let ncmTasteCacheTime = 0;
let ncmTasteInFlight = null;
const CACHE_TTL = 30 * 60 * 1000;
const NCM_TASTE_WAIT_MS = parseInt(process.env.NCM_TASTE_WAIT_MS || '2000', 10);

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8').trim();
  } catch {
    return '';
  }
}

function formatNcmProfile(profile) {
  if (!profile) return '';

  const sections = [];
  if (profile.weekTopSongs.length > 0) {
    sections.push('近期最常听：' + profile.weekTopSongs.slice(0, 8).join('、'));
  }
  if (profile.allTimeTopSongs.length > 0) {
    sections.push('历史最爱：' + profile.allTimeTopSongs.slice(0, 8).join('、'));
  }
  if (profile.recentPlayed.length > 0) {
    sections.push('最近播放：' + profile.recentPlayed.slice(0, 6).join('、'));
  }
  if (profile.playlists.length > 0) {
    sections.push('自建歌单：' + profile.playlists.join('、'));
  }
  if (profile.dailyRecommend.length > 0) {
    sections.push('今日推荐：' + profile.dailyRecommend.slice(0, 6).join('、'));
  }

  return sections.join('\n\n');
}

function getNcmProfileCache() {
  try {
    if (!fs.existsSync(NCM_PROFILE_CACHE_FILE)) return null;
    const cached = JSON.parse(fs.readFileSync(NCM_PROFILE_CACHE_FILE, 'utf-8'));
    if (!cached?.profile || !cached?.tasteText || !cached?.updatedAt) return null;

    const currentProfile = ncm.getProfile();
    if (currentProfile?.userId && cached.userId && String(cached.userId) !== String(currentProfile.userId)) {
      return null;
    }

    return {
      ...cached,
      ageMs: Date.now() - cached.updatedAt,
      fresh: Date.now() - cached.updatedAt < CACHE_TTL
    };
  } catch (err) {
    console.warn('[Context] NCM profile cache read failed:', err.message);
    return null;
  }
}

function saveNcmProfileCache(profile, tasteText) {
  const currentProfile = ncm.getProfile();
  const payload = {
    version: 1,
    userId: currentProfile?.userId || null,
    nickname: profile.nickname || currentProfile?.nickname || null,
    updatedAt: Date.now(),
    profile,
    tasteText
  };

  try {
    fs.writeFileSync(NCM_PROFILE_CACHE_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[Context] NCM profile cache write failed:', err.message);
  }

  return payload;
}

function loadNcmTasteFromDisk() {
  const cached = getNcmProfileCache();
  if (!cached) return null;

  ncmTasteCache = cached.tasteText;
  ncmTasteCacheTime = cached.updatedAt;
  return cached;
}

function withTimeout(promise, ms, fallback = '') {
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

async function buildNcmTaste() {
  const profile = await ncm.buildUserTasteProfile();
  if (!profile) return '';

  const tasteText = formatNcmProfile(profile);
  saveNcmProfileCache(profile, tasteText);
  return tasteText;
}

async function refreshNcmTaste({ force = false } = {}) {
  if (!ncm.isLoggedIn()) return '';

  const now = Date.now();
  if (!force && ncmTasteCache && (now - ncmTasteCacheTime) < CACHE_TTL) {
    return ncmTasteCache;
  }

  if (!ncmTasteInFlight) {
    ncmTasteInFlight = buildNcmTaste()
      .then(taste => {
        ncmTasteCache = taste;
        ncmTasteCacheTime = Date.now();
        return taste;
      })
      .catch(err => {
        console.error('[Context] NCM taste error:', err.message);
        return '';
      })
      .finally(() => {
        ncmTasteInFlight = null;
      });
  }

  return await ncmTasteInFlight;
}

async function getNcmTaste() {
  if (!ncm.isLoggedIn()) return '';

  const now = Date.now();
  if (ncmTasteCache && (now - ncmTasteCacheTime) < CACHE_TTL) {
    return ncmTasteCache;
  }

  const diskCache = loadNcmTasteFromDisk();
  if (diskCache) {
    if (!diskCache.fresh) {
      refreshNcmTaste({ force: true }).catch(err => {
        console.error('[Context] NCM background refresh error:', err.message);
      });
    }
    return diskCache.tasteText;
  }

  refreshNcmTaste().catch(err => {
    console.error('[Context] NCM taste error:', err.message);
  });

  return await withTimeout(ncmTasteInFlight, NCM_TASTE_WAIT_MS, ncmTasteCache || '');
}

async function warmNcmTaste() {
  if (!ncm.isLoggedIn()) return null;

  const cached = loadNcmTasteFromDisk();
  if (cached) {
    console.log(`[Context] 已载入网易云画像缓存，更新时间: ${new Date(cached.updatedAt).toLocaleString('zh-CN', { hour12: false })}`);
  }

  if (!cached?.fresh) {
    console.log('[Context] 后台刷新网易云画像...');
    refreshNcmTaste({ force: true })
      .then(() => console.log('[Context] 网易云画像缓存已刷新'))
      .catch(err => console.error('[Context] 网易云画像刷新失败:', err.message));
  }

  return cached;
}

async function assembleContext(userInput = '') {
  // Fragment 1: System prompt / DJ persona
  const djPersona = readFile(path.join(PROMPTS_DIR, 'dj-persona.md'));

  // Fragment 2: User taste (local files)
  const taste = readFile(path.join(USER_DIR, 'taste.md'));
  const routines = readFile(path.join(USER_DIR, 'routines.md'));
  const moodRules = readFile(path.join(USER_DIR, 'mood-rules.md'));

  // Fragment 2b: NCM real listening data
  const ncmTaste = await getNcmTaste();

  // Fragment 3: Environment injection
  const weather = await getWeather();
  const now = new Date();
  const timeStr = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  const hour = now.getHours();
  const timeOfDay = hour < 6 ? '深夜' : hour < 12 ? '上午' : hour < 18 ? '下午' : hour < 22 ? '晚上' : '深夜';

  const environment = [
    `当前时间：${timeStr}（${timeOfDay}）`,
    weather.temp !== null
      ? `天气：${weather.city || process.env.WEATHER_CITY} ${weather.description}，${weather.temp}°C，湿度${weather.humidity}%${weather.windDirection ? `，${weather.windDirection}风${weather.windPower}级` : ''}`
      : `天气：${weather.description}`
  ].join('\n');

  // Fragment 4: Play history / memory
  const todayPlays = state.getTodayPlays();
  const recentMessages = state.getRecentMessages(4);

  const playHistory = todayPlays.length > 0
    ? '今天已播放：\n' + todayPlays.map(p => `- ${p.song_name} - ${p.artist}`).join('\n')
    : '今天还没有播放记录';

  const conversationHistory = recentMessages.length > 0
    ? '最近对话：\n' + recentMessages.map(m => `${m.role === 'user' ? '听众' : 'DJ'}：${m.content}`).join('\n')
    : '';

  // Assemble system prompt
  const systemPrompt = [
    djPersona,
    '',
    '## 用户口味档案（自述）',
    taste,
    '',
    ncmTaste ? '## 用户真实听歌数据（来自网易云音乐）' : null,
    ncmTaste || null,
    '',
    '## 作息习惯',
    routines,
    '',
    '## 情绪规则',
    moodRules,
    '',
    '## 当前环境',
    environment,
    '',
    '## 今日播放记忆',
    playHistory,
    conversationHistory ? '' : null,
    conversationHistory || null,
    '',
    '## 输出格式',
    '你必须以 JSON 格式回复，结构如下：',
    '```json',
    '{',
    '  "say": "你作为DJ要说的话（中文，自然口语，1-3句）",',
    '  "play": ["歌名 - 歌手", "歌名 - 歌手", "歌名 - 歌手"],',
    '  "reason": "选歌原因（内部说明，不对外播放）",',
    '  "segue": "下一首歌的引入词（可留空）"',
    '}',
    '```',
    'play 数组包含 3-5 首歌，格式为"歌名 - 歌手"。只用 JSON 回复，不要其他内容。'
  ].filter(s => s !== null).join('\n');

  return { systemPrompt, environment };
}

module.exports = {
  assembleContext,
  getNcmProfileCache,
  refreshNcmTaste,
  warmNcmTaste
};
