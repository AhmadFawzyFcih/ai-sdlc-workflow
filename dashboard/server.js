#!/usr/bin/env node
// backend dashboard — local web UI for the `backend` Claude Code plugin.
// Listens on 127.0.0.1 only. Every API call needs the per-run token that is embedded in the page.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as plans from './lib/plans.js';
import { Sessions } from './lib/sessions.js';
import { Procs } from './lib/procs.js';
import { Worktrees } from './lib/worktrees.js';
import { Monitor } from './lib/monitor.js';
import * as C from './lib/compose.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8'));

// ---------- options ----------
const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`backend-dash ${PKG.version}

Usage: backend-dash [--project <path>] [--port <n>] [--open] [--no-open]

  --project <path>  add this project and show it first (default: the current folder, if it is a git repo)
  --port <n>        port on 127.0.0.1 (default 4545, or $BACKEND_DASH_PORT)
  --open            open the browser (default when started from a terminal)
  --no-open         don't open the browser

Environment: BACKEND_DASH_CLAUDE = claude binary to run (default "claude").`);
  process.exit(0);
}
const PORT = Number(opt('--port', process.env.BACKEND_DASH_PORT || 4545));
const CLAUDE_BIN = process.env.BACKEND_DASH_CLAUDE || 'claude';
const CONFIG_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'backend-dash');
const TOKEN = crypto.randomBytes(24).toString('hex');
fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });

fixSpawnHelper();
const watchers = new Map();
const watchedBy = new Map(); // project → real path of its plans folder

// ---------- projects ----------
const PROJECTS_FILE = path.join(CONFIG_DIR, 'projects.json');
const expand = (p) => path.resolve(String(p || '').replace(/^~(?=$|\/)/, os.homedir()));
let projects = (() => { try { return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8')).projects || []; } catch { return []; } })();
const saveProjects = () => fs.writeFileSync(PROJECTS_FILE, JSON.stringify({ projects }, null, 2) + '\n', { mode: 0o600 });
function addProject(p, first = false, after = null) {
  const abs = expand(p);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error('Folder not found: ' + abs);
  projects = projects.filter((x) => x !== abs);
  if (after && projects.includes(after)) {
    // right after its main checkout and that checkout's other worktrees
    let i = projects.indexOf(after) + 1;
    while (i < projects.length && worktrees.byPath(projects[i]) && worktrees.byPath(projects[i]).main === after) i++;
    projects.splice(i, 0, abs);
  } else first ? projects.unshift(abs) : projects.push(abs);
  saveProjects();
  watchProject(abs);
  return abs;
}
function removeProject(p) {
  projects = projects.filter((x) => x !== p); saveProjects();
  unwatchProject(p);
}
const procs = new Procs();
const worktrees = new Worktrees({ configDir: CONFIG_DIR, procs });
const startProject = opt('--project', null) || (fs.existsSync(path.join(process.cwd(), '.git')) ? process.cwd() : null);
if (startProject) { try { addProject(startProject, true); } catch (e) { console.error(e.message); } }
const isProject = (p) => projects.includes(p);

// ---------- Claude Code hooks injected into dashboard sessions ----------
const SETTINGS_PATH = path.join(CONFIG_DIR, 'session-hooks.json');
const hookCmd = `curl -s -m 2 -o /dev/null -X POST -H 'Content-Type: application/json' -H 'X-Dash-Token: ${TOKEN}' --data-binary @- 'http://127.0.0.1:${PORT}/api/hook' || true`;
const hookEntry = [{ hooks: [{ type: 'command', command: hookCmd, timeout: 5 }] }];
fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ hooks: { UserPromptSubmit: hookEntry, PreToolUse: hookEntry, Notification: hookEntry, Stop: hookEntry } }, null, 2), { mode: 0o600 });

const sessions = new Sessions({ claudeBin: CLAUDE_BIN, settingsPath: SETTINGS_PATH });


