// Zero-dependency helpers for tests/e2e.mjs: process management, a tiny Chrome
// DevTools Protocol client, and a Page object with the helpers scenarios use.
// Requires Node >= 22 (global fetch and WebSocket).
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'x';
const oneLine = (s, n = 300) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// ---------------------------------------------------------------------------
// processes
// ---------------------------------------------------------------------------
const PROCS = new Set();
const TMP_DIRS = new Set();

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function spawnTracked(cmd, args, opts) {
  // detached: own process group, so we can kill Chrome helpers / server with one signal
  const p = spawn(cmd, args, { ...opts, detached: true });
  p.tail = [];
  const keep = (buf) => { p.tail.push(...String(buf).split('\n').filter(Boolean)); if (p.tail.length > 40) p.tail.splice(0, p.tail.length - 40); };
  if (p.stdout) p.stdout.on('data', keep);
  if (p.stderr) p.stderr.on('data', keep);
  p.on('error', (e) => keep(`spawn error: ${e.message}`));
  PROCS.add(p);
  p.on('exit', () => PROCS.delete(p));
  return p;
}

function killGroup(p, sig) {
  if (!p || p.exitCode !== null || p.signalCode !== null) return;
  try { process.kill(-p.pid, sig); } catch { try { p.kill(sig); } catch { /* gone */ } }
}

export async function cleanupAll() {
  const list = [...PROCS];
  for (const p of list) killGroup(p, 'SIGTERM');
  const t0 = Date.now();
  while (list.some((p) => p.exitCode === null && p.signalCode === null) && Date.now() - t0 < 3000) await sleep(50);
  for (const p of list) killGroup(p, 'SIGKILL');
  await sleep(100);
  for (const d of TMP_DIRS) { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 3 }); } catch { /* best effort */ } TMP_DIRS.delete(d); }
}

// last-resort synchronous cleanup (process 'exit' handler)
export function cleanupSync() {
  for (const p of PROCS) killGroup(p, 'SIGKILL');
  for (const d of TMP_DIRS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
}

export async function waitHttp(url, timeoutMs, proc) {
  const t0 = Date.now();
  let last = 'no response';
  while (Date.now() - t0 < timeoutMs) {
    if (proc && (proc.exitCode !== null || proc.signalCode !== null)) throw new Error(`process exited early (${proc.exitCode ?? proc.signalCode}): ${proc.tail.slice(-5).join(' | ')}`);
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return r;
      last = `HTTP ${r.status}`;
    } catch (e) { last = e.message; }
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${url}: ${last}`);
}

export async function startStaticServer(root, port) {
  const p = spawnTracked('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = `http://127.0.0.1:${port}/`;
  await waitHttp(base, 10000, p);
  return { proc: p, base };
}

export async function launchChrome({ chromePath, port, headful = false, extraArgs = [] }) {
  if (!fs.existsSync(chromePath)) throw new Error(`Chrome not found at ${chromePath} (use --chrome <path>)`);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analystgym-e2e-'));
  TMP_DIRS.add(userDataDir);
  const args = [
    ...(headful ? [] : ['--headless=new']),
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    ...extraArgs,
    'about:blank',
  ];
  const proc = spawnTracked(chromePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  await waitHttp(`http://127.0.0.1:${port}/json/version`, 20000, proc);
  let target = null;
  for (let i = 0; i < 50 && !target; i++) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!target) await sleep(100);
  }
  if (!target) {
    const r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
    target = await r.json();
  }
  return { proc, userDataDir, wsUrl: target.webSocketDebuggerUrl };
}

// ---------------------------------------------------------------------------
// CDP client
// ---------------------------------------------------------------------------
export class CDP {
  static async connect(wsUrl, timeoutMs = 10000) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout connecting to ${wsUrl}`)), timeoutMs);
      ws.addEventListener('open', () => { clearTimeout(t); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(t); reject(new Error(`WebSocket error connecting to ${wsUrl}`)); }, { once: true });
    });
    return new CDP(ws);
  }

  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    this.closed = false;
    ws.addEventListener('message', (ev) => this._onMessage(ev.data));
    ws.addEventListener('close', () => {
      this.closed = true;
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('CDP connection closed (Chrome crashed or exited?)')); }
      this.pending.clear();
    });
  }

  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8')); } catch { return; }
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}${msg.error.data ? ` (${msg.error.data})` : ''}`));
      else p.resolve(msg.result || {});
    } else if (msg.method) {
      const hs = this.handlers.get(msg.method);
      if (hs) for (const fn of [...hs]) { try { fn(msg.params || {}); } catch (e) { console.error(`[cdp] handler for ${msg.method} threw:`, e); } }
    }
  }

  send(method, params = {}, timeoutMs = 30000) {
    if (this.closed) return Promise.reject(new Error(`CDP closed, cannot send ${method}`));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout after ${timeoutMs} ms: ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, new Set());
    this.handlers.get(method).add(fn);
    return () => this.handlers.get(method).delete(fn);
  }

  waitForEvent(method, predicate = () => true, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const off = this.on(method, (p) => { if (predicate(p)) { clearTimeout(t); off(); resolve(p); } });
      const t = setTimeout(() => { off(); reject(new Error(`timeout after ${timeoutMs} ms waiting for ${method}`)); }, timeoutMs);
    });
  }

  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

