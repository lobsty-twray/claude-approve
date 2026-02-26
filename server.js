#!/usr/bin/env node

/**
 * Claude Approve - Web companion for Claude Code tool approval
 * 
 * Wraps Claude Code in a PTY, serves a web UI, and allows
 * approving/denying tool requests from either the terminal or browser.
 */

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const PermissionDetector = require('./lib/detector');

let pty;
try {
  pty = require('node-pty');
} catch (e) {
  console.error('Error: node-pty not installed. Run: npm install');
  console.error('node-pty requires build tools: python3, make, g++');
  process.exit(1);
}

// --- Configuration ---
const config = {
  port: parseInt(process.env.PORT || '3456'),
  host: process.env.HOST || '0.0.0.0',
  command: process.env.CLAUDE_COMMAND || 'claude',
  args: [],
  cwd: process.env.CLAUDE_CWD || process.cwd(),
  shell: process.env.SHELL || '/bin/bash',
  idleThresholdMs: parseInt(process.env.IDLE_THRESHOLD || '400'),
  token: process.env.AUTH_TOKEN || null,
};

// Parse CLI args
const cliArgs = process.argv.slice(2);
for (let i = 0; i < cliArgs.length; i++) {
  switch (cliArgs[i]) {
    case '--port':
    case '-p':
      config.port = parseInt(cliArgs[++i]);
      break;
    case '--host':
    case '-h':
      if (cliArgs[i + 1] && !cliArgs[i + 1].startsWith('-')) {
        config.host = cliArgs[++i];
      } else {
        console.log(`
Claude Approve v1.0.0 — Web companion for Claude Code tool approval

Usage:
  claude-approve [options] [-- claude-args...]

Options:
  --port, -p <port>        Web UI port (default: 3456)
  --host <host>            Bind address (default: 0.0.0.0)
  --command, -c <cmd>      Command to run (default: claude)
  --cwd <dir>              Working directory (default: current)
  --token <token>          Auth token for web UI
  --help, -h               Show this help

Environment Variables:
  PORT                     Web UI port
  CLAUDE_COMMAND           Command to wrap
  CLAUDE_CWD               Working directory
  AUTH_TOKEN               Auth token for web UI
  IDLE_THRESHOLD           Permission detection idle threshold (ms)

Examples:
  claude-approve                         # Start with defaults
  claude-approve -p 8080                 # Custom port
  claude-approve -c "bash test/mock-claude.sh"  # Use mock for testing
  claude-approve -- --model sonnet       # Pass args to claude
`);
        process.exit(0);
      }
      break;
    case '--command':
    case '-c':
      config.command = cliArgs[++i];
      break;
    case '--cwd':
      config.cwd = cliArgs[++i];
      break;
    case '--token':
      config.token = cliArgs[++i];
      break;
    case '--':
      config.args = cliArgs.slice(i + 1);
      i = cliArgs.length;
      break;
    default:
      if (!cliArgs[i].startsWith('-')) {
        config.args.push(cliArgs[i]);
      }
      break;
  }
}

// --- State ---
let ptyProcess = null;
let sessionActive = false;
let sessionStartTime = null;
const clients = new Set();
const permissionHistory = [];

// --- Express App ---
const app = express();
const server = http.createServer(app);

// Auth middleware
if (config.token) {
  app.use((req, res, next) => {
    if (req.path === '/health') return next();
    const token = req.query.token || req.headers['authorization']?.replace('Bearer ', '');
    if (token !== config.token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  });
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', sessionActive, uptime: process.uptime() });
});

app.get('/api/session', (req, res) => {
  res.json({
    active: sessionActive,
    startTime: sessionStartTime,
    command: config.command,
    cwd: config.cwd,
    pendingRequest: detector.getPendingRequest(),
    history: permissionHistory.slice(-50),
  });
});

// --- Permission Detector ---
const detector = new PermissionDetector({
  idleThresholdMs: config.idleThresholdMs,
  onPermissionDetected: (request) => {
    console.log(`\n🔔 Permission request detected: ${request.tool}`);
    permissionHistory.push({ ...request, status: 'pending' });
    broadcast({ type: 'permission', request });
  },
  onPermissionResolved: (resolved) => {
    const entry = permissionHistory.find(h => h.id === resolved.id);
    if (entry) entry.status = `resolved (${resolved.resolvedBy})`;
    broadcast({ type: 'permission-resolved', id: resolved.id, resolvedBy: resolved.resolvedBy });
  },
});

// --- WebSocket Server ---
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  // Auth check for WebSocket
  if (config.token) {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    if (token !== config.token) {
      ws.close(4001, 'Unauthorized');
      return;
    }
  }

  clients.add(ws);
  console.log(`🌐 Web client connected (${clients.size} total)`);

  // Send current state
  ws.send(JSON.stringify({
    type: 'session-info',
    active: sessionActive,
    startTime: sessionStartTime,
    command: config.command,
    cwd: config.cwd,
  }));

  // Send pending request if any
  const pending = detector.getPendingRequest();
  if (pending) {
    ws.send(JSON.stringify({ type: 'permission', request: pending }));
  }

  // Send recent history
  ws.send(JSON.stringify({
    type: 'history',
    permissions: permissionHistory.slice(-20),
  }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      handleClientMessage(msg, ws);
    } catch (e) {
      console.error('Invalid message:', e.message);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`🌐 Web client disconnected (${clients.size} remaining)`);
  });
});

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(data);
    }
  }
}