// ---------- live file watching ----------
// Worktrees link .plans/ to the main checkout's, so several projects can share one folder:
// it is watched once (by its real path) and every project that uses it is told.
function realPlans(root) { const { abs } = plans.plansDirOf(root); try { return fs.realpathSync(abs); } catch { return abs; } }
function watchProject(root) {
  const { abs } = plans.plansDirOf(root);
  try { if (!fs.existsSync(abs)) fs.mkdirSync(abs, { recursive: false }); } catch {}
  const real = realPlans(root);
  watchedBy.set(root, real);
  if (watchers.has(real)) return;
  let timer = null;
  const fire = () => {
    clearTimeout(timer);
    timer = setTimeout(() => broadcast({ t: 'tree', projects: [...watchedBy].filter(([, r]) => r === real).map(([p]) => p) }), 250);
  };
  try {
    watchers.set(real, fs.watch(real, { recursive: true }, fire));
  } catch {
    // Recursive watch unsupported here: poll the folder instead.
    let last = '';
    watchers.set(real, setInterval(() => {
      const sig = JSON.stringify(plans.tree(root));
      if (sig !== last) { if (last) fire(); last = sig; }
    }, 2000));
  }
}
function unwatchProject(root) {
  const real = watchedBy.get(root);
  watchedBy.delete(root);
  if (!real || [...watchedBy.values()].includes(real)) return;
  const w = watchers.get(real);
  if (w) { if (typeof w.close === 'function') w.close(); else clearInterval(w); }
  watchers.delete(real);
}
worktrees.linkAllPlans(); // every worktree sees the main checkout's plans (repairs older worktrees)
projects.forEach((p) => { if (fs.existsSync(p)) watchProject(p); });
worktrees.on('plans', (rec) => { unwatchProject(rec.path); watchProject(rec.path); broadcast({ t: 'tree', projects: [rec.path] }); });

// ---------- monitor ----------
// Main checkouts with a compose file: their compose project name and which services are "app" ones.
let mainInfo = [];
async function refreshMainInfo() {
  const out = [];
  for (const p of projects) {
    if (worktrees.byPath(p) || !fs.existsSync(p)) continue;
    try { const { doc } = worktrees.readMainCompose(p); out.push({ path: p, project: await worktrees.mainProject(p), app: C.classify(doc).app }); } catch {}
  }
  mainInfo = out;
  worktrees.setMains(out.map((m) => m.path));
}
const monitor = new Monitor({ worktrees, procs, sessions, mains: () => mainInfo });
worktrees.monitor = monitor;

// ---------- http ----------
const STATIC = {
  '/': ['public/index.html', 'text/html'],
  '/app.js': ['public/app.js', 'text/javascript'],
  '/skills.js': ['public/skills.js', 'text/javascript'],
  '/worktrees.js': ['public/worktrees.js', 'text/javascript'],
  '/app.css': ['public/app.css', 'text/css'],
  '/sw.js': ['public/sw.js', 'text/javascript'],
  '/vendor/xterm.js': ['node_modules/@xterm/xterm/lib/xterm.js', 'text/javascript'],
  '/vendor/xterm.css': ['node_modules/@xterm/xterm/css/xterm.css', 'text/css'],
  '/vendor/addon-fit.js': ['node_modules/@xterm/addon-fit/lib/addon-fit.js', 'text/javascript'],
  '/vendor/marked.js': ['node_modules/marked/lib/marked.umd.js', 'text/javascript'],
  '/vendor/purify.js': ['node_modules/dompurify/dist/purify.min.js', 'text/javascript']
};
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);

const server = http.createServer(async (req, res) => {
  try {
    if (!ALLOWED_HOSTS.has(req.headers.host || '')) return send(res, 403, { error: 'Bad host' });
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && STATIC[url.pathname]) return serveStatic(res, url.pathname);
    if (req.method === 'GET' && url.pathname.startsWith('/view/')) return serveView(res, url.pathname.slice(6));
    if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
    if (req.headers['x-dash-token'] !== TOKEN) return send(res, 401, { error: 'Missing or wrong token' });
    const body = req.method === 'POST' ? await readBody(req) : {};
    return await api(req.method, url, body, res);
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.message });
  }
});

