let wss = null;

function init(websocketServer) {
  wss = websocketServer;
}

function broadcast(data) {
  if (!wss) return;
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) { // OPEN
      client.send(msg);
    }
  });
}

module.exports = { init, broadcast };
