// Ahrefs SEO Data Extractor — Background Service Worker
// Exposes extracted data via a local HTTP endpoint on port 18800

'use strict';

// ── State ─────────────────────────────────────────────────────────
let lastExtraction = null;
let ahrefsTabId = null;

// ── Find Ahrefs Tab ───────────────────────────────────────────────
async function findAhrefsTab() {
  const tabs = await chrome.tabs.query({ url: ['https://app.ahrefs.com/*', 'https://ahrefs.com/*'] });
  if (tabs.length > 0) {
    ahrefsTabId = tabs[0].id;
    return tabs[0];
  }
  return null;
}

// ── Send message to content script ────────────────────────────────
async function sendToContent(action, tabId) {
  const tid = tabId || ahrefsTabId;
  if (!tid) {
    const tab = await findAhrefsTab();
    if (!tab) throw new Error('No Ahrefs tab found. Open Ahrefs in a tab first.');
  }
  return chrome.tabs.sendMessage(tid || ahrefsTabId, { action });
}

// ── Extract data from Ahrefs ──────────────────────────────────────
async function extract(tabId) {
  const result = await sendToContent('extractAll', tabId);
  if (result?.ok) {
    lastExtraction = result.data;
  }
  return result;
}

// ── HTTP Server via offscreen or native messaging ─────────────────
// MV3 doesn't support raw sockets. We use a companion Node.js server.
// The extension communicates via chrome.runtime messaging, and we provide
// a tiny Node bridge that handles HTTP on port 18800.
//
// Alternative: Use chrome.runtime.connectNative for native messaging.
// For simplicity, we bundle a small Node server that polls the extension.

// ── External Message Listener (for native host / web pages) ───────
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  handleRequest(msg).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
  return true;
});

// ── Internal Message Listener ─────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // From popup or native bridge
  if (msg.source === 'bridge' || msg.source === 'popup') {
    handleRequest(msg).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});

async function handleRequest(msg) {
  switch (msg.action) {
    case 'extract':
    case 'extractAll':
      return extract(msg.tabId);
    case 'extractTables':
      return sendToContent('extractTables', msg.tabId);
    case 'extractMetrics':
      return sendToContent('extractMetrics', msg.tabId);
    case 'status': {
      const tab = await findAhrefsTab();
      return { ok: true, ahrefsTab: tab ? { id: tab.id, url: tab.url, title: tab.title } : null, lastExtraction };
    }
    case 'ping':
      return sendToContent('ping', msg.tabId);
    case 'listTabs': {
      const tabs = await chrome.tabs.query({ url: ['https://app.ahrefs.com/*', 'https://ahrefs.com/*'] });
      return { ok: true, tabs: tabs.map(t => ({ id: t.id, url: t.url, title: t.title })) };
    }
    case 'cached':
      return { ok: true, data: lastExtraction };
    default:
      return { ok: false, error: `Unknown action: ${msg.action}` };
  }
}

// Track Ahrefs tabs
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.url && (tab.url.includes('app.ahrefs.com') || tab.url.includes('ahrefs.com'))) {
    ahrefsTabId = tabId;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === ahrefsTabId) ahrefsTabId = null;
});

console.log('[Ahrefs Extractor] Background service worker started');
