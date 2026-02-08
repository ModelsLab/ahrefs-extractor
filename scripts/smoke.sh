#!/bin/bash
# Smoke test the bridge endpoints (bridge must be running)
set -e
BASE="http://127.0.0.1:18800"

echo "=== Ahrefs Extractor Bridge Smoke Test ==="
echo ""

echo "GET /status"
curl -sf "$BASE/status" | head -c 500
echo -e "\n"

echo "GET /healthz"
curl -sf "$BASE/healthz" | head -c 500
echo -e "\n"

echo "GET /tabs"
curl -sf "$BASE/tabs" | head -c 500
echo -e "\n"

echo "GET /extract"
RESULT=$(curl -sf "$BASE/extract" 2>&1) || true
echo "$RESULT" | head -c 1000
echo -e "\n"

echo "GET /metrics"
curl -sf "$BASE/metrics" | head -c 500
echo -e "\n"

echo "GET /tables"
curl -sf "$BASE/tables" | head -c 500
echo -e "\n"

echo "=== Done ==="
