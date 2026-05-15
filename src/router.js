const { assembleContext } = require('./context');
const { askClaude } = require('./claude');
const { enqueue } = require('./player');
const state = require('./state');
const broadcast = require('./broadcast');
const ncm = require('./ncm');

async function buildFallbackResult(input) {
  const [daily, recommended] = await Promise.all([
    ncm.getDailyRecommend().catch(() => []),
    ncm.getRecommend(8).catch(() => [])
  ]);

  const seen = new Set();
  const play = [...daily, ...recommended]
    .filter(song => {
      const key = `${song.name} - ${song.artist}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5)
    .map(song => `${song.name} - ${song.artist}`);

  return {
    say: '模型接口暂时没接上，我先不让电台冷场，给你放几首现在能播的。',
    play: play.length ? play : ['晴天 - 周杰伦', '小幸运 - 田馥甄', '红色高跟鞋 - 蔡健雅'],
    reason: `Claude API unavailable; local fallback for: ${input}`,
    segue: ''
  };
}

// Route a user message or scheduled trigger
async function handle(input, triggerType = 'user') {
  console.log(`[Router] Handling: "${input}" (${triggerType})`);

  // Record user message
  if (triggerType === 'user') {
    state.addMessage('user', input);
  }

  broadcast.broadcast({ type: 'thinking', message: 'DJ 正在思考...' });

  try {
    const { systemPrompt } = await assembleContext(input);

    const userMessage = triggerType === 'scheduled'
      ? input
      : `听众说：${input}`;

    // onSay fires as soon as "say" is streamed — broadcast immediately
    const onSay = (say) => {
      state.addMessage('assistant', say);
      broadcast.broadcast({ type: 'dj_say', say });
      console.log('[Router] say (early):', say.slice(0, 60));
    };

    const result = await askClaude(systemPrompt, userMessage, onSay);

    console.log('[Router] Claude result:', JSON.stringify(result).slice(0, 200));

    // If say wasn't streamed early, record it now
    if (result.say && !result._saySentEarly) {
      state.addMessage('assistant', result.say);
    }

    // Enqueue songs and speech
    await enqueue(result);

    return result;
  } catch (err) {
    console.error('[Router] error:', err.message);
    console.warn('[Router] Falling back to local playlist mode');

    try {
      const fallback = await buildFallbackResult(input);
      state.addMessage('assistant', fallback.say);
      broadcast.broadcast({ type: 'dj_say', say: fallback.say });
      await enqueue(fallback);
      return fallback;
    } catch (fallbackErr) {
      console.error('[Router] fallback error:', fallbackErr.message);
      broadcast.broadcast({ type: 'error', message: fallbackErr.message });
      throw fallbackErr;
    }
  }
}

module.exports = { handle };
