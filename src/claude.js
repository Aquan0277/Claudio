const { spawn } = require('child_process');
const https = require('https');
const http = require('http');

let apiBackoffUntil = 0;
let apiBackoffReason = '';

async function askClaude(systemPrompt, userMessage, onSay = null) {
  const mode = process.env.CLAUDE_MODE || 'subprocess';

  if (mode === 'api' && process.env.ANTHROPIC_API_KEY) {
    return await askViaApi(systemPrompt, userMessage, onSay);
  }

  // Try subprocess first; if it fails (not logged in), fall back to API
  try {
    return await askViaSubprocess(systemPrompt, userMessage);
  } catch (err) {
    if (process.env.ANTHROPIC_API_KEY) {
      console.warn('[Claude] subprocess failed, falling back to API mode:', err.message);
      return await askViaApi(systemPrompt, userMessage, onSay);
    }
    throw err;
  }
}

async function askViaSubprocess(systemPrompt, userMessage) {
  return new Promise((resolve, reject) => {
    const fullPrompt = `${systemPrompt}\n\n---\n\n用户消息：${userMessage}`;

    const proc = spawn('claude', ['-p', fullPrompt, '--output-format', 'json'], {
      env: { ...process.env },
      timeout: 60000
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Claude exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        const envelope = JSON.parse(stdout.trim());

        if (envelope.is_error || (envelope.result && envelope.result.includes('Not logged in'))) {
          reject(new Error(envelope.result || 'Claude not logged in'));
          return;
        }

        const text = envelope.result || envelope.content || stdout;
        resolve(extractJSON(text));
      } catch {
        try {
          resolve(extractJSON(stdout));
        } catch {
          console.error('[Claude] parse error. Raw:', stdout.slice(0, 500));
          reject(new Error('Failed to parse Claude response'));
        }
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });
  });
}

async function askViaApi(systemPrompt, userMessage, onSay = null) {
  if (Date.now() < apiBackoffUntil) {
    throw new Error(`Claude API temporarily unavailable: ${apiBackoffReason}`);
  }

  try {
    return await askViaApiStream(systemPrompt, userMessage, onSay);
  } catch (err) {
    console.warn('[Claude API] stream failed, retrying non-stream:', err.message);
    try {
      return await askViaApiOnce(systemPrompt, userMessage, onSay);
    } catch (fallbackErr) {
      apiBackoffUntil = Date.now() + 5 * 60 * 1000;
      apiBackoffReason = fallbackErr.message.slice(0, 160);
      throw fallbackErr;
    }
  }
}

function apiRequest(parsed, apiKey, body, label) {
  const transport = parsed.protocol === 'http:' ? http : https;

  return new Promise((resolve, reject) => {
    const req = transport.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: (parsed.pathname === '/' ? '' : parsed.pathname) + '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      timeout: 60000
    }, (res) => {
      let rawBody = '';
      res.on('data', chunk => {
        rawBody += chunk.toString();
      });

      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${label} HTTP ${res.statusCode}: ${rawBody.slice(0, 300)}`));
          return;
        }
        resolve(rawBody);
      });

      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`${label} timeout`)); });
    req.write(body);
    req.end();
  });
}

function extractTextFromMessage(json) {
  if (typeof json === 'string') return json;
  if (typeof json?.content === 'string') return json.content;
  if (Array.isArray(json?.content)) {
    return json.content.map(block => block.text || '').join('');
  }
  if (json?.completion) return json.completion;
  if (json?.choices?.[0]?.message?.content) return json.choices[0].message.content;
  if (json?.choices?.[0]?.text) return json.choices[0].text;
  return '';
}

function maybeSendSay(text, onSay) {
  if (!onSay) return false;
  const m = text.match(/"say"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!m) return false;
  const sayText = m[1]
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
  onSay(sayText);
  return true;
}

// Streaming API — calls onSay(text) as soon as "say" field is complete
async function askViaApiStream(systemPrompt, userMessage, onSay = null) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const baseUrl = process.env.API_BASE_URL || 'https://api.anthropic.com';
  const model   = process.env.API_MODEL || 'claude-sonnet-4-6';
  const parsed  = new URL(baseUrl);

  const body = JSON.stringify({
    model,
    max_tokens: 800,
    stream: true,                    // ← streaming ON
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }]
  });

  console.log(`[Claude API] → ${parsed.hostname} model=${model} (stream)`);

  return new Promise((resolve, reject) => {
    const transport = parsed.protocol === 'http:' ? http : https;
    const req = transport.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: (parsed.pathname === '/' ? '' : parsed.pathname) + '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      timeout: 60000
    }, (res) => {
      let accumulated = '';
      let rawBody     = '';
      let sseBuffer   = '';
      let saySent     = false;

      res.on('data', chunk => {
        const chunkText = chunk.toString();
        rawBody += chunkText;
        sseBuffer += chunkText;
        const lines = sseBuffer.split('\n');
        sseBuffer   = lines.pop();           // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') continue;
          try {
            const evt = JSON.parse(raw);
            if (evt.type === 'content_block_delta' && evt.delta?.text) {
              accumulated += evt.delta.text;

              // Fire onSay as soon as the "say" field is fully streamed
              if (!saySent && onSay) {
                const m = accumulated.match(/"say"\s*:\s*"((?:[^"\\]|\\.)*)"/);
                if (m) {
                  saySent = true;
                  const sayText = m[1]
                    .replace(/\\n/g, '\n')
                    .replace(/\\"/g, '"')
                    .replace(/\\\\/g, '\\');
                  onSay(sayText);
                }
              }
            }
          } catch {}
        }
      });

      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`stream HTTP ${res.statusCode}: ${rawBody.slice(0, 300)}`));
          return;
        }

        try {
          if (!accumulated.trim() && rawBody.trim()) {
            const json = JSON.parse(rawBody);
            accumulated = extractTextFromMessage(json);
            saySent = maybeSendSay(accumulated, onSay);
          }
          if (!accumulated.trim()) throw new Error('empty API response');
          const result = extractJSON(accumulated);
          result._saySentEarly = saySent;  // flag: say already broadcast
          resolve(result);
        } catch (err) {
          console.error('[Claude API] parse error. Raw:', (accumulated || rawBody).slice(0, 500));
          reject(err);
        }
      });

      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('API timeout')); });
    req.write(body);
    req.end();
  });
}

async function askViaApiOnce(systemPrompt, userMessage, onSay = null) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const baseUrl = process.env.API_BASE_URL || 'https://api.anthropic.com';
  const model   = process.env.API_MODEL || 'claude-sonnet-4-6';
  const parsed  = new URL(baseUrl);

  const body = JSON.stringify({
    model,
    max_tokens: 800,
    stream: false,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }]
  });

  console.log(`[Claude API] → ${parsed.hostname} model=${model} (non-stream)`);

  const rawBody = await apiRequest(parsed, apiKey, body, 'non-stream');
  const json = JSON.parse(rawBody);
  const text = extractTextFromMessage(json);
  const saySent = maybeSendSay(text, onSay);
  const result = extractJSON(text);
  result._saySentEarly = saySent;
  return result;
}

function extractJSON(text) {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) ||
                    text.match(/```\s*([\s\S]*?)\s*```/) ||
                    text.match(/(\{[\s\S]*\})/);

  const jsonStr = jsonMatch ? jsonMatch[1] : text.trim();
  const parsed = JSON.parse(jsonStr);

  return {
    say: parsed.say || '',
    play: Array.isArray(parsed.play) ? parsed.play : [],
    reason: parsed.reason || '',
    segue: parsed.segue || ''
  };
}

module.exports = { askClaude };
