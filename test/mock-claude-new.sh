#!/bin/bash
# Mock Claude Code CLI for testing — NEW permission format (v2.1.62+)
# Simulates the numbered menu permission prompts

echo ""
echo "╭──────────────────────────────────────────╮"
echo "│          Claude Code v2.1.62             │"
echo "│          Model: claude-sonnet-4-5        │"
echo "╰──────────────────────────────────────────╯"
echo ""
echo "  Working directory: $(pwd)"
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
  echo "│ $TOOL"
  echo "│ $DETAIL"
  echo "╰────────────────────────────────────────────────────────╯"
  echo ""
  echo "  Do you want to proceed?"
  echo "❯ 1. Yes"
  echo "  2. Yes, and don't ask again for similar commands in $(pwd)"
  echo "  3. No, and tell Claude what to do differently (esc)"
  echo ""
  
  read -n 1 response
  echo ""
  
  case $response in
    1)
      echo "  ✅ Approved — executing $TOOL..."
      sleep 1
      echo "  Done."
      ;;
    2)
      echo "  ✅ Always approved for this session"
      sleep 1
      echo "  Done."
      ;;
    3)
      echo "  ❌ Denied"
      ;;
    *)
      echo "  ❓ Unknown response: $response"
      ;;
  esac
}

# Auto mode
auto_mode() {
  echo "  🤖 Running in auto mode — generating sample permission requests..."
  echo ""
  
  TOOLS=("Bash command" "Read file" "Write to" "Edit file" "Bash command")
  DETAILS=(
    "find /home -name '*.java' -type f"
    "./package.json"
    "./output.txt"
    "./server.js"
    "npm install express"
  )
  
  for i in "${!TOOLS[@]}"; do
    simulate_request "${TOOLS[$i]}" "${DETAILS[$i]}"
    sleep 2
  done
  
  echo ""
  echo "  📋 All sample requests processed!"
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
      "bash")
        simulate_request "Bash command" "echo 'hello world'"
        ;;
      "read")
        simulate_request "Read file" "./README.md"
        ;;
      "write")
        simulate_request "Write to" "./output.txt"
        ;;
      "auto")
        auto_mode
        ;;
      "")
        ;;
      *)
        echo "  Thinking..."
        sleep 1
        simulate_request "Bash command" "grep -r '$input' ."
        ;;
    esac
  done
}

if [[ "$1" == "--auto" ]]; then
  auto_mode
else
  interactive_mode
fi
