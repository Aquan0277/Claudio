#!/usr/bin/env node
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const projectDir = path.resolve(__dirname, '..');
const pidDir = path.join(projectDir, '.run');
const logDir = path.join(projectDir, 'logs');
const pidFile = path.join(pidDir, 'ai-radio.pid');
const logFile = path.join(logDir, 'ai-radio.log');
const port = Number(process.env.PORT || 8080);

fs.mkdirSync(pidDir, { recursive: true });
fs.mkdirSync(logDir, { recursive: true });

function isRunning(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid() {
  try {
    return Number(fs.readFileSync(pidFile, 'utf-8').trim());
  } catch {
    return 0;
  }
}

function portListening(portNumber) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port: portNumber });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(400, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForPort(portNumber, ms) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < ms) {
    if (await portListening(portNumber)) return true;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return false;
}

function printPortOwner() {
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf-8' });
    process.stdout.write(out);
  } catch {}
}

(async () => {
  const oldPid = readPid();
  if (isRunning(oldPid)) {
    console.log(`AI radio is already running: pid=${oldPid}`);
    console.log(`Open: http://localhost:${port}/?v=4`);
    return;
  }
  if (oldPid) fs.rmSync(pidFile, { force: true });

  if (await portListening(port)) {
    console.error(`Port ${port} is already in use.`);
    printPortOwner();
    process.exit(1);
  }

  const out = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: projectDir,
    detached: true,
    stdio: ['ignore', out, out],
    env: process.env
  });
  child.unref();
  fs.writeFileSync(pidFile, String(child.pid));

  const ready = await waitForPort(port, 7000);
  if (!ready || !isRunning(child.pid)) {
    console.error('Failed to start AI radio. Recent log:');
    try {
      const lines = fs.readFileSync(logFile, 'utf-8').trim().split('\n').slice(-80);
      console.error(lines.join('\n'));
    } catch {}
    fs.rmSync(pidFile, { force: true });
    process.exit(1);
  }

  console.log(`AI radio started: pid=${child.pid}`);
  console.log(`Open: http://localhost:${port}/?v=4`);
  console.log(`Log: ${logFile}`);
})();