async function api(method, url, body, res) {
  const p = url.pathname;
  const project = url.searchParams.get('project') || body.project;
  const needProject = () => {
    if (!project || !isProject(project)) { send(res, 400, { error: 'Unknown project' }); return false; }
    return true;
  };

  if (method === 'GET' && p === '/api/projects') {
    return send(res, 200, { projects: projects.map(projectView), home: os.homedir() });
  }
  if (method === 'POST' && p === '/api/projects') {
    try { const added = addProject(body.path, !!body.first); await refreshMainInfo(); return send(res, 200, { path: added }); } catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (method === 'POST' && p === '/api/projects/remove') {
    if (worktrees.byPath(body.path)) return send(res, 400, { error: 'This is a worktree — delete it from the Worktrees page instead.' });
    removeProject(body.path); await refreshMainInfo(); return send(res, 200, { ok: true });
  }
  if (method === 'GET' && p === '/api/tree') { if (!needProject()) return; return send(res, 200, Object.assign(plans.tree(project), { branch: await plans.currentBranch(project) })); }
  if (method === 'GET' && p === '/api/index') { if (!needProject()) return; return send(res, 200, await plans.index(project)); }
  if (method === 'GET' && p === '/api/folder') { if (!needProject()) return; return send(res, 200, await plans.folder(project, url.searchParams.get('path'))); }
  if (method === 'GET' && p === '/api/file') { if (!needProject()) return; return send(res, 200, plans.readFile(project, url.searchParams.get('path'))); }
  if (method === 'POST' && p === '/api/open') {
    if (!needProject()) return;
    const abs = plans.safeResolve(project, body.path);
    if (!abs || !fs.existsSync(abs)) return send(res, 400, { error: 'Not found' });
    execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [abs], () => {});
    return send(res, 200, { ok: true });
  }
  if (method === 'POST' && p === '/api/open-editor') {
    const dir = path.resolve(String(body.path || ''));
    if (!isProject(dir) && !worktrees.byPath(dir)) return send(res, 400, { error: 'Unknown project' });
    return send(res, 200, await worktrees.openEditor(dir));
  }
  if (method === 'GET' && p === '/api/download') {
    if (!needProject()) return;
    const abs = plans.safeResolve(project, url.searchParams.get('path'));
    if (!abs || abs === plans.plansDirOf(project).abs || !fs.existsSync(abs)) return send(res, 400, { error: 'No such file or folder inside the plans directory' });
    const dir = fs.statSync(abs).isDirectory();
    const name = path.basename(abs) + (dir ? '.zip' : '');
    const head = { 'Content-Type': dir ? 'application/zip' : 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (!dir) { res.writeHead(200, Object.assign(head, { 'Content-Length': fs.statSync(abs).size })); return fs.createReadStream(abs).pipe(res); }
    const zip = spawn('zip', ['-r', '-q', '-', path.basename(abs)], { cwd: path.dirname(abs) });
    let started = false;
    zip.stdout.on('data', (c) => { if (!started) { started = true; res.writeHead(200, head); } res.write(c); });
    zip.on('error', (e) => { if (!started) send(res, 500, { error: 'zip failed: ' + e.message }); else res.destroy(); });
    zip.on('close', (code) => { if (!started) return send(res, 500, { error: 'zip failed (exit ' + code + ')' }); if (code) res.destroy(); else res.end(); });
    return;
  }
  if (method === 'POST' && p === '/api/delete') {
    if (!needProject()) return;
    const abs = plans.safeResolve(project, body.path);
    if (!abs || abs === plans.plansDirOf(project).abs || !fs.existsSync(abs)) return send(res, 400, { error: 'No such file or folder inside the plans directory' });
    try { await plans.moveToTrash(abs); } catch (e) { return send(res, 500, { error: e.message }); }
    return send(res, 200, { ok: true });
  }
  if (method === 'POST' && p === '/api/view') {
    if (!needProject()) return;
    const abs = plans.safeResolve(project, body.path);
    if (!abs || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return send(res, 400, { error: 'Not found' });
    const ticket = crypto.randomBytes(16).toString('hex');
    views.set(ticket, { abs, at: Date.now() });
    return send(res, 200, { url: '/view/' + ticket });
  }
  if (method === 'POST' && p === '/api/subtask-status') {
    if (!needProject()) return;
    return send(res, 200, await plans.setSubtaskStatus(project, String(body.key || ''), String(body.status || '')));
  }
  if (method === 'GET' && p === '/api/sessions') return send(res, 200, { sessions: sessions.list() });
  if (method === 'POST' && p === '/api/sessions') {
    if (!needProject()) return;
    const s = sessions.create({ project, command: String(body.command || '').trim(), title: String(body.title || '').slice(0, 80), key: body.key || null, env: wtEnv(project) });
    return send(res, 200, { id: s.id });
  }
  let m;
  if (method === 'POST' && (m = p.match(/^\/api\/sessions\/([\w-]+)\/(kill|dismiss|reopen)$/))) {
    const s = sessions.get(m[1]);
    if (!s) return send(res, 404, { error: 'No such session' });
    if (m[2] === 'kill') sessions.kill(s.id);
    if (m[2] === 'dismiss') sessions.dismiss(s.id);
    if (m[2] === 'reopen') {
      if (s.pty) return send(res, 200, { ok: true });
      if (!sessions.canReopen(s.id)) return send(res, 409, { error: 'Nothing to reopen — no message was ever sent in this session.' });
      sessions.create({ project: s.project, title: s.title, key: s.key, resumeId: s.id, env: wtEnv(s.project) });
    }
    return send(res, 200, { ok: true });
  }
  if (method === 'POST' && p === '/api/hook') { sessions.hook(body); return send(res, 200, { ok: true }); }
  if (p.startsWith('/api/worktrees') || p.startsWith('/api/shared') || p.startsWith('/api/monitor') || p.startsWith('/api/procs')) return worktreeApi(method, p, url, body, res);
  return send(res, 404, { error: 'Not found' });
}

// ---------- worktrees ----------
function projectView(x) {
  const w = worktrees.byPath(x);
  return {
    path: x, name: w ? w.key : path.basename(x), ok: fs.existsSync(x), plans: plans.plansDirOf(x).rel,
    worktree: w ? { id: w.id, main: w.main, slot: w.slot, branch: w.branch, key: w.key, url: worktrees.url(w) } : null,
    hasCompose: !w && ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'].some((f) => fs.existsSync(path.join(x, f))),
    env: w ? { id: w.id } : (worktrees.mains().find((m) => m.path === x) ? { id: worktrees.mains().find((m) => m.path === x).id, main: true } : null)
  };
}
const wtEnv = (p) => { const w = worktrees.byPath(p); return w ? worktrees.sessionEnv(w) : null; };
const mainOf = (p) => { const w = worktrees.byPath(p); return w ? w.main : p; };

async function worktreeApi(method, p, url, body, res) {
  let m;
  if (method === 'GET' && p === '/api/worktrees') {
    const status = await worktrees.statusAll();
    const mains = [...new Set(projects.filter((x) => !worktrees.byPath(x) && projectView(x).hasCompose).concat(worktrees.list().map((w) => w.main)))];
    const shared = {};
    if (status.docker) for (const x of mains) shared[x] = await worktrees.sharedStatus(x);
    return send(res, 200, {
      worktrees: worktrees.list().map((w) => Object.assign({}, w, { status: status.worktrees[w.id], url: worktrees.url(w) })),
      mainEnvs: worktrees.mains().map((m) => Object.assign({}, m, { status: status.worktrees[m.id], url: worktrees.url(m) })),
      mains, shared, banner: worktrees.sharedBanner(), docker: status.docker, dockerError: status.dockerError
    });
  }
  if (method === 'GET' && p === '/api/worktrees/inspect') {
    const main = mainOf(url.searchParams.get('project'));
    if (!isProject(main)) return send(res, 400, { error: 'Unknown project' });
    return send(res, 200, await worktrees.inspect(main));
  }
  if (method === 'POST' && p === '/api/worktrees') {
    const main = mainOf(body.main);
    if (!isProject(main)) return send(res, 400, { error: 'Unknown project' });
    const rec = await worktrees.create(Object.assign({}, body, { main }));
    addProject(rec.path, false, main);
    await refreshMainInfo();
    if (body.start) {
      worktrees.step(rec.id, 'all', { forceStart: !!body.forceStart })
        .then((r) => { if (r.needsChoice || r.confirm) broadcast({ t: 'wtask', id: rec.id, step: 'all', r }); })
        .catch((e) => broadcast({ t: 'wterror', id: rec.id, error: e.message }));
    }
    return send(res, 200, { worktree: rec, project: projectView(rec.path) });
  }
  if ((m = p.match(/^\/api\/worktrees\/([\w-]+)$/)) && method === 'GET') return send(res, 200, await worktrees.detail(m[1]));
  if ((m = p.match(/^\/api\/worktrees\/([\w-]+)\/step$/)) && method === 'POST') {
    const r = await worktrees.step(m[1], String(body.step || ''), { force: !!body.force, forceStart: !!body.forceStart });
    return send(res, r.needsChoice || r.confirm ? 409 : 200, Object.assign({}, r, r.proc ? { proc: procView(r.proc) } : {}));
  }
  if ((m = p.match(/^\/api\/worktrees\/([\w-]+)\/stop$/)) && method === 'POST') return send(res, 200, await worktrees.stop(m[1]));
  if ((m = p.match(/^\/api\/worktrees\/([\w-]+)\/settings$/)) && method === 'POST') return send(res, 200, worktrees.setAutoStart(m[1], !!body.autoStart));
  if ((m = p.match(/^\/api\/worktrees\/([\w-]+)\/db$/)) && method === 'POST') return send(res, 200, await worktrees.setDbMode(m[1], String(body.mode || '')));
  if ((m = p.match(/^\/api\/worktrees\/([\w-]+)\/rollback$/)) && method === 'POST') return send(res, 200, await worktrees.rollbackShared(m[1]));
  if ((m = p.match(/^\/api\/worktrees\/([\w-]+)\/delete-plan$/)) && method === 'GET') return send(res, 200, await worktrees.deletePlan(m[1]));
  if ((m = p.match(/^\/api\/worktrees\/([\w-]+)\/delete$/)) && method === 'POST') {
    const rec = worktrees.get(m[1]);
    for (const s of sessions.list()) if (s.project === rec.path) sessions.dismiss(s.id);
    const r = await worktrees.remove(m[1], { dropDb: body.dropDb !== false, rollback: !!body.rollback, deleteBranch: !!body.deleteBranch, force: !!body.force });
    removeProject(rec.path);
    for (const pr of procs.list()) if (pr.wt === m[1]) procs.remove(pr.id);
    refreshMainInfo();
    return send(res, 200, r);
  }
  if ((m = p.match(/^\/api\/shared\/(start|stop|logs)$/)) && method === 'POST') {
    const main = mainOf(body.project);
    if (!isProject(main)) return send(res, 400, { error: 'Unknown project' });
    const r = await worktrees.sharedAction(main, m[1]);
    return send(res, 200, { proc: procView(r.proc) });
  }
  if (method === 'GET' && p === '/api/monitor') return send(res, 200, monitor.snapshot());
  if (method === 'GET' && p === '/api/monitor/disk') return send(res, 200, await monitor.diskSizes(url.searchParams.get('refresh') === '1'));
  if (method === 'GET' && p === '/api/procs') return send(res, 200, { procs: procs.list() });
  if ((m = p.match(/^\/api\/procs\/([\w-]+)\/log$/)) && method === 'GET') {
    const pr = procs.get(m[1]);
    if (!pr) return send(res, 404, { error: 'No such process' });
    return send(res, 200, { log: pr.buffer.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)|\x1b[@-_]/g, '').replace(/\r/g, '') });
  }
  if ((m = p.match(/^\/api\/procs\/([\w-]+)\/(kill|remove)$/)) && method === 'POST') {
    if (!procs.get(m[1])) return send(res, 404, { error: 'No such process' });
    m[2] === 'kill' ? procs.kill(m[1]) : procs.remove(m[1]);
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'Not found' });
}
const procView = (pr) => procs.list().find((x) => x.id === pr.id) || null;

