// Minimal headless Edge/Chrome driver over CDP (Node 22+: global fetch/WebSocket).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The browser picks a free debugging port (port 0) and writes it to <profile>/DevToolsActivePort,
// so parallel runs never share a port and a leftover browser is never picked up by mistake.
// (The old fixed port 9444 connected to whatever browser already listened there.)
async function launch({ profileDir }) {
  const exe = BROWSERS.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('Edge/Chrome not found');
  fs.mkdirSync(profileDir, { recursive: true });
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  fs.rmSync(portFile, { force: true });
  const proc = spawn(
    exe,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--disable-extensions',
      '--disable-gpu',
      '--disable-component-update', // a fresh profile otherwise downloads ~400 MB of Edge components
      'about:blank',
    ],
    { stdio: 'ignore' }
  );
  let port = null;
  let list;
  for (let i = 0; i < 100 && !(list && list.find((t) => t.type === 'page')); i++) {
    try {
      if (!port) port = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]) || null;
      if (port) list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    } catch (_) {
      /* not up yet */
    }
    if (!(list && list.find((t) => t.type === 'page'))) await sleep(100);
  }
  const page = list && list.find((t) => t.type === 'page');
  if (!page) {
    killTree(proc.pid);
    throw new Error(`browser did not start (is another browser still using ${profileDir}?)`);
  }
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

  // Ask the browser to quit (Browser.close on the browser target), then kill whatever is left of
  // the process tree. proc.kill() alone left headless browsers and their profiles locked.
  async function close() {
    try {
      const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      const bws = new WebSocket(v.webSocketDebuggerUrl);
      await new Promise((r, j) => {
        bws.addEventListener('open', r);
        bws.addEventListener('error', j);
      });
      const closed = new Promise((r) => bws.addEventListener('close', r));
      bws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
      await Promise.race([closed, sleep(3000)]);
    } catch (_) {
      /* already gone */
    }
    try {
      ws.close();
    } catch (_) {
      /* ignore */
    }
    killTree(proc.pid);
  }

  // Shared page helpers.
  await evaluate(fs.readFileSync(path.join(__dirname, 'page-helpers.js'), 'utf8'));
  return { evaluate, close };
}

function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      require('child_process').execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else process.kill(pid);
  } catch (_) {
    /* already exited */
  }
}

module.exports = { launch };
