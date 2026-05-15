const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { v4: uuidv4 } = require('uuid');

const CACHE_DIR = path.join(__dirname, '..', 'cache', 'tts');

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function getCacheKey(text, voiceId) {
  return crypto.createHash('md5').update(`${voiceId}:${text}`).digest('hex');
}

async function synthesize(text) {
  const appId = process.env.VOLC_APP_ID;
  const token = process.env.VOLC_ACCESS_TOKEN;
  const voiceId = process.env.VOLC_VOICE_ID || 'BV701_streaming';

  if (!appId || !token) {
    console.warn('[TTS] 火山引擎凭据未配置，跳过语音合成');
    return null;
  }

  const hash = getCacheKey(text, voiceId);
  const cachePath = path.join(CACHE_DIR, `${hash}.mp3`);

  if (fs.existsSync(cachePath)) {
    console.log('[TTS] cache hit:', hash);
    return `/tts/${hash}.mp3`;
  }

  try {
    const audioData = await volcTTS(appId, token, voiceId, text);
    fs.writeFileSync(cachePath, audioData);
    console.log(`[TTS] 合成成功: ${hash} (${text.length} 字)`);
    return `/tts/${hash}.mp3`;
  } catch (err) {
    console.error('[TTS] 合成失败:', err.message);
    return null;
  }
}

function volcTTS(appId, token, voiceId, text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      app: {
        appid: appId,
        token: 'access_token',
        cluster: 'volcano_tts'
      },
      user: {
        uid: 'ai-radio-dj'
      },
      audio: {
        voice_type: voiceId,
        encoding: 'mp3',
        speed_ratio: 1.0,
        volume_ratio: 1.0,
        pitch_ratio: 1.0
      },
      request: {
        reqid: uuidv4(),
        text: text,
        text_type: 'plain',
        operation: 'query'
      }
    });

    const req = https.request({
      hostname: 'openspeech.bytedance.com',
      path: '/api/v1/tts',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer;${token}`,
      },
      timeout: 30000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.code !== 3000) {
            reject(new Error(`火山TTS错误 [${json.code}]: ${json.message || JSON.stringify(json)}`));
            return;
          }
          const audioBase64 = json.data;
          if (!audioBase64) {
            reject(new Error('返回数据中无音频'));
            return;
          }
          resolve(Buffer.from(audioBase64, 'base64'));
        } catch (err) {
          reject(new Error('解析火山TTS响应失败: ' + data.slice(0, 300)));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('火山TTS超时')); });
    req.write(body);
    req.end();
  });
}

module.exports = { synthesize, CACHE_DIR };
