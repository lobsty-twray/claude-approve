#!/usr/bin/env node

/**
 * Claude Hub v3.0.0 - Multi-Session Web companion for Claude Code
 * 
 * Supports multiple simultaneous Claude Code sessions, each with its own
 * PTY, terminal view, and permission queue.
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
    case '--port': case '-p': config.port = parseInt(cliArgs[++i]); break;
    case '--host':
    case '-h':
      if (cliArgs[i + 1] && !cliArgs[i + 1].startsWith('-')) {
        config.host = cliArgs[++i];
      } else {
        console.log(`
Claude Hub v3.0.0 — Multi-session web companion for Claude Code

Usage:
  claude-approve [options] [-- claude-args...]

Options:
  --port, -p <port>        Web UI port (default: 3456)
  --host <host>            Bind address (default: 0.0.0.0)
  --command, -c <cmd>      Command to run (default: claude)
  --cwd <dir>              Working directory (default: current)
  --token <token>          Auth token for web UI
  --help, -h               Show this help

Examples:
  claude-approve                         # Start with defaults
  claude-approve -p 8080                 # Custom port
  claude-approve -c "bash test/mock-claude.sh"  # Use mock for testing
  claude-approve -- --model sonnet       # Pass args to claude
`);
        process.exit(0);
      }
      break;
    case '--command': case '-c': config.command = cliArgs[++i]; break;
    case '--cwd': config.cwd = cliArgs[++i]; break;
    case '--token': config.token = cliArgs[++i]; break;
    case '--':
      config.args = cliArgs.slice(i + 1);
      i = cliArgs.length;
      break;
    default:
      if (!cliArgs[i].startsWith('-')) config.args.push(cliArgs[i]);
      break;
  }
}

// --- Session Manager ---
let sessionCounter = 0;
const sessions = new Map();

function createSession(opts = {}) {
  const id = `session_${++sessionCounter}`;
  const name = opts.name || `Session ${sessionCounter}`;
  const cwd = opts.cwd || config.cwd;
  const args = opts.args || [...config.args];
  const command = opts.command || config.command;

  const detector = new PermissionDetector({
    idleThresholdMs: config.idleThresholdMs,
    onPermissionDetected: (request) => {
      request.sessionId = id;
      session.permissionHistory.push({ ...request, status: 'pending' });
      broadcast({ type: 'permission', request, sessionId: id });
    },
    onPermissionResolved: (resolved) => {
      resolved.sessionId = id;
      const entry = session.permissionHistory.find(h => h.id === resolved.id);
      if (entry) entry.status = `resolved (${resolved.resolvedBy})`;
      broadcast({ type: 'permission-resolved', id: resolved.id, resolvedBy: resolved.resolvedBy, sessionId: id });
    },
    onWaitingForInput: (waiting) => {
      session.waitingForInput = waiting;
      broadcast({ type: 'session-waiting', sessionId: id, waiting });
    },
  });

  const session = {
    id,
    name,
    command,
    cwd,
    args,
    pty: null,
    detector,
    permissionHistory: [],
    status: 'created', // created | active | exited
    startTime: null,
    exitCode: null,
  };

  sessions.set(id, session);
  startSessionPty(id);
  return session;
}

function startSessionPty(id) {
  const session = sessions.get(id);
  if (!session) return;

  if (session.pty) {
    try { session.pty.kill(); } catch (e) {}
  }
  session.detector.reset();

  let cmd, args;
  if (session.command.includes(' ')) {
    const parts = session.command.split(/\s+/);
    cmd = parts[0];
    args = [...parts.slice(1), ...session.args];
  } else {
    cmd = session.command;
    args = [...session.args];
  }

  console.log(`🚀 Starting ${session.name} (${id}): ${cmd} ${args.join(' ')}`);

  try {
    session.pty = pty.spawn(cmd, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: session.cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
    });
  } catch (e) {
    console.error(`Failed to start ${session.name}:`, e.message);
    session.status = 'exited';
    broadcast({ type: 'session-update', session: serializeSession(session) });
    return;
  }

  session.status = 'active';
  session.startTime = new Date().toISOString();
  session.exitCode = null;

  session.pty.onData((data) => {
    session.detector.feed(data);
    broadcast({ type: 'output', data, sessionId: id });
  });

  session.pty.onExit(({ exitCode, signal }) => {
    if (session.status === 'removing' || !sessions.has(id)) return;
    console.log(`📋 ${session.name} ended (code: ${exitCode})`);
    session.status = 'exited';
    session.exitCode = exitCode;
    session.detector.reset();
    broadcast({ type: 'session-exit', sessionId: id, code: exitCode, signal });
  });

  broadcast({ type: 'session-update', session: serializeSession(session) });
}

function removeSession(id) {
  const session = sessions.get(id);
  if (!session) return false;
  session.status = 'removing';
  session.detector.reset();
  if (session.pty) {
    try { session.pty.kill(); } catch (e) {}
  }
  sessions.delete(id);
  broadcast({ type: 'session-removed', sessionId: id });
  return true;
}

function serializeSession(s) {
  return {
    id: s.id,
    name: s.name,
    command: s.command,
    cwd: s.cwd,
    status: s.status,
    startTime: s.startTime,
    exitCode: s.exitCode,
    pendingCount: s.detector.getPendingRequest() ? 1 : 0,
    waitingForInput: s.waitingForInput || false,
    permissionHistory: s.permissionHistory.slice(-50),
  };
}

// --- Express App ---
const app = express();
const server = http.createServer(app);

app.use(express.json());

// Auth middleware
if (config.token) {
  app.use((req, res, next) => {
    if (req.path === '/health') return next();
    const token = req.query.token || req.headers['authorization']?.replace('Bearer ', '');
    if (token !== config.token) return res.status(401).json({ error: 'Unauthorized' });
    next();
  });
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', sessions: sessions.size, uptime: process.uptime() });
});

// V1 compat: /api/session returns first session info
app.get('/api/session', (req, res) => {
  const first = sessions.values().next().value;
  if (!first) return res.json({ active: false, sessions: 0 });
  res.json({
    active: first.status === 'active',
    startTime: first.startTime,
    command: first.command,
    cwd: first.cwd,
    pendingRequest: first.detector.getPendingRequest(),
    history: first.permissionHistory.slice(-50),
  });
});

// V2 API
app.get('/api/sessions', (req, res) => {
  const list = [];
  for (const s of sessions.values()) list.push(serializeSession(s));
  res.json(list);
});

app.post('/api/sessions', (req, res) => {
  const { name, cwd, args, command } = req.body || {};
  const session = createSession({ name, cwd, args, command });
  res.json(serializeSession(session));
});

app.get('/api/sessions/:id', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  res.json(serializeSession(s));
});

app.delete('/api/sessions/:id', (req, res) => {
  if (removeSession(req.params.id)) res.json({ ok: true });
  else res.status(404).json({ error: 'Session not found' });
});

app.post('/api/sessions/:id/input', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s || !s.pty) return res.status(404).json({ error: 'Session not found' });
  if (req.body.data) s.pty.write(req.body.data);
  res.json({ ok: true });
});

app.post('/api/sessions/:id/restart', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  startSessionPty(req.params.id);
  res.json(serializeSession(s));
});

// --- WebSocket Server ---
const wss = new WebSocketServer({ server });
const clients = new Set();

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const client of clients) {
    if (client.readyState === 1) client.send(data);
  }
}

wss.on('connection', (ws, req) => {
  if (config.token) {
    const url = new URL(req.url, 'http://localhost');
    if (url.searchParams.get('token') !== config.token) {
      ws.close(4001, 'Unauthorized');
      return;
    }
  }

  clients.add(ws);

  // Send all sessions info
  const allSessions = [];
  for (const s of sessions.values()) allSessions.push(serializeSession(s));
  ws.send(JSON.stringify({ type: 'sessions-list', sessions: allSessions }));

  // Send pending permissions for all sessions
  for (const s of sessions.values()) {
    const pending = s.detector.getPendingRequest();
    if (pending) {
      ws.send(JSON.stringify({ type: 'permission', request: { ...pending, sessionId: s.id }, sessionId: s.id }));
    }
  }

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      handleClientMessage(msg, ws);
    } catch (e) {}
  });

  ws.on('close', () => clients.delete(ws));
});

function handleClientMessage(msg, ws) {
  const session = msg.sessionId ? sessions.get(msg.sessionId) : sessions.values().next().value;
  if (!session) return;

  switch (msg.type) {
    case 'input':
      if (session.pty && session.status === 'active') session.pty.write(msg.data);
      break;

    case 'approve':
      if (session.pty && session.status === 'active' && session.detector.getPendingRequest()) {
        const approveKey = session.detector.getPromptFormat() === 'old' ? 'y' : '1';
        session.pty.write(approveKey);
        session.detector.resolveCurrentRequest('web-approve');
        updateHistoryStatus(session, msg.id, 'approved (web)');
      }
      break;

    case 'deny':
      if (session.pty && session.status === 'active' && session.detector.getPendingRequest()) {
        const denyKey = session.detector.getPromptFormat() === 'old' ? 'n' : '3';
        session.pty.write(denyKey);
        session.detector.resolveCurrentRequest('web-deny');
        updateHistoryStatus(session, msg.id, 'denied (web)');
      }
      break;

    case 'always':
      if (session.pty && session.status === 'active' && session.detector.getPendingRequest()) {
        const alwaysKey = session.detector.getPromptFormat() === 'old' ? 'a' : '2';
        session.pty.write(alwaysKey);
        session.detector.resolveCurrentRequest('web-always');
        updateHistoryStatus(session, msg.id, 'always (web)');
      }
      break;

    case 'resize':
      if (session.pty && session.status === 'active' && msg.cols && msg.rows) {
        session.pty.resize(msg.cols, msg.rows);
      }
      break;

    case 'restart':
      startSessionPty(session.id);
      break;
  }
}

function updateHistoryStatus(session, id, status) {
  const entry = session.permissionHistory.find(h => h.id === id);
  if (entry) entry.status = status;
}

// --- Terminal passthrough for first session (CLI compat) ---
let ptyActive = false;

function setupTerminalPassthrough() {
  if (!process.stdin.isTTY) return;

  const getActiveSession = () => sessions.values().next().value;

  process.stdin.setRawMode(true);
  process.stdin.resume();

  process.stdout.on('resize', () => {
    const s = getActiveSession();
    if (s?.pty) try { s.pty.resize(process.stdout.columns, process.stdout.rows); } catch (e) {}
  });

  process.stdin.on('data', (data) => {
    const s = getActiveSession();
    if (!s || s.status !== 'active') {
      const ch = data.toString();
      if (ch === '\x03' || ch === 'q') { shutdown(); return; }
      return;
    }
    const char = data.toString();
    if (s.detector.getPendingRequest() && /^[yna123]$/i.test(char)) {
      const actionMap = s.detector.getPromptFormat() === 'old'
        ? { y: 'approved', n: 'denied', a: 'always' }
        : { '1': 'approved', '3': 'denied', '2': 'always', y: 'approved', n: 'denied', a: 'always' };
      const action = actionMap[char.toLowerCase()];
      if (action) s.detector.resolveCurrentRequest(`terminal-${action}`);
    }
    s.pty.write(data);
  });
}

// --- Graceful Shutdown ---
function shutdown() {
  console.log('\n👋 Shutting down...');
  for (const s of sessions.values()) {
    if (s.pty) try { s.pty.kill(); } catch (e) {}
  }
  if (process.stdin.isTTY) try { process.stdin.setRawMode(false); } catch (e) {}
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
│   🔐 Claude Hub v3.0.0                      │
│                                                  │
│   Web UI: http://localhost:${String(config.port).padEnd(5)}                │
│   Command: ${(config.command + ' ' + config.args.join(' ')).trim().slice(0, 36).padEnd(36)} │
│   CWD: ${config.cwd.slice(0, 40).padEnd(40)} │
│   Multi-session: ✅                              │
│                                                  │
╰──────────────────────────────────────────────────╯
`);

  // Create initial default session (like v1 behavior)
  createSession({ name: 'Default' });

  if (process.stdin.isTTY) {
    console.log('  Press Ctrl+C to stop the server.\n');
    // Terminal passthrough disabled — use the web UI for session interaction
  }
});
