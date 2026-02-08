// Ahrefs SEO Data Extractor v1.1 — Content Script
// Parses DOM tables and data panels from Ahrefs pages
// Includes normalization, de-duplication, wait-for-render, and meta info

(() => {
  'use strict';

  // ── Utilities ───────────────────────────────────────────────────

  function cleanText(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
  }

  function safeInnerText(el) {
    if (!el) return '';
    return cleanText(el.innerText || el.textContent || '');
  }

  function normalizeNumber(s) {
    if (!s || typeof s !== 'string') return s;
    s = s.trim();
    const match = s.match(/^([\d,.]+)\s*([KMBkmb])?(%)?$/);
    if (!match) return s;
    let num = parseFloat(match[1].replace(/,/g, ''));
    if (isNaN(num)) return s;
    const suffix = (match[2] || '').toUpperCase();
    if (suffix === 'K') num *= 1000;
    else if (suffix === 'M') num *= 1000000;
    else if (suffix === 'B') num *= 1000000000;
    return match[3] ? num + '%' : num;
  }

  // Wait briefly for key elements to appear
  function waitForSelector(selector, timeoutMs = 2000) {
    return new Promise(resolve => {
      if (document.querySelector(selector)) return resolve(true);
      const start = Date.now();
      const iv = setInterval(() => {
        if (document.querySelector(selector) || Date.now() - start > timeoutMs) {
          clearInterval(iv);
          resolve(!!document.querySelector(selector));
        }
      }, 200);
    });
  }

  // ── Page Detection ──────────────────────────────────────────────

  function detectPage() {
    const path = location.pathname;
    if (/\/site-explorer\//.test(path) || /\/v2-site-explorer/.test(path)) {
      if (/\/organic-keywords/.test(path)) return 'site-explorer:organic-keywords';
      if (/\/backlinks/.test(path)) return 'site-explorer:backlinks';
      if (/\/top-pages/.test(path)) return 'site-explorer:top-pages';
      if (/\/referring-domains/.test(path)) return 'site-explorer:referring-domains';
      if (/\/paid-keywords/.test(path)) return 'site-explorer:paid-keywords';
      return 'site-explorer:overview';
    }
    if (/\/keywords-explorer/.test(path)) {
      if (/\/ideas/.test(path)) return 'keywords-explorer:ideas';
      return 'keywords-explorer:overview';
    }
    if (/\/site-audit/.test(path)) {
      if (/\/issues/.test(path)) return 'site-audit:issues';
      return 'site-audit:overview';
    }
    if (/\/rank-tracker/.test(path)) return 'rank-tracker';
    return 'unknown';
  }

  // ── Generic Table Extraction ────────────────────────────────────

  function extractTables() {
    const tables = [];
    const seenRows = new Set();

    document.querySelectorAll('table').forEach((table, idx) => {
      const headers = [];
      table.querySelectorAll('thead th, thead td').forEach(th => {
        headers.push(cleanText(th.innerText));
      });

      const rows = [];
      table.querySelectorAll('tbody tr').forEach(tr => {
        const cells = [];
        tr.querySelectorAll('td').forEach(td => {
          const raw = td.getAttribute('data-value') || td.getAttribute('data-sort-value');
          const text = raw || cleanText(td.innerText);
          const link = td.querySelector('a[href]');
          cells.push({
            value: text,
            normalized: normalizeNumber(text),
            url: link ? link.href : undefined
          });
        });

        if (cells.length > 0) {
          // De-duplicate rows
          const rowKey = cells.map(c => c.value).join('|');
          if (!seenRows.has(rowKey)) {
            seenRows.add(rowKey);
            if (headers.length > 0) {
              const row = {};
              cells.forEach((c, i) => { row[headers[i] || `col_${i}`] = c; });
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

  // ── Metric Panels (key-value cards) ─────────────────────────────

  function extractMetricPanels() {
    const metrics = {};
    const seenKeys = new Set();

    function addMetric(key, val) {
      if (key && val && val.length < 200 && !seenKeys.has(key)) {
        seenKeys.add(key);
        metrics[key] = { raw: val, normalized: normalizeNumber(val) };
      }
    }

    // Strategy 1: data-test attributes
    document.querySelectorAll('[data-test]').forEach(el => {
      addMetric(el.getAttribute('data-test'), cleanText(el.innerText));
    });

    // Strategy 2: Metric card patterns
    document.querySelectorAll('.MetricCard, [class*="MetricCard"], [class*="metric-card"]').forEach(card => {
      const label = card.querySelector('[class*="label"], [class*="title"], [class*="name"], small');
      const value = card.querySelector('[class*="value"], [class*="number"], [class*="count"], strong');
      if (label && value) addMetric(cleanText(label.innerText), cleanText(value.innerText));
    });

    // Strategy 3: Widget heading + big number
    document.querySelectorAll('[class*="Widget"], [class*="widget"], [class*="Panel"], [class*="panel"], [class*="Card"], [class*="card"]').forEach(widget => {
      const heading = widget.querySelector('h2, h3, h4, [class*="heading"], [class*="title"]');
      const bigNum = widget.querySelector('[class*="big"], [class*="value"], [class*="number"], [class*="metric"]');
      if (heading && bigNum) {
        const k = cleanText(heading.innerText);
        const v = cleanText(bigNum.innerText);
        if (k.length < 100 && v.length < 100) addMetric(k, v);
      }
    });

    return metrics;
  }

  // ── Overview Stats Bar ──────────────────────────────────────────

  function extractOverviewStats() {
    const stats = {};
    document.querySelectorAll('[class*="OverviewStat"], [class*="overview-stat"], [class*="StatsBar"] > *, [class*="stats-bar"] > *').forEach(el => {
      const parts = safeInnerText(el).split('\n').map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2) {
        stats[parts[parts.length - 1]] = { raw: parts[0], normalized: normalizeNumber(parts[0]) };
      }
    });
    return stats;
  }

  // ── Keyword-specific extraction ─────────────────────────────────

  function extractKeywordData() {
    const data = {};
    document.querySelectorAll('[class*="KeywordOverview"], [class*="keyword-overview"], [class*="KwOverview"]').forEach(panel => {
      const items = panel.querySelectorAll('[class*="item"], [class*="row"], [class*="stat"]');
      items.forEach(item => {
        const parts = safeInnerText(item).split('\n').map(s => s.trim()).filter(Boolean);
        if (parts.length >= 2) data[parts[0]] = { raw: parts[1], normalized: normalizeNumber(parts[1]) };
      });
    });
    return data;
  }

  // ── Chart data (visible legends/labels) ─────────────────────────

  function extractChartLabels() {
    const charts = [];
    document.querySelectorAll('[class*="Chart"], [class*="chart"], svg').forEach((chart, idx) => {
      const parent = chart.closest('[class*="Widget"], [class*="widget"], [class*="Card"], [class*="card"], section') || chart.parentElement;
      const title = safeInnerText(parent?.querySelector('h2, h3, h4, [class*="title"]')) || `chart_${idx}`;
      const legends = [];
      parent?.querySelectorAll('[class*="legend"], [class*="Legend"]').forEach(l => {
        const text = cleanText(l.innerText);
        if (text) legends.push(text);
      });
      if (legends.length) charts.push({ title, legends });
    });
    return charts;
  }

  // ── Full page extraction ────────────────────────────────────────

  function extractAll() {
    const page = detectPage();
    const tables = extractTables();
    const metrics = extractMetricPanels();
    const overviewStats = extractOverviewStats();

    return {
      page,
      url: location.href,
      title: document.title,
      timestamp: new Date().toISOString(),
      target: document.querySelector('input[class*="target"], input[name="target"], [class*="TargetInput"] input, [data-test="target-input"]')?.value
        || document.querySelector('[class*="target-url"], [class*="TargetUrl"]')?.innerText?.trim()
        || null,
      metrics,
      overviewStats,
      keywordData: extractKeywordData(),
      tables,
      charts: extractChartLabels(),
      meta: {
        extractedAt: new Date().toISOString(),
        pageType: page,
        tableCount: tables.length,
        metricCount: Object.keys(metrics).length,
        totalRows: tables.reduce((s, t) => s + t.rowCount, 0)
      }
    };
  }

  // ── Message Listener ────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    try {
      switch (msg.action) {
        case 'extract':
        case 'extractAll':
          sendResponse({ ok: true, data: extractAll() });
          break;
        case 'detectPage':
          sendResponse({ ok: true, page: detectPage() });
          break;
        case 'extractTables':
          sendResponse({ ok: true, tables: extractTables() });
          break;
        case 'extractMetrics':
          sendResponse({ ok: true, metrics: extractMetricPanels(), overviewStats: extractOverviewStats() });
          break;
        case 'ping':
          sendResponse({ ok: true, page: detectPage(), url: location.href });
          break;
        default:
          sendResponse({ ok: false, error: `Unknown action: ${msg.action}` });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
    return true; // keep channel open for async
  });

  console.log('[Ahrefs Extractor v1.1] Content script loaded on', detectPage());
})();