// HTML plan files (API contracts, reports) open in their own sandboxed page: an opaque origin
// that cannot read the dashboard or call its API. Tickets are random and expire after 30 minutes.
const views = new Map();
function serveView(res, ticket) {
  const v = views.get(ticket);
  for (const [k, x] of views) if (Date.now() - x.at > 30 * 60 * 1000) views.delete(k);
  if (!v) return send(res, 404, { error: 'Expired — reopen the file' });
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': 'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox', 'X-Content-Type-Options': 'nosniff' });
  res.end(fs.readFileSync(v.abs));
}

function serveStatic(res, route) {
  const [file, type] = STATIC[route];
  let data = fs.readFileSync(path.join(HERE, file));
  if (route === '/') data = data.toString('utf8').replace('__DASH_TOKEN__', TOKEN).replace('__DASH_VERSION__', PKG.version);
  res.writeHead(200, {
    'Content-Type': type + '; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...(route === '/' ? { 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; frame-src 'self' blob: data:; frame-ancestors 'none'" } : {})
  });
  res.end(data);
}

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 2_000_000) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

// ---------- websocket ----------
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== '/ws' || !ALLOWED_HOSTS.has(req.headers.host || '') || !ALLOWED_ORIGINS.has(req.headers.origin || '') || url.searchParams.get('token') !== TOKEN) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
});
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ t: 'sessions', list: sessions.list() }));
  ws.send(JSON.stringify({ t: 'procs', list: procs.list() }));
  ws.monitoring = false;
  const isProc = (id) => String(id || '').startsWith('p-');
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.t === 'in') (isProc(msg.id) ? procs : sessions).input(msg.id, String(msg.data || ''));
    else if (msg.t === 'resize') (isProc(msg.id) ? procs : sessions).resize(msg.id, msg.cols, msg.rows);
    else if (msg.t === 'attach') { const s = (isProc(msg.id) ? procs : sessions).get(msg.id); if (s) ws.send(JSON.stringify({ t: 'buffer', id: s.id, data: s.buffer })); }
    else if (msg.t === 'monitor' && !!msg.on !== ws.monitoring) { ws.monitoring = !!msg.on; monitor.watch(ws.monitoring); }
  });
  ws.on('close', () => { if (ws.monitoring) monitor.watch(false); });
});
function broadcast(obj) {
  const data = JSON.stringify(obj);
  for (const c of wss.clients) if (c.readyState === 1) c.send(data);
}
sessions.on('out', (id, data) => broadcast({ t: 'out', id, data }));
sessions.on('update', (s) => broadcast({ t: 'session', s }));
sessions.on('removed', (id) => broadcast({ t: 'removed', id }));
sessions.on('attention', (s, kind) => broadcast({ t: 'attention', s, kind }));
procs.on('out', (id, data) => broadcast({ t: 'out', id, data }));
procs.on('update', (pr) => broadcast({ t: 'proc', p: pr }));
procs.on('removed', (id) => broadcast({ t: 'procRemoved', id }));
worktrees.on('changed', () => broadcast({ t: 'worktrees' }));
worktrees.on('error', (rec, e) => broadcast({ t: 'wterror', id: rec.id, error: e.message }));
monitor.onSample((snap) => {
  const d = snap.docker && snap.docker.total ? Math.round((snap.docker.used / snap.docker.total) * 100) : null;
  const data = JSON.stringify({ t: 'monitor', snap: Object.assign({}, snap, { history: monitor.history.slice(-1) }) });
  for (const c of wss.clients) if (c.readyState === 1) c.send(c.monitoring ? data : JSON.stringify({ t: 'dockerPct', pct: d }));
});
refreshMainInfo().then(() => { monitor.start(); return worktrees.autoStart(); }).catch((e) => console.error(e.message));
setInterval(refreshMainInfo, 60_000).unref();

