// Memory, CPU and disk: the Mac, the Docker VM, and what each worktree (containers, Vite, Claude) uses.
// `docker stats` costs some CPU, so it samples every 5 s only while a Monitor tab is open, else every 30 s.
import os from 'node:os';
import fs from 'node:fs';
import { sh } from './sh.js';

const HISTORY = 360; // samples kept (30 min at 5 s)

export class Monitor {
  constructor({ worktrees, procs, sessions, mains }) {
    this.wt = worktrees; this.procs = procs; this.sessions = sessions; this.mains = mains;
    this.history = [];
    this.last = null;
    this.viewers = 0;
    this.cpuPrev = null;
    this.timer = null;
    this.disk = { at: 0, data: null, running: null };
    this.listeners = new Set();
  }

  start() { this.schedule(1000); }
  stop() { clearTimeout(this.timer); }
  watch(on) { this.viewers = Math.max(0, this.viewers + (on ? 1 : -1)); if (on) this.schedule(200); }
  onSample(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  schedule(ms) { clearTimeout(this.timer); this.timer = setTimeout(() => this.tick(), ms); }

  async tick() {
    try {
      const snap = await this.sample();
      this.last = snap;
      this.history.push({ at: snap.at, host: snap.host.used, docker: snap.docker.used });
      if (this.history.length > HISTORY) this.history.shift();
      this.listeners.forEach((fn) => { try { fn(snap); } catch {} });
    } catch {}
    this.schedule(this.viewers > 0 ? 5000 : 30000);
  }

  async sample() {
    const [host, disk, docker, procs] = await Promise.all([hostMemory(), diskFree(), this.dockerStats(), processStats()]);
    host.cpu = this.cpu();
    host.cores = os.cpus().length;
    host.load = os.loadavg()[0];
    return { at: Date.now(), host, disk, docker: docker.summary, groups: this.groups(docker.containers, procs), dockerError: docker.error };
  }

  cpu() {
    const now = os.cpus().map((c) => c.times);
    const prev = this.cpuPrev; this.cpuPrev = now;
    if (!prev) return null;
    let idle = 0; let total = 0;
    now.forEach((t, i) => {
      const p = prev[i] || t;
      const d = Object.keys(t).reduce((s, k) => s + (t[k] - p[k]), 0);
      total += d; idle += t.idle - p.idle;
    });
    return total ? Math.round((1 - idle / total) * 100) : null;
  }

  async dockerStats() {
    const docker = this.wt.docker;
    const [info, ps, stats] = await Promise.all([
      sh(docker, ['info', '--format', '{{.MemTotal}}'], { timeout: 15000 }),
      sh(docker, ['ps', '--format', '{{.Names}}\t{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.service"}}\t{{.Label "com.docker.compose.oneoff"}}'], { timeout: 15000 }),
      sh(docker, ['stats', '--no-stream', '--format', '{{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}'], { timeout: 30000 })
    ]);
    if (info.code !== 0) return { summary: { total: 0, used: 0, ok: false }, containers: [], error: 'Docker is not running' };
    const labels = {};
    for (const l of ps.stdout.split('\n').filter(Boolean)) { const [name, project, service, oneoff] = l.split('\t'); labels[name] = { project, service, oneoff: oneoff === 'True' }; }
    const containers = [];
    for (const l of stats.stdout.split('\n').filter(Boolean)) {
      const [name, mem, cpu] = l.split('\t');
      const lab = labels[name] || {};
      containers.push({ name, project: lab.project || null, service: lab.service || name, oneoff: !!lab.oneoff, mem: toBytes(String(mem).split('/')[0]), cpu: parseFloat(cpu) || 0 });
    }
    const total = Number(info.stdout.trim()) || 0;
    return { summary: { total, used: containers.reduce((s, c) => s + c.mem, 0), ok: true }, containers };
  }

  // Containers and our own processes, grouped: shared services, the main checkout, each worktree, other.
  groups(containers, procs) {
    const groups = new Map();
    const group = (key, label, kind, extra) => { if (!groups.has(key)) groups.set(key, Object.assign({ key, label, kind, items: [], mem: 0 }, extra || {})); return groups.get(key); };
    const mains = this.mains();
    const appOf = {};
    for (const m of mains) { try { appOf[m.project] = { main: m.path, app: new Set(m.app) }; } catch {} }
    const wts = this.wt.list();
    for (const c of containers) {
      const w = wts.find((x) => this.wt.project(x) === c.project);
      if (w) { group('wt:' + w.id, w.key, 'worktree', { id: w.id, path: w.path }).items.push(item(c)); continue; }
      const m = appOf[c.project];
      if (m) {
        if (m.app.has(c.service)) group('main:' + m.main, 'main · ' + m.main.split('/').pop(), 'main', { path: m.main }).items.push(item(c));
        else group('shared:' + m.main, 'Shared services', 'shared', { path: m.main }).items.push(item(c));
        continue;
      }
      group('other', 'Other containers', 'other').items.push(item(c));
    }
    // Vite / yarn processes we started, and Claude sessions — by the project they run in.
    const own = [];
    for (const p of this.procs.pids()) own.push({ pid: p.pid, name: p.kind === 'vite' ? 'vite' : p.kind || 'process', project: p.project });
    for (const s of this.sessions.list()) { const x = this.sessions.get(s.id); if (x && x.pty) own.push({ pid: x.pty.pid, name: 'claude', project: s.project }); }
    for (const o of own) {
      const st = procs[o.pid];
      if (!st) continue;
      const w = wts.find((x) => x.path === o.project);
      const g = w ? group('wt:' + w.id, w.key, 'worktree', { id: w.id, path: w.path }) : group('main:' + o.project, 'main · ' + String(o.project).split('/').pop(), 'main', { path: o.project });
      const same = g.items.find((i) => i.name === o.name && i.kind === 'process');
      if (same) { same.mem += st.mem; same.cpu += st.cpu; } else g.items.push({ name: o.name, mem: st.mem, cpu: st.cpu, kind: 'process' });
    }
    for (const w of wts) group('wt:' + w.id, w.key, 'worktree', { id: w.id, path: w.path });
    const order = { shared: 0, main: 1, worktree: 2, other: 3 };
    return [...groups.values()].map((g) => { g.items.sort((a, b) => b.mem - a.mem); g.mem = g.items.reduce((s, i) => s + i.mem, 0); return g; })
      .sort((a, b) => order[a.kind] - order[b.kind] || a.label.localeCompare(b.label));
  }

  // Disk per worktree (folder, node_modules, private DB). `du` on node_modules is slow, so it runs on demand and is cached.
  async diskSizes(force) {
    if (!force && this.disk.data && Date.now() - this.disk.at < 10 * 60_000) return this.disk.data;
    if (this.disk.running) return this.disk.running;
    this.disk.running = (async () => {
      const out = [];
      for (const w of this.wt.list()) out.push(Object.assign({ id: w.id, key: w.key, dbMode: w.db.mode }, await this.wt.sizes(w)));
      this.disk = { at: Date.now(), data: { at: Date.now(), worktrees: out }, running: null };
      return this.disk.data;
    })();
    try { return await this.disk.running; } finally { this.disk.running = null; }
  }

  snapshot() { return Object.assign({}, this.last || {}, { history: this.history, viewers: this.viewers }); }
}

const item = (c) => ({ name: c.oneoff ? c.service + ' (run)' : c.service, mem: c.mem, cpu: c.cpu, kind: 'container' });

export function toBytes(s) {
  const m = String(s || '').trim().match(/^([\d.]+)\s*([KMGT]?i?B|B)?$/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const u = (m[2] || 'B').toUpperCase();
  const pow = { B: 0, KB: 1, KIB: 1, MB: 2, MIB: 2, GB: 3, GIB: 3, TB: 4, TIB: 4 }[u] || 0;
  const base = u.includes('I') || u === 'B' ? 1024 : 1000;
  return Math.round(n * base ** pow);
}

async function hostMemory() {
  const total = os.totalmem();
  if (process.platform === 'darwin') {
    // "Memory used" as Activity Monitor shows it: app (active) + wired + compressed pages.
    const [vm, swap] = await Promise.all([sh('vm_stat', [], { timeout: 5000 }), sh('sysctl', ['-n', 'vm.swapusage'], { timeout: 5000 })]);
    const page = Number((vm.stdout.match(/page size of (\d+) bytes/) || [])[1]) || 16384;
    const pages = (k) => Number((vm.stdout.match(new RegExp(k + ':\\s+(\\d+)')) || [])[1]) || 0;
    const used = (pages('Pages active') + pages('Pages wired down') + pages('Pages occupied by compressor')) * page;
    const sw = swap.stdout.match(/total = ([\d.]+)M\s+used = ([\d.]+)M/);
    return { total, used: Math.min(used, total), swapTotal: sw ? Number(sw[1]) * 1048576 : 0, swapUsed: sw ? Number(sw[2]) * 1048576 : 0 };
  }
  try {
    const mi = fs.readFileSync('/proc/meminfo', 'utf8');
    const kb = (k) => Number((mi.match(new RegExp('^' + k + ':\\s+(\\d+)', 'm')) || [])[1]) * 1024 || 0;
    return { total: kb('MemTotal'), used: kb('MemTotal') - kb('MemAvailable'), swapTotal: kb('SwapTotal'), swapUsed: kb('SwapTotal') - kb('SwapFree') };
  } catch {
    return { total, used: total - os.freemem(), swapTotal: 0, swapUsed: 0 };
  }
}

async function diskFree() {
  const r = await sh('df', ['-kP', os.homedir()], { timeout: 5000 });
  const line = r.stdout.trim().split('\n')[1] || '';
  const p = line.split(/\s+/);
  return { total: Number(p[1]) * 1024 || 0, free: Number(p[3]) * 1024 || 0 };
}

// RSS and CPU per process group (each PTY we start leads its own group).
async function processStats() {
  const r = await sh('ps', ['-A', '-o', 'pgid=,rss=,pcpu='], { timeout: 5000 });
  const out = {};
  for (const l of r.stdout.split('\n')) {
    const [pgid, rss, cpu] = l.trim().split(/\s+/);
    if (!pgid) continue;
    const o = out[pgid] || (out[pgid] = { mem: 0, cpu: 0 });
    o.mem += Number(rss) * 1024 || 0; o.cpu += Number(cpu) || 0;
  }
  return out;
}
