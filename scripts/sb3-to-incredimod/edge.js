// Minimal headless Edge/Chrome driver over CDP (Node 22+: global fetch/WebSocket).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

async function launch({ port = 9444, profileDir }) {
  const exe = BROWSERS.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('Edge/Chrome not found');
  fs.mkdirSync(profileDir, { recursive: true });
  const proc = spawn(
    exe,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--disable-extensions',
      '--disable-gpu',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );
  let list;
  for (let i = 0; i < 50; i++) {
    try {
      list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (list.find((t) => t.type === 'page')) break;
    } catch (_) {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  const page = list && list.find((t) => t.type === 'page');
  if (!page) throw new Error('browser did not start');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener('open', r);
    ws.addEventListener('error', j);
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d);
      pending.delete(d.id);
    }
  });
  const send = (method, params) =>
    new Promise((resolve) => {
      const my = ++id;
      pending.set(my, resolve);
      ws.send(JSON.stringify({ id: my, method, params }));
    });

  async function evaluate(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.error) throw new Error(JSON.stringify(r.error));
    if (r.result.exceptionDetails) {
      const ex = r.result.exceptionDetails;
      throw new Error((ex.exception && ex.exception.description) || ex.text);
    }
    return r.result.result.value;
  }

  async function close() {
    try {
      ws.close();
    } catch (_) {
      /* ignore */
    }
    proc.kill();
  }

  // Shared page helpers.
  await evaluate(fs.readFileSync(path.join(__dirname, 'page-helpers.js'), 'utf8'));
  return { evaluate, close };
}

module.exports = { launch };
