# 🔐 Claude Hub

**Web companion for Claude Code tool approval** — approve or deny tool permission requests from your browser, phone, or any device. Works alongside your terminal, not instead of it.

![Version](https://img.shields.io/badge/version-3.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## What is this?

When you use [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (Anthropic's CLI for Claude), it asks for permission before running tools like `Bash`, `Read`, `Write`, `Edit`, etc. Normally you approve/deny these in the terminal.

**Claude Hub** wraps your Claude Code session and adds a web UI — so you can approve tool requests from your phone while you're away from your desk, or from a second monitor.

### Key Features

- 🖥️ **Full terminal in your browser** via xterm.js — see exactly what Claude is doing
- 🔔 **Permission request detection** — automatically detects when Claude asks for approval
- ✅ **One-tap approve/deny** — big, mobile-friendly buttons
- 📋 **Permission history** — see what was approved/denied and when
- 🔊 **Notifications** — sound + browser notifications when approval is needed
- 🌙 **Dark theme** — easy on the eyes
- 📱 **Mobile-first** — designed for phones and tablets
- 🔑 **Optional auth token** — secure access when exposing to network

## Quick Start

### Prerequisites

- **Node.js 18+** (with npm)
- **Claude Code CLI** installed (`npm install -g @anthropic-ai/claude-code`)
- **Build tools** for node-pty: `python3`, `make`, `g++`
  - macOS: `xcode-select --install`
  - Ubuntu/Debian: `sudo apt install python3 make g++`
  - Fedora: `sudo dnf install python3 make gcc-c++`

### Install

```bash
# Clone the repo
git clone https://github.com/lobsty-twray/claude-hub.git
cd claude-hub

# Install dependencies
npm install
```

### Run

```bash
# Start with Claude Code (default)
node server.js

# Start with a custom port
node server.js --port 8080

# Start with auth token (recommended for network access)
node server.js --token my-secret-token

# Start in a specific directory
node server.js --cwd /path/to/project

# Pass arguments to Claude
node server.js -- --model sonnet

# Test with mock Claude (no API key needed)
node server.js --command "bash test/mock-claude.sh"
```

Then open **http://localhost:3456** in your browser (or `http://localhost:3456?token=my-secret-token` if using auth).

### Global Install (optional)

```bash
npm install -g .
# Now you can run from anywhere:
claude-hub
claude-hub --port 8080
claude-hub -- --model sonnet
```

## Docker

### Build and Run

```bash
# Build
docker build -t claude-hub .

# Run with mock (for testing)
docker run -it -p 3456:3456 claude-hub

# Run with real Claude CLI (mount your config)
docker run -it -p 3456:3456 \
  -v ~/.claude:/root/.claude:ro \
  -v $(pwd):/workspace \
  -e CLAUDE_COMMAND=claude \
  -e CLAUDE_CWD=/workspace \
  -e AUTH_TOKEN=my-secret-token \
  claude-hub
```

### Docker Compose

```bash
# Edit docker-compose.yml to configure your settings, then:
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

**Note:** For Docker with real Claude CLI, you need to:
1. Install Claude Code inside the container (add to Dockerfile), OR
2. Mount the Claude CLI binary and its config

## Configuration

### CLI Options

| Option | Default | Description |
|--------|---------|-------------|
| `--port, -p` | `3456` | Web UI port |
| `--host` | `0.0.0.0` | Bind address |
| `--command, -c` | `claude` | Command to wrap |
| `--cwd` | Current dir | Working directory for Claude |
| `--token` | None | Auth token for web UI |
| `--help, -h` | | Show help |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3456` | Web UI port |
| `HOST` | `0.0.0.0` | Bind address |
| `CLAUDE_COMMAND` | `claude` | Command to wrap |
| `CLAUDE_CWD` | Current dir | Working directory |
| `AUTH_TOKEN` | None | Auth token |
| `IDLE_THRESHOLD` | `400` | Permission detection idle threshold (ms) |

## How It Works

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Terminal    │◄───►│  Claude Hub  │◄───►│  Web Browser│
│  (stdin/out) │     │  (PTY + Server)  │     │  (WebSocket)│
└─────────────┘     │                  │     └─────────────┘
                    │  ┌────────────┐  │
                    │  │ Claude CLI │  │
                    │  │  (in PTY)  │  │
                    │  └────────────┘  │
                    │                  │
                    │  ┌────────────┐  │
                    │  │ Permission │  │
                    │  │ Detector   │  │
                    │  └────────────┘  │
                    └──────────────────┘
```

1. **Claude Hub** launches Claude Code inside a pseudo-terminal (PTY)
2. All terminal output flows to both your **local terminal** and the **web UI**
3. The **Permission Detector** watches for approval prompts in the output
4. When detected, a card appears in the web UI with **Approve / Deny / Always** buttons
5. Clicking a button sends the corresponding keystroke (`y`, `n`, or `a`) to the PTY
6. You can still approve/deny from the terminal — both work simultaneously

### Permission Detection

The detector looks for patterns like:
- `Allow? (y)es / (n)o / (a)lways`
- `Do you want to allow...`
- `y/n/a` prompts
- Box-drawn permission dialogs

It uses a combination of regex pattern matching and idle detection (waits for output to stop, indicating the CLI is waiting for input).

## Claude Code Setup

### Recommended `.claude/settings.json`

To get the most out of Claude Hub, configure Claude Code to ask for permission on sensitive tools:

```json
{
  "permissions": {
    "allow": [
      "Read"
    ],
    "deny": [],
    "ask": [
      "Bash",
      "Write",
      "Edit",
      "WebSearch",
      "WebFetch"
    ]
  }
}
```

Place this file in your project's `.claude/settings.json` or `~/.claude/settings.json` for global settings.

### Claude Code Configuration Files

Claude Code uses these config locations:

| File | Location | Purpose |
|------|----------|---------|
| `settings.json` | `~/.claude/settings.json` | Global settings |
| `settings.json` | `.claude/settings.json` (in project) | Project-specific settings |
| `CLAUDE.md` | Project root | Project instructions |

## Testing

### Run Unit Tests

```bash
npm test
```

### Test with Mock Claude

The mock script simulates Claude Code's permission prompts without needing an API key:

```bash
# Interactive mock
node server.js --command "bash test/mock-claude.sh"

# Auto mode (cycles through sample requests)
node server.js --command "bash test/mock-claude.sh --auto"
```

In the mock interactive mode, type:
- `bash`, `read`, `write`, `edit`, `search` — trigger specific tool requests
- `auto` — run through all sample requests
- `quit` — exit

## Security

⚠️ **Important considerations:**

- **Don't expose publicly without auth** — always use `--token` if the port is accessible beyond localhost
- **The web UI has full terminal access** — anyone with access can type commands
- **Use HTTPS** if accessing over a network — consider a reverse proxy (nginx, Caddy)
- **Token is sent in URL** for WebSocket — use HTTPS to prevent interception

### Recommended: Reverse Proxy with HTTPS

```nginx
# Nginx example
server {
    listen 443 ssl;
    server_name approve.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3456;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

## Roadmap

- [x] **V1** — Single session web approval companion
- [ ] **V2** — Multi-session support (multiple terminals visible in one web UI)
- [ ] Mobile app (PWA)
- [ ] Webhook notifications (Slack, Discord, etc.)
- [ ] Approval rules engine (auto-approve safe patterns)
- [ ] Session recording/playback

## Troubleshooting

### `node-pty` fails to install

```bash
# macOS
xcode-select --install

# Ubuntu/Debian
sudo apt install python3 make g++

# Then retry
npm install
```

### Permission prompts not detected

- The detector relies on pattern matching — if Claude Code changes its prompt format, detection may break
- Try adjusting `IDLE_THRESHOLD` (lower = more sensitive, higher = fewer false positives)
- Check the terminal output in the web UI to see the actual prompt format
- Open an issue with the prompt text that wasn't detected

### WebSocket connection fails

- Check that the port isn't blocked by a firewall
- If using a reverse proxy, ensure WebSocket upgrade headers are forwarded
- Try connecting to `http://localhost:3456` directly first

## License

MIT
