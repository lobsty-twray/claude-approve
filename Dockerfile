FROM node:22-slim

# Install build tools for node-pty
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --production

# Copy app
COPY . .

# Make scripts executable
RUN chmod +x bin/claude-approve test/mock-claude.sh

EXPOSE 3456

ENV PORT=3456
ENV HOST=0.0.0.0

# Default: run with mock for demo/testing
# Override CLAUDE_COMMAND to use real Claude CLI
CMD ["node", "server.js"]
