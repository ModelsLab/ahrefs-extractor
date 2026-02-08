#!/usr/bin/env node
// Ahrefs Extractor HTTP Bridge v1.1
// Runs on localhost:18800, uses Chrome DevTools Protocol (CDP) to execute
// extraction directly in Ahrefs tabs. No extension messaging required.
//
// Usage: node bridge.js [--chrome-debug-port=9222]
//
// Architecture: HTTP server → CDP WebSocket → Runtime.evaluate in Ahrefs tab
// Chrome must be launched with --remote-debugging-port=<port>

const http = require('http');

const PORT = 18800;
const startTime = Date.now();
let lastErrorTimestamp = null;
let lastErrorMessage = null;

let chromeDebugPort = 9222;
const portArg = process.argv.find(a => a.startsWith('--chrome-debug-port='));
if (portArg) chromeDebugPort = parseInt(portArg.split('=')[1]);

// ── Helpers ───────────────────────────────────────────────────────

async function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? require('https') : require('http');
    proto.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function sendCDP(wsUrl, method, params = {}, timeoutMs = 15000) {
  const WebSocket = require('ws');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const id = 1;
    ws.on('open', () => {
      ws.send(JSON.stringify({ id, method, params }));
    });
    ws.on('message', data => {
      const msg = JSON.parse(data);
      if (msg.id === id) {
        ws.close();
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
    ws.on('error', reject);
    setTimeout(() => { ws.close(); reject(new Error('CDP timeout')); }, timeoutMs);
  });
}

// Retry wrapper for CDP calls
async function sendCDPWithRetry(wsUrl, method, params = {}, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await sendCDP(wsUrl, method, params);
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

// Find Ahrefs tab with optional targeting
async function findAhrefsTab(query = {}) {
  const targets = await fetchJSON(`http://127.0.0.1:${chromeDebugPort}/json`);
  const ahrefsTabs = targets.filter(t =>
    t.url && (t.url.includes('app.ahrefs.com') || t.url.includes('ahrefs.com')) && t.type === 'page'
  );

  if (ahrefsTabs.length === 0) return null;

  // Target by tab ID
  if (query.tabId) {
    return ahrefsTabs.find(t => t.id === query.tabId) || null;
  }
  // Target by URL substring
  if (query.urlContains) {
    return ahrefsTabs.find(t => t.url.includes(query.urlContains)) || ahrefsTabs[0];
  }

  return ahrefsTabs[0];
}

// ── Extraction ────────────────────────────────────────────────────

const extractionExpression = `
(function() {
  try {
    function cleanText(s) { return (s || '').replace(/\\s+/g, ' ').trim(); }

    function normalizeNumber(s) {
      if (!s || typeof s !== 'string') return s;
      s = s.trim();
      // Handle K/M/B suffixes
      const match = s.match(/^([\\d,.]+)\\s*([KMBkmb])?(%)?$/);
      if (!match) return s;
      let num = parseFloat(match[1].replace(/,/g, ''));
      if (isNaN(num)) return s;
      const suffix = (match[2] || '').toUpperCase();
      if (suffix === 'K') num *= 1000;
      else if (suffix === 'M') num *= 1000000;
      else if (suffix === 'B') num *= 1000000000;
      return match[3] ? num + '%' : num;
    }

    function detectPage() {
      const path = location.pathname;
      if (/\\/site-explorer\\//.test(path) || /\\/v2-site-explorer/.test(path)) {
        if (/\\/organic-keywords/.test(path)) return 'site-explorer:organic-keywords';
        if (/\\/backlinks/.test(path)) return 'site-explorer:backlinks';
        if (/\\/top-pages/.test(path)) return 'site-explorer:top-pages';
        if (/\\/referring-domains/.test(path)) return 'site-explorer:referring-domains';
        if (/\\/paid-keywords/.test(path)) return 'site-explorer:paid-keywords';
        return 'site-explorer:overview';
      }
      if (/\\/keywords-explorer/.test(path)) return 'keywords-explorer';
      if (/\\/site-audit/.test(path)) return 'site-audit';
      if (/\\/rank-tracker/.test(path)) return 'rank-tracker';
      return 'unknown';
    }

    function extractTables() {
      const tables = [];
      const seen = new Set();
      document.querySelectorAll('table').forEach((table, idx) => {
        const headers = [];
        table.querySelectorAll('thead th, thead td').forEach(th => headers.push(cleanText(th.innerText)));
        const rows = [];
        table.querySelectorAll('tbody tr').forEach(tr => {
          const cells = [];
          tr.querySelectorAll('td').forEach(td => {
            const raw = td.getAttribute('data-value') || td.getAttribute('data-sort-value');
            const text = raw || cleanText(td.innerText);
            const link = td.querySelector('a[href]');
            cells.push({ value: text, normalized: normalizeNumber(text), url: link ? link.href : undefined });
          });
          if (cells.length > 0) {
            const rowKey = cells.map(c => c.value).join('|');
            if (!seen.has(rowKey)) {
              seen.add(rowKey);
              if (headers.length > 0) {
                const row = {};
                cells.forEach((c, i) => { row[headers[i] || 'col_' + i] = c; });
                rows.push(row);
              } else {
                rows.push(cells);
              }
            }
          }
        });
        if (rows.length > 0) tables.push({ index: idx, headers, rows, rowCount: rows.length });
      });
      return tables;
    }

    function extractMetrics() {
      const metrics = {};
      const seenKeys = new Set();

      // data-test attributes
      document.querySelectorAll('[data-test]').forEach(el => {
        const key = el.getAttribute('data-test');
        const val = cleanText(el.innerText);
        if (key && val && val.length < 200 && !seenKeys.has(key)) {
          seenKeys.add(key);
          metrics[key] = { raw: val, normalized: normalizeNumber(val) };
        }
      });

      // Metric cards
      document.querySelectorAll('.MetricCard, [class*="MetricCard"], [class*="metric-card"]').forEach(card => {
        const label = card.querySelector('[class*="label"], [class*="title"], small');
        const value = card.querySelector('[class*="value"], [class*="number"], strong');
        if (label && value) {
          const k = cleanText(label.innerText);
          const v = cleanText(value.innerText);
          if (k && v && !seenKeys.has(k)) {
            seenKeys.add(k);
            metrics[k] = { raw: v, normalized: normalizeNumber(v) };
          }
        }
      });

      // Widget headings with big numbers
      document.querySelectorAll('[class*="Widget"], [class*="Panel"], [class*="Card"]').forEach(widget => {
        const heading = widget.querySelector('h2, h3, h4, [class*="heading"], [class*="title"]');
        const bigNum = widget.querySelector('[class*="big"], [class*="value"], [class*="number"], [class*="metric"]');
        if (heading && bigNum) {
          const k = cleanText(heading.innerText);
          const v = cleanText(bigNum.innerText);
          if (k && v && k.length < 100 && v.length < 100 && !seenKeys.has(k)) {
            seenKeys.add(k);
            metrics[k] = { raw: v, normalized: normalizeNumber(v) };
          }
        }
      });

      return metrics;
    }

    const page = detectPage();
    const tables = extractTables();
    const metrics = extractMetrics();

    return JSON.stringify({
      ok: true,
      page: page,
      url: location.href,
      title: document.title,
      target: document.querySelector('input[class*="target"], input[name="target"], [class*="TargetInput"] input, [data-test="target-input"]')?.value
        || document.querySelector('[class*="target-url"], [class*="TargetUrl"]')?.innerText?.trim()
        || null,
      metrics: metrics,
      tables: tables,
      meta: {
        extractedAt: new Date().toISOString(),
        pageType: page,
        tableCount: tables.length,
        metricCount: Object.keys(metrics).length,
        totalRows: tables.reduce((s, t) => s + t.rowCount, 0)
      }
    });
  } catch(e) {
    return JSON.stringify({ ok: false, error: e.message, stack: e.stack });
  }
})()
`;

async function extractViaCDP(query = {}) {
  const tab = await findAhrefsTab(query);
  if (!tab) {
    return { ok: false, error: 'No Ahrefs tab found in Chrome. Make sure Ahrefs is open and Chrome was launched with --remote-debugging-port=' + chromeDebugPort };
  }

  const result = await sendCDPWithRetry(tab.webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression: extractionExpression,
    returnByValue: true
  });

  const parsed = JSON.parse(result.result.value);
  if (parsed.ok === false) {
    return { ok: false, error: parsed.error || 'Extraction failed', tab: { url: tab.url, title: tab.title } };
  }

  return { ok: true, data: parsed, tab: { url: tab.url, title: tab.title } };
}

// Propagate extraction errors correctly for /tables and /metrics
function respondFromExtraction(full, pick) {
  if (!full.ok) return full;
  return { ok: true, ...pick(full.data), tab: full.tab };
}

async function listTabsViaCDP() {
  const targets = await fetchJSON(`http://127.0.0.1:${chromeDebugPort}/json`);
  const ahrefsTabs = targets.filter(t =>
    t.url && (t.url.includes('app.ahrefs.com') || t.url.includes('ahrefs.com')) && t.type === 'page'
  );
  return { ok: true, tabs: ahrefsTabs.map(t => ({ url: t.url, title: t.title, id: t.id })) };
}

// ── HTTP Server ───────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const query = {
    tabId: url.searchParams.get('tabId') || undefined,
    urlContains: url.searchParams.get('urlContains') || undefined
  };

  try {
    let result;
    switch (path) {
      case '/':
      case '/status':
        result = {
          ok: true,
          service: 'ahrefs-extractor',
          version: '1.1.0',
          endpoints: ['/extract', '/tables', '/metrics', '/tabs', '/status', '/healthz']
        };
        break;

      case '/healthz':
        result = {
          ok: true,
          chromeDebugPort,
          uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
          lastError: lastErrorTimestamp ? { timestamp: lastErrorTimestamp, message: lastErrorMessage } : null
        };
        break;

      case '/extract':
        result = await extractViaCDP(query);
        break;

      case '/tables': {
        const full = await extractViaCDP(query);
        result = respondFromExtraction(full, d => ({
          tables: d.tables || [],
          meta: d.meta
        }));
        break;
      }

      case '/metrics': {
        const full = await extractViaCDP(query);
        result = respondFromExtraction(full, d => ({
          metrics: d.metrics || {},
          page: d.page,
          meta: d.meta
        }));
        break;
      }

      case '/tabs':
        result = await listTabsViaCDP();
        break;

      default:
        res.writeHead(404);
        result = { ok: false, error: 'Not found' };
    }

    const status = result.ok !== false ? 200 : 500;
    res.writeHead(status);
    res.end(JSON.stringify(result, null, 2));
  } catch (err) {
    lastErrorTimestamp = new Date().toISOString();
    lastErrorMessage = err.message;
    res.writeHead(500);
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[Ahrefs Extractor Bridge v1.1] Listening on http://127.0.0.1:${PORT}`);
  console.log(`[Ahrefs Extractor Bridge v1.1] Chrome debug port: ${chromeDebugPort}`);
  console.log('');
  console.log('Endpoints:');
  console.log('  GET /extract           — Extract all data from active Ahrefs tab');
  console.log('  GET /extract?tabId=X   — Extract from specific tab');
  console.log('  GET /extract?urlContains=site-explorer — Target by URL');
  console.log('  GET /tables            — Extract just table data');
  console.log('  GET /metrics           — Extract just metric panels');
  console.log('  GET /tabs              — List open Ahrefs tabs');
  console.log('  GET /status            — Service status');
  console.log('  GET /healthz           — Runtime diagnostics');
});
