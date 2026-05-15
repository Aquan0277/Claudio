const cron = require('node-cron');
const { handle } = require('./router');

const TRIGGERS = [
  {
    name: '早晨开播',
    cron: '0 7 * * *',
    message: '现在是早上7点，帮我规划今天早晨的音乐，根据我今天的日程和天气给出适合的曲目'
  },
  {
    name: '上午情绪检查',
    cron: '0 9 * * *',
    message: '早上好，现在9点了，帮我选几首适合上午专注工作的音乐'
  },
  {
    name: '午间换换心情',
    cron: '0 12 * * *',
    message: '午休时间到了，选几首轻松的歌曲休息一下'
  },
  {
    name: '下午提神',
    cron: '0 15 * * *',
    message: '下午三点，容易犯困，帮我选几首提神醒脑的音乐'
  },
  {
    name: '傍晚放松',
    cron: '0 18 * * *',
    message: '下班时间，帮我选些放松减压的音乐，结合今天的天气和心情'
  },
  {
    name: '晚间陪伴',
    cron: '0 21 * * *',
    message: '晚上了，帮我选些适合夜晚安静听的歌曲'
  }
];

function start() {
  TRIGGERS.forEach(({ name, cron: cronExpr, message }) => {
    cron.schedule(cronExpr, async () => {
      console.log(`[Scheduler] Trigger: ${name}`);
      try {
        await handle(message, 'scheduled');
      } catch (err) {
        console.error(`[Scheduler] ${name} failed:`, err.message);
      }
    }, { timezone: 'Asia/Shanghai' });

    console.log(`[Scheduler] Registered: ${name} (${cronExpr})`);
  });
}

module.exports = { start };
