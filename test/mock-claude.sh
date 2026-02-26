#!/bin/bash
# Mock Claude Code CLI for testing permission detection
# Simulates Claude Code's tool approval prompts

echo ""
echo "╭──────────────────────────────────────────╮"
echo "│          Claude Code v1.0.0              │"
echo "│          Model: claude-sonnet-4-5        │"
echo "╰──────────────────────────────────────────╯"
echo ""
echo "  Working directory: $(pwd)"
echo ""
echo "  Type 'help' for commands, or just chat."
echo ""

REQUEST_NUM=0

simulate_request() {
  local TOOL=$1
  local DETAIL=$2
  
  REQUEST_NUM=$((REQUEST_NUM + 1))
  
  echo ""
  echo "  Thinking..."
  sleep 1
  echo ""
  echo "╭────────────────────────────────────────────────────────╮"
  echo "│                                                        │"
  echo "│  🔧 Tool: $TOOL"
  echo "│"
  
  case $TOOL in
    "Bash")
      echo "│  Command: $DETAIL"
      ;;
    "Read")
      echo "│  File: $DETAIL"
      ;;
    "Write")
      echo "│  File: $DETAIL"
      echo "│  Content: (file contents...)"
      ;;
    "Edit")
      echo "│  File: $DETAIL"
      echo "│  Changes: (diff...)"
      ;;
    "WebSearch")
      echo "│  Query: $DETAIL"
      ;;
  esac
  
  echo "│"
  echo "│  Allow? (y)es / (n)o / (a)lways"
  echo "│"
  echo "╰────────────────────────────────────────────────────────╯"
  echo ""
  
  read -n 1 response
  echo ""
  
  case $response in
    y|Y)
      echo "  ✅ Allowed — executing $TOOL..."
      sleep 1
      case $TOOL in
        "Bash")
          echo "  \$ $DETAIL"
          eval "$DETAIL" 2>/dev/null || echo "  (command output)"
          ;;
        "Read")
          echo "  (reading file contents...)"
          ;;
        "Write")
          echo "  ✓ File written"
          ;;
        "Edit")
          echo "  ✓ File edited"
          ;;
        "WebSearch")
          echo "  Found 5 results for: $DETAIL"
          ;;
      esac
      echo "  Done."
      ;;
    n|N)
      echo "  ❌ Denied"
      ;;
    a|A)
      echo "  ✅ Always allowed for this session"
      sleep 1
      echo "  Done."
      ;;
    *)
      echo "  ❓ Unknown response: $response"
      ;;
  esac
}

# Auto mode: cycle through sample requests
auto_mode() {
  echo "  🤖 Running in auto mode — generating sample permission requests..."
  echo ""
  
  TOOLS=("Bash" "Read" "Write" "Edit" "Bash" "WebSearch")
  DETAILS=(
    "ls -la /home/user/projects"
    "./package.json"
    "./output.txt"
    "./server.js"
    "npm install express"
    "Claude Code tool approval web UI"
  )
  
  for i in "${!TOOLS[@]}"; do
    simulate_request "${TOOLS[$i]}" "${DETAILS[$i]}"
    sleep 2
  done
  
  echo ""
  echo "  📋 All sample requests processed!"
  echo "  Session ending..."
}

# Interactive mode
interactive_mode() {
  while true; do
    echo -n "  > "
    read input
    
    case "$input" in
      "quit"|"exit"|"q")
        echo "  Goodbye!"
        exit 0
        ;;
      "help")
        echo "  Commands: bash, read, write, edit, search, auto, quit"
        ;;
      "bash")
        simulate_request "Bash" "echo 'hello world'"
        ;;
      "read")
        simulate_request "Read" "./README.md"
        ;;
      "write")
        simulate_request "Write" "./output.txt"
        ;;
      "edit")
        simulate_request "Edit" "./server.js"
        ;;
      "search")
        simulate_request "WebSearch" "how to build a web app"
        ;;
      "auto")
        auto_mode
        ;;
      "")
        ;;
      *)
        echo "  I'd help with that, but first I need to check something..."
        sleep 1
        simulate_request "Bash" "grep -r '$input' ."
        ;;
    esac
  done
}

# Check for auto flag
if [[ "$1" == "--auto" ]]; then
  auto_mode
else
  interactive_mode
fi
