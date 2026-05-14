# xterm

A browser-based terminal emulator powered by [xterm.js](https://xtermjs.org/), connected to a real shell via WebSocket and [node-pty](https://github.com/microsoft/node-pty).

## How it works

- The Node.js server serves the frontend and handles WebSocket connections
- Each connection spawns a real shell process using `node-pty`
- Keyboard input is sent from the browser to the shell; output is streamed back
- Terminal resize events are forwarded so the pty dimensions stay in sync

## Stack

| Layer | Library |
|---|---|
| Terminal UI | [@xterm/xterm](https://www.npmjs.com/package/@xterm/xterm) v6 |
| Terminal resizing | [@xterm/addon-fit](https://www.npmjs.com/package/@xterm/addon-fit) |
| WebSocket server | [ws](https://www.npmjs.com/package/ws) |
| Shell / PTY | [node-pty](https://www.npmjs.com/package/node-pty) |

## Authentication

Access is protected by a password login page. A session cookie is set on successful login and checked on every HTTP request and WebSocket upgrade.

The following environment variables are available:

| Variable | Required | Default | Description |
|---|---|---|---|
| `PASSWORD` | Yes | — | Password for the login page. Server refuses to start without it. |
| `PORT` | No | `3000` | Port the server listens on. |

## Running locally

**Prerequisites:** Node.js, and build tools for node-pty (`python3`, `make`, `g++`).

```bash
npm install
cp .env.example .env  # then edit .env with your password
PASSWORD=your-password node server.js
```

Open [http://localhost:3000](http://localhost:3000).

> **Note:** If `npm install` fails for `node-pty` on a newer Node.js version, force a native compile:
> ```bash
> cd node_modules/node-pty && npx node-gyp rebuild
> ```

## Running with Docker

```bash
docker build -t xterm .
docker run -p 3000:3000 -e PASSWORD=your-password xterm
```

The Docker image installs and compiles `node-pty` from source, so there are no native module compatibility issues.
