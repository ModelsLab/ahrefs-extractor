# Ahrefs SEO Data Extractor v1.1

Chrome extension + HTTP bridge that extracts structured SEO data from Ahrefs dashboard pages via DOM scraping. Replaces expensive Ahrefs API calls when you have Ahrefs open in the browser.

## What It Extracts

| Ahrefs Tool | Data |
|---|---|
| Site Explorer | Organic keywords, backlinks, traffic, referring domains, top pages |
| Keywords Explorer | Search volume, keyword difficulty, CPC, keyword suggestions |
| Site Audit | Health score, issues, crawl stats |
| Rank Tracker | Position tracking data |

All data is extracted as structured JSON with **normalized values** (e.g. `12.5K` → `12500`) and metadata.

## Setup

### 1. Install the Chrome Extension

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select this folder
4. The extension icon appears in your toolbar

### 2. Start the HTTP Bridge

The bridge exposes extracted data on `localhost:18800` for AI agents.

```bash
# Chrome must be launched with remote debugging enabled:
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# Then start the bridge:
cd ahrefs-extractor
npm install
node bridge.js
```

### 3. Use It

1. Open Ahrefs in Chrome (app.ahrefs.com) and navigate to any tool
2. **Via popup:** Click the extension icon → "Extract All", "Metrics Only", or "Tables Only"
3. **Via HTTP (for AI agents):**

```bash
# Extract everything from active Ahrefs tab
curl http://127.0.0.1:18800/extract

# Target specific tab by URL substring
curl "http://127.0.0.1:18800/extract?urlContains=site-explorer"

# Target specific tab by ID
curl "http://127.0.0.1:18800/extract?tabId=ABC123"

# Just tables
curl http://127.0.0.1:18800/tables

# Just metrics
curl http://127.0.0.1:18800/metrics

# List open Ahrefs tabs
curl http://127.0.0.1:18800/tabs

# Runtime diagnostics
curl http://127.0.0.1:18800/healthz
```

## API Endpoints

| Endpoint | Query Params | Description |
|---|---|---|
| `GET /extract` | `tabId`, `urlContains` | Full extraction (metrics + tables + page info + meta) |
| `GET /tables` | `tabId`, `urlContains` | Table data only |
| `GET /metrics` | `tabId`, `urlContains` | Metric panels only |
| `GET /tabs` | — | List open Ahrefs tabs |
| `GET /status` | — | Service info |
| `GET /healthz` | — | Runtime diagnostics (uptime, last error, debug port) |

### Query Parameters

- **`tabId`** — Target a specific Chrome tab by its CDP target ID (from `/tabs`)
- **`urlContains`** — Match the first Ahrefs tab whose URL contains this substring (e.g. `site-explorer`, `backlinks`)

## Response Format

```json
{
  "ok": true,
  "data": {
    "page": "site-explorer:organic-keywords",
    "url": "https://app.ahrefs.com/site-explorer/...",
    "title": "Organic keywords - Ahrefs",
    "target": "example.com",
    "metrics": {
      "organic-traffic": { "raw": "12.5K", "normalized": 12500 }
    },
    "tables": [
      {
        "headers": ["Keyword", "Volume", "KD", "Position", "Traffic"],
        "rows": [
          {
            "Keyword": { "value": "example", "normalized": "example", "url": "https://..." },
            "Volume": { "value": "5,400", "normalized": 5400 }
          }
        ],
        "rowCount": 50
      }
    ],
    "meta": {
      "extractedAt": "2026-02-08T09:00:00.000Z",
      "pageType": "site-explorer:organic-keywords",
      "tableCount": 1,
      "metricCount": 5,
      "totalRows": 50
    }
  },
  "tab": { "url": "...", "title": "..." }
}
```

### Error Response

When extraction fails, `/tables` and `/metrics` correctly propagate the error (no false `ok: true`):

```json
{
  "ok": false,
  "error": "No Ahrefs tab found in Chrome..."
}
```

## Architecture

```
Chrome (Ahrefs tab)
  └── content.js (DOM scraping, normalization, de-duplication)
        ↕ chrome.runtime messaging
  └── background.js (service worker, tab tracking)

Node bridge (port 18800) — CDP only
  └── bridge.js → Chrome DevTools Protocol → Runtime.evaluate in Ahrefs tab
        ↕ HTTP
  └── AI agents / curl
```

The bridge communicates **directly via CDP** (Chrome DevTools Protocol). It does not use extension messaging or native host. Chrome must be launched with `--remote-debugging-port`.

## Popup Features

- **Extract All** — Full page extraction
- **Metrics Only** — Just metric panels
- **Tables Only** — Just table data
- **Copy** — Copy last result to clipboard
- **Download JSON** — Save as timestamped JSON file
- **Refresh** — Re-check Ahrefs tab status

## Validation

```bash
# Syntax check all JS files
bash scripts/check-js.sh

# Smoke test endpoints (bridge must be running)
bash scripts/smoke.sh
```

## Troubleshooting

| Problem | Fix |
|---|---|
| "No Ahrefs tab found" | Open app.ahrefs.com in Chrome |
| Bridge can't connect to Chrome | Launch Chrome with `--remote-debugging-port=9222` |
| Empty metrics/tables | Ahrefs pages are dynamic; wait for page to fully load before extracting |
| Wrong tab extracted | Use `?urlContains=` or `?tabId=` to target specific tab |
| Stale data | Extension re-extracts on each request; ensure the page is current |

## Notes

- **Login required:** You must be logged into Ahrefs. The extension reads what's visible on screen.
- **No API key needed:** This scrapes the rendered DOM, not the Ahrefs API.
- **Normalized values:** Numbers like `12.5K`, `1.2M`, `45%` are parsed into numeric form alongside raw strings.
- **De-duplicated rows:** Duplicate table rows are automatically removed.
- **Chrome debug port:** Required for the HTTP bridge; the popup works without it.