// ---------------------------------------------------------------------------
// In-page helper functions (serialised into Runtime.evaluate)
// ---------------------------------------------------------------------------
const PAGE_HELPERS = String.raw`
  const __vis = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.01;
  };
  const __desc = (el) => {
    if (!el || !el.tagName) return String(el);
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
    if (cls.length) s += '.' + cls.join('.');
    const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return t ? s + ' "' + t + '"' : s;
  };
  const __norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const __find = (spec) => {
    const root = spec.within ? document.querySelector(spec.within) : document;
    if (!root) return { error: 'container not found: ' + spec.within };
    let cands = [];
    if (spec.selector) { try { cands = [...root.querySelectorAll(spec.selector)]; } catch (e) { cands = []; } }
    if (!cands.length && (spec.text != null || spec.re)) {
      const all = [...root.querySelectorAll('button, a, summary, label, [role=button], input[type=button], input[type=submit]')];
      const txt = (el) => __norm(el.innerText || el.value || el.getAttribute('aria-label') || el.title || '');
      if (spec.re) { const re = new RegExp(spec.re, spec.flags || 'i'); cands = all.filter((el) => re.test((el.innerText || el.value || el.getAttribute('aria-label') || '').trim())); }
      else {
        const t = __norm(spec.text);
        cands = all.filter((el) => txt(el) === t);
        if (!cands.length) cands = all.filter((el) => txt(el).startsWith(t));
        if (!cands.length) cands = all.filter((el) => txt(el).includes(t));
      }
    }
    const visible = cands.filter(__vis);
    return { list: visible, total: cands.length };
  };
`;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export class Page {
  constructor(cdp, { baseUrl, outDir, config, verbose = false, noShots = false }) {
    this.cdp = cdp;
    this.baseUrl = baseUrl;
    this.origin = new URL(baseUrl).origin;
    this.outDir = outDir;
    this.config = config;
    this.verbose = verbose;
    this.noShots = noShots;
    // state shared by every per-scenario view of this page (see forScenario)
    this.shared = { inflight: new Map(), issues: { console: [], network: [], dialogs: [] }, responses: [], crashed: false };
    this.cancelled = false;
    this.loadedOnSite = false;
    this.viewport = null;
    this.scenario = null;
    this.data = {};
  }

  // A fresh view of the page for one scenario: own bookkeeping and cancel flag, shared CDP + collectors.
  forScenario(name, result) {
    const v = Object.create(this);
    v.scenario = name;
    v.result = result;
    v.cancelled = false;
    v.loadedOnSite = false;
    v.viewport = null;
    return v;
  }

  send(method, params = {}, timeoutMs) {
    if (this.cancelled) return Promise.reject(new Error('scenario cancelled (timeout)'));
    return this.cdp.send(method, params, timeoutMs);
  }

  async init() {
    const c = this.cdp;
    const sh = this.shared;
    c.on('Runtime.exceptionThrown', (p) => {
      const d = p.exceptionDetails || {};
      const text = (d.exception && (d.exception.description || d.exception.value)) || d.text || 'exception';
      sh.issues.console.push({ kind: 'exception', text: oneLine(text, 400), url: d.url || '', line: d.lineNumber });
    });
    c.on('Runtime.consoleAPICalled', (p) => {
      if (p.type !== 'error' && p.type !== 'assert') return;
      const text = (p.args || []).map((a) => (a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value)) : a.description || a.type)).join(' ');
      const fr = (p.stackTrace && p.stackTrace.callFrames && p.stackTrace.callFrames[0]) || {};
      sh.issues.console.push({ kind: `console.${p.type}`, text: oneLine(text, 400), url: fr.url || '', line: fr.lineNumber });
    });
    c.on('Log.entryAdded', ({ entry }) => {
      if (!entry || entry.level !== 'error') return;
      if (entry.source === 'network') return; // reported by the network collector
      sh.issues.console.push({ kind: `log.${entry.source}`, text: oneLine(entry.text, 400), url: entry.url || '' });
    });
    c.on('Network.requestWillBeSent', (p) => { sh.inflight.set(p.requestId, { url: p.request.url, t: Date.now(), type: p.type }); });
    c.on('Network.responseReceived', (p) => {
      const r = p.response || {};
      sh.responses.push({ url: r.url, status: r.status, type: p.type, t: Date.now() });
      if (sh.responses.length > 500) sh.responses.splice(0, sh.responses.length - 500);
      if (r.status >= 400 && !/^(data|blob|chrome-extension):/.test(r.url)) sh.issues.network.push({ url: r.url, status: r.status, type: p.type });
    });
    c.on('Network.loadingFinished', (p) => sh.inflight.delete(p.requestId));
    c.on('Network.loadingFailed', (p) => {
      const req = sh.inflight.get(p.requestId);
      sh.inflight.delete(p.requestId);
      if (p.canceled) return;
      const url = req ? req.url : '(unknown)';
      if (/^(data|blob):/.test(url)) return;
      sh.issues.network.push({ url, error: p.errorText, type: p.type, blocked: p.blockedReason });
    });
    c.on('Page.javascriptDialogOpening', (p) => {
      sh.issues.dialogs.push({ type: p.type, message: oneLine(p.message, 200) });
      c.send('Page.handleJavaScriptDialog', { accept: this.config.acceptDialogs !== false, promptText: '' }).catch(() => {});
    });
    c.on('Inspector.targetCrashed', () => { sh.crashed = true; });
    await Promise.all([
      c.send('Page.enable'), c.send('Runtime.enable'), c.send('Network.enable'), c.send('Log.enable'), c.send('Inspector.enable').catch(() => {}),
    ]);
    await c.send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => {});
  }

  log(...a) { if (this.verbose) console.log('    ·', ...a); }

  // ----- scenario bookkeeping (the runner sets this.result) -----
  step(label) { if (this.result) this.result.step = label; this.log(`step: ${label}`); return label; }
  note(msg) { if (this.result) this.result.notes.push(oneLine(msg, 400)); this.log(`note: ${msg}`); }
  warn(msg) { if (this.result) this.result.warnings.push({ step: this.result.step, message: oneLine(msg, 600) }); this.log(`warn: ${msg}`); }

  // soft assertion: records a failure (with screenshot) and continues
  async check(cond, msg) {
    if (cond) return true;
    await this.fail(msg);
    return false;
  }
  // opts.key: failures with the same key are recorded once per scenario (repeats are counted)
  async fail(msg, { key } = {}) {
    const r = this.result;
    if (r && key) {
      r.failKeys = r.failKeys || new Map();
      const prevF = r.failKeys.get(key);
      if (prevF) { prevF.repeats = (prevF.repeats || 0) + 1; return; }
    }
    let shot = null;
    if (r && !r.shotSteps.has(r.step)) {
      r.shotSteps.add(r.step);
      shot = await this.screenshot(`FAIL-${r.failures.length + 1}-${r.step}`, { force: true, fullPage: false }).catch(() => null);
    }
    const f = { step: r ? r.step : '', message: oneLine(msg, 900), screenshot: shot };
    if (r) { r.failures.push(f); if (key) r.failKeys.set(key, f); }
    this.log(`FAIL: ${msg}`);
  }
  // hard assertion: aborts the scenario
  expect(cond, msg) { if (!cond) throw new Error(msg); }

  // ----- evaluation -----
  async eval(fnOrExpr, ...args) {
    const expression = typeof fnOrExpr === 'function'
      ? `(async () => { ${PAGE_HELPERS}; return await (${fnOrExpr.toString()})(...${JSON.stringify(args)}); })()`
      : String(fnOrExpr);
    const res = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      throw new Error(`page.eval failed: ${oneLine((d.exception && d.exception.description) || d.text, 400)}`);
    }
    return res.result ? res.result.value : undefined;
  }

  // ----- viewport / navigation -----
  async setViewport(vp) {
    this.viewport = vp;
    await this.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr || 1, mobile: !!vp.mobile });
    await this.send('Emulation.setTouchEmulationEnabled', { enabled: !!vp.mobile, maxTouchPoints: vp.mobile ? 5 : 1 }).catch(() => {});
  }

  async navigateRaw(url, timeoutMs = 20000) {
    const loaded = this.cdp.waitForEvent('Page.loadEventFired', () => true, timeoutMs);
    const res = await this.send('Page.navigate', { url });
    if (res.errorText) { loaded.catch(() => {}); throw new Error(`navigation to ${url} failed: ${res.errorText}`); }
    if (res.loaderId) await loaded; else loaded.catch(() => {});
  }

  async clearStorage() {
    await this.send('Storage.clearDataForOrigin', { origin: this.origin, storageTypes: 'local_storage,indexeddb,cache_storage,service_workers,cookies' }).catch(() => {});
  }

  // Full document load of base + hash (via about:blank, so it is never a same-document navigation).
  async load(hash = '#/') {
    await this.navigateRaw('about:blank');
    await this.navigateRaw(this.baseUrl + hash);
    this.loadedOnSite = true;
    await this.settle();
  }

  async reload() { const h = await this.eval('location.hash'); await this.load(h || '#/'); }

  // In-app navigation (hashchange). First goto of a scenario, or {fresh:true}, does a full load.
  async goto(hash, { fresh = false } = {}) {
    if (fresh || !this.loadedOnSite) return this.load(hash);
    await this.eval((h) => {
      if (location.hash === h) window.dispatchEvent(new HashChangeEvent('hashchange'));
      else location.hash = h;
    }, hash);
    await this.settle();
  }

  async hash() { return this.eval('location.hash'); }

  // Wait until the app has rendered: main exists, no loading placeholder, no in-flight local requests.
  async settle({ timeout = 8000, quiet = 150 } = {}) {
    const S = this.config.selectors;
    const t0 = Date.now();
    let okSince = 0;
    while (Date.now() - t0 < timeout) {
      if (this.crashed) throw new Error('page crashed');
      const now = Date.now();
      const busy = [...this.shared.inflight.values()].filter((r) => now - r.t < 4000 && r.url.startsWith(this.origin)).length;
      const ready = await this.eval((mainSel, loadingSel) => {
        const m = document.querySelector(mainSel);
        return document.readyState === 'complete' && !!m && !(loadingSel && m.querySelector(loadingSel)) && m.childElementCount > 0;
      }, S.main, S.loading).catch(() => false);
      if (ready && !busy) { if (!okSince) okSince = now; if (now - okSince >= quiet) break; } else okSince = 0;
      await sleep(50);
    }
    await this.eval(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))).catch(() => {});
    return Date.now() - t0 < timeout;
  }

  // ----- DOM helpers -----
  async exists(selector) { return this.eval((s) => !!document.querySelector(s), selector); }
  async count(selector, { visible = false } = {}) { return this.eval((s, v) => [...document.querySelectorAll(s)].filter((e) => !v || __vis(e)).length, selector, visible); }
  async text(selector) { return this.eval((s) => { const el = document.querySelector(s); return el ? el.innerText : ''; }, selector || this.config.selectors.main); }

  async waitFor(target, timeout = 5000, { visible = false } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const ok = typeof target === 'function'
        ? await this.eval(target).catch(() => false)
        : await this.eval((s, v) => { const els = [...document.querySelectorAll(s)]; return v ? els.some(__vis) : els.length > 0; }, target, visible);
      if (ok) return true;
      await sleep(60);
    }
    throw new Error(`waitFor timed out after ${timeout} ms: ${typeof target === 'function' ? 'predicate' : target}`);
  }

  _spec(target, opts = {}) {
    if (target instanceof RegExp) return { re: target.source, flags: target.flags.replace('g', '') || undefined, index: opts.index || 0, within: opts.within };
    if (target && typeof target === 'object') {
      if (target.text instanceof RegExp) return { re: target.text.source, flags: target.text.flags.replace('g', ''), index: opts.index || 0, within: opts.within || target.within };
      return { selector: target.selector, text: target.text, index: opts.index || 0, within: opts.within || target.within };
    }
    return { selector: String(target), text: String(target), index: opts.index || 0, within: opts.within };
  }

  // Real mouse click on an element found by CSS selector, or by visible text if the selector matches nothing.
  // target: '.opt' | 'Termina' | /^Avanti/ | { text: 'Inizia' } | { selector: '.x' }. opts: { index, within, timeout, force }
  async click(target, opts = {}) {
    const spec = this._spec(target, opts);
    const timeout = opts.timeout ?? 4000;
    const t0 = Date.now();
    let info;
    for (;;) {
      info = await this.eval((sp) => {
        const f = __find(sp);
        if (f.error) return { error: f.error };
        const el = f.list[sp.index || 0];
        if (!el) return { notFound: true, total: f.total, visible: f.list.length };
        if (el.disabled) return { disabled: true, desc: __desc(el) };
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        const r = el.getBoundingClientRect();
        const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
        const y = Math.min(Math.max(r.top + Math.min(r.height / 2, 20), 1), innerHeight - 1);
        const hit = document.elementFromPoint(x, y);
        const covered = !hit || (hit !== el && !el.contains(hit));
        return { x, y, desc: __desc(el), covered, hit: covered ? __desc(hit) : null };
      }, spec);
      if (info && info.x !== undefined && !info.covered) break;
      if (Date.now() - t0 > timeout) break;
      await sleep(80);
    }
    const what = spec.re ? `/${spec.re}/` : (spec.selector || spec.text);
    if (info.error) throw new Error(`click(${what}): ${info.error}`);
    if (info.notFound) throw new Error(`click(${what}): no visible element found (matches: ${info.total}, visible: ${info.visible}, index ${spec.index || 0})`);
    if (info.disabled) throw new Error(`click(${what}): element is disabled: ${info.desc}`);
    if (info.covered && !opts.force) throw new Error(`click(${what}): ${info.desc} is covered by ${info.hit}`);
    if (info.covered && opts.force) {
      await this.eval((sp) => { const el = __find(sp).list[sp.index || 0]; el && el.click(); }, spec);
    } else {
      const { x, y } = info;
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    }
    this.log(`clicked ${info.desc}`);
    await sleep(opts.after ?? 40);
    return info.desc;
  }

  // Does a visible clickable element matching target exist (no click)?
  async has(target, opts = {}) {
    const spec = this._spec(target, opts);
    return this.eval((sp) => { const f = __find(sp); return !f.error && f.list.length > (sp.index || 0); }, spec);
  }

  async type(selector, text) {
    await this.eval((s) => { const el = document.querySelector(s); if (!el) throw new Error('type: not found ' + s); el.scrollIntoView({ block: 'center', behavior: 'instant' }); el.focus(); if ('value' in el) el.value = ''; }, selector);
    await this.send('Input.insertText', { text: String(text) });
  }

  async press(key) {
    const codes = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39 };
    const vk = codes[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
    const base = { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
    await this.send('Input.dispatchKeyEvent', { type: key.length === 1 ? 'keyDown' : 'rawKeyDown', ...base, ...(key.length === 1 ? { text: key } : key === 'Enter' ? { text: '\r' } : {}) });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }

  // ----- screenshots -----
  async screenshot(name, { fullPage = true, force = false, maxHeight = 4000 } = {}) {
    if (this.noShots && !force) return null;
    fs.mkdirSync(this.outDir, { recursive: true });
    const vp = this.viewport || { name: 'vp', width: 1280, height: 900 };
    const file = path.join(this.outDir, `${slug(this.scenario || 'page')}__${slug(name)}__${vp.name}.png`);
    const params = { format: 'png' };
    if (fullPage) {
      const m = await this.send('Page.getLayoutMetrics');
      const cs = m.cssContentSize || m.contentSize;
      params.captureBeyondViewport = true;
      params.clip = { x: 0, y: 0, width: vp.width, height: Math.max(vp.height, Math.min(Math.ceil(cs.height), maxHeight)), scale: 1 };
    }
    const { data } = await this.send('Page.captureScreenshot', params, 60000);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return path.relative(process.cwd(), file) || file;
  }

  // ----- issue collectors -----
  takeIssues() {
    const out = this.shared.issues;
    this.shared.issues = { console: [], network: [], dialogs: [] };
    return out;
  }
  get crashed() { return this.shared.crashed; }
  // responses seen since `sinceMs` (epoch ms), optionally filtered by a RegExp on the URL
  responses(re, sinceMs = 0) { return this.shared.responses.filter((r) => r.t >= sinceMs && (!re || re.test(r.url))); }

  classifyIssues(issues) {
    const C = this.config;
    const errors = [], warnings = [];
    const ign = (list, s) => (list || []).some((re) => re.test(s));
    for (const e of issues.console) {
      const s = `${e.kind}: ${e.text} ${e.url ? `(${e.url}${e.line !== undefined ? ':' + (e.line + 1) : ''})` : ''}`;
      if (ign(C.ignoreConsole, s)) continue;
      errors.push(`console ${s}`);
    }
    for (const n of issues.network) {
      const s = `${n.status ? `HTTP ${n.status}` : n.error} ${n.url}`;
      if (ign(C.ignoreRequests, n.url)) continue;
      const external = !n.url.startsWith(this.origin);
      if (external && C.externalRequestFailures !== 'fail') warnings.push(`external request failed: ${s}`);
      else errors.push(`request failed: ${s}`);
    }
    for (const d of issues.dialogs) warnings.push(`dialog ${d.type}: ${d.message}`);
    return { errors, warnings };
  }

  // Generic checks for the current page. Records soft failures; returns the list of problems.
  async verify(label, { allowShort = false, minText, issues = true } = {}) {
    const C = this.config;
    const prev = this.result ? this.result.step : null;
    if (label) this.step(label);
    const problems = [];
    if (issues) {
      const { errors, warnings } = this.classifyIssues(this.takeIssues());
      for (const e of errors) { problems.push(e); await this.fail(`${e} [first seen on ${await this.hash().catch(() => '?')}]`, { key: e }); }
      warnings.forEach((w) => this.warn(w));
    }
    const nIssues = problems.length;
    const res = await this.eval((cfg) => {
      const main = document.querySelector(cfg.main);
      const mainText = main ? main.innerText : '';
      const bodyText = document.body ? document.body.innerText : '';
      const out = { mainLen: mainText.replace(/\s+/g, ' ').trim().length, hasMain: !!main, hash: location.hash };
      // layout viewport width: with mobile emulation Chrome zooms out to fit wide content, which
      // inflates innerWidth, so measure against documentElement.clientWidth as well
      out.scrollWidth = document.documentElement.scrollWidth;
      out.innerWidth = Math.min(innerWidth, document.documentElement.clientWidth || innerWidth);
      out.zoomedOut = innerWidth > out.innerWidth + 1 ? innerWidth : 0;
      // Elements partly cut by the viewport edge whose nearest clipping ancestor is page level
      // (html/body/main or none). Catches overflow hidden by body{overflow-x:hidden}; ignores scroll
      // containers and component-level clipping (tickers, cards) and fully off-canvas elements.
      out.culprits = [];
      {
        const W = out.innerWidth;
        const pageLevel = new Set([document.documentElement, document.body, main]);
        const bad = [];
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          const cutRight = r.right > W + 1 && r.left < W - 1;
          const cutLeft = r.left < -1 && r.right > 1;
          if (!cutRight && !cutLeft) continue;
          let p = el.parentElement, clipper = null;
          while (p) { if (getComputedStyle(p).overflowX !== 'visible') { clipper = p; break; } p = p.parentElement; }
          if (clipper && !pageLevel.has(clipper)) continue;
          if (getComputedStyle(el).visibility === 'hidden' || el.closest('[aria-hidden="true"]')) continue;
          bad.push(el);
        }
        const outer = bad.filter((el) => !bad.includes(el.parentElement));
        out.nCut = outer.length;
        out.culprits = outer.slice(0, 4).map((el) => { const r = el.getBoundingClientRect(); return `${__desc(el)} [left=${Math.round(r.left)} right=${Math.round(r.right)} width=${Math.round(r.width)}]`; });
      }
      out.bad = [];
      for (const [src, flags] of cfg.badText) {
        const re = new RegExp(src, flags);
        const m = re.exec(bodyText);
        if (m) out.bad.push({ pattern: src, snippet: bodyText.slice(Math.max(0, m.index - 50), m.index + m[0].length + 50).replace(/\s+/g, ' ') });
      }
      for (const [src, flags] of cfg.badMainText) {
        const re = new RegExp(src, flags);
        const m = re.exec(mainText);
        if (m) out.bad.push({ pattern: src, snippet: mainText.slice(Math.max(0, m.index - 30), m.index + m[0].length + 60).replace(/\s+/g, ' ') });
      }
      out.badAttrs = [];
      for (const el of document.querySelectorAll('svg, svg *, [style]')) {
        for (const a of el.attributes) {
          if (/\b(NaN|undefined|Infinity)\b/.test(a.value)) { out.badAttrs.push(`${el.tagName.toLowerCase()}[${a.name}="${a.value.slice(0, 60)}"]`); break; }
        }
        if (out.badAttrs.length >= 3) break;
      }
      out.brokenImgs = [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.src && !i.src.startsWith('data:')).map((i) => i.src).slice(0, 3);
      return out;
    }, {
      main: C.selectors.main,
      badText: C.badText.map((re) => [re.source, re.flags.replace('g', '')]),
      badMainText: C.badMainText.map((re) => [re.source, re.flags.replace('g', '')]),
    });
    const min = minText ?? C.minMainText;
    if (!res.hasMain) problems.push(`main element ${C.selectors.main} missing`);
    else if (!allowShort && res.mainLen <= min) problems.push(`main has too little text (${res.mainLen} chars <= ${min})`);
    if (res.scrollWidth > res.innerWidth + 1 || res.zoomedOut) problems.push(`horizontal overflow: scrollWidth ${res.scrollWidth} > viewport ${res.innerWidth}${res.zoomedOut ? ` (mobile zoom-out to ${res.zoomedOut}px)` : ''}; culprits: ${res.culprits.join(' ; ') || 'n/a'}`);
    else if (res.nCut) problems.push(`content cut off at the viewport edge (${res.nCut} element(s) wider than ${res.innerWidth}px, hidden by page-level overflow clipping): ${res.culprits.join(' ; ')}`);
    for (const b of res.bad) problems.push(`bad visible text /${b.pattern}/: "...${b.snippet}..."`);
    if (res.badAttrs.length) problems.push(`bad attribute values: ${res.badAttrs.join(' ; ')}`);
    if (res.brokenImgs.length) problems.push(`broken images: ${res.brokenImgs.join(' ; ')}`);
    for (const p of problems.slice(nIssues)) await this.fail(`${p} [${res.hash}]`);
    if (prev !== null && label && this.result) this.result.step = prev;
    return problems;
  }

  // =========================================================================
  // Quiz helpers (selectors and texts come from config.quiz)
  // =========================================================================
  async quizState() {
    const Q = this.config.quiz;
    return this.eval((q) => {
      const main = document.querySelector(q.main) || document.body;
      const stage = main.querySelector(q.stage) || main;
      const opts = [...stage.querySelectorAll(q.option)].filter(__vis);
      const num = [...stage.querySelectorAll(q.numericInput)].find(__vis);
      const sjt = [...stage.querySelectorAll(q.sjtGrid)].find(__vis);
      let kind = null;
      if (sjt) kind = 'sjt';
      else if (num) kind = 'numeric';
      else if (opts.length) kind = (opts.length === 3 && opts.every((o) => /^[TFC]$/.test(o.dataset.v || ''))) ? 'tfc' : 'mcq';
      let locked = false;
      if (kind === 'numeric') locked = num.disabled;
      else if (kind === 'sjt') locked = [...sjt.querySelectorAll(q.sjtPick)].every((b) => b.disabled);
      else if (kind) locked = opts.every((o) => o.disabled);
      const vEl = [...stage.querySelectorAll(q.verdict)].find(__vis) || stage.querySelector(q.verdict);
      const verdict = vEl ? (['ok', 'ko', 'mid'].find((c) => vEl.classList.contains(c)) || 'unknown') : null;
      const btns = [...main.querySelectorAll('button, a.btnlink, a[role=button], [role=button]')].filter((b) => __vis(b) && !b.disabled);
      const btn = (src) => btns.find((b) => new RegExp(src, 'i').test((b.innerText || '').trim()));
      const nextB = btn(q.nextText);
      const startB = btn(q.startText);
      const rep = main.querySelector(q.report);
      const stemEl = stage.querySelector(q.stem);
      const progEl = main.querySelector(q.progress);
      return {
        kind, locked, verdict,
        nOptions: kind === 'sjt' ? sjt.querySelectorAll(q.sjtPick).length / 2 : opts.length,
        stem: stemEl ? stemEl.innerText.replace(/\s+/g, ' ').trim() : '',
        options: opts.map((o) => o.innerText.replace(/\s+/g, ' ').trim()),
        prog: progEl ? progEl.innerText.trim() : '',
        next: nextB ? nextB.innerText.trim() : null,
        start: startB ? startB.innerText.trim() : null,
        report: !!(rep && __vis(rep)),
        reportText: rep ? rep.innerText.replace(/\s+/g, ' ').trim().slice(0, 300) : '',
        hash: location.hash,
      };
    }, { ...Q, main: this.config.selectors.main });
  }

  // Best effort: look the displayed item up in the loaded content bank (no app hook needed).
  // Returns { type, answer, best, worst } or null (e.g. generated items).
  async resolveAnswer(state) {
    const mod = this.config.quiz.contentModule;
    if (!mod) return null;
    return this.eval(async (modPath, stem, options) => {
      try {
        const m = await import(new URL(modPath, location.href).href);
        const C = typeof m.content === 'function' ? m.content() : null;
        const items = (C && C.items) || [];
        const n = (s) => String(s || '').replace(/\s+/g, ' ').trim();
        const key = n(stem).slice(0, 160);
        const cands = items.filter((i) => n(i.stem).slice(0, 160) === key);
        const strip = (s) => n(s).replace(/^[A-F]\s*/, '');
        const it = cands.find((i) => !i.options || !options.length || i.options.every((o, k) => options[k] && strip(options[k]).endsWith(n(o)))) || (cands.length === 1 ? cands[0] : null);
        return it ? { type: it.type, answer: it.answer, best: it.best, worst: it.worst, id: it.id } : null;
      } catch (e) { return null; }
    }, mod, state.stem, state.options || []);
  }

  // Answer the current quiz item through the UI.
  // {correct: true} answers right when the item can be resolved from the bank, {correct: false} answers wrong
  // when it can be resolved; otherwise (and by default) it picks option 1 / True / "1" / SJT A most + B least.
  async answerCurrent({ correct, value } = {}) {
    const Q = this.config.quiz;
    const st = await this.quizState();
    if (!st.kind) throw new Error(`answerCurrent: no answerable item on screen (hash ${st.hash}, next=${st.next}, start=${st.start}, report=${st.report})`);
    if (st.locked) throw new Error('answerCurrent: current item is already answered (locked)');
    let known = null;
    if (correct !== undefined) known = await this.resolveAnswer(st);
    const res = { kind: st.kind, stem: st.stem, prog: st.prog, correctKnown: !!known, intended: correct === undefined ? 'first' : (known ? (correct ? 'right' : 'wrong') : 'first') };
    if (st.kind === 'mcq' || st.kind === 'tfc') {
      let idx = 0;
      if (known) {
        const ans = st.kind === 'tfc' ? ['T', 'F', 'C'].indexOf(known.answer) : Number(known.answer);
        idx = correct ? ans : (ans === 0 ? 1 : 0);
      }
      if (typeof value === 'number') idx = value;
      res.choice = idx;
      await this.click(Q.option, { index: idx, within: Q.stageWithin });
    } else if (st.kind === 'numeric') {
      let v = value ?? '1';
      if (known) v = correct ? String(known.answer) : String(Number(known.answer) * 3 + 17);
      res.choice = v;
      await this.type(`${Q.stageWithin ? Q.stageWithin + ' ' : ''}${Q.numericInput}`, v);
      if (await this.has(Q.numericSubmit, { within: Q.stageWithin })) await this.click(Q.numericSubmit, { within: Q.stageWithin });
      else await this.press('Enter');
    } else if (st.kind === 'sjt') {
      let most = 0, least = 1;
      if (known) { if (correct) { most = known.best; least = known.worst; } else { most = known.worst; least = known.best; } }
      res.choice = [most, least];
      await this.click(`${Q.sjtGrid} ${Q.sjtPick}`, { index: most * 2, within: Q.stageWithin });
      await this.click(`${Q.sjtGrid} ${Q.sjtPick}`, { index: least * 2 + 1, within: Q.stageWithin });
      await this.click({ text: new RegExp(Q.confirmText, 'i') }, { within: Q.stageWithin });
    }
    // wait for the effect: verdict, next item, interstitial or report
    const t0 = Date.now();
    let after = null;
    while (Date.now() - t0 < 6000) {
      after = await this.quizState();
      if (after.verdict || after.report || (after.kind && !after.locked && (after.prog !== st.prog || after.stem !== st.stem)) || (!after.kind && after.start)) break;
      await sleep(50);
    }
    res.verdict = after ? after.verdict : null;
    res.after = after;
    if (after && after.verdict) {
      res.explanation = await this.eval((q) => {
        const main = document.querySelector(q.main) || document.body;
        const stage = main.querySelector(q.stage) || main;
        const ex = stage.querySelector(q.expl);
        if (!ex) return { present: false, steps: 0, open: false };
        return { present: true, steps: ex.querySelectorAll(q.explSteps).length, open: ex.classList.contains('open') || __vis(ex.querySelector(q.explSteps)), text: ex.innerText.replace(/\s+/g, ' ').trim().slice(0, 200) };
      }, { ...Q, main: this.config.selectors.main });
    }
    return res;
  }

  // Drive a quiz (drill, mock with interstitials, review) until the report appears.
  // answer: 'first' | 'correct' | 'wrong' | (state, i) => answerCurrent opts
  // onAnswered(result, i): optional async hook after each answer (verdict visible in feedback modes)
  async runQuiz({ answer = 'first', onAnswered, maxItems = 150, stuckMs = 8000, clickStart = true } = {}) {
    const Q = this.config.quiz;
    const startHash = (await this.hash()).split('?')[0];
    const answered = [];
    let lastSig = '', lastChange = Date.now(), starts = 0;
    for (let guard = 0; guard < maxItems * 6; guard++) {
      const st = await this.quizState();
      const curHash = st.hash.split('?')[0];
      if (curHash !== startHash && !Q.allowHashChange.some((re) => re.test(st.hash))) throw new Error(`runQuiz: navigated away from ${startHash} to ${st.hash}`);
      if (st.report) {
        const m = st.reportText.match(/(\d{1,3})\s*%/);
        return { answered, report: { text: st.reportText, score: m ? Number(m[1]) : null }, starts };
      }
      const sig = JSON.stringify([st.kind, st.locked, st.verdict, st.prog, st.stem.slice(0, 80), st.next, st.start]);
      if (sig !== lastSig) { lastSig = sig; lastChange = Date.now(); }
      else if (Date.now() - lastChange > stuckMs) {
        const txt = oneLine(await this.text(), 300);
        throw new Error(`runQuiz: stuck for ${stuckMs} ms after ${answered.length} answers; state=${sig}; main="${txt}"`);
      }
      if (st.kind && !st.locked) {
        if (answered.length >= maxItems) throw new Error(`runQuiz: more than ${maxItems} items, giving up`);
        const opts = typeof answer === 'function' ? (await answer(st, answered.length)) || {} : answer === 'correct' ? { correct: true } : answer === 'wrong' ? { correct: false } : {};
        const r = await this.answerCurrent(opts);
        answered.push(r);
        this.log(`answered #${answered.length} ${r.kind} -> ${r.verdict || '(no feedback)'}`);
        if (onAnswered) await onAnswered(r, answered.length - 1);
        continue;
      }
      if (st.verdict && st.next) { await this.click({ text: new RegExp(Q.nextText, 'i') }, { within: this.config.selectors.main }); await sleep(30); continue; }
      if (!st.kind && st.start && clickStart) { starts++; await this.click({ text: new RegExp(Q.startText, 'i') }, { within: this.config.selectors.main }); await sleep(60); continue; }
      await sleep(60);
    }
    throw new Error('runQuiz: loop guard exceeded');
  }
}
