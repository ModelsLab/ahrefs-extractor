#!/usr/bin/env node
// Ahrefs Extractor HTTP Bridge
// Runs on localhost:18800, forwards requests to the Chrome extension via Native Messaging
// OR can be used standalone — polls the extension's popup endpoint.
//
// Usage: node bridge.js [--extension-id=EXTENSION_ID]
//
// This bridge works by:
// 1. Hosting HTTP on :18800
// 2. Using Chrome's DevTools Protocol (CDP) to communicate with the extension
//    OR using the chrome.runtime.sendMessage from an allowed page
//
// Simplest approach: The bridge injects requests via chrome.debugger or
// we use a shared "mailbox" approach with chrome.storage.

const http = require('http');
const { execSync } = require('child_process');

const PORT = 18800;
const EXTENSION_ID = process.argv.find(a => a.startsWith('--extension-id='))?.split('=')[1] || null;

// We use a WebSocket/CDP approach to talk to Chrome
// But the simplest reliable method: use Chrome's --remote-debugging-port

let chromeDebugPort = 9222;
const portArg = process.argv.find(a => a.startsWith('--chrome-debug-port='));
if (portArg) chromeDebugPort = parseInt(portArg.split('=')[1]);

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

async function sendCDP(wsUrl, method, params = {}) {
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
    setTimeout(() => { ws.close(); reject(new Error('CDP timeout')); }, 10000);
  });
}

// Find Ahrefs tab via CDP and execute extraction
async function extractViaCDP() {
  const targets = await fetchJSON(`http://127.0.0.1:${chromeDebugPort}/json`);
  const ahrefsTab = targets.find(t => t.url && (t.url.includes('app.ahrefs.com') || t.url.includes('ahrefs.com')) && t.type === 'page');

  if (!ahrefsTab) {
    return { ok: false, error: 'No Ahrefs tab found in Chrome. Make sure Ahrefs is open and Chrome was launched with --remote-debugging-port=' + chromeDebugPort };
  }

  // Execute the content script extraction directly in the page
  const expression = `
    (function() {
      try {
        // Re-use the content script's extraction if available
        if (typeof extractAll === 'function') return JSON.stringify(extractAll());
        
        // Inline fallback extraction
        function detectPage() {
          const path = location.pathname;
          if (/\\/site-explorer\\//.test(path)) {
            if (/\\/organic-keywords/.test(path)) return 'site-explorer:organic-keywords';
            if (/\\/backlinks/.test(path)) return 'site-explorer:backlinks';
            if (/\\/top-pages/.test(path)) return 'site-explorer:top-pages';
            if (/\\/referring-domains/.test(path)) return 'site-explorer:referring-domains';
            return 'site-explorer:overview';
          }
          if (/\\/keywords-explorer/.test(path)) return 'keywords-explorer';
          if (/\\/site-audit/.test(path)) return 'site-audit';
          if (/\\/rank-tracker/.test(path)) return 'rank-tracker';
          return 'unknown';
        }
        
        function extractTables() {
          const tables = [];
          document.querySelectorAll('table').forEach((table, idx) => {
            const headers = [];
            table.querySelectorAll('thead th, thead td').forEach(th => headers.push(th.innerText.trim()));
            const rows = [];
            table.querySelectorAll('tbody tr').forEach(tr => {
              const cells = [];
              tr.querySelectorAll('td').forEach(td => {
                const raw = td.getAttribute('data-value') || td.getAttribute('data-sort-value');
                cells.push(raw || td.innerText.trim());
              });
              if (cells.length > 0) {
                if (headers.length > 0) {
                  const row = {};
                  cells.forEach((c, i) => { row[headers[i] || 'col_' + i] = c; });
                  rows.push(row);
                } else {
                  rows.push(cells);
                }
              }
            });
            if (rows.length > 0) tables.push({ index: idx, headers, rows, rowCount: rows.length });
          });
          return tables;
        }
        
        function extractMetrics() {
          const metrics = {};
          document.querySelectorAll('[data-test]').forEach(el => {
            const key = el.getAttribute('data-test');
            const val = el.innerText.trim();
            if (key && val && val.length < 200) metrics[key] = val;
          });
          return metrics;
        }
        
        return JSON.stringify({
          page: detectPage(),
          url: location.href,
          timestamp: new Date().toISOString(),
          metrics: extractMetrics(),
          tables: extractTables()
        });
      } catch(e) { return JSON.stringify({ ok: false, error: e.message }); }
    })()
  `;

  const result = await sendCDP(ahrefsTab.webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression,
    returnByValue: true
  });

  return { ok: true, data: JSON.parse(result.result.value), tab: { url: ahrefsTab.url, title: ahrefsTab.title } };
}

async function listTabsViaCDP() {
  const targets = await fetchJSON(`http://127.0.0.1:${chromeDebugPort}/json`);
  const ahrefsTabs = targets.filter(t => t.url && (t.url.includes('app.ahrefs.com') || t.url.includes('ahrefs.com')) && t.type === 'page');
  return { ok: true, tabs: ahrefsTabs.map(t => ({ url: t.url, title: t.title, id: t.id })) };
}

// HTTP Server
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    let result;
    switch (path) {
      case '/':
      case '/status':
        result = { ok: true, service: 'ahrefs-extractor', version: '1.0.0', endpoints: ['/extract', '/tables', '/tabs', '/status'] };
        break;
      case '/extract':
        result = await extractViaCDP();
        break;
      case '/tables': {
        const full = await extractViaCDP();
        result = { ok: true, tables: full.data?.tables || [] };
        break;
      }
      case '/metrics': {
        const full = await extractViaCDP();
        result = { ok: true, metrics: full.data?.metrics || {}, page: full.data?.page };
        break;
      }
      case '/tabs':
        result = await listTabsViaCDP();
        break;
      default:
        res.writeHead(404);
        result = { ok: false, error: 'Not found' };
    }
    res.writeHead(result.ok !== false ? 200 : 500);
    res.end(JSON.stringify(result, null, 2));
  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[Ahrefs Extractor Bridge] Listening on http://127.0.0.1:${PORT}`);
  console.log(`[Ahrefs Extractor Bridge] Chrome debug port: ${chromeDebugPort}`);
  console.log('');
  console.log('Endpoints:');
  console.log('  GET /extract  — Extract all data from active Ahrefs tab');
  console.log('  GET /tables   — Extract just table data');
  console.log('  GET /metrics  — Extract just metric panels');
  console.log('  GET /tabs     — List open Ahrefs tabs');
  console.log('  GET /status   — Service status');
});
