let lastResult = null;
const buttons = () => document.querySelectorAll('button');

async function sendAction(action) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ source: 'popup', action }, resolve);
  });
}

function setButtonsDisabled(disabled) {
  buttons().forEach(b => b.disabled = disabled);
}

async function updateStatus() {
  const result = await sendAction('status');
  const el = document.getElementById('status');
  if (result?.ok && result.ahrefsTab) {
    el.className = 'status ok';
    el.textContent = `✓ ${result.ahrefsTab.title || result.ahrefsTab.url}`;
    if (result.lastExtraction) {
      document.getElementById('timestamp').textContent = `Last: ${new Date(result.lastExtraction.timestamp || result.lastExtraction.meta?.extractedAt).toLocaleTimeString()}`;
    }
  } else {
    el.className = 'status err';
    el.textContent = '✗ No Ahrefs tab found — open app.ahrefs.com';
  }
}

function showResult(data, isError = false) {
  lastResult = data;
  const el = document.getElementById('output');
  el.textContent = JSON.stringify(data, null, 2);
  el.className = isError ? 'error' : 'success';
  if (data?.data?.meta?.extractedAt) {
    document.getElementById('timestamp').textContent = `Extracted: ${new Date(data.data.meta.extractedAt).toLocaleTimeString()}`;
  }
}

async function runAction(action, label) {
  const output = document.getElementById('output');
  output.textContent = `${label}...`;
  output.className = '';
  setButtonsDisabled(true);
  try {
    const result = await sendAction(action);
    const isError = !result?.ok;
    showResult(result, isError);
  } catch (err) {
    showResult({ ok: false, error: err.message }, true);
  } finally {
    setButtonsDisabled(false);
  }
}

document.getElementById('btnExtract').addEventListener('click', () => runAction('extractAll', 'Extracting all data'));
document.getElementById('btnTables').addEventListener('click', () => runAction('extractTables', 'Extracting tables'));
document.getElementById('btnMetrics').addEventListener('click', () => runAction('extractMetrics', 'Extracting metrics'));

document.getElementById('btnCopy').addEventListener('click', () => {
  if (!lastResult) return;
  try {
    navigator.clipboard.writeText(JSON.stringify(lastResult, null, 2));
    const el = document.getElementById('output');
    const prev = el.textContent;
    el.textContent = '✓ Copied to clipboard!';
    setTimeout(() => { el.textContent = prev; }, 1000);
  } catch (err) {
    document.getElementById('output').textContent = '✗ Copy failed: ' + err.message;
  }
});

document.getElementById('btnDownload').addEventListener('click', () => {
  if (!lastResult) return;
  try {
    const blob = new Blob([JSON.stringify(lastResult, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ahrefs-extract-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    document.getElementById('output').textContent = '✗ Download failed: ' + err.message;
  }
});

document.getElementById('btnRefresh').addEventListener('click', updateStatus);

updateStatus();
