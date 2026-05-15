(() => {
  'use strict';

  // ── State ──
  const S = {
    isPlaying: false,
    currentSong: null,
    ws: null,
    wsTimer: null,
    currentFile: 'taste.md',
    ttsPlaying: false,
  };

  // ── DOM ──
  const $ = id => document.getElementById(id);
  const audio = $('audioPlayer');
  const ttsAudio = $('ttsPlayer');

  // ═══════════════════════ DOT-MATRIX CLOCK ═══════════════════════
  const DIGIT_MAP = {
    '0': ['01110','10001','10011','10101','11001','10001','01110'],
    '1': ['00100','01100','00100','00100','00100','00100','01110'],
    '2': ['01110','10001','00001','00110','01000','10000','11111'],
    '3': ['01110','10001','00001','00110','00001','10001','01110'],
    '4': ['00010','00110','01010','10010','11111','00010','00010'],
    '5': ['11111','10000','11110','00001','00001','10001','01110'],
    '6': ['00110','01000','10000','11110','10001','10001','01110'],
    '7': ['11111','00001','00010','00100','01000','01000','01000'],
    '8': ['01110','10001','10001','01110','10001','10001','01110'],
    '9': ['01110','10001','10001','01111','00001','00010','01100'],
    ':': ['000','000','010','000','010','000','000'],
  };

  function drawClock() {
    const canvas = $('clockCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const chars = [h[0], h[1], ':', m[0], m[1]];

    const dotR = 2.5;
    const gap = 7;
    const charGap = 10;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let offsetX = 20;
    for (const ch of chars) {
      const grid = DIGIT_MAP[ch];
      if (!grid) continue;
      const cols = grid[0].length;
      for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < cols; c++) {
          const x = offsetX + c * gap;
          const y = 8 + r * gap;
          const on = grid[r][c] === '1';
          ctx.beginPath();
          ctx.arc(x, y, dotR, 0, Math.PI * 2);
          const isLight = document.body.classList.contains('light');
          ctx.fillStyle = on
            ? (isLight ? '#000000' : '#e0e0e0')
            : (isLight ? '#e0e0e0' : '#1a1a1a');
          ctx.fill();
        }
      }
      offsetX += grid[0].length * gap + charGap;
    }

    // Update day/date
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    $('clockDay').textContent = days[now.getDay()];
    $('clockDate').textContent = `${String(now.getDate()).padStart(2,'0')} ${months[now.getMonth()]} ${now.getFullYear()}`;
  }

  drawClock();
  setInterval(drawClock, 1000);

  // ═══════════════════════ WAVEFORM INIT ═══════════════════════
  (function initWaveform() {
    const container = $('waveform');
    for (let i = 0; i < 60; i++) {
      const bar = document.createElement('span');
      const h = 5 + Math.random() * 40;
      bar.style.height = h + 'px';
      bar.style.animationDelay = (Math.random() * 0.5) + 's';
      container.appendChild(bar);
    }
  })();

  // ═══════════════════════ NAVIGATION ═══════════════════════
  $('showProfile').addEventListener('click', () => {
    $('view-main').classList.remove('active');
    $('view-profile').classList.add('active');
    loadProfile();
  });

  $('backFromProfile').addEventListener('click', () => {
    $('view-profile').classList.remove('active');
    $('view-main').classList.add('active');
  });

  // Theme switch
  document.querySelectorAll('.mode-switch .mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-switch .mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.body.className = btn.dataset.theme;
      drawClock();
    });
  });

  // ═══════════════════════ WEBSOCKET ═══════════════════════
  function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    S.ws = new WebSocket(`${proto}//${location.host}`);

    S.ws.onopen = () => {
      $('footerStatus').textContent = 'CONNECTED';
      $('chatLive').textContent = 'LIVE';
      clearTimeout(S.wsTimer);
    };

    S.ws.onmessage = (e) => {
      try { handleMsg(JSON.parse(e.data)); } catch {}
    };

    S.ws.onclose = () => {
      $('footerStatus').textContent = 'RECONNECTING';
      S.wsTimer = setTimeout(connectWS, 3000);
    };
  }

  function handleMsg(msg) {
    switch (msg.type) {
      case 'now_playing': onNowPlaying(msg); break;
      case 'dj_speech': onDJSpeech(msg); break;
      case 'dj_say': onDJSay(msg); break;
      case 'dj_tts':
        if (msg.ttsUrl) playTTS(msg.ttsUrl, msg.say);
        else if (msg.say && msg.say !== lastShownSay) { lastShownSay = msg.say; addDJMessage(msg.say); }
        break;
      case 'queue_updated': onQueueUpdate(msg.queue); break;
      case 'thinking': onThinking(); break;
      case 'idle': break;
      case 'error': addSystemMsg('Error: ' + msg.message); break;
    }
  }

  // ═══════════════════════ PLAYER LOGIC ═══════════════════════

  // Track last DJ say text to avoid duplicate messages
  let lastDJSay = null;
  let lastShownSay = null;   // 最后一次已显示气泡的 say，防止重复

  function onNowPlaying(msg) {
    const { song, say, ttsUrl, queueLength, queue } = msg;
    if (!song) return;

    S.currentSong = song;
    $('playerTitle').textContent = `${song.name} - ${song.artist}`;
    $('playerStatus').textContent = 'PLAYING';
    $('eqBars').classList.add('active');
    renderQueue(queue || []);

    // ── Now Playing Hero ──
    showNowHero(song.name, song.artist);

    // 文字气泡在 playTTS 里统一显示，这里不重复
    lastDJSay = null;

    playAudio(song.url, ttsUrl, say);
  }

  function showNowHero(name, artist) {
    const hero   = $('nowHero');
    const title  = $('nowHeroTitle');
    const art    = $('nowHeroArtist');
    const clock  = $('clockSection');

    // Reset animation so it re-triggers on song change
    hero.classList.remove('visible');
    void hero.offsetWidth; // force reflow

    title.textContent  = name;
    art.textContent    = artist.toUpperCase();

    requestAnimationFrame(() => {
      hero.classList.add('visible');
      clock.classList.add('playing');
    });
  }

  function hideNowHero() {
    $('nowHero').classList.remove('visible');
    $('clockSection').classList.remove('playing');
  }

  function onDJSay(msg) {
    // 先显示文字回复，TTS 慢的时候也不让用户空等。
    if (msg.say) {
      lastDJSay = msg.say;
      if (msg.say !== lastShownSay) {
        lastShownSay = msg.say;
        addDJMessage(msg.say);
      } else {
        removeThinking();
      }
    }
  }

  function onDJSpeech(msg) {
    if (msg.say) {
      addDJMessage(msg.say);
      if (msg.ttsUrl) playTTS(msg.ttsUrl, msg.say);
    }
  }

  function onThinking() {
    addThinkingMsg();
  }

  function onQueueUpdate(queue) {
    renderQueue(queue || []);
  }

  // Queue 折叠状态
  let queueOpen = false;

  $('queueBar').addEventListener('click', () => {
    const list = $('queueList');
    const bar  = $('queueBar');
    if (list.innerHTML === '') return;   // 没内容不展开
    queueOpen = !queueOpen;
    bar.classList.toggle('open', queueOpen);
    list.classList.toggle('open', queueOpen);
    list.style.display = 'flex';        // flex 始终保持，高度由 CSS 控制
  });

  function renderQueue(items) {
    const list  = $('queueList');
    const bar   = $('queueBar');
    const count = (items || []).length;
    $('queueCount').textContent = count ? `${count} TRACK${count !== 1 ? 'S' : ''}` : 'EMPTY';

    if (count === 0) {
      list.innerHTML = '';
      list.classList.remove('open');
      bar.classList.remove('open');
      list.style.display = 'none';
      queueOpen = false;
      return;
    }

    list.style.display = 'flex';
    list.innerHTML = items.map((t, i) => `
      <div class="queue-item">
        <span class="queue-item-num">${i + 1}</span>
        <div class="queue-item-info">
          <span class="queue-item-name">${escHtml(t.name)}</span>
          <span class="queue-item-artist">${escHtml(t.artist)}</span>
        </div>
      </div>`).join('');

    // 有新歌入队时自动展开
    if (!queueOpen) {
      queueOpen = true;
      bar.classList.add('open');
      list.classList.add('open');
    }
  }

  // legacy shim
  function updateQueue(count) {
    $('queueCount').textContent = count ? `${count} TRACK${count !== 1 ? 'S' : ''}` : 'EMPTY';
  }

  async function playAudio(url, ttsUrl, say) {
    if (ttsUrl) {
      // TTS 可用：播放语音，同时在 playTTS 内显示气泡
      await playTTS(ttsUrl, say);
    } else if (say && say !== lastShownSay) {
      // TTS 不可用（合成失败 / subprocess 模式）：直接显示文字气泡
      lastShownSay = say;
      addDJMessage(say);
    }

    if (!url) return;

    audio.src = url;
    audio.volume = parseInt($('volSlider').value) / 100;
    audio.load();

    try {
      await audio.play();
      setPlaying(true);
    } catch (err) {
      setPlaying(false);
      if (err && err.name === 'NotAllowedError') {
        $('playerStatus').textContent = 'TAP TO PLAY';
        addSystemMsg('浏览器阻止了自动播放，点一下播放键就能开始。');
      } else {
        addSystemMsg('播放失败，正在尝试下一首');
        if (S.ws && S.ws.readyState === 1) {
          S.ws.send(JSON.stringify({ type: 'song_ended' }));
        }
      }
    }
  }

  // ── Audio ducking: DJ 说话时音乐压低 ──
  let duckRafId = null;
  const DUCK_TARGET = 0.18;   // TTS 期间音乐降到 18%
  const DUCK_SPEED  = 0.06;   // 每帧步进（越大越快）
  const UNDUCK_SPEED = 0.03;

  function getMusicVol() {
    return parseInt($('volSlider').value) / 100;
  }

  function duckMusic(targetVol, speed, onDone) {
    if (duckRafId) cancelAnimationFrame(duckRafId);
    ;(function step() {
      const cur = audio.volume;
      const diff = targetVol - cur;
      if (Math.abs(diff) < 0.01) {
        audio.volume = targetVol;
        if (onDone) onDone();
        return;
      }
      audio.volume = Math.max(0, Math.min(1, cur + diff * speed * 3));
      duckRafId = requestAnimationFrame(step);
    })();
  }

  function playTTS(url, text) {
    return new Promise(resolve => {
      S.ttsPlaying = true;
      showSpeakingOverlay(text || '');

      // TTS 开始播时，才显示 DJ 文字气泡（文字和声音同步，防重复）
      if (text && text !== lastShownSay) {
        lastShownSay = text;
        addDJMessage(text);
      }

      // 设置 DJ 音量
      ttsAudio.volume = parseInt($('djVolSlider').value) / 100;
      ttsAudio.src = url;

      // 音乐先压低再播 TTS
      duckMusic(DUCK_TARGET, DUCK_SPEED, () => {
        ttsAudio.play().catch(() => {});
      });

      const finish = () => {
        S.ttsPlaying = false;
        hideSpeakingOverlay();
        // 音乐淡回正常音量
        duckMusic(getMusicVol(), UNDUCK_SPEED);
        resolve();
      };

      ttsAudio.onended = finish;
      ttsAudio.onerror = finish;
      setTimeout(finish, 15000);
    });
  }

  function setPlaying(playing) {
    S.isPlaying = playing;
    $('btnPlayPause').textContent = playing ? '⏸' : '▶';
    $('playerStatus').textContent = playing ? 'PLAYING' : 'PAUSED';
    $('eqBars').classList.toggle('active', playing);
    $('onAirStatus').innerHTML = playing
      ? '<span class="on-air-dot"></span> ON AIR'
      : '<span class="on-air-dot" style="background:#666;box-shadow:none"></span> OFF AIR';

    if (!playing) hideNowHero();
  }

  // Audio events
  audio.addEventListener('timeupdate', () => {
    if (!audio.duration) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    $('progressFill').style.width = pct + '%';
    $('progressKnob').style.left = pct + '%';
    $('currentTime').textContent = fmtTime(audio.currentTime);
    $('totalTime').textContent = fmtTime(audio.duration);
  });

  audio.addEventListener('ended', () => {
    setPlaying(false);
    if (S.ws && S.ws.readyState === 1) {
      S.ws.send(JSON.stringify({ type: 'song_ended' }));
    }
  });

  audio.addEventListener('error', () => {
    setPlaying(false);
    addSystemMsg('当前音频链接失效，正在切下一首...');
    if (S.ws && S.ws.readyState === 1) {
      S.ws.send(JSON.stringify({ type: 'song_ended' }));
    }
  });

  audio.addEventListener('play', () => setPlaying(true));
  audio.addEventListener('pause', () => setPlaying(false));

  // Progress bar seek
  $('progressBar').addEventListener('click', (e) => {
    if (!audio.duration) return;
    const rect = $('progressBar').getBoundingClientRect();
    audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
  });

  // Volume
  $('volSlider').addEventListener('input', (e) => {
    // 如果 TTS 正在播放，不改实际音量（ducking 中），只改滑块记录值
    if (!S.ttsPlaying) {
      audio.volume = parseInt(e.target.value) / 100;
    }
  });

  $('djVolSlider').addEventListener('input', (e) => {
    ttsAudio.volume = parseInt(e.target.value) / 100;
  });

  // Controls
  $('btnPlayPause').addEventListener('click', () => {
    if (!audio.src || audio.src === location.href) {
      sendChat('帮我选几首好歌播放');
      return;
    }
    if (audio.paused) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
      ttsAudio.pause();
    }
  });

  $('btnPrev').addEventListener('click', () => {
    audio.currentTime = 0;
  });

  $('btnNext').addEventListener('click', () => {
    audio.dispatchEvent(new Event('ended'));
  });

  $('btnStop').addEventListener('click', () => {
    audio.pause();
    audio.currentTime = 0;
    ttsAudio.pause();
    ttsAudio.currentTime = 0;
    setPlaying(false);
  });

  $('btnHeart').addEventListener('click', () => {
    $('btnHeart').classList.toggle('liked');
    $('btnHeart').textContent = $('btnHeart').classList.contains('liked') ? '♥' : '♡';
  });

  // ═══════════════════════ CHAT ═══════════════════════
  function addDJMessage(text, song) {
    removeThinking();
    const container = $('chatMessages');
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

    const el = document.createElement('div');
    el.className = 'msg-dj';
    el.innerHTML = `
      <div class="msg-avatar"></div>
      <div class="msg-body">
        <div class="msg-sender">CLAUDIO</div>
        <div class="msg-text">${escHtml(text)}</div>
        ${song ? `<div class="msg-now-playing">Now playing: ${escHtml(song.name)} - ${escHtml(song.artist)}</div>` : ''}
        <div class="msg-time">
          <span>${time}</span>
          <span class="msg-replay">▶ REPLAY</span>
        </div>
      </div>
    `;
    container.appendChild(el);
    scrollChat();
  }

  function addDJMessageWithSongs(text, songs) {
    removeThinking();
    const container = $('chatMessages');
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

    let songsHtml = '';
    if (songs && songs.length > 0) {
      songsHtml = '<div class="msg-songs">' + songs.map((s, i) => {
        const parts = s.split(' - ');
        const title = parts[0] || s;
        const artist = parts[1] || '';
        return `<div class="msg-song-item${i === 0 ? ' current' : ''}" data-query="${escHtml(s)}">
          <span class="song-icon">${i === 0 ? '★' : '♪'}</span>
          <span><span class="song-item-title">${escHtml(title)}</span> <span class="song-item-artist">${escHtml(artist)}</span></span>
        </div>`;
      }).join('') + '</div>';
    }

    const el = document.createElement('div');
    el.className = 'msg-dj';
    el.innerHTML = `
      <div class="msg-avatar"></div>
      <div class="msg-body">
        <div class="msg-sender">CLAUDIO</div>
        <div class="msg-text">${escHtml(text)}</div>
        ${songsHtml}
        <div class="msg-time">
          <span>${time}</span>
          <span class="msg-replay">▶ REPLAY</span>
        </div>
      </div>
    `;
    container.appendChild(el);
    scrollChat();
  }

  function addUserMessage(text) {
    const container = $('chatMessages');
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

    const el = document.createElement('div');
    el.className = 'msg-user';
    el.innerHTML = `
      <div class="msg-avatar user-avatar"></div>
      <div class="msg-body">
        <div class="msg-sender">YOU</div>
        <div class="msg-text">${escHtml(text)}</div>
        <div class="msg-time"><span>${time}</span></div>
      </div>
    `;
    container.appendChild(el);
    scrollChat();
  }

  function addSystemMsg(text) {
    const el = document.createElement('div');
    el.className = 'chat-system';
    el.textContent = text;
    $('chatMessages').appendChild(el);
    scrollChat();
  }

  function addThinkingMsg() {
    removeThinking();
    const el = document.createElement('div');
    el.className = 'msg-dj thinking-msg';
    el.innerHTML = `
      <div class="msg-avatar"></div>
      <div class="msg-body">
        <div class="msg-sender">CLAUDIO</div>
        <div class="msg-text"><span class="thinking-dots">Thinking</span></div>
      </div>
    `;
    $('chatMessages').appendChild(el);
    scrollChat();
  }

  function removeThinking() {
    document.querySelectorAll('.thinking-msg').forEach(el => el.remove());
  }

  function scrollChat() {
    const c = $('chatMessages');
    setTimeout(() => c.scrollTop = c.scrollHeight, 50);
  }

  // Chat input
  $('chatInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('chatSend').click();
    }
  });

  $('chatSend').addEventListener('click', () => {
    const msg = $('chatInput').value.trim();
    if (!msg) return;
    $('chatInput').value = '';
    addUserMessage(msg);
    sendChat(msg);
  });

  async function sendChat(message) {
    try {
      await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });
    } catch {
      addSystemMsg('发送失败，请检查服务器连接');
    }
  }

  // ═══════════════════════ SPEAKING OVERLAY ═══════════════════════
  function showSpeakingOverlay(text) {
    // Show inline waveform in chat header
    $('chatHeader').classList.add('speaking');

    // Keep legacy overlay updated but don't show it
    if (S.currentSong) {
      $('speakingTitle').textContent = S.currentSong.name || '—';
      $('speakingSubtitle').textContent = S.currentSong.artist || '—';
    }
  }

  function hideSpeakingOverlay() {
    $('chatHeader').classList.remove('speaking');
    $('speakingOverlay').classList.remove('active');
  }

  $('speakingOverlay').addEventListener('click', (e) => {
    if (e.target === $('speakingOverlay')) {
      hideSpeakingOverlay();
    }
  });

  // ═══════════════════════ PROFILE ═══════════════════════
  async function loadProfile() {
    try {
      const res = await fetch('/api/taste');
      const files = await res.json();

      // Show current file
      $('tasteEditor').value = files[S.currentFile] || '';

      // Extract tags from taste.md
      const taste = files['taste.md'] || '';
      const tags = [];
      const lines = taste.split('\n');
      for (const line of lines) {
        const m = line.match(/^-\s+(.+)/);
        if (m && m[1].length < 30) tags.push(m[1]);
      }

      $('profileTags').innerHTML = tags.slice(0, 12).map(t =>
        `<span class="tag">${escHtml(t)}</span>`
      ).join('');
    } catch {}

    // Check NCM login status
    checkNcmStatus();
  }

  document.querySelectorAll('.taste-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.taste-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      S.currentFile = btn.dataset.file;
      loadProfile();
    });
  });

  $('tasteSave').addEventListener('click', async () => {
    try {
      await fetch('/api/taste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: S.currentFile, content: $('tasteEditor').value })
      });
      $('tasteStatus').textContent = 'Saved ✓';
      setTimeout(() => $('tasteStatus').textContent = '', 2000);
    } catch {
      $('tasteStatus').textContent = 'Failed';
    }
  });

  // ═══════════════════════ NCM QR LOGIN ═══════════════════════
  let qrPollTimer = null;

  async function checkNcmStatus() {
    try {
      const res = await fetch('/api/settings');
      const d = await res.json();
      const el = $('ncmStatus');
      if (d.ncmLoggedIn) {
        el.textContent = '✅ 已登录: ' + d.ncmUser;
        el.className = 'ncm-status ok';
        $('ncmLoginBtn').style.display = 'none';
        $('ncmQrWrap').style.display = 'none';
      } else {
        el.textContent = '未登录 — 点击下方按钮扫码登录';
        el.className = 'ncm-status';
        $('ncmLoginBtn').style.display = '';
      }
    } catch {}
  }

  $('ncmLoginBtn').addEventListener('click', async () => {
    const btn = $('ncmLoginBtn');
    btn.disabled = true;
    btn.textContent = '生成中...';

    try {
      const res = await fetch('/api/ncm/qr');
      const data = await res.json();
      if (data.qrimg) {
        $('ncmQrImg').src = data.qrimg;
        $('ncmQrWrap').style.display = '';
        $('ncmQrStatus').textContent = '等待扫码...';
        $('ncmQrStatus').className = 'ncm-qr-status';
        btn.textContent = '刷新二维码';
        btn.disabled = false;
        startQrPoll(data.key);
      } else {
        btn.textContent = '生成失败，重试';
        btn.disabled = false;
      }
    } catch {
      btn.textContent = '网络错误，重试';
      btn.disabled = false;
    }
  });

  function startQrPoll(key) {
    clearInterval(qrPollTimer);
    qrPollTimer = setInterval(async () => {
      try {
        const res = await fetch('/api/ncm/qr/check?key=' + encodeURIComponent(key));
        const data = await res.json();
        const el = $('ncmQrStatus');

        if (data.status === 'scanned') {
          el.textContent = '已扫码，请在手机上确认...';
          el.className = 'ncm-qr-status scanned';
        } else if (data.status === 'success') {
          el.textContent = '✅ 登录成功: ' + (data.nickname || '');
          el.className = 'ncm-qr-status success';
          clearInterval(qrPollTimer);
          setTimeout(() => {
            $('ncmQrWrap').style.display = 'none';
            checkNcmStatus();
          }, 1500);
        } else if (data.status === 'expired') {
          el.textContent = '二维码已过期，请重新生成';
          el.className = 'ncm-qr-status';
          clearInterval(qrPollTimer);
        }
      } catch {}
    }, 2000);
  }

  // ═══════════════════════ HELPERS ═══════════════════════
  function fmtTime(s) {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ═══════════════════════ BREATHING LIGHT ═══════════════════════
  ;(function() {
    const app = document.getElementById('app');
    let audioCtx  = null;
    let analyser  = null;
    let rafId     = null;
    let peak      = 0;
    let beatReady = false;

    // ── captureStream：只窃听分析，不影响音频输出 ──
    function initBeat() {
      if (beatReady) return;
      try {
        const stream = audio.captureStream
          ? audio.captureStream()
          : audio.mozCaptureStream
            ? audio.mozCaptureStream()
            : null;
        if (!stream) return;

        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;               // 更小 = 响应更快
        analyser.smoothingTimeConstant = 0.55; // 低平滑 = 跟得上节拍

        audioCtx.createMediaStreamSource(stream).connect(analyser);
        beatReady = true;
      } catch (e) {
        console.warn('[Glow] initBeat failed:', e.message);
      }
    }

    // ── 切歌重置 ──
    audio.addEventListener('loadedmetadata', () => {
      beatReady = false;
      audioCtx  = null;
      analyser  = null;
      stopLoop();
    });

    // ── rAF 节拍循环 ──
    function startLoop() {
      if (rafId || !analyser) return;
      const data = new Uint8Array(analyser.frequencyBinCount);

      ;(function tick() {
        rafId = requestAnimationFrame(tick);
        analyser.getByteFrequencyData(data);

        // Bass 能量：前 15% 频段（~20-200 Hz）
        const hi = Math.max(3, Math.floor(data.length * 0.15));
        let sum = 0;
        for (let i = 1; i < hi; i++) sum += data[i];
        const bass = sum / (hi - 1) / 255;

        // 极快攻击（抓住鼓点）+ 适中衰减
        peak = bass > peak
          ? bass * 0.92 + peak * 0.08
          : peak * 0.80;

        applyGlow(peak);
      })();
    }

    function stopLoop() {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      peak = 0;
      // 暂停/停止时完全熄灭，不留任何动画
      app.style.boxShadow = '';
      app.classList.remove('glow-idle', 'glow-beat');
    }

    function applyGlow(v) {
      if (v < 0.02) {
        // 静音段：回到慢呼吸
        app.style.boxShadow = '';
        app.classList.add('glow-idle');
        return;
      }
      app.classList.remove('glow-idle', 'glow-beat');
      const g1 = (6  + v * 28).toFixed(0);
      const g2 = (14 + v * 55).toFixed(0);
      const a1 = (0.07 + v * 0.38).toFixed(2);
      const a2 = (0.02 + v * 0.12).toFixed(2);
      app.style.boxShadow =
        `0 0 ${g1}px 3px rgba(74,222,128,${a1}),` +
        `0 0 ${g2}px 8px rgba(74,222,128,${a2})`;
    }

    // ── 音频事件 ──
    audio.addEventListener('play', () => {
      app.classList.remove('glow-idle', 'glow-beat');
      initBeat();
      if (beatReady) {
        startLoop();
      } else {
        app.classList.add('glow-beat'); // 降级 CSS 动画
      }
    });

    audio.addEventListener('pause', () => {
      stopLoop(); // 暂停立即熄灭，不留残影
    });

    audio.addEventListener('ended', () => {
      // 等 loadedmetadata 重置，不手动停
    });

    // 初始慢呼吸
    app.classList.add('glow-idle');
  })();

  // ═══════════════════════ INIT ═══════════════════════
  connectWS();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
})();
