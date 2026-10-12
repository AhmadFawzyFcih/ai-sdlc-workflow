// Commands the dashboard runs for worktrees (docker compose, yarn, vite…) in pseudo-terminals,
// so their output can be shown live in a tab — same terminal as the Claude tabs.
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pty from '@lydell/node-pty';

const BUFFER_LIMIT = 400_000;

export class Procs extends EventEmitter {
  constructor() {
    super();
    this.map = new Map();
  }

  list() { return [...this.map.values()].map(view); }
  get(id) { return this.map.get(id); }

  /**
   * Start a command through the developer's login shell (PATH, nvm, rbenv… as in their terminal).
   * @param o.key     stable name (e.g. "vite:proj-1"); a running proc with the same key is returned as is
   * @param o.cmd     shell command line
   * @param o.cwd     working folder
   * @param o.env     extra environment
   * @param o.title   tab title
   * @param o.project project path the proc belongs to
   * @param o.kind    step name (migrate, up, vite…)
   */
  start(o) {
    const old = o.key ? [...this.map.values()].find((p) => p.key === o.key) : null;
    if (old && old.pty) return old;
    if (old) this.map.delete(old.id);
    const id = 'p-' + crypto.randomBytes(6).toString('hex');
    const shell = process.env.SHELL || '/bin/zsh';
    const flags = (process.env.BACKEND_DASH_SHELL_FLAGS || '-lic').split(/\s+/).filter(Boolean);
    const env = Object.assign({}, process.env, { TERM: 'xterm-256color', COLORTERM: 'truecolor' }, o.env || {});
    delete env.CLAUDECODE; delete env.CLAUDE_CODE_ENTRYPOINT;
    const p = { id, key: o.key || id, title: o.title || o.cmd, cmd: o.cmd, cwd: o.cwd, project: o.project || null, kind: o.kind || null, wt: o.wt || null,
      status: 'running', exitCode: null, startedAt: Date.now(), endedAt: null, buffer: '', stoppedByUser: false };
    let done;
    p.done = new Promise((r) => { done = r; });
    try {
      p.pty = pty.spawn(shell, [...flags, o.cmd], { name: 'xterm-256color', cols: o.cols || 120, rows: o.rows || 30, cwd: o.cwd, env });
    } catch (e) {
      p.pty = null; p.status = 'failed'; p.buffer = 'Could not start: ' + e.message + '\r\n'; p.endedAt = Date.now();
      this.map.set(id, p); done(p); this.emit('update', view(p));
      return p;
    }
    this.map.set(id, p);
    p.pty.onData((d) => {
      p.buffer = (p.buffer + d).slice(-BUFFER_LIMIT);
      this.emit('out', id, d);
    });
    p.pty.onExit(({ exitCode }) => {
      p.pty = null;
      clearTimeout(p.killTimer);
      p.exitCode = exitCode;
      p.endedAt = Date.now();
      p.status = p.stoppedByUser ? 'stopped' : exitCode === 0 ? 'ok' : 'failed';
      this.emit('update', view(p));
      done(p);
    });
    this.emit('update', view(p));
    return p;
  }

  // Start and wait; resolves with the finished proc (status ok / failed / stopped).
  run(o) { return this.start(o).done; }

  input(id, data) { const p = this.map.get(id); if (p && p.pty) p.pty.write(data); }
  resize(id, cols, rows) { const p = this.map.get(id); if (p && p.pty && cols > 10 && rows > 3) { try { p.pty.resize(Math.floor(cols), Math.floor(rows)); } catch {} } }

  // Stop like a terminal does: Ctrl+C goes to the command in the foreground (the login shell is
  // interactive, so the command runs in its own process group and ignores signals sent to the shell's),
  // then SIGTERM and finally SIGKILL to the shell and everything it started.
  // o.grace: time for Ctrl+C (default 3s; `docker compose up` gets 30s to stop its containers).
  // o.detach: SIGKILL right away — `docker compose up` then exits without stopping its containers.
  kill(id, o = {}) {
    const p = this.map.get(id);
    if (!p || !p.pty) return;
    p.stoppedByUser = true;
    clearTimeout(p.killTimer);
    const tree = (sig) => { if (p.pty) signalTree(p.pty.pid, sig); };
    if (o.detach) { tree('SIGKILL'); return; }
    try { p.pty.write('\x03'); } catch {}
    p.killTimer = setTimeout(() => {
      tree('SIGTERM');
      p.killTimer = setTimeout(() => tree('SIGKILL'), 3000);
    }, o.grace || 3000);
  }
  // Stop and wait until it has exited.
  async stop(id, o) { const p = this.map.get(id); if (!p || !p.pty) return; this.kill(id, o); await p.done; }

  killWhere(fn, o) { for (const p of this.map.values()) if (p.pty && fn(p)) this.kill(p.id, o); }
  // Stop and wait for every proc that matches.
  stopWhere(fn, o) { const ps = [...this.map.values()].filter((p) => p.pty && fn(p)); for (const p of ps) this.kill(p.id, o); return Promise.all(ps.map((p) => p.done)); }
  // Dashboard shutdown: Ctrl+C everything; resolves when all have exited (`docker compose up` stops its containers first).
  killAll() { return this.stopWhere(() => true, { grace: 30000 }); }
  running() { return [...this.map.values()].filter((p) => p.pty).length; }
  remove(id) { this.kill(id); this.map.delete(id); this.emit('removed', id); }
  byKey(key) { return [...this.map.values()].find((p) => p.key === key) || null; }
  pids() { return [...this.map.values()].filter((p) => p.pty).map((p) => ({ pid: p.pty.pid, wt: p.wt, project: p.project, kind: p.kind })); }
}

// The process and all its descendants (children first), from one `ps` listing (works on macOS and Linux).
export function descendants(pid) {
  let out = '';
  try { out = execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8', timeout: 5000 }); } catch { return [pid]; }
  const kids = new Map();
  for (const line of out.split('\n')) {
    const [c, par] = line.trim().split(/\s+/).map(Number);
    if (c && par) (kids.get(par) || kids.set(par, []).get(par)).push(c);
  }
  const all = [];
  const walk = (x) => { for (const c of kids.get(x) || []) walk(c); all.push(x); };
  walk(pid);
  return all;
}
function signalTree(pid, sig) { for (const x of descendants(pid)) { try { process.kill(x, sig); } catch {} } }

function view(p) {
  return { id: p.id, key: p.key, title: p.title, cmd: p.cmd, cwd: p.cwd, project: p.project, kind: p.kind, wt: p.wt, status: p.status, exitCode: p.exitCode, startedAt: p.startedAt, endedAt: p.endedAt, alive: !!p.pty };
}
