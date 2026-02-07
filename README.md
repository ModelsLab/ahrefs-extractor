# Ahrefs SEO Data Extractor

Chrome extension + HTTP bridge that extracts structured SEO data from Ahrefs dashboard pages via DOM scraping. Replaces expensive Ahrefs API calls when you have Ahrefs open in the browser.

## What It Extracts

| Ahrefs Tool | Data |
|---|---|
| Site Explorer | Organic keywords, backlinks, traffic, referring domains, top pages |
| Keywords Explorer | Search volume, keyword difficulty, CPC, keyword suggestions |
| Site Audit | Health score, issues, crawl stats |
| Rank Tracker | Position tracking data |

All data is extracted as structured JSON from DOM tables and metric panels.

## Setup

### 1. Install the Chrome Extension

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select this folder (`tools/ahrefs-extractor/`)
4. The extension icon appears in your toolbar

### 2. Start the HTTP Bridge

The bridge exposes extracted data on `localhost:18800` for AI agents.

```bash
# Chrome must be launched with remote debugging enabled:
# macOS:
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# Then start the bridge:
cd tools/ahrefs-extractor
npm install
node bridge.js
```

### 3. Use It

1. Open Ahrefs in Chrome (app.ahrefs.com) and navigate to any tool
2. **Via popup:** Click the extension icon → "Extract All Data"
3. **Via HTTP (for AI agents):**

```bash
# Extract everything from active Ahrefs tab
curl http://127.0.0.1:18800/extract

# Just tables
curl http://127.0.0.1:18800/tables

# Just metrics
curl http://127.0.0.1:18800/metrics

# List open Ahrefs tabs
curl http://127.0.0.1:18800/tabs
```

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /extract` | Full extraction (metrics + tables + page info) |
| `GET /tables` | Table data only |
| `GET /metrics` | Metric panels only |
| `GET /tabs` | List open Ahrefs tabs |
| `GET /status` | Service health check |

## Response Format

```json
{
  "ok": true,
  "data": {
    "page": "site-explorer:organic-keywords",
    "url": "https://app.ahrefs.com/site-explorer/...",
    "timestamp": "2026-02-07T17:00:00.000Z",
    "target": "example.com",
    "metrics": {
      "organic-traffic": "12.5K",
      "referring-domains": "1,234"
    },
    "tables": [
      {
        "headers": ["Keyword", "Volume", "KD", "Position", "Traffic"],
        "rows": [
          {"Keyword": "example", "Volume": "5,400", "KD": "32", "Position": "3", "Traffic": "890"}
        ],
        "rowCount": 50
      }
    ]
  }
}
```

## Architecture

```
Chrome (Ahrefs tab)
  └── content.js (DOM scraping)
        ↕ chrome.runtime messaging
  └── background.js (service worker)

Node bridge (port 18800)
  └── bridge.js → Chrome DevTools Protocol → evaluates extraction in Ahrefs tab
        ↕ HTTP
  └── AI agents / curl
```

## Notes

- **Login required:** You must be logged into Ahrefs. The extension reads what's visible on screen.
- **No API key needed:** This scrapes the rendered DOM, not the Ahrefs API.
- **Generic table parsing:** Tables are parsed generically (headers + rows), so it works even if Ahrefs changes class names.
- **Chrome debug port:** The bridge needs Chrome launched with `--remote-debugging-port=9222`. This is required for the HTTP bridge; the popup works without it.
