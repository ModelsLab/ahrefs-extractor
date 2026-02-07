// Ahrefs SEO Data Extractor — Content Script
// Parses DOM tables and data panels from Ahrefs pages

(() => {
  'use strict';

  // ── Page Detection ──────────────────────────────────────────────
  function detectPage() {
    const url = location.href;
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
    document.querySelectorAll('table').forEach((table, idx) => {
      const headers = [];
      table.querySelectorAll('thead th, thead td').forEach(th => {
        headers.push(th.innerText.trim());
      });
      const rows = [];
      table.querySelectorAll('tbody tr').forEach(tr => {
        const cells = [];
        tr.querySelectorAll('td').forEach(td => {
          // Try to get raw number from data attributes or aria
          const raw = td.getAttribute('data-value') || td.getAttribute('data-sort-value');
          cells.push(raw || td.innerText.trim());
        });
        if (cells.length > 0) {
          if (headers.length > 0) {
            const row = {};
            cells.forEach((c, i) => { row[headers[i] || `col_${i}`] = c; });
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

  // ── Metric Panels (key-value cards) ─────────────────────────────
  function extractMetricPanels() {
    const metrics = {};

    // Strategy 1: Ahrefs uses data-test attributes sometimes
    document.querySelectorAll('[data-test]').forEach(el => {
      const key = el.getAttribute('data-test');
      const val = el.innerText.trim();
      if (key && val && val.length < 200) metrics[key] = val;
    });

    // Strategy 2: Look for common metric card patterns
    // Ahrefs typically shows metrics in cards with a label + value structure
    document.querySelectorAll('.MetricCard, .css-metric, [class*="MetricCard"], [class*="metric-card"]').forEach(card => {
      const label = card.querySelector('[class*="label"], [class*="title"], [class*="name"], small, .css-label');
      const value = card.querySelector('[class*="value"], [class*="number"], [class*="count"], strong, .css-value');
      if (label && value) {
        metrics[label.innerText.trim()] = value.innerText.trim();
      }
    });

    // Strategy 3: Generic — find paired label/value from common Ahrefs dashboard structure
    // Many Ahrefs widgets use a heading + large number combo
    document.querySelectorAll('[class*="Widget"], [class*="widget"], [class*="Panel"], [class*="panel"], [class*="Card"], [class*="card"]').forEach(widget => {
      const heading = widget.querySelector('h2, h3, h4, [class*="heading"], [class*="title"]');
      const bigNum = widget.querySelector('[class*="big"], [class*="value"], [class*="number"], [class*="metric"]');
      if (heading && bigNum) {
        const k = heading.innerText.trim();
        const v = bigNum.innerText.trim();
        if (k && v && k.length < 100 && v.length < 100) metrics[k] = v;
      }
    });

    return metrics;
  }

  // ── Overview Stats Bar (the horizontal stats at top of Site Explorer) ──
  function extractOverviewStats() {
    const stats = {};
    // Ahrefs overview pages typically have a row of stats
    document.querySelectorAll('[class*="OverviewStat"], [class*="overview-stat"], [class*="StatsBar"] > *, [class*="stats-bar"] > *').forEach(el => {
      const parts = el.innerText.trim().split('\n').filter(Boolean);
      if (parts.length >= 2) {
        stats[parts[parts.length - 1]] = parts[0]; // value first, label second typically
      }
    });
    return stats;
  }

  // ── Keyword-specific extraction ─────────────────────────────────
  function extractKeywordData() {
    const data = {};
    // Keyword overview panels
    document.querySelectorAll('[class*="KeywordOverview"], [class*="keyword-overview"], [class*="KwOverview"]').forEach(panel => {
      const items = panel.querySelectorAll('[class*="item"], [class*="row"], [class*="stat"]');
      items.forEach(item => {
        const parts = item.innerText.trim().split('\n').filter(Boolean);
        if (parts.length >= 2) data[parts[0]] = parts[1];
      });
    });
    return data;
  }

  // ── Chart data (visible legends/labels) ─────────────────────────
  function extractChartLabels() {
    const charts = [];
    document.querySelectorAll('[class*="Chart"], [class*="chart"], svg').forEach((chart, idx) => {
      const parent = chart.closest('[class*="Widget"], [class*="widget"], [class*="Card"], [class*="card"], section') || chart.parentElement;
      const title = parent?.querySelector('h2, h3, h4, [class*="title"]')?.innerText?.trim() || `chart_${idx}`;
      const legends = [];
      parent?.querySelectorAll('[class*="legend"], [class*="Legend"]').forEach(l => {
        legends.push(l.innerText.trim());
      });
      if (legends.length) charts.push({ title, legends });
    });
    return charts;
  }

  // ── Full page extraction ────────────────────────────────────────
  function extractAll() {
    const page = detectPage();
    return {
      page,
      url: location.href,
      timestamp: new Date().toISOString(),
      target: document.querySelector('input[class*="target"], input[name="target"], [class*="TargetInput"] input, [data-test="target-input"]')?.value
        || document.querySelector('[class*="target-url"], [class*="TargetUrl"]')?.innerText?.trim()
        || null,
      metrics: extractMetricPanels(),
      overviewStats: extractOverviewStats(),
      keywordData: extractKeywordData(),
      tables: extractTables(),
      charts: extractChartLabels(),
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

  console.log('[Ahrefs Extractor] Content script loaded on', detectPage());
})();
