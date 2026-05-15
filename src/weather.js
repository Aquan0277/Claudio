const axios = require('axios');

async function getWeather() {
  const apiKey = process.env.AMAP_WEATHER_KEY;
  const city = process.env.WEATHER_CITY || '440100'; // 广州 adcode

  if (!apiKey) {
    return { description: '天气未配置', temp: null, feels_like: null, humidity: null };
  }

  try {
    const res = await axios.get('https://restapi.amap.com/v3/weather/weatherInfo', {
      params: { key: apiKey, city, extensions: 'base', output: 'JSON' },
      timeout: 5000
    });

    const d = res.data;
    if (d.status !== '1' || !d.lives || d.lives.length === 0) {
      console.error('[Weather] 高德天气返回异常:', JSON.stringify(d).slice(0, 300));
      return { description: '获取失败', temp: null };
    }

    const live = d.lives[0];
    return {
      description: live.weather || '未知',
      temp: parseInt(live.temperature) || null,
      feels_like: null,
      humidity: parseInt(live.humidity) || null,
      windDirection: live.winddirection,
      windPower: live.windpower,
      city: live.city
    };
  } catch (err) {
    console.error('[Weather] error:', err.message);
    return { description: '获取失败', temp: null };
  }
}

module.exports = { getWeather };
