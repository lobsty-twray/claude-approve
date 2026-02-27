/**
 * Permission Detector
 * 
 * Detects Claude Code tool approval prompts in terminal output.
 * Uses pattern matching on ANSI-stripped output + idle timeout detection.
 */

class PermissionDetector {
  constructor(options = {}) {
    this.idleThresholdMs = options.idleThresholdMs || 400;
    this.waitingThresholdMs = options.waitingThresholdMs || 1500;
    this.maxBufferSize = options.maxBufferSize || 20000;
    this.buffer = '';
    this.pendingRequest = null;
    this.idleTimer = null;
    this.waitingTimer = null;
    this.waitingForInput = false;
    this.onPermissionDetected = options.onPermissionDetected || (() => {});
    this.onPermissionResolved = options.onPermissionResolved || (() => {});
    this.onWaitingForInput = options.onWaitingForInput || (() => {});
    this.lastOutputTime = 0;
    this.awaitingInput = false;
  }

  stripAnsi(str) {
    return str
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      .replace(/\x1b[()][AB012]/g, '')
      .replace(/\x1b\[[\?]?[0-9;]*[hlm]/g, '')
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  }

  feed(rawData) {
    const data = typeof rawData === 'string' ? rawData : rawData.toString('utf8');
    this.buffer += data;
    this.lastOutputTime = Date.now();

    // Trim buffer
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer = this.buffer.slice(-this.maxBufferSize / 2);
    }

    // If we had a pending request and new substantial output arrives, it's resolved
    if (this.pendingRequest && this.awaitingInput) {
      const stripped = this.stripAnsi(data).trim();
      if (stripped.length > 2 && !this.matchesPermissionPattern(stripped)) {
        this.resolveCurrentRequest('terminal');
      }
    }

    // Reset idle timer
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.checkForPermission(), this.idleThresholdMs);

    // Reset waiting-for-input timer
    if (this.waitingTimer) clearTimeout(this.waitingTimer);
    if (this.waitingForInput) {
      this.waitingForInput = false;
      this.onWaitingForInput(false);
    }
    this.waitingTimer = setTimeout(() => this.checkForWaiting(), this.waitingThresholdMs);
  }

  matchesPermissionPattern(text) {
    const patterns = [
      // Claude Code permission patterns
      /allow\s*(?:this)?\s*(?:tool|action|command|operation)?\s*\?/i,
      /\(y\)\s*es\s*[\/|,]\s*\(n\)\s*o/i,
      /\[\s*Y\s*\]\s*es\s*[\/|,]\s*\[\s*N\s*\]\s*o/i,
      /\by\s*\/\s*n\s*\/\s*a\b/i,
      /\byes\s*\/\s*no\s*\/\s*always\b/i,
      /\byes\s*\/\s*no\b.*\balways\b/i,
      /Do you want to allow/i,
      /Approve this/i,
      /Permission required/i,
      /allow once|allow always|deny/i,
    ];

    return patterns.some(p => p.test(text));
  }

  checkForPermission() {
    if (this.pendingRequest) return;

    const stripped = this.stripAnsi(this.buffer);
    const lines = stripped.split('\n').filter(l => l.trim());
    
    // Check the last ~20 lines for permission patterns
    const recentLines = lines.slice(-20);
    const recentText = recentLines.join('\n');

    if (!this.matchesPermissionPattern(recentText)) return;

    // Extract tool info from context
    const toolInfo = this.extractToolInfo(recentLines);
    
    this.pendingRequest = {
      id: `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tool: toolInfo.tool,
      details: toolInfo.details,
      context: recentLines.slice(-10).join('\n'),
      timestamp: new Date().toISOString(),
    };
    this.awaitingInput = true;

    this.onPermissionDetected(this.pendingRequest);
    return this.pendingRequest;
  }

  extractToolInfo(lines) {
    const text = lines.join('\n');
    let tool = 'Tool Request';
    let details = '';

    // Try various extraction patterns
    const toolPatterns = [
      /(?:Tool|Action|Command):\s*(.+)/i,
      /wants?\s+to\s+(?:use|run|execute|call)\s+(\w+)/i,
      /(?:Running|Executing|Using)\s+(\w+)/i,
      /(?:Bash|Read|Write|Edit|WebSearch|WebFetch|Grep)(?:\s*:\s*(.+))?/i,
    ];

    for (const pattern of toolPatterns) {
      const match = text.match(pattern);
      if (match) {
        tool = match[1]?.trim() || match[0]?.trim() || tool;
        break;
      }
    }

    const detailPatterns = [
      /(?:Command|File|Path|URL):\s*(.+)/i,
      /(?:│|┃|\|)\s*(.+\.(js|ts|py|sh|json|md|txt|yml|yaml))/i,
      /(?:│|┃|\|)\s*((?:\/|\.\/|~\/).+)/i,
      /`([^`]+)`/,
    ];

    for (const pattern of detailPatterns) {
      const match = text.match(pattern);
      if (match) {
        details = match[1]?.trim() || '';
        break;
      }
    }

    return { tool, details };
  }

  checkForWaiting() {
    if (this.pendingRequest) return; // permission prompt takes priority
    
    const stripped = this.stripAnsi(this.buffer);
    const lines = stripped.split('\n').filter(l => l.trim());
    if (lines.length === 0) return;

    // Check if the last meaningful output looks like Claude is waiting for input
    // Claude Code shows ">" or "❯" prompt when ready for next message
    const lastLines = lines.slice(-5).join('\n');
    const waitingPatterns = [
      /^\s*[>❯›]\s*$/m,           // bare prompt
      /^\s*[>❯›]\s+$/m,           // prompt with trailing space
      /\? for shortcuts/,          // Claude Code shows this when idle
    ];

    const isWaiting = waitingPatterns.some(p => p.test(lastLines));
    if (isWaiting && !this.waitingForInput) {
      this.waitingForInput = true;
      this.onWaitingForInput(true);
    }
  }

  isWaiting() {
    return this.waitingForInput;
  }

  resolveCurrentRequest(source = 'unknown') {
    if (!this.pendingRequest) return;
    
    const resolved = { ...this.pendingRequest, resolvedBy: source };
    this.pendingRequest = null;
    this.awaitingInput = false;
    this.buffer = '';

    this.onPermissionResolved(resolved);
    return resolved;
  }

  getPendingRequest() {
    return this.pendingRequest;
  }

  reset() {
    this.buffer = '';
    this.pendingRequest = null;
    this.awaitingInput = false;
    this.waitingForInput = false;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.waitingTimer) clearTimeout(this.waitingTimer);
  }
}

module.exports = PermissionDetector;
