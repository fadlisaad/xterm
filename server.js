const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
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

// Returns { cmd, args } for either a local shell or an SSH connection
function resolveShell(host) {
  if (!host) {
    return { cmd: process.env.SHELL || 'bash', args: [] };
  }
  // Parse user@host:port — port is optional
  const portMatch = host.match(/:(\d+)$/);
  const port = portMatch ? portMatch[1] : null;
  const target = portMatch ? host.slice(0, -portMatch[0].length) : host;
  const args = ['-t', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=no'];
  if (port) args.push('-p', port);
  args.push(target);
  return { cmd: 'ssh', args };
}

const server = http.createServer((req, res) => {
  if (req.url === '/login' || req.url.startsWith('/login?')) {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        const params = new URLSearchParams(body);
        const password = params.get('password');
        if (password === PASSWORD) {
          const host = (params.get('host') || '').trim();
          const cookies = [
            `session=${VALID_TOKEN}; HttpOnly; SameSite=Strict; Path=/`,
            `host=${encodeURIComponent(host)}; HttpOnly; SameSite=Strict; Path=/`,
          ];
          res.writeHead(302, { 'Set-Cookie': cookies, 'Location': '/' });
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

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (!isAuthenticated(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws, req) => {
  const cookies = parseCookies(req.headers.cookie);
  const host = decodeURIComponent(cookies.host || '');
  const { cmd, args } = resolveShell(host);

  const ptyProcess = pty.spawn(cmd, args, {
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