// ---------- start ----------
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} is busy — is the dashboard already running? Open http://127.0.0.1:${PORT} or start with --port <n>.`);
  else console.error(e.message);
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => {
  const link = `http://127.0.0.1:${PORT}`;
  console.log(`backend dashboard ${PKG.version} → ${link}`);
  console.log(projects.length ? 'Projects: ' + projects.join(', ') : 'No project yet — add one from the page (Project → Add a project folder…).');
  console.log('Ctrl+C stops the dashboard and every Claude session it started.');
  const wantOpen = argv.includes('--open') || (!argv.includes('--no-open') && process.stdout.isTTY);
  if (wantOpen) execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [link], () => {});
});
// Ctrl+C: stop what the dashboard started (`docker compose up` stops its containers, up to 30s); a second Ctrl+C quits now.
let stopping = false;
const shutdown = () => {
  if (stopping) { console.log('\nQuitting now — containers that were still stopping may keep running.'); process.exit(1); }
  stopping = true;
  sessions.killAll(); monitor.stop();
  const n = procs.running();
  if (n) console.log(`\nStopping ${n} command${n > 1 ? 's' : ''} the dashboard started (docker compose up, vite…) — Ctrl+C again to quit now.`);
  Promise.race([procs.killAll(), new Promise((r) => setTimeout(r, 40000))]).then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// npm installs can drop the execute bit on node-pty's macOS helper ("posix_spawnp failed").
function fixSpawnHelper() {
  const base = path.join(HERE, 'node_modules', '@lydell');
  let dirs = [];
  try { dirs = fs.readdirSync(base).filter((d) => d.startsWith('node-pty-darwin')); } catch { return; }
  for (const d of dirs) {
    for (const rel of ['spawn-helper', 'prebuilds/spawn-helper', 'build/Release/spawn-helper']) {
      const f = path.join(base, d, rel);
      try { if (fs.existsSync(f)) fs.chmodSync(f, 0o755); } catch {}
    }
  }
}
