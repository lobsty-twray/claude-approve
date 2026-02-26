#!/usr/bin/env node

/**
 * Basic tests for the Permission Detector
 */

const PermissionDetector = require('../lib/detector');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

console.log('\n🧪 Permission Detector Tests\n');

// Test 1: ANSI stripping
test('strips ANSI escape codes', () => {
  const d = new PermissionDetector();
  const result = d.stripAnsi('\x1b[31mhello\x1b[0m world');
  assert(result === 'hello world', `Got: "${result}"`);
});

// Test 2: Detects "Allow?" pattern
test('detects Allow? pattern', (done) => {
  let detected = null;
  const d = new PermissionDetector({
    idleThresholdMs: 50,
    onPermissionDetected: (req) => { detected = req; },
  });

  d.feed('Claude wants to run a command\n');
  d.feed('Tool: Bash\n');
  d.feed('Command: ls -la\n');
  d.feed('Allow? (y)es / (n)o / (a)lways\n');

  setTimeout(() => {
    assert(detected !== null, 'Should have detected a permission request');
    assert(detected.tool, `Tool should be extracted, got: ${detected.tool}`);
    console.log(`    Detected tool: "${detected.tool}"`);
  }, 100);
});

// Test 3: Detects y/n/a pattern
test('detects y/n/a pattern', () => {
  const d = new PermissionDetector({ idleThresholdMs: 50 });
  const result = d.matchesPermissionPattern('Do you want to allow this? y/n/a');
  assert(result === true, 'Should match y/n/a pattern');
});

// Test 4: Does not false-positive on normal output
test('no false positive on normal output', () => {
  const d = new PermissionDetector({ idleThresholdMs: 50 });
  const result = d.matchesPermissionPattern('The file has been written successfully.');
  assert(result === false, 'Should not match normal output');
});

// Test 5: Does not false-positive on text containing "allow"
test('no false positive on casual "allow" mention', () => {
  const d = new PermissionDetector({ idleThresholdMs: 50 });
  const result = d.matchesPermissionPattern('This will allow you to run the app faster');
  assert(result === false, 'Should not match casual allow mention');
});

// Test 6: Detects Claude Code style box prompts
test('detects box-style permission prompt', () => {
  const d = new PermissionDetector({ idleThresholdMs: 50 });
  const text = `╭────────────────────────────────╮
│  Tool: Bash                    │
│  Command: rm -rf /tmp/test     │
│                                │
│  Allow? (y)es / (n)o / (a)lways│
╰────────────────────────────────╯`;
  const result = d.matchesPermissionPattern(text);
  assert(result === true, 'Should match box-style prompt');
});

// Test 7: Extracts tool info
test('extracts tool info from context', () => {
  const d = new PermissionDetector();
  const lines = [
    '╭──────────────────────────╮',
    '│  Tool: Bash              │',
    '│  Command: ls -la         │',
    '│  Allow? (y)es / (n)o     │',
    '╰──────────────────────────╯',
  ];
  const info = d.extractToolInfo(lines);
  assert(info.tool, `Should extract tool name, got: ${info.tool}`);
});

// Test 8: Reset clears state
test('reset clears state', () => {
  const d = new PermissionDetector({ idleThresholdMs: 50 });
  d.feed('some data');
  d.pendingRequest = { id: 'test' };
  d.reset();
  assert(d.buffer === '', 'Buffer should be empty');
  assert(d.pendingRequest === null, 'Pending request should be null');
});

// Test 9: Resolve clears pending
test('resolve clears pending request', () => {
  let resolved = null;
  const d = new PermissionDetector({
    idleThresholdMs: 50,
    onPermissionResolved: (r) => { resolved = r; },
  });
  d.pendingRequest = { id: 'test-123', tool: 'Bash' };
  d.awaitingInput = true;
  d.resolveCurrentRequest('web-approve');
  assert(d.pendingRequest === null, 'Should clear pending');
  assert(resolved !== null, 'Should call onPermissionResolved');
  assert(resolved.resolvedBy === 'web-approve', `resolvedBy should be web-approve, got: ${resolved.resolvedBy}`);
});

// Summary
setTimeout(() => {
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}, 200);
