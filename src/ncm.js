const axios = require('axios');
const fs = require('fs');
const path = require('path');

const NCM_BASE = process.env.NCM_API || 'http://localhost:3001';
const COOKIE_FILE = path.join(__dirname, '..', 'user', 'ncm-cookie.json');

// Store login cookie for authenticated requests
let loginCookie = '';
let userProfile = null;

// ── Cookie persistence ──
function saveCookie() {
  try {
    fs.writeFileSync(COOKIE_FILE, JSON.stringify({ cookie: loginCookie, savedAt: Date.now() }));
    console.log('[NCM] Cookie 已持久化保存');
  } catch (e) {
    console.warn('[NCM] Cookie 保存失败:', e.message);
  }
}

function loadCookie() {
  try {
    if (!fs.existsSync(COOKIE_FILE)) return null;
    const { cookie } = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
    return cookie || null;
  } catch {
    return null;
  }
}

const ncm = {

  // ═══ 启动时自动恢复登录 ═══
  async autoLogin() {
    // 1. 尝试从文件恢复 cookie
    const saved = loadCookie();
    if (saved) {
      loginCookie = saved;
      try {
        const res = await ncm._req('/login/status', { timestamp: Date.now() });
        const profile = res.data?.data?.profile;
        if (profile?.userId) {
          userProfile = profile;
          console.log(`[NCM] ✅ 自动恢复登录: ${profile.nickname} (uid: ${profile.userId})`);
          return true;
        }
      } catch {}
      // Cookie 失效，清空
      loginCookie = '';
      console.log('[NCM] 已保存的 Cookie 已过期，请重新扫码登录');
      try { fs.unlinkSync(COOKIE_FILE); } catch {}
    }

    console.log('[NCM] 未登录，请在设置页扫码登录网易云账号');
    return false;
  },

  // 兼容旧接口
  async login() {
    return ncm.autoLogin();
  },

  // ═══ QR Code Login ═══
  async qrGetKey() {
    try {
      const res = await axios.get(`${NCM_BASE}/login/qr/key`, {
        params: { timestamp: Date.now() },
        timeout: 8000
      });
      return res.data?.data?.unikey || null;
    } catch (err) {
      console.error('[NCM] QR key error:', err.message);
      return null;
    }
  },

  async qrCreate(key) {
    try {
      const res = await axios.get(`${NCM_BASE}/login/qr/create`, {
        params: { key, qrimg: true, timestamp: Date.now() },
        timeout: 8000
      });
      return res.data?.data?.qrimg || null; // base64 image
    } catch (err) {
      console.error('[NCM] QR create error:', err.message);
      return null;
    }
  },

  async qrCheck(key) {
    try {
      const res = await axios.get(`${NCM_BASE}/login/qr/check`, {
        params: { key, timestamp: Date.now() },
        timeout: 8000
      });
      const code = res.data?.code;
      // 800=expired, 801=waiting, 802=scanned waiting confirm, 803=success
      if (code === 803) {
        const cookies = res.headers['set-cookie'];
        if (cookies) {
          loginCookie = cookies.map(c => c.split(';')[0]).join('; ');
          saveCookie();   // 💾 持久化，重启后自动恢复
        }
        // Fetch user profile after QR login
        await ncm._fetchProfile();
        return { status: 'success', nickname: userProfile?.nickname };
      } else if (code === 802) {
        return { status: 'scanned' };
      } else if (code === 800) {
        return { status: 'expired' };
      } else {
        return { status: 'waiting' };
      }
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  },

  async _fetchProfile() {
    try {
      const res = await ncm._req('/login/status', { timestamp: Date.now() });
      userProfile = res.data?.data?.profile || null;
      if (userProfile) {
        console.log(`[NCM] 扫码登录成功: ${userProfile.nickname} (uid: ${userProfile.userId})`);
      }
    } catch {}
  },

  getProfile() {
    return userProfile;
  },

  isLoggedIn() {
    return !!userProfile;
  },

  // Helper: authenticated request
  _req(url, params = {}) {
    const headers = loginCookie ? { Cookie: loginCookie } : {};
    return axios.get(`${NCM_BASE}${url}`, { params, headers, timeout: 10000 });
  },

  // ═══ Basic ═══
  async search(keyword, limit = 5) {
    try {
      const res = await ncm._req('/search', { keywords: keyword, limit, type: 1 });
      const songs = res.data?.result?.songs || [];
      return songs.map(s => ({
        id: String(s.id),
        name: s.name,
        artist: s.artists?.map(a => a.name).join(' / ') || '未知',
        album: s.album?.name || '',
        duration: s.duration
      }));
    } catch (err) {
      console.error('[NCM] search error:', err.message);
      return [];
    }
  },

  async getSongUrl(songId) {
    const attempts = [
      ['/song/url/v1', { id: songId, level: 'exhigh', timestamp: Date.now() }],
      ['/song/url', { id: songId, br: 320000, timestamp: Date.now() }]
    ];

    for (const [endpoint, params] of attempts) {
      try {
        const res = await ncm._req(endpoint, params);
        const data = res.data?.data?.[0];
        if (data?.url) return data.url;
      } catch (err) {
        console.error(`[NCM] getSongUrl ${endpoint} error:`, err.message);
      }
    }

    return null;
  },

  async getLyric(songId) {
    try {
      const res = await ncm._req('/lyric', { id: songId });
      return res.data?.lrc?.lyric || '';
    } catch {
      return '';
    }
  },

  // ═══ Personalized (requires login) ═══

  // 每日推荐歌曲
  async getDailyRecommend() {
    if (!userProfile) return [];
    try {
      const res = await ncm._req('/recommend/songs');
      const songs = res.data?.data?.dailySongs || res.data?.recommend || [];
      return songs.slice(0, 20).map(s => ({
        id: String(s.id),
        name: s.name,
        artist: s.ar?.map(a => a.name).join(' / ') || s.artists?.map(a => a.name).join(' / ') || '未知'
      }));
    } catch (err) {
      console.error('[NCM] dailyRecommend error:', err.message);
      return [];
    }
  },

  // 用户歌单列表
  async getUserPlaylists() {
    if (!userProfile) return [];
    try {
      const res = await ncm._req('/user/playlist', { uid: userProfile.userId, limit: 30 });
      const lists = res.data?.playlist || [];
      return lists.map(p => ({
        id: String(p.id),
        name: p.name,
        trackCount: p.trackCount,
        playCount: p.playCount,
        isCreator: p.creator?.userId === userProfile.userId
      }));
    } catch (err) {
      console.error('[NCM] userPlaylists error:', err.message);
      return [];
    }
  },

  // 获取歌单详情（歌曲列表）
  async getPlaylistDetail(playlistId) {
    try {
      const res = await ncm._req('/playlist/detail', { id: playlistId });
      const tracks = res.data?.playlist?.tracks || [];
      return tracks.slice(0, 50).map(s => ({
        id: String(s.id),
        name: s.name,
        artist: s.ar?.map(a => a.name).join(' / ') || '未知'
      }));
    } catch (err) {
      console.error('[NCM] playlistDetail error:', err.message);
      return [];
    }
  },

  // 最近播放记录
  async getRecentPlayed() {
    if (!userProfile) return [];
    try {
      const res = await ncm._req('/record/recent/song', { limit: 50 });
      const list = res.data?.data?.list || [];
      return list.map(item => {
        const s = item.data;
        return {
          id: String(s.id),
          name: s.name,
          artist: s.ar?.map(a => a.name).join(' / ') || '未知',
          playTime: item.playTime
        };
      });
    } catch (err) {
      console.error('[NCM] recentPlayed error:', err.message);
      return [];
    }
  },

  // 听歌排行（所有时间 / 最近一周）
  async getListenRanking(type = 1) {
    // type: 1 = 最近一周, 0 = 所有时间
    if (!userProfile) return [];
    try {
      const res = await ncm._req('/user/record', { uid: userProfile.userId, type });
      const data = type === 1 ? res.data?.weekData : res.data?.allData;
      if (!data) return [];
      return data.slice(0, 30).map(item => ({
        id: String(item.song.id),
        name: item.song.name,
        artist: item.song.ar?.map(a => a.name).join(' / ') || '未知',
        playCount: item.playCount,
        score: item.score
      }));
    } catch (err) {
      console.error('[NCM] listenRanking error:', err.message);
      return [];
    }
  },

  // 用户喜欢的音乐 ID 列表
  async getLikedSongIds() {
    if (!userProfile) return [];
    try {
      const res = await ncm._req('/likelist', { uid: userProfile.userId });
      return (res.data?.ids || []).slice(0, 100).map(String);
    } catch {
      return [];
    }
  },

  // 个性化推荐（不需要登录也可用，登录后更精准）
  async getRecommend(limit = 10) {
    try {
      const res = await ncm._req('/personalized/newsong', { limit });
      const songs = res.data?.result || [];
      return songs.map(s => ({
        id: String(s.id),
        name: s.name,
        artist: s.song?.artists?.map(a => a.name).join(' / ') || '未知'
      }));
    } catch {
      return [];
    }
  },

  // ═══ Aggregate: 生成用户音乐画像 ═══
  async buildUserTasteProfile() {
    if (!userProfile) return null;

    console.log('[NCM] 正在分析你的音乐习惯...');

    const [weekRank, allRank, recent, playlists, dailyRec] = await Promise.all([
      ncm.getListenRanking(1),
      ncm.getListenRanking(0),
      ncm.getRecentPlayed(),
      ncm.getUserPlaylists(),
      ncm.getDailyRecommend()
    ]);

    const profile = {
      nickname: userProfile.nickname,
      weekTopSongs: weekRank.slice(0, 15).map(s => `${s.name} - ${s.artist}`),
      allTimeTopSongs: allRank.slice(0, 15).map(s => `${s.name} - ${s.artist}`),
      recentPlayed: recent.slice(0, 15).map(s => `${s.name} - ${s.artist}`),
      playlists: playlists.filter(p => p.isCreator).map(p => p.name),
      dailyRecommend: dailyRec.slice(0, 10).map(s => `${s.name} - ${s.artist}`)
    };

    console.log(`[NCM] 画像生成完毕: ${profile.weekTopSongs.length} 周榜, ${profile.allTimeTopSongs.length} 总榜, ${profile.recentPlayed.length} 最近播放, ${profile.playlists.length} 歌单`);

    return profile;
  },

  // ═══ Resolve playlist ═══
  async resolvePlaylist(songNames) {
    // Step 1: Search all songs in parallel
    const searchResults = await Promise.all(
      songNames.map(name => ncm.search(name, 1).catch(() => []))
    );

    // Filter out songs not found
    const found = searchResults
      .map((results, i) => results.length > 0 ? results[0] : null)
      .filter(Boolean);

    if (found.length === 0) return [];

    // Step 2: Fetch all URLs in parallel
    const withUrls = await Promise.all(
      found.map(async song => {
        const url = await ncm.getSongUrl(song.id).catch(() => null);
        return url ? { ...song, url } : null;
      })
    );

    return withUrls.filter(Boolean);
  }
};

module.exports = ncm;
