const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');

const PORT = 8080;
const PASSWORD = process.env.PASSWORD;

if (!PASSWORD) {
  console.error('ERROR: PASSWORD environment variable is required');
  process.exit(1);
}

// Derive a stable token from the password so sessions survive restarts
const SESSION_SECRET = crypto.createHmac('sha256', 'xterm-v1').update(PASSWORD).digest('hex');
const VALID_TOKEN = crypto.createHmac('sha256', SESSION_SECRET).update('session').digest('hex');

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
};

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').flatMap(part => {
      const [k, ...v] = part.trim().split('=');
      return k ? [[k, v.join('=')]] : [];
    })
  );
}

function isAuthenticated(req) {
  try {
    const token = parseCookies(req.headers.cookie).session || '';
    if (token.length !== VALID_TOKEN.length) return false;
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(VALID_TOKEN));
  } catch {
    return false;
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/login' || req.url.startsWith('/login?')) {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        const password = new URLSearchParams(body).get('password');
        if (password === PASSWORD) {
          res.writeHead(302, {
            'Set-Cookie': `session=${VALID_TOKEN}; HttpOnly; SameSite=Strict; Path=/`,
            'Location': '/',
          });
        } else {
          res.writeHead(302, { 'Location': '/login?error=1' });
        }
        res.end();
      });
      return;
    }
    fs.readFile(path.join(__dirname, 'login.html'), (err, data) => {
      if (err) { res.writeHead(500); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  if (!isAuthenticated(req)) {
    res.writeHead(302, { 'Location': '/login' });
    res.end();
    return;
  }

  const filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// Handle WebSocket upgrades manually so we can auth-gate them
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (!isAuthenticated(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

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
