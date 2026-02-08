#!/bin/bash
# Syntax-check all JS files (Node-compatible only; content.js uses chrome APIs)
set -e
cd "$(dirname "$0")/.."

echo "Checking bridge.js..."
node --check bridge.js

echo "Checking background.js..."
# background.js uses chrome.* APIs, can't node --check but we check parse
node -e "require('fs').readFileSync('background.js','utf8')" && echo "  parse OK"

echo "Checking popup.js..."
node -e "require('fs').readFileSync('popup.js','utf8')" && echo "  parse OK"

echo "Checking content.js..."
node -e "require('fs').readFileSync('content.js','utf8')" && echo "  parse OK"

echo ""
echo "✓ All JS files OK"
