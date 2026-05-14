const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');

const PORT = 8080;
const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
};

const server = http.createServer((req, res) => {
  const filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const shell = process.env.SHELL || 'bash';
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: process.env.HOME,
    env: process.env,
  });

  ptyProcess.onData((data) => ws.send(JSON.stringify({ type: 'output', data })));
  ptyProcess.onExit(() => ws.close());

  ws.on('message', (msg) => {
    try {
      const { type, data, cols, rows } = JSON.parse(msg);
      if (type === 'input') ptyProcess.write(data);
      if (type === 'resize') ptyProcess.resize(cols, rows);
    } catch {}
  });

  ws.on('close', () => ptyProcess.kill());
});

server.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