function handleClientMessage(msg, ws) {
  switch (msg.type) {
    case 'input':
      // Forward terminal input from web client
      if (ptyProcess && sessionActive) {
        ptyProcess.write(msg.data);
      }
      break;

    case 'approve':
      if (ptyProcess && sessionActive && detector.getPendingRequest()) {
        console.log('✅ Approved from web UI');
        ptyProcess.write('y');
        detector.resolveCurrentRequest('web-approve');
        updateHistoryStatus(msg.id, 'approved (web)');
      }
      break;

    case 'deny':
      if (ptyProcess && sessionActive && detector.getPendingRequest()) {
        console.log('❌ Denied from web UI');
        ptyProcess.write('n');
        detector.resolveCurrentRequest('web-deny');
        updateHistoryStatus(msg.id, 'denied (web)');
      }
      break;

    case 'always':
      if (ptyProcess && sessionActive && detector.getPendingRequest()) {
        console.log('✅ Always allowed from web UI');
        ptyProcess.write('a');
        detector.resolveCurrentRequest('web-always');
        updateHistoryStatus(msg.id, 'always (web)');
      }
      break;

    case 'resize':
      if (ptyProcess && sessionActive && msg.cols && msg.rows) {
        ptyProcess.resize(msg.cols, msg.rows);
      }
      break;

    case 'restart':
      startSession();
      break;
  }
}

function updateHistoryStatus(id, status) {
  const entry = permissionHistory.find(h => h.id === id);
  if (entry) entry.status = status;
}

// --- PTY Session ---
function startSession() {
  if (ptyProcess) {
    try { ptyProcess.kill(); } catch (e) {}
  }

  detector.reset();

  // Parse command - handle quoted commands with spaces
  let cmd, args;
  if (config.command.includes(' ')) {
    const parts = config.command.split(/\s+/);
    cmd = parts[0];
    args = [...parts.slice(1), ...config.args];
  } else {
    cmd = config.command;
    args = [...config.args];
  }

  console.log(`\n🚀 Starting session: ${cmd} ${args.join(' ')}`);
  console.log(`📁 Working directory: ${config.cwd}`);

  try {
    ptyProcess = pty.spawn(cmd, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: config.cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
    });
  } catch (e) {
    console.error(`Failed to start "${cmd}":`, e.message);
    broadcast({ type: 'error', message: `Failed to start: ${e.message}` });
    return;
  }

  sessionActive = true;
  sessionStartTime = new Date().toISOString();

  broadcast({
    type: 'session-info',
    active: true,
    startTime: sessionStartTime,
    command: config.command,
    cwd: config.cwd,
  });

  // Forward PTY output to terminal and web clients
  ptyProcess.onData((data) => {
    // Write to host terminal (so terminal still works)
    process.stdout.write(data);
    // Feed to permission detector
    detector.feed(data);
    // Send to web clients
    broadcast({ type: 'output', data });
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    console.log(`\n📋 Session ended (code: ${exitCode}, signal: ${signal})`);
    sessionActive = false;
    detector.reset();
    broadcast({ type: 'exit', code: exitCode, signal });
  });

  // Forward host terminal input to PTY
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (data) => {
      if (ptyProcess && sessionActive) {
        // Check if user typed y/n/a while there's a pending request
        const char = data.toString();
        if (detector.getPendingRequest() && /^[yna]$/i.test(char)) {
          const action = { y: 'approved', n: 'denied', a: 'always' }[char.toLowerCase()];
          detector.resolveCurrentRequest(`terminal-${action}`);
          updateHistoryStatus(detector.getPendingRequest()?.id, `${action} (terminal)`);
        }
        ptyProcess.write(data);
      }
    });
  }
}

// --- Graceful Shutdown ---
function shutdown() {
  console.log('\n👋 Shutting down...');
  if (ptyProcess) {
    try { ptyProcess.kill(); } catch (e) {}
  }
  if (process.stdin.isTTY) {
    try { process.stdin.setRawMode(false); } catch (e) {}
  }
  server.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// --- Start ---
server.listen(config.port, config.host, () => {
  console.log(`
╭──────────────────────────────────────────────────╮
│                                                  │
│   🔐 Claude Approve v1.0.0                      │
│                                                  │
│   Web UI: http://localhost:${String(config.port).padEnd(5)}                │
│   Command: ${(config.command + ' ' + config.args.join(' ')).trim().slice(0, 36).padEnd(36)} │
│   CWD: ${config.cwd.slice(0, 40).padEnd(40)} │
│                                                  │
│   Terminal input works normally.                 │
│   Open the Web UI for remote approval.           │
│                                                  │
╰──────────────────────────────────────────────────╯
`);

  startSession();
});
