let lastResult = null;

async function sendAction(action) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ source: 'popup', action }, resolve);
  });
}

async function updateStatus() {
  const result = await sendAction('status');
  const el = document.getElementById('status');
  if (result?.ok && result.ahrefsTab) {
    el.className = 'status ok';
    el.textContent = `✓ Ahrefs: ${result.ahrefsTab.title || result.ahrefsTab.url}`;
  } else {
    el.className = 'status err';
    el.textContent = '✗ No Ahrefs tab found — open app.ahrefs.com';
  }
}

function showResult(data) {
  lastResult = data;
  const el = document.getElementById('output');
  el.textContent = JSON.stringify(data, null, 2);
}

document.getElementById('btnExtract').addEventListener('click', async () => {
  document.getElementById('output').textContent = 'Extracting...';
  const result = await sendAction('extractAll');
  showResult(result);
});

document.getElementById('btnTables').addEventListener('click', async () => {
  document.getElementById('output').textContent = 'Extracting tables...';
  const result = await sendAction('extractTables');
  showResult(result);
});

document.getElementById('btnCopy').addEventListener('click', () => {
  if (lastResult) {
    navigator.clipboard.writeText(JSON.stringify(lastResult, null, 2));
    document.getElementById('output').textContent = '✓ Copied to clipboard!';
    setTimeout(() => showResult(lastResult), 1000);
  }
});

updateStatus();
