const { serveNcmApi } = require('NeteaseCloudMusicApi');

serveNcmApi({
  port: 3001,
  host: '127.0.0.1',
});

console.log('网易云音乐 API 已启动: http://localhost:3001');
