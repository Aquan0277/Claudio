const fs = require('fs');
const path = require('path');

const STATE_PATH = path.join(__dirname, '..', 'state.json');

const DEFAULT = {
  messages: [],
  plays: [],
  prefs: {},
  plan: {}
};

function load() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
  } catch {
    return { ...DEFAULT };
  }
}

function save(data) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

const state = {
  addMessage(role, content) {
    const data = load();
    data.messages.push({ role, content, created_at: Math.floor(Date.now() / 1000) });
    if (data.messages.length > 50) data.messages = data.messages.slice(-50);
    save(data);
  },

  getRecentMessages(limit = 10) {
    const data = load();
    return data.messages.slice(-limit);
  },

  recordPlay(songName, artist, songId) {
    const data = load();
    data.plays.push({ song_name: songName, artist, song_id: songId || null, played_at: Math.floor(Date.now() / 1000) });
    if (data.plays.length > 200) data.plays = data.plays.slice(-200);
    save(data);
  },

  getRecentPlays(limit = 20) {
    const data = load();
    return data.plays.slice(-limit).reverse();
  },

  getTodayPlays() {
    const data = load();
    const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
    return data.plays.filter(p => p.played_at >= todayStart);
  },

  setPref(key, value) {
    const data = load();
    data.prefs[key] = value;
    save(data);
  },

  getPref(key, defaultValue = null) {
    const data = load();
    return key in data.prefs ? data.prefs[key] : defaultValue;
  },

  savePlan(date, content) {
    const data = load();
    data.plan[date] = content;
    save(data);
  },

  getPlan(date) {
    const data = load();
    return data.plan[date] || null;
  }
};

module.exports = state;
