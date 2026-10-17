// Git worktrees with their own backend (docker compose), frontend (Vite), Redis, ports and — when
// asked — their own database. Shared services (Postgres, MinIO…) keep running from the main checkout
// and are connected to each worktree's Docker network under their usual host names.
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import * as C from './compose.js';
import { sh, quote } from './sh.js';
import * as plans from './plans.js';

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
export const DEFAULTS = {
  migrate: 'bundle exec rails db:migrate',
  migrateDown: 'bundle exec rails db:migrate:down VERSION={version}',
  setup: 'bundle exec rails db:setup',
  testMigrate: true, // migrate also runs with RAILS_ENV=test against the worktree's own test database
  testSetup: 'bundle exec rails db:schema:load', // RAILS_ENV=test, when the test database starts empty
  bash: 'bash',
  service: null, // the service used for bash / migrate (default: web, else the first one that runs the code)
  maxRunning: 2,
  minDockerFreeGb: 3,
  memCode: '3g',
  memOther: '1g',
  hostMode: 'subdomain', // open the frontend on <key>.localhost:<port> (own cookies); "localhost" to disable
  autoStartMain: true, // start the main checkout (migrate → docker compose up → yarn start) when the dashboard starts
  folder: null, // default: <main>-worktrees/<KEY>
  sharedDb: null,
  editor: null // command that opens a folder, e.g. "cursor" or "code -n"; default: VS Code
};
const LINKS = ['.claude/backend.yml', '.env', '.env.local', '.env.development', '.env.development.local', 'config/master.key'];
const KEY_RE = /[A-Z][A-Z0-9]+-\d+/;
const exists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const qi = (s) => '"' + String(s).replace(/"/g, '""') + '"'; // SQL identifier
const ql = (s) => "'" + String(s).replace(/'/g, "''") + "'"; // SQL literal

export class Worktrees extends EventEmitter {
  constructor({ configDir, procs, docker }) {
    super();
    this.configDir = configDir;
    this.procs = procs;
    this.docker = docker || process.env.BACKEND_DASH_DOCKER || 'docker';
    this.file = path.join(configDir, 'worktrees.json');
    this.settingsFile = path.join(configDir, 'worktree-settings.json');
    this.dir = path.join(configDir, 'worktrees');
    this.data = readJson(this.file, { worktrees: [] });
    if (!Array.isArray(this.data.worktrees)) this.data.worktrees = [];
    this.cache = new Map();
    this.monitor = null; // set by the server: last Docker memory sample for the start guard
    this.runs = new Map(); // id → number of the current "Start all"; Stop bumps it so a running chain gives up
    this.mainRecs = new Map(); // main checkouts, run like a worktree (slot 0, their own compose file)
  }

  // ---------- registry ----------
  save() { fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2) + '\n', { mode: 0o600 }); this.emit('changed'); }
  list() { return this.data.worktrees; }
  get(id) { const r = this.data.worktrees.find((w) => w.id === id) || this.mainRecs.get(id); if (!r) throw httpError(404, 'No such worktree'); return r; }

  // ---------- the main checkout as an environment ----------
  // Same steps as a worktree (bash · migrate · up · install · start), on its own compose file, ports and databases.
  setMains(paths) {
    const keep = new Set();
    for (const main of paths) { try { keep.add(this.mainRec(main).id); } catch {} }
    for (const id of [...this.mainRecs.keys()]) if (!keep.has(id)) this.mainRecs.delete(id);
  }
  mainRec(main) {
    const id = 'main-' + C.slug(path.basename(main));
    const { doc } = this.readMainCompose(main);
    const cls = C.classify(doc);
    const s = this.settings(main);
    let r = this.mainRecs.get(id);
    if (!r) { r = { id, isMain: true, key: path.basename(main), main, path: main, slot: 0, sharedMigrations: [], links: [] }; this.mainRecs.set(id, r); }
    r.services = Object.keys(doc.services);
    r.app = cls.app;
    r.ports = cls.app.flatMap((n) => C.hostPortsOf(doc.services[n] || {}).map((p) => ({ service: n, main: p.host, port: p.host })));
    r.db = { mode: 'main', name: null, source: s.sharedDb || null, ready: true, test: s.testMigrate && this.hasTestEnv(main) ? { name: s.sharedTestDb || null, ready: true } : null };
    const f = this.frontend(main);
    r.frontend = f ? Object.assign({}, f, { port: 5173, start: null, run: f.run }) : null;
    r.autoStart = s.autoStartMain !== false;
    return r;
  }
  mains() { return [...this.mainRecs.values()]; }
  setAutoStart(id, on) { const r = this.get(id); if (!r.isMain) throw httpError(400, 'Only the main checkout starts with the dashboard.'); this.saveSetting(r.main, 'autoStartMain', !!on); this.mainRec(r.main); return { ok: true }; }

  // When the dashboard starts: run the main checkout like "Start all" — unless it is already running
  // (started from a terminal), then only the frontend is started if its port is free.
  async autoStart() {
    for (const r of this.mains()) {
      if (!r.autoStart) continue;
      try {
        const st = (await this.statusAll()).worktrees[r.id];
        if (!st || st.dockerDown) continue;
        if (st.backend.state === 'down') await this.runAll(r, { force: true, forceStart: true });
        else if (r.frontend && !this.procs.byKey('vite:' + r.id) && (await portFree(r.frontend.port))) this.startVite(r);
      } catch (e) { this.emit('error', r, e); }
    }
  }
  byPath(p) { const a = path.resolve(String(p || '')); return this.data.worktrees.find((w) => w.path === a) || null; }
  childrenOf(main) { return this.data.worktrees.filter((w) => w.main === main); }

  // Opens a checkout in the editor (VS Code by default) so its changes show in Source Control.
  async openEditor(dir) {
    dir = path.resolve(String(dir || ''));
    if (!fs.existsSync(dir)) throw httpError(400, 'The folder does not exist: ' + dir);
    const rec = this.byPath(dir);
    const s = this.settings(rec ? rec.main : dir);
    const shell = process.env.SHELL || '/bin/zsh';
    const tries = [];
    // a login shell, so a "code" / "cursor" installed in the PATH from .zprofile / .bash_profile is found; "$0" is the folder
    if (s.editor) tries.push([shell, ['-lc', s.editor + ' "$0"', dir]]);
    else {
      if (process.platform === 'darwin') tries.push(['open', ['-a', 'Visual Studio Code', dir]]);
      tries.push([shell, ['-lc', 'code "$0"', dir]]);
    }
    let last = null;
    for (const [cmd, args] of tries) {
      const r = await sh(cmd, args, { timeout: 20_000 });
      if (r.code === 0) return { ok: true, editor: s.editor || 'VS Code' };
      last = (r.stderr || r.error || '').trim();
    }
    throw httpError(500, (s.editor ? `"${s.editor}" failed` : 'VS Code was not found') + (last ? ': ' + last.split('\n').pop() : '') +
      (s.editor ? '' : ' — install it, or run "Shell Command: Install \'code\' command in PATH" from VS Code, or set "editor" in worktree-settings.json.'));
  }

  settings(main) {
    const all = readJson(this.settingsFile, {});
    return Object.assign({}, DEFAULTS, all.defaults || {}, (main && all[main]) || {});
  }
  saveSetting(main, key, value) {
    const all = readJson(this.settingsFile, {});
    all[main] = Object.assign({}, all[main] || {}, { [key]: value });
    fs.writeFileSync(this.settingsFile, JSON.stringify(all, null, 2) + '\n', { mode: 0o600 });
  }

  // ---------- docker / compose ----------
  async composeBase() {
    if (this.composeCmd) return this.composeCmd;
    const v2 = await sh(this.docker, ['compose', 'version'], { timeout: 15000 });
    if (v2.code === 0) this.composeCmd = [this.docker, 'compose'];
    else {
      const v1 = await sh('docker-compose', ['version'], { timeout: 15000 });
      if (v1.code !== 0) throw httpError(400, 'Docker Compose was not found. Is Docker Desktop running?');
      this.composeCmd = ['docker-compose'];
    }
    return this.composeCmd;
  }
  cfgDir(rec) { return path.join(this.dir, rec.id); }
  project(rec) { return 'bd-' + rec.id; }
  network(rec) { return 'bd-' + rec.id; }
  async composeArgs(rec) {
    if (rec.isMain) return [...(await this.composeBase()), '-p', await this.mainProject(rec.main), '-f', this.readMainCompose(rec.main).file, '--project-directory', rec.main];
    return [...(await this.composeBase()), '-p', this.project(rec), '-f', path.join(this.cfgDir(rec), 'docker-compose.yml'), '--project-directory', rec.path];
  }
  async composeLine(rec) { return (await this.composeArgs(rec)).map(quote).join(' '); }

  readMainCompose(main) {
    for (const f of COMPOSE_FILES) {
      const file = path.join(main, f);
      if (fs.existsSync(file)) return { file, doc: C.parseCompose(fs.readFileSync(file, 'utf8')) };
    }
    throw httpError(400, 'No docker-compose.yml in ' + main);
  }

  // The compose project the main checkout runs under (from its containers, else Compose's default).
  async mainProject(main) {
    const hit = this.cache.get('proj:' + main);
    if (hit && Date.now() - hit.at < 30_000) return hit.v;
    const r = await sh(this.docker, ['ps', '-a', '--filter', 'label=com.docker.compose.project.working_dir=' + main, '--format', '{{.Label "com.docker.compose.project"}}'], { timeout: 15000 });
    let v = r.code === 0 ? r.stdout.split('\n').map((s) => s.trim()).find(Boolean) : null;
    if (!v) {
      const env = (() => { try { return fs.readFileSync(path.join(main, '.env'), 'utf8'); } catch { return ''; } })();
      const m = env.match(/^\s*COMPOSE_PROJECT_NAME\s*=\s*['"]?([^'"\s]+)/m);
      v = m ? m[1] : C.composeProjectName(main);
    }
    this.cache.set('proj:' + main, { at: Date.now(), v });
    return v;
  }

  async containersOf(project) {
    const r = await sh(this.docker, ['ps', '-a', '--filter', 'label=com.docker.compose.project=' + project, '--format', '{{.ID}}\t{{.Label "com.docker.compose.service"}}\t{{.State}}\t{{.Label "com.docker.compose.oneoff"}}'], { timeout: 15000 });
    if (r.code !== 0) throw httpError(503, dockerDown(r));
    return r.stdout.split('\n').filter(Boolean).map((l) => { const [id, service, state, oneoff] = l.split('\t'); return { id, service, state, oneoff: oneoff === 'True' }; }).filter((c) => !c.oneoff);
  }

  // Shared services of the main checkout: everything the worktree does not run itself.
  async shared(main, own) {
    const { doc } = this.readMainCompose(main);
    const cls = C.classify(doc);
    const mine = new Set(own || cls.app);
    const names = Object.keys(doc.services).filter((n) => !mine.has(n));
    const project = await this.mainProject(main);
    const cs = await this.containersOf(project);
    return names.map((service) => {
      const c = cs.find((x) => x.service === service);
      return { service, id: c ? c.id : null, state: c ? c.state : 'missing' };
    });
  }

  async ensureNetwork(rec) {
    const name = this.network(rec);
    if ((await sh(this.docker, ['network', 'inspect', name], { timeout: 15000 })).code !== 0) {
      const r = await sh(this.docker, ['network', 'create', '--label', 'dev.backend-dash.worktree=' + rec.id, name], { timeout: 30000 });
      if (r.code !== 0 && !/already exists/.test(r.stderr)) throw httpError(500, 'Could not create the Docker network: ' + r.stderr.trim());
    }
    const shared = await this.shared(rec.main, rec.services);
    const missing = [];
    for (const s of shared) {
      if (!s.id) { missing.push(s.service); continue; }
      const r = await sh(this.docker, ['network', 'connect', '--alias', s.service, name, s.id], { timeout: 15000 });
      if (r.code !== 0 && !/already exists|endpoint with name/i.test(r.stderr)) missing.push(s.service);
    }
    return { missing, shared };
  }

  async dropNetwork(rec) {
    const name = this.network(rec);
    const ins = await sh(this.docker, ['network', 'inspect', name, '--format', '{{range $k, $v := .Containers}}{{$k}} {{end}}'], { timeout: 15000 });
    if (ins.code !== 0) return true;
    for (const c of ins.stdout.trim().split(/\s+/).filter(Boolean)) await sh(this.docker, ['network', 'disconnect', '-f', name, c], { timeout: 15000 });
    return (await sh(this.docker, ['network', 'rm', name], { timeout: 15000 })).code === 0;
  }

  // ---------- Postgres (the shared one) ----------
  async pg(main) {
    const { doc } = this.readMainCompose(main);
    const cls = C.classify(doc);
    if (!cls.postgres) throw httpError(400, 'No Postgres service found in docker-compose.yml');
    const project = await this.mainProject(main);
    const c = (await this.containersOf(project)).find((x) => x.service === cls.postgres);
    if (!c) return { service: cls.postgres, id: null, running: false, user: 'postgres' };
    const env = await sh(this.docker, ['inspect', '-f', '{{json .Config.Env}}', c.id], { timeout: 15000 });
    let user = 'postgres';
    try { const e = JSON.parse(env.stdout).find((x) => x.startsWith('POSTGRES_USER=')); if (e) user = e.slice(14) || 'postgres'; } catch {}
    return { service: cls.postgres, id: c.id, running: c.state === 'running', user };
  }

  async psql(main, sql, db = 'postgres') {
    const pg = await this.pg(main);
    if (!pg.running) throw httpError(409, `Shared ${pg.service} is not running — start the shared services first.`);
    const r = await sh(this.docker, ['exec', pg.id, 'psql', '-U', pg.user, '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', sql], { timeout: 120_000 });
    if (r.code !== 0) throw httpError(500, (r.stderr || r.stdout).trim() || 'psql failed');
    return r.stdout.split('\n').filter(Boolean);
  }

  async databases(main) {
    const rows = await this.psql(main, "SELECT datname, pg_database_size(datname) FROM pg_database WHERE NOT datistemplate AND datname <> 'postgres' ORDER BY 1");
    return rows.map((l) => { const [name, size] = l.split('|'); return { name, size: Number(size) }; });
  }

  async appliedVersions(main, db) {
    try { return new Set(await this.psql(main, 'SELECT version FROM schema_migrations', db)); } catch { return new Set(); }
  }

  sharedDbOf(rec) { return rec.db.source || this.settings(rec.main).sharedDb; }
  targetDb(rec) { return rec.db.mode === 'shared' ? this.sharedDbOf(rec) : rec.db.name; }

  // A private copy of a shared database: CREATE DATABASE … TEMPLATE takes seconds but needs nobody
  // connected to the source; when the main app is running, fall back to pg_dump | psql (shown as a step).
  async cloneDb(rec, src, dst, label) {
    await this.psql(rec.main, `DROP DATABASE IF EXISTS ${qi(dst)}`);
    const pg = await this.pg(rec.main);
    try {
      await this.psql(rec.main, `CREATE DATABASE ${qi(dst)} TEMPLATE ${qi(src)}`);
      return { fast: true };
    } catch (e) {
      if (!/being accessed by other users/i.test(e.message)) throw e;
    }
    const u = quote(pg.user);
    const cmd = `${quote(this.docker)} exec ${pg.id} sh -c ${quote(`createdb -U ${u} ${quote(dst)} && pg_dump -U ${u} --no-owner ${quote(src)} | psql -q -U ${u} -v ON_ERROR_STOP=0 ${quote(dst)} >/dev/null`)}`;
    const p = await this.procs.run({ key: 'db:' + rec.id, cmd, cwd: rec.main, title: label + ' · ' + rec.key, project: rec.path, kind: 'db', wt: rec.id });
    if (p.status !== 'ok') throw httpError(500, label + ' failed — see its tab.');
    return { fast: false };
  }
  async copyDb(rec) {
    if (!rec.db.source) throw httpError(400, 'Pick the shared database to copy from.');
    return this.cloneDb(rec, rec.db.source, rec.db.name, 'Copy database');
  }

  // The worktree's own test database: a copy of the shared test database when there is one
  // (the first migrate then only adds this branch's migrations), else empty (the first migrate loads the schema).
  async createTestDb(rec) {
    const t = rec.db.test;
    if (!t) return;
    const dbs = await this.databases(rec.main);
    if (t.source && dbs.some((d) => d.name === t.source)) {
      await this.cloneDb(rec, t.source, t.name, 'Copy test database');
      t.ready = true;
    } else {
      await this.psql(rec.main, `DROP DATABASE IF EXISTS ${qi(t.name)}`);
      await this.psql(rec.main, `CREATE DATABASE ${qi(t.name)}`);
      t.source = null; t.ready = false;
    }
  }

  async dropDbNamed(main, name) {
    await this.psql(main, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${ql(name)} AND pid <> pg_backend_pid()`);
    await this.psql(main, `DROP DATABASE IF EXISTS ${qi(name)}`);
  }
  async dropDb(rec) { return this.dropDbNamed(rec.main, rec.db.name); }

  // ---------- git ----------
  async git(dir, args, timeout = 60_000) { return sh('git', ['-C', dir, ...args], { timeout }); }

  async branches(main) {
    const refs = await this.git(main, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
    const wl = await this.git(main, ['worktree', 'list', '--porcelain']);
    const open = {};
    let cur = null;
    for (const l of wl.stdout.split('\n')) {
      if (l.startsWith('worktree ')) cur = l.slice(9);
      else if (l.startsWith('branch refs/heads/')) open[l.slice(18)] = cur;
    }
    const local = refs.stdout.split('\n').filter(Boolean);
    return local.map((name) => ({ name, openAt: open[name] || null }));
  }

  // How `git worktree add` gets the branch: the local one if it exists; else fetched from origin and tracking it;
  // else created from a freshly fetched default branch (origin/HEAD → master → main), without tracking it.
  async resolveBranch(main, branch, folder) {
    const has = async (ref) => (await this.git(main, ['rev-parse', '--verify', '--quiet', ref])).code === 0;
    const hasOrigin = (await this.git(main, ['remote', 'get-url', 'origin'])).code === 0;
    const fetch = async (b) => {
      const r = await this.git(main, ['fetch', '--no-tags', 'origin', `+refs/heads/${b}:refs/remotes/origin/${b}`], 120_000);
      if (r.code === 0) return true;
      if (/couldn't find remote ref/i.test(r.stderr)) return false;
      throw httpError(400, 'Could not fetch from origin: ' + (r.stderr || r.stdout).trim().replace(/^fatal: /, ''));
    };
    const onRemote = hasOrigin && await fetch(branch);
    if (await has('refs/heads/' + branch)) return { args: [folder, branch], created: false, ref: branch };
    if (onRemote) return { args: ['--track', '-b', branch, folder, 'origin/' + branch], created: false, ref: 'origin/' + branch };
    let base = null;
    if (hasOrigin) {
      const head = await this.git(main, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
      const candidates = [head.code === 0 ? head.stdout.trim().replace(/^origin\//, '') : null, 'master', 'main'].filter(Boolean);
      for (const b of candidates) if (await fetch(b)) { base = 'origin/' + b; break; }
    }
    if (!base) base = (await has('refs/heads/master')) ? 'master' : (await has('refs/heads/main')) ? 'main' : 'HEAD';
    return { args: ['--no-track', '-b', branch, folder, base], created: true, ref: base };
  }

  // Branches the plans know about (subtasks in state.json), whether or not they exist yet.
  async planBranches(main) {
    try {
      const ix = await plans.index(main);
      const out = [];
      for (const it of ix.items) {
        if (it.branch) out.push({ name: it.branch, key: it.key, title: it.title });
        for (const st of it.stories) for (const t of st.subtasks) if (t.branch) out.push({ name: t.branch, key: t.key, title: t.title });
      }
      return out;
    } catch { return []; }
  }

  // dirty: uncommitted changes (lost when the folder goes).
  // unpushed: commits ahead of the upstream — or, without one, commits no other branch or remote has
  // (those are lost only if the branch is deleted too).
  async gitState(rec) {
    const st = await this.git(rec.path, ['status', '--porcelain'], 15000);
    const br = await this.git(rec.path, ['rev-parse', '--abbrev-ref', 'HEAD'], 15000);
    const branch = br.code === 0 ? br.stdout.trim() : rec.branch;
    let ahead = await this.git(rec.path, ['rev-list', '--count', '@{u}..HEAD'], 15000);
    if (ahead.code !== 0) ahead = await this.git(rec.path, ['rev-list', '--count', 'HEAD', '--not', '--remotes', `--exclude=${branch}`, '--branches'], 15000);
    return {
      ok: st.code === 0, branch,
      dirty: st.code === 0 ? st.stdout.split('\n').filter(Boolean).length : 0,
      unpushed: ahead.code === 0 ? Number(ahead.stdout.trim()) || 0 : 0
    };
  }

  async excludeFile(dir) {
    const r = await this.git(dir, ['rev-parse', '--git-common-dir']);
    const common = path.resolve(dir, r.stdout.trim());
    return path.join(common, 'info', 'exclude');
  }
  async exclude(dir, rel) {
    if ((await this.git(dir, ['check-ignore', '-q', '--no-index', rel])).code === 0) return;
    const file = await this.excludeFile(dir);
    const line = '/' + rel.replace(/^\/+/, '');
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch {}
    if (text.split('\n').includes(line)) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, (text && !text.endsWith('\n') ? '\n' : '') + (text.includes('# backend-dash') ? '' : '# backend-dash: links and generated files in worktrees\n') + line + '\n');
  }

  // ---------- migrations ----------
  versions(dir) {
    try { return fs.readdirSync(path.join(dir, 'db', 'migrate')).map((f) => { const m = f.match(/^(\d{6,})_.*\.rb$/); return m ? { version: m[1], file: f } : null; }).filter(Boolean); }
    catch { return []; }
  }
  branchOnlyMigrations(rec) {
    const main = new Set(this.versions(rec.main).map((v) => v.version));
    return this.versions(rec.path).filter((v) => !main.has(v.version));
  }

  // ---------- frontend ----------
  frontend(dir) {
    const list = (d, dirs) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => (dirs ? e.isDirectory() : true)).map((e) => e.name); } catch { return []; } };
    const f = C.findViteConfig(list, dir);
    if (!f) return null;
    const pkg = readJson(path.join(f.dir, 'package.json'), null);
    const lock = ['yarn.lock', 'pnpm-lock.yaml', 'package-lock.json'].find((x) => fs.existsSync(path.join(f.dir, x)));
    const install = lock === 'pnpm-lock.yaml' ? 'pnpm install' : lock === 'package-lock.json' ? 'npm install' : 'yarn install';
    const run = lock === 'pnpm-lock.yaml' ? 'pnpm start' : lock === 'package-lock.json' ? 'npm start' : 'yarn start';
    return { dir: path.relative(dir, f.dir) || '.', config: f.config, start: C.startScript(pkg), run, install, lock: lock || null };
  }

  // ---------- slots & ports ----------
  async nextSlot(main, doc, services) {
    const taken = new Set(this.data.worktrees.map((w) => w.slot));
    const mainPorts = C.mainHostPorts(doc);
    const otherPorts = new Set(this.data.worktrees.flatMap((w) => (w.ports || []).map((p) => p.port).concat(w.frontend ? [w.frontend.port] : [])));
    const own = (services || C.classify(doc).app).flatMap((n) => C.hostPortsOf(doc.services[n] || {}).map((p) => p.host));
    for (let slot = 1; slot < 100; slot++) {
      if (taken.has(slot)) continue;
      const ports = own.map((p) => p + C.SLOT_STEP * slot).concat([5173 + C.SLOT_STEP * slot]);
      if (ports.some((p) => mainPorts.has(p) || otherPorts.has(p))) continue;
      if ((await Promise.all(ports.map(portFree))).every(Boolean)) return slot;
    }
    throw httpError(409, 'No free port slot left.');
  }

  // ---------- inspect (for the "New worktree" dialog) ----------
  async inspect(main) {
    const { file, doc } = this.readMainCompose(main);
    const cls = C.classify(doc);
    const s = this.settings(main);
    const [branches, planBranches] = await Promise.all([this.branches(main), this.planBranches(main)]);
    let pg = null; let databases = []; let dockerError = null;
    try { pg = await this.pg(main); if (pg.running) databases = await this.databases(main); } catch (e) { dockerError = e.message; }
    const taken = new Set(this.data.worktrees.map((w) => w.db.name).filter(Boolean));
    const candidates = databases.filter((d) => !taken.has(d.name));
    const sharedDb = s.sharedDb && databases.some((d) => d.name === s.sharedDb) ? s.sharedDb
      : (candidates.find((d) => /_development$/.test(d.name)) || candidates.find((d) => /dev/.test(d.name)) || candidates[0] || {}).name || null;
    const takenTest = new Set(this.data.worktrees.map((w) => w.db.test && w.db.test.name).filter(Boolean));
    const sharedTestDb = this.guessTestDb(main, databases.filter((d) => !takenTest.has(d.name)), sharedDb);
    let slot = null;
    try { slot = await this.nextSlot(main, doc, cls.app); } catch {}
    const ports = slot ? cls.app.flatMap((n) => C.hostPortsOf(doc.services[n]).map((p) => ({ service: n, main: p.host, port: p.host + C.SLOT_STEP * slot }))) : [];
    const front = this.frontend(main);
    return {
      main, compose: path.basename(file), project: await this.mainProject(main).catch(() => null),
      services: cls.app.map((n) => ({ name: n, why: cls.why[n] })), shared: cls.shared, postgres: cls.postgres,
      pgRunning: !!(pg && pg.running), databases: databases.filter((d) => !taken.has(d.name) && !takenTest.has(d.name)), sharedDb, sharedTestDb, dockerError,
      testDb: this.settings(main).testMigrate && this.hasTestEnv(main),
      branches, planBranches, slot, ports, vitePort: slot ? 5173 + C.SLOT_STEP * slot : null, frontend: front,
      folderBase: s.folder || main + '-worktrees', dbPrefix: C.dbIdent(path.basename(main)), maxRunning: s.maxRunning,
      hasDatabaseYml: fs.existsSync(path.join(main, 'config', 'database.yml'))
    };
  }

  hasTestEnv(dir) {
    try { return C.ymlEnvs(fs.readFileSync(path.join(dir, 'config', 'database.yml'), 'utf8')).includes('test'); } catch { return false; }
  }
  // The shared test database: the settings' choice, else <x>_test next to the shared <x>_development.
  guessTestDb(main, databases, sharedDb) {
    const s = this.settings(main);
    if (s.sharedTestDb && databases.some((d) => d.name === s.sharedTestDb)) return s.sharedTestDb;
    const want = sharedDb ? sharedDb.replace(/_development$|_dev$/, '') + '_test' : null;
    return (databases.find((d) => d.name === want) || databases.find((d) => /_test$/.test(d.name)) || {}).name || null;
  }

  // ---------- create ----------
  async create(o) {
    const main = path.resolve(String(o.main || ''));
    if (this.byPath(main)) throw httpError(400, 'Create worktrees from the main checkout, not from another worktree.');
    const { doc } = this.readMainCompose(main);
    const cls = C.classify(doc);
    const branch = String(o.newBranch || o.branch || '').trim();
    if (!branch) throw httpError(400, 'Pick a branch.');
    if (!/^[\w./-]+$/.test(branch) || branch.includes('..')) throw httpError(400, 'That is not a valid branch name.');
    // The worktree's own name (folder, databases, tab title) — it can check out other branches later.
    const name = String(o.name || '').trim() || (branch.match(KEY_RE) || [])[0] || C.slug(branch);
    if (!/^[\w.-]{1,40}$/.test(name)) throw httpError(400, 'Use letters, digits, dots, dashes or underscores for the name (up to 40).');
    if (this.data.worktrees.some((w) => w.key.toLowerCase() === name.toLowerCase())) throw httpError(400, 'A worktree called ' + name + ' already exists.');
    const key = name;
    const folder = path.resolve(String(o.folder || path.join(this.settings(main).folder || main + '-worktrees', name)).replace(/^~(?=\/)/, process.env.HOME || '~'));
    if (exists(folder)) throw httpError(400, 'That folder already exists: ' + folder);
    let id = C.slug(name);
    if (id.startsWith('main-')) id = 'wt-' + id;
    for (let n = 2; this.data.worktrees.some((w) => w.id === id); n++) id = C.slug(name) + '-' + n;
    const services = Array.isArray(o.services) && o.services.length ? o.services.filter((n) => doc.services[n]) : cls.app;
    if (!services.some((n) => C.codeMountTarget(doc.services[n]))) throw httpError(400, 'Keep at least one service that runs the code (e.g. web).');
    const mode = ['shared', 'copy', 'fresh'].includes(o.dbMode) ? o.dbMode : 'shared';
    const slot = await this.nextSlot(main, doc, services);
    const source = o.sourceDb || this.settings(main).sharedDb || null;
    if (source) this.saveSetting(main, 'sharedDb', source);
    if (mode === 'copy' && !source) throw httpError(400, 'Pick the shared database to copy.');
    const rec = {
      id, key, main, path: folder, branch, slot, services,
      db: { mode, name: mode === 'shared' ? null : C.dbIdent(C.dbIdent(path.basename(main)) + '_' + id), source, ready: mode !== 'fresh', test: null },
      sharedMigrations: [], links: [], createdAt: Date.now()
    };

    fs.mkdirSync(path.dirname(folder), { recursive: true });
    const plan = o.newBranch
      ? { args: ['-b', branch, folder, o.base || 'HEAD'], created: true, ref: o.base || 'HEAD' }
      : await this.resolveBranch(main, branch, folder);
    const add = await this.git(main, ['worktree', 'add', ...plan.args]);
    if (add.code !== 0) throw httpError(400, (add.stderr || add.stdout).trim().replace(/^fatal: /, ''));
    rec.from = { created: plan.created, ref: plan.ref };
    try {
      if (mode !== 'shared') {
        const yml = (() => { try { return fs.readFileSync(path.join(folder, 'config', 'database.yml'), 'utf8'); } catch { return null; } })();
        if (!yml || !C.databaseYmlOverride(yml, 'x')) throw httpError(400, 'config/database.yml has no development section — use the shared database for this worktree.');
      }
      await this.linkShared(rec);
      await this.syncRepos(rec);
      if (mode === 'copy') await this.copyDb(rec);
      if (this.settings(main).testMigrate && this.hasTestEnv(folder)) {
        rec.db.test = { name: C.dbIdent(C.dbIdent(path.basename(main)) + '_' + id + '_test'), source: o.sourceTestDb || null, ready: false };
        if (rec.db.test.source) this.saveSetting(main, 'sharedTestDb', rec.db.test.source);
        await this.createTestDb(rec);
      }
      this.writeConfig(rec);
      await this.writeFrontend(rec);
    } catch (e) {
      await this.git(main, ['worktree', 'remove', '--force', folder]);
      if (plan.created) await this.git(main, ['branch', '-D', branch]);
      fs.rmSync(this.cfgDir(rec), { recursive: true, force: true });
      for (const n of [rec.db.name, rec.db.test && rec.db.test.name]) if (n) await this.dropDbNamed(main, n).catch(() => {});
      throw e;
    }
    this.data.worktrees.push(rec);
    this.save();
    return rec;
  }

  // Every worktree sees the main checkout's plans folder: its own plans path is a link to it.
  // Repairs worktrees where that is not so (no link yet, a link elsewhere, or a real folder — e.g. created
  // before the link, or with plans_dir pointing outside the repo): files only the worktree has are moved
  // into the main plans folder first (a name taken in both gets ".from-<worktree>"). A plans folder that
  // git tracks in the branch is left out of this worktree with sparse-checkout (per worktree; the main
  // checkout is untouched), so checkouts and pulls here never write through the link into main's folder.
  // Returns true when something changed.
  linkPlans(rec) {
    if (rec.isMain || !fs.existsSync(rec.path)) return false;
    const m = plans.plansDirOf(rec.main).abs;
    const w = plans.plansDirOf(rec.path).abs;
    if (path.resolve(w) === path.resolve(m)) return false;
    fs.mkdirSync(m, { recursive: true });
    const realM = fs.realpathSync(m);
    let realW = null; try { realW = fs.realpathSync(w); } catch {}
    if (realW === realM) return false;
    const rel = path.relative(rec.path, w);
    const inside = !rel.startsWith('..') && !path.isAbsolute(rel);
    let st = null; try { st = fs.lstatSync(w); } catch {}
    if (st && !st.isSymbolicLink() && !st.isDirectory()) return false;
    if (st && st.isSymbolicLink()) fs.unlinkSync(w);
    else if (st) mergeInto(w, realM, '.from-' + rec.id);
    if (inside && spawnSync('git', ['-C', rec.path, 'ls-files', '--', rel], { encoding: 'utf8' }).stdout.trim()) {
      // Local edits are already merged into main's folder; reset them so sparse-checkout can drop the files.
      if (st && st.isDirectory()) spawnSync('git', ['-C', rec.path, 'checkout', 'HEAD', '--', rel]);
      const r = spawnSync('git', ['-C', rec.path, 'sparse-checkout', 'set', '--no-cone', '/*', '!/' + rel + '/'], { encoding: 'utf8' });
      // The files are reachable through the link; without this git clears their skip-worktree bit and reports them deleted.
      if (r.status === 0) Object.assign(r, spawnSync('git', ['-C', rec.path, 'config', '--worktree', 'sparse.expectFilesOutsideOfPatterns', 'true'], { encoding: 'utf8' }));
      if (r.status !== 0) {
        rec.plansWarning = `${rel} is tracked by git in this branch and could not be left out of this worktree (${(r.stderr || '').trim()}), so it keeps its own copy.`;
        return false;
      }
    }
    if (st && st.isDirectory()) fs.rmSync(w, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(w), { recursive: true });
    fs.symlinkSync(realM, w);
    if (inside && !rec.links.includes(rel)) rec.links.push(rel);
    if (inside) spawnSync('sh', ['-c', 'f="$(git -C "$1" rev-parse --git-common-dir)/info/exclude" && mkdir -p "$(dirname "$f")" && (grep -qxF "/$2" "$f" 2>/dev/null || echo "/$2" >> "$f")', 'sh', rec.path, rel]);
    delete rec.plansWarning;
    return true;
  }
  linkAllPlans() { let n = 0; for (const w of this.data.worktrees) { try { if (this.linkPlans(w)) n++; } catch (e) { console.error('plans link for ' + w.key + ': ' + e.message); } } if (n) this.save(); return n; }

  // .plans/, .claude/backend.yml, .env and the like are the main checkout's (git-ignored, not in a fresh worktree).
  async linkShared(rec) {
    const rels = new Set(LINKS);
    try { for (const f of fs.readdirSync(path.join(rec.main, 'config', 'credentials'))) if (f.endsWith('.key')) rels.add('config/credentials/' + f); } catch {}
    const front = this.frontend(rec.main);
    if (front && front.dir !== '.') for (const f of ['.env', '.env.local', '.env.development', '.env.development.local']) rels.add(path.join(front.dir, f));
    for (const r of rels) {
      const src = path.join(rec.main, r);
      const dst = path.join(rec.path, r);
      if (!exists(src) || exists(dst)) continue;
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.symlinkSync(src, dst);
      rec.links.push(r);
      await this.exclude(rec.path, r);
    }
    this.linkPlans(rec);
  }

  // Code a fresh `git worktree add` does not bring, but the main checkout has — the frontend fails without it
  // (e.g. `import … from "../../planviewer/src"`):
  //  · git submodules: checked out with `git submodule update --init`, from the main checkout's copy
  //    (offline, fast), else from their remote;
  //  · other git repos inside the main checkout that it does not track (cloned next to the code, git-ignored):
  //    cloned locally from the main checkout's copy, same branch, same origin.
  // Runs on create and before every start; the ones already there are left alone.
  async syncRepos(rec) {
    const wt = rec.path; const main = rec.main;
    const empty = (p) => { try { return fs.readdirSync(p).length === 0; } catch { return true; } };
    const notes = [];
    const sm = await this.git(wt, ['config', '-f', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$']);
    for (const line of sm.code === 0 ? sm.stdout.split('\n').filter(Boolean) : []) {
      const [k, rel] = line.trim().split(/\s+/);
      const name = k.replace(/^submodule\./, '').replace(/\.path$/, '');
      if (!rel || !empty(path.join(wt, rel))) continue;
      const local = path.join(main, rel);
      let r = { code: 1 };
      if (!empty(local)) {
        r = await this.git(wt, ['-c', 'protocol.file.allow=always', '-c', `submodule.${name}.url=${local}`, 'submodule', 'update', '--init', '--recursive', '--', rel], 600_000);
        const url = ((await this.git(main, ['config', '--get', `submodule.${name}.url`])).stdout || (await this.git(wt, ['config', '-f', '.gitmodules', '--get', `submodule.${name}.url`])).stdout).trim();
        if (r.code === 0 && url) await this.git(path.join(wt, rel), ['remote', 'set-url', 'origin', url]);
      }
      if (r.code !== 0) r = await this.git(wt, ['submodule', 'update', '--init', '--recursive', '--', rel], 600_000);
      notes.push({ path: rel, how: 'submodule', ok: r.code === 0, error: r.code === 0 ? null : (r.stderr || r.error || '').trim().split('\n').pop() });
    }
    if (!rec.reposScanned) {
      // untracked + ignored entries, a whole untracked folder as one line (node_modules is never descended into)
      const o = await this.git(main, ['ls-files', '--others', '--directory', '--no-empty-directory', '-z'], 120_000);
      for (const ent of o.code === 0 ? o.stdout.split('\0').filter(Boolean) : []) {
        const rel = ent.replace(/\/$/, '');
        if (/(^|\/)(node_modules|tmp|log|coverage|\.git)$/.test(rel) || rel.startsWith('.plans')) continue;
        const src = path.join(main, rel); const dst = path.join(wt, rel);
        let st; try { st = fs.lstatSync(src); } catch { continue; }
        if (st.isSymbolicLink()) { // a link to code elsewhere (e.g. frontend/planviewer → ~/work/planviewer): same link
          let target; try { target = fs.realpathSync(src); if (!fs.statSync(target).isDirectory()) continue; } catch { continue; }
          if (exists(dst)) continue;
          fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.symlinkSync(target, dst);
          await this.exclude(wt, rel); rec.links.push(rel);
          notes.push({ path: rel, how: 'link', ok: true });
          continue;
        }
        if (!st.isDirectory() || !exists(path.join(src, '.git')) || !empty(dst)) continue;
        const branch = (await this.git(src, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
        const r = await this.git(main, ['clone', '-q', '--local', ...(branch && branch !== 'HEAD' ? ['-b', branch] : []), src, dst], 600_000);
        const url = (await this.git(src, ['remote', 'get-url', 'origin'])).stdout.trim();
        if (r.code === 0 && url) await this.git(dst, ['remote', 'set-url', 'origin', url]);
        if (r.code === 0) await this.exclude(wt, rel);
        notes.push({ path: rel, how: 'clone', ok: r.code === 0, error: r.code === 0 ? null : (r.stderr || '').trim().split('\n').pop() });
      }
      rec.reposScanned = true;
    }
    const before = rec.repos || [];
    rec.repos = [...before.filter((x) => !notes.some((n) => n.path === x.path)), ...notes];
    if (notes.some((n) => !n.ok)) this.emit('error', rec, new Error('Could not bring ' + notes.filter((n) => !n.ok).map((n) => `${n.path} (${n.how}): ${n.error}`).join('; ')));
    return notes;
  }

  // Rewritten on every start, so changes to docker-compose.yml or database.yml are picked up.
  writeConfig(rec) {
    const dir = this.cfgDir(rec);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const { doc } = this.readMainCompose(rec.main);
    const s = this.settings(rec.main);
    const priv = rec.db.mode !== 'shared';
    const test = rec.db.test ? rec.db.test.name : null;
    const dbYml = priv || test ? path.join(dir, 'database.yml') : null;
    if (dbYml) {
      const orig = fs.readFileSync(path.join(rec.path, 'config', 'database.yml'), 'utf8');
      const names = {};
      if (priv) names.development = rec.db.name;
      if (test && C.ymlEnvs(orig).includes('test')) names.test = test;
      const text = C.databaseYmlOverride(orig, names);
      if (!text) throw httpError(400, 'config/database.yml has no development section.');
      fs.writeFileSync(dbYml, text);
    }
    // `docker compose …` typed in this worktree (by you or by Claude) reads this folder's .env too.
    const envLink = path.join(dir, '.env');
    if (!exists(envLink) && exists(path.join(rec.path, '.env'))) { try { fs.symlinkSync(path.join(rec.path, '.env'), envLink); } catch {} }
    const links = new Set(rec.links || []);
    const out = C.buildWorktreeCompose({
      id: rec.id, compose: doc, services: rec.services, mainDir: rec.main, wtDir: rec.path, slot: rec.slot, network: this.network(rec),
      dbName: priv ? rec.db.name : null, testDbName: test, dbYml, memLimits: { code: s.memCode, other: s.memOther },
      existsInWt: (rel) => { const r = path.normalize(rel); return !links.has(r) && exists(path.join(rec.path, r)); }
    });
    fs.writeFileSync(path.join(dir, 'docker-compose.yml'), out.text);
    rec.ports = out.ports;
    return out;
  }

  async writeFrontend(rec) {
    const front = this.frontend(rec.path);
    if (!front) { rec.frontend = null; return; }
    const offset = C.SLOT_STEP * rec.slot;
    const portMap = {};
    for (const p of rec.ports || []) portMap[p.main] = p.port;
    const viteFile = path.join(rec.path, front.dir, C.VITE_WRAPPER);
    const allow = (rec.repos || []).filter((x) => x.how === 'link' && x.ok).map((x) => { try { return fs.realpathSync(path.join(rec.path, x.path)); } catch { return null; } }).filter(Boolean);
    fs.writeFileSync(viteFile, C.viteWrapper({ config: front.config, offset, portMap, allow }));
    await this.exclude(rec.path, path.join(front.dir, C.VITE_WRAPPER));
    rec.frontend = { dir: front.dir, config: front.config, port: 5173 + offset, start: front.start, install: front.install, lock: front.lock };
  }

  // For Claude sessions and terminals in a worktree: plain `docker compose …` reaches this worktree's stack.
  sessionEnv(rec) {
    return { COMPOSE_PROJECT_NAME: this.project(rec), COMPOSE_FILE: path.join(this.cfgDir(rec), 'docker-compose.yml') };
  }

  url(rec) {
    if (!rec.frontend) return null;
    if (rec.isMain) return `http://localhost:${rec.frontend.port}`;
    const host = this.settings(rec.main).hostMode === 'localhost' ? 'localhost' : `${rec.id}.localhost`;
    return `http://${host}:${rec.frontend.port}`;
  }

  // ---------- status ----------
  async statusAll() {
    const r = await sh(this.docker, ['ps', '-a', '--filter', 'label=dev.backend-dash.worktree', '--format', '{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.service"}}\t{{.State}}\t{{.Label "com.docker.compose.oneoff"}}'], { timeout: 15000 });
    const docker = r.code === 0;
    const by = {};
    if (docker) for (const l of r.stdout.split('\n').filter(Boolean)) {
      const [project, service, state, oneoff] = l.split('\t');
      if (oneoff === 'True') continue;
      (by[project] = by[project] || []).push({ service, state });
    }
    const out = {};
    await Promise.all(this.data.worktrees.map(async (w) => {
      const cs = by[this.project(w)] || [];
      const running = cs.filter((c) => c.state === 'running').length;
      const vite = this.procs.byKey('vite:' + w.id);
      out[w.id] = {
        exists: fs.existsSync(w.path),
        backend: { running, total: w.services.length, services: cs, state: running === 0 ? 'down' : running < w.services.length ? 'partial' : 'up' },
        frontend: { state: vite && vite.pty ? 'up' : 'down', procId: vite ? vite.id : null },
        git: fs.existsSync(w.path) ? await this.gitState(w) : null,
        url: this.url(w),
        editor: this.settings(w.main).editor || null
      };
    }));
    for (const m of this.mains()) {
      let cs = [];
      try { if (docker) cs = await this.containersOf(await this.mainProject(m.main)); } catch {}
      const app = cs.filter((c) => m.app.includes(c.service));
      const running = app.filter((c) => c.state === 'running').length;
      const vite = this.procs.byKey('vite:' + m.id);
      out[m.id] = {
        exists: true, dockerDown: !docker,
        backend: { running, total: m.app.length, services: cs, state: running === 0 ? 'down' : running < m.app.length ? 'partial' : 'up', allRunning: cs.filter((c) => c.state === 'running').length, all: m.services.length },
        frontend: { state: vite && vite.pty ? 'up' : 'down', procId: vite ? vite.id : null },
        git: await this.gitState(m),
        url: m.frontend ? `http://localhost:${m.frontend.port}` : null,
        editor: this.settings(m.main).editor || null
      };
    }
    return { docker, dockerError: docker ? null : dockerDown(r), worktrees: out };
  }

  async detail(id) {
    const rec = this.get(id);
    const all = await this.statusAll();
    const st = all.worktrees[id];
    const branchOnly = this.branchOnlyMigrations(rec);
    let applied = new Set(); let appliedTest = new Set(); let dbSize = null; let testSize = null; let pgRunning = false;
    const size = async (n) => Number((await this.psql(rec.main, `SELECT pg_database_size(${ql(n)})`))[0]) || null;
    try {
      const pg = await this.pg(rec.main);
      pgRunning = pg.running;
      if (pg.running) {
        const db = this.targetDb(rec);
        if (db) applied = await this.appliedVersions(rec.main, db);
        if (rec.db.mode !== 'shared') dbSize = await size(rec.db.name);
        if (rec.db.test && rec.db.test.name) { appliedTest = await this.appliedVersions(rec.main, rec.db.test.name); testSize = await size(rec.db.test.name).catch(() => null); }
        if (rec.isMain && rec.db.source) dbSize = await size(rec.db.source).catch(() => null);
      }
    } catch {}
    const steps = {};
    for (const k of ['bash', 'migrate', 'up', 'down', 'install', 'vite', 'logs', 'db']) {
      const p = this.procs.byKey(k + ':' + id);
      if (p) steps[k] = { procId: p.id, status: p.status, exitCode: p.exitCode, endedAt: p.endedAt, startedAt: p.startedAt };
    }
    return Object.assign({}, st, {
      record: rec, pgRunning, dbSize, testSize, steps, settings: this.settings(rec.main), migrateScript: this.migrateScript(rec),
      migrations: branchOnly.map((m) => ({ ...m, applied: applied.has(m.version), appliedTest: rec.db.test ? appliedTest.has(m.version) : null, onShared: rec.sharedMigrations.some((s) => s.version === m.version) })),
      dockerError: all.dockerError
    });
  }

  // ---------- steps ----------
  service(rec) {
    const s = this.settings(rec.main).service;
    if (s && rec.services.includes(s)) return s;
    if (rec.services.includes('web')) return 'web';
    const { doc } = this.readMainCompose(rec.main);
    return rec.services.find((n) => C.codeMountTarget(doc.services[n])) || rec.services[0];
  }

  async prepare(rec) {
    if (rec.isMain) { this.mainRec(rec.main); return { missing: [] }; }
    if (!fs.existsSync(rec.path)) throw httpError(409, 'The worktree folder is gone: ' + rec.path);
    await this.syncRepos(rec);
    if (this.linkPlans(rec)) this.emit('plans', rec);
    this.writeConfig(rec);
    await this.writeFrontend(rec);
    this.save();
    const net = await this.ensureNetwork(rec);
    const pg = await this.pg(rec.main);
    if (!pg.running) throw httpError(409, `Shared ${pg.service} is not running — start the shared services first (Worktrees page).`);
    return net;
  }

  // Before migrating on the shared database: are there migrations only this branch has, not yet applied there?
  async migrationCheck(rec) {
    if (rec.isMain || rec.db.mode !== 'shared') return { needsChoice: false };
    const branchOnly = this.branchOnlyMigrations(rec);
    if (!branchOnly.length) return { needsChoice: false };
    const db = this.sharedDbOf(rec);
    const applied = db ? await this.appliedVersions(rec.main, db) : new Set();
    const pending = branchOnly.filter((m) => !applied.has(m.version));
    return pending.length ? { needsChoice: true, migrations: pending, sharedDb: db } : { needsChoice: false };
  }

  async guardStart(rec, force) {
    if (force || rec.isMain) return null;
    const s = this.settings(rec.main);
    const all = await this.statusAll();
    const running = Object.entries(all.worktrees).filter(([id, x]) => id !== rec.id && !this.mainRecs.has(id) && x.backend.running > 0).map(([id]) => id);
    if (running.length >= s.maxRunning) {
      return { confirm: 'max', message: `${running.length} worktrees are already running (${running.join(', ')}). Each one needs about 3 GB of memory. Stop one first, or start anyway.` };
    }
    const snap = this.monitor && this.monitor.last;
    if (snap && snap.docker && snap.docker.total) {
      const free = (snap.docker.total - snap.docker.used) / 1024 ** 3;
      if (free < s.minDockerFreeGb) return { confirm: 'memory', message: `Docker has ${free.toFixed(1)} GB of memory free. Starting another worktree may make your Mac slow. Stop a worktree first, or start anyway.` };
    }
    return null;
  }

  procBase(rec, kind, title) { return { key: kind + ':' + rec.id, cwd: rec.path, project: rec.path, kind, wt: rec.id, title: title + ' · ' + rec.key }; }

  // development first (db:setup the first time for a fresh database), then the same for RAILS_ENV=test
  // on the worktree's own test database (schema:load the first time when it started empty).
  migrateScript(rec) {
    const s = this.settings(rec.main);
    const dev = !rec.db.ready && rec.db.mode === 'fresh' ? `${s.setup} && ${s.migrate}` : s.migrate;
    const t = rec.db.test;
    if (!t) return dev;
    const test = t.ready ? s.migrate : `${s.testSetup} && RAILS_ENV=test ${s.migrate}`;
    return `${dev} && RAILS_ENV=test ${test}`;
  }
  async migrateCmd(rec) {
    return `${await this.composeLine(rec)} run --rm ${quote(this.service(rec))} sh -c ${quote(this.migrateScript(rec))}`;
  }

  async afterMigrate(rec, p) {
    if (p.status !== 'ok' || rec.isMain) return;
    if (rec.db.mode === 'fresh' && !rec.db.ready) rec.db.ready = true;
    if (rec.db.test) rec.db.test.ready = true;
    if (rec.db.mode === 'shared') {
      const db = this.sharedDbOf(rec);
      const applied = db ? await this.appliedVersions(rec.main, db) : new Set();
      for (const m of this.branchOnlyMigrations(rec)) {
        if (applied.has(m.version) && !rec.sharedMigrations.some((x) => x.version === m.version)) rec.sharedMigrations.push({ version: m.version, file: m.file, at: Date.now() });
      }
    }
    this.save();
  }

  async step(id, step, opts = {}) {
    const rec = this.get(id);
    const s = this.settings(rec.main);
    if (step === 'stop-vite') { const p = this.procs.byKey('vite:' + id); if (p) this.procs.kill(p.id); return { ok: true }; }
    if (step === 'all') return this.runAll(rec, opts);
    if (step === 'install' || step === 'vite') {
      if (!rec.frontend) await this.writeFrontend(rec);
      if (!rec.frontend) throw httpError(400, 'No Vite frontend found in this worktree.');
      const cwd = path.join(rec.path, rec.frontend.dir);
      if (step === 'install') return { proc: this.procs.start(Object.assign(this.procBase(rec, 'install', rec.frontend.install), { cwd, cmd: rec.frontend.install })) };
      return { proc: this.startVite(rec) };
    }
    if (step === 'logs') {
      const up = this.procs.byKey('up:' + id);
      if (up && up.pty) return { proc: up }; // `docker compose up` runs attached: its output is the log
      return { proc: this.procs.start(Object.assign(this.procBase(rec, 'logs', 'Logs'), { cmd: `${await this.composeLine(rec)} logs -f --tail=200` })) };
    }
    if (step === 'down') return this.stopBackend(rec);

    await this.prepare(rec);
    if (step === 'bash') return { proc: this.procs.start(Object.assign(this.procBase(rec, 'bash', this.service(rec) + ' bash'), { cmd: `${await this.composeLine(rec)} run --rm ${quote(this.service(rec))} ${s.bash}` })) };
    if (step === 'migrate') {
      if (!opts.force) { const chk = await this.migrationCheck(rec); if (chk.needsChoice) return chk; }
      const p = this.procs.start(Object.assign(this.procBase(rec, 'migrate', 'Migrate'), { cmd: await this.migrateCmd(rec) }));
      p.done.then((x) => this.afterMigrate(rec, x)).catch(() => {});
      return { proc: p };
    }
    if (step === 'up') {
      const guard = await this.guardStart(rec, opts.forceStart);
      if (guard) return guard;
      return { proc: await this.startUp(rec) };
    }
    throw httpError(400, 'Unknown step ' + step);
  }

  // `docker compose up` without -d: it stays attached, its tab is the live log, stopping it stops the containers.
  // Main checkout: if it is already up (with stopped app services), start those again in the background.
  async startUp(rec) {
    const line = await this.composeLine(rec);
    const cur = this.procs.byKey('up:' + rec.id);
    if (cur && cur.pty) {
      if (rec.isMain) await this.procs.run(Object.assign(this.procBase(rec, 'start', 'Start app services'), { cmd: `${line} up -d ${rec.app.map(quote).join(' ')}` }));
      return cur;
    }
    return this.procs.start(Object.assign(this.procBase(rec, 'up', 'docker compose up'), { cmd: `${line} up${rec.isMain ? '' : ' --remove-orphans'}` }));
  }

  // Wait until the service used for bash/migrate is running (or `up` exits) — up to 20 minutes for first pulls.
  async waitBackend(rec, upProc) {
    const svc = this.service(rec);
    const end = Date.now() + 20 * 60_000;
    while (Date.now() < end) {
      if (upProc && !upProc.pty) return false;
      const st = (await this.statusAll()).worktrees[rec.id];
      if (st && st.backend.services.some((c) => c.service === svc && c.state === 'running')) return true;
      await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
  }

  // Worktrees of this main checkout whose backend is running (they need the shared Postgres, MinIO…).
  async runningChildren(main) {
    const st = (await this.statusAll()).worktrees;
    return this.childrenOf(main).filter((w) => st[w.id] && st[w.id].backend.running > 0);
  }

  // Stop frees the memory: every command of this environment is stopped (Ctrl+C, then killed), then
  // worktree: `docker compose down` (its containers are removed; the databases are in the shared Postgres);
  // main checkout: its app containers are removed, and the shared services stop too unless a worktree is
  // running — then they keep running for it. all=false (Backend → Stop): the frontend keeps running.
  async stopBackend(rec, { all = false } = {}) {
    this.runs.set(rec.id, (this.runs.get(rec.id) || 0) + 1);
    const line = await this.composeLine(rec);
    const keep = rec.isMain ? await this.runningChildren(rec.main) : [];
    const mine = (p) => p.wt === rec.id && p.kind !== 'down' && p.kind !== 'up' && (all || !['vite', 'install'].includes(p.kind));
    await this.procs.stopWhere(mine);
    const up = this.procs.byKey('up:' + rec.id);
    // main with worktrees running: let `up` go without stopping the shared containers; else Ctrl+C stops them all
    if (up && up.pty) await this.procs.stop(up.id, keep.length ? { detach: true } : { grace: 30000 });
    const cmd = !rec.isMain ? `${line} down --remove-orphans`
      : `${line} rm -sf ${rec.app.map(quote).join(' ')}` + (keep.length ? '' : ` && ${line} stop`);
    const p = await this.procs.run(Object.assign(this.procBase(rec, 'down', rec.isMain ? 'Stop' : 'Down'), { cmd }));
    return { ok: p.status === 'ok', proc: p, keptShared: keep.map((w) => w.key) };
  }

  startVite(rec) {
    const cwd = path.join(rec.path, rec.frontend.dir);
    if (rec.isMain) return this.procs.start(Object.assign(this.procBase(rec, 'vite', 'Frontend'), { cwd, cmd: rec.frontend.run || 'yarn start' }));
    const portMap = {};
    for (const p of rec.ports || []) portMap[p.main] = p.port;
    const envFiles = ['.env', '.env.development', '.env.local', '.env.development.local'].map((f) => { try { return fs.readFileSync(path.join(cwd, f), 'utf8'); } catch { return ''; } });
    // API base URLs (localhost:3000) become the page's own origin, so calls go through Vite's proxy — no CORS.
    const web = (rec.ports || []).find((p) => p.service === this.service(rec) && p.container === '3000') || (rec.ports || []).find((p) => p.service === this.service(rec));
    const env = C.envOverrides(envFiles, portMap, web && this.url(rec) ? { port: String(web.main), origin: this.url(rec) } : null);
    const start = rec.frontend.start || `vite --config ${C.VITE_WRAPPER}`;
    return this.procs.start(Object.assign(this.procBase(rec, 'vite', 'Frontend'), { cwd, env, cmd: `PATH="$PWD/node_modules/.bin:$PATH" ${start}` }));
  }

  needsInstall(rec) {
    if (!rec.frontend) return false;
    const dir = path.join(rec.path, rec.frontend.dir);
    const nm = path.join(dir, 'node_modules');
    if (!fs.existsSync(nm)) return true;
    if (!rec.frontend.lock) return false;
    try { return fs.statSync(path.join(dir, rec.frontend.lock)).mtimeMs > fs.statSync(nm).mtimeMs; } catch { return false; }
  }

  // Run all: migrate → up → (yarn install) → vite. Stops at the first failing step.
  async runAll(rec, opts) {
    await this.prepare(rec);
    if (!opts.force) { const chk = await this.migrationCheck(rec); if (chk.needsChoice) return chk; }
    const guard = await this.guardStart(rec, opts.forceStart);
    if (guard) return guard;
    const run = (this.runs.get(rec.id) || 0) + 1;
    this.runs.set(rec.id, run);
    const stopped = () => this.runs.get(rec.id) !== run; // Stop was pressed meanwhile
    const chain = (async () => {
      let p = await this.procs.run(Object.assign(this.procBase(rec, 'migrate', 'Migrate'), { cmd: await this.migrateCmd(rec) }));
      await this.afterMigrate(rec, p);
      if (p.status !== 'ok' || stopped()) return;
      const up = await this.startUp(rec);
      if (!(await this.waitBackend(rec, up)) || !rec.frontend || stopped()) return;
      if (this.needsInstall(rec)) {
        p = await this.procs.run(Object.assign(this.procBase(rec, 'install', rec.frontend.install), { cwd: path.join(rec.path, rec.frontend.dir), cmd: rec.frontend.install }));
        if (p.status !== 'ok' || stopped()) return;
      }
      if (!this.procs.byKey('vite:' + rec.id) || !this.procs.byKey('vite:' + rec.id).pty) this.startVite(rec);
    })();
    chain.catch((e) => this.emit('error', rec, e));
    return { started: true };
  }

  async stop(id) {
    const rec = this.get(id);
    const r = await this.stopBackend(rec, { all: true });
    return { ok: r.ok, proc: r.proc.id, keptShared: r.keptShared };
  }

  // ---------- database mode ----------
  async setDbMode(id, mode) {
    const rec = this.get(id);
    if (rec.isMain) throw httpError(400, 'The main checkout always uses its own databases.');
    if (mode === 'refresh-test') {
      if (!rec.db.test) throw httpError(400, 'This worktree has no test database of its own.');
      rec.db.test.source = this.guessTestDb(rec.main, await this.databases(rec.main), this.sharedDbOf(rec));
      await this.createTestDb(rec);
      this.writeConfig(rec); this.save();
      return { ok: true };
    }
    if (mode === 'copy' || mode === 'refresh') {
      if (!rec.db.source) throw httpError(400, 'Pick the shared database to copy first.');
      if (mode === 'copy' && rec.db.mode !== 'shared') return { ok: true };
      await this.procs.run(Object.assign(this.procBase(rec, 'down', 'Stop'), { cmd: `${await this.composeLine(rec)} down --remove-orphans` }));
      if (!rec.db.name) rec.db.name = C.dbIdent(C.dbIdent(path.basename(rec.main)) + '_' + rec.id);
      await this.copyDb(rec);
      rec.db.mode = 'copy'; rec.db.ready = true;
    } else if (mode === 'shared') {
      if (rec.db.mode === 'shared') return { ok: true };
      await this.procs.run(Object.assign(this.procBase(rec, 'down', 'Stop'), { cmd: `${await this.composeLine(rec)} down --remove-orphans` }));
      rec.db.mode = 'shared'; // the private database is kept until the worktree is deleted
    } else throw httpError(400, 'Unknown database mode');
    this.writeConfig(rec);
    this.save();
    return { ok: true };
  }

  // Undo the branch's migrations on the shared database (newest first).
  async rollbackShared(id) {
    const rec = this.get(id);
    if (!rec.sharedMigrations.length) return { ok: true, rolledBack: [] };
    await this.prepare(rec);
    const s = this.settings(rec.main);
    const versions = rec.sharedMigrations.map((m) => m.version).sort().reverse();
    const prev = rec.db.mode;
    // Roll back against the shared database even if this worktree has a private one by now.
    if (prev !== 'shared') { rec.db.mode = 'shared'; this.writeConfig(rec); }
    const cmds = versions.map((v) => s.migrateDown.replace('{version}', v)).join(' && ');
    const p = await this.procs.run(Object.assign(this.procBase(rec, 'migrate', 'Roll back shared'), { cmd: `${await this.composeLine(rec)} run --rm ${quote(this.service(rec))} sh -c ${quote(cmds)}` }));
    if (prev !== 'shared') { rec.db.mode = prev; this.writeConfig(rec); }
    if (p.status !== 'ok') throw httpError(500, 'Rolling back failed — see the "Roll back shared" tab.');
    const applied = await this.appliedVersions(rec.main, this.sharedDbOf(rec));
    rec.sharedMigrations = rec.sharedMigrations.filter((m) => applied.has(m.version));
    this.save();
    return { ok: true, rolledBack: versions };
  }

  sharedBanner() {
    return this.data.worktrees.filter((w) => w.sharedMigrations.length).map((w) => ({ id: w.id, key: w.key, main: w.main, migrations: w.sharedMigrations }));
  }

  // ---------- delete ----------
  async sizes(rec) {
    const du = async (p) => { const r = await sh('du', ['-sk', p], { timeout: 120_000 }); return r.code === 0 || r.stdout ? Number(r.stdout.split(/\s/)[0]) * 1024 : null; };
    const nm = rec.frontend ? path.join(rec.path, rec.frontend.dir, 'node_modules') : null;
    const [folder, modules] = await Promise.all([fs.existsSync(rec.path) ? du(rec.path) : 0, nm && fs.existsSync(nm) ? du(nm) : 0]);
    const dbSize = async (n) => { try { return Number((await this.psql(rec.main, `SELECT pg_database_size(${ql(n)})`))[0]) || null; } catch { return null; } };
    const db = rec.db.name ? await dbSize(rec.db.name) : null;
    const testDb = rec.db.test ? await dbSize(rec.db.test.name) : null;
    return { folder, modules, db, testDb };
  }

  async deletePlan(id) {
    const rec = this.get(id);
    const [git, sizes] = await Promise.all([fs.existsSync(rec.path) ? this.gitState(rec) : null, this.sizes(rec)]);
    return { record: rec, git, sizes, sharedMigrations: rec.sharedMigrations, volumes: await this.volumes(rec) };
  }

  async volumes(rec) {
    const r = await sh(this.docker, ['volume', 'ls', '-q', '--filter', 'label=com.docker.compose.project=' + this.project(rec)], { timeout: 15000 });
    return r.code === 0 ? r.stdout.split('\n').filter(Boolean) : [];
  }

  async remove(id, o = {}) {
    const rec = this.get(id);
    if (rec.isMain) throw httpError(400, 'The main checkout cannot be deleted from here.');
    const steps = [];
    const note = (label, ok, detail) => { steps.push({ label, ok, detail: detail || null }); this.emit('progress', id, steps); };
    const g0 = fs.existsSync(rec.path) ? await this.gitState(rec) : null;
    const branchNow = (g0 && g0.branch && g0.branch !== 'HEAD' ? g0.branch : null) || rec.branch;
    if (g0 && !o.force) {
      const g = g0;
      if (g.dirty || (o.deleteBranch && g.unpushed)) throw httpError(409, (g.dirty ? `${g.dirty} uncommitted change(s)` : '') + (g.dirty && o.deleteBranch && g.unpushed ? ' and ' : '') + (o.deleteBranch && g.unpushed ? `${g.unpushed} commit(s) only on this branch` : '') + ' would be lost — confirm to delete anyway.');
    }
    this.procs.killWhere((p) => p.wt === id);
    if (o.rollback && rec.sharedMigrations.length) {
      try { const r = await this.rollbackShared(id); note('Rolled back on the shared database: ' + r.rolledBack.join(', '), true); }
      catch (e) { note('Roll back shared migrations', false, e.message); throw httpError(500, 'Stopped before deleting anything else: ' + e.message); }
    }
    if (fs.existsSync(path.join(this.cfgDir(rec), 'docker-compose.yml'))) {
      const down = await sh((await this.composeBase())[0], [...(await this.composeArgs(rec)).slice(1), 'down', '-v', '--remove-orphans'], { timeout: 300_000, cwd: fs.existsSync(rec.path) ? rec.path : rec.main });
      note('Containers and volumes removed', down.code === 0, down.code === 0 ? null : down.stderr.trim().slice(-400));
    }
    // Volumes compose may not know about any more (services removed from the file since).
    for (const v of await this.volumes(rec)) await sh(this.docker, ['volume', 'rm', '-f', v], { timeout: 60_000 });
    note('Docker network removed', await this.dropNetwork(rec));
    if (rec.db.name && o.dropDb !== false) {
      try { await this.dropDb(rec); note(`Database ${rec.db.name} dropped`, true); } catch (e) { note(`Drop database ${rec.db.name}`, false, e.message); }
    }
    if (rec.db.test) {
      try { await this.dropDbNamed(rec.main, rec.db.test.name); note(`Test database ${rec.db.test.name} dropped`, true); } catch (e) { note(`Drop test database ${rec.db.test.name}`, false, e.message); }
    }
    if (fs.existsSync(rec.path)) {
      const r = await this.git(rec.main, ['worktree', 'remove', '--force', rec.path], 300_000);
      if (r.code !== 0) fs.rmSync(rec.path, { recursive: true, force: true });
      note('Folder removed (incl. node_modules)', !fs.existsSync(rec.path), r.code === 0 ? null : r.stderr.trim());
    }
    await this.git(rec.main, ['worktree', 'prune']);
    if (o.deleteBranch) {
      const r = await this.git(rec.main, ['branch', '-D', branchNow]);
      note('Local branch ' + branchNow + ' deleted', r.code === 0, r.code === 0 ? null : r.stderr.trim());
    }
    fs.rmSync(this.cfgDir(rec), { recursive: true, force: true });
    note('Generated config removed, port slot ' + rec.slot + ' free', true);
    this.data.worktrees = this.data.worktrees.filter((w) => w.id !== id);
    this.save();
    return { ok: steps.every((s) => s.ok), steps };
  }

  // ---------- shared services ----------
  async sharedAction(main, action) {
    const { file, doc } = this.readMainCompose(main);
    const shared = C.classify(doc).shared;
    const project = await this.mainProject(main);
    const base = (await this.composeBase()).map(quote).join(' ') + ` -p ${quote(project)} -f ${quote(file)}`;
    const cmd = action === 'start' ? `${base} up -d ${shared.map(quote).join(' ')}` : action === 'stop' ? `${base} stop ${shared.map(quote).join(' ')}` : `${base} logs -f --tail=100 ${shared.map(quote).join(' ')}`;
    const p = this.procs.start({ key: 'shared-' + action + ':' + main, cmd, cwd: main, title: 'Shared services · ' + action, project: main, kind: 'shared' });
    if (action !== 'logs') p.done.then(() => { this.cache.delete('proj:' + main); this.emit('changed'); });
    return { proc: p };
  }

  async sharedStatus(main) {
    try {
      const list = await this.shared(main, C.classify(this.readMainCompose(main).doc).app);
      return { services: list, running: list.filter((s) => s.state === 'running').length, total: list.length, project: await this.mainProject(main) };
    } catch (e) { return { error: e.message, services: [], running: 0, total: 0 }; }
  }
}

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '0.0.0.0');
  });
}

function dockerDown(r) {
  const t = (r.stderr || r.error || '').trim();
  return /Cannot connect|daemon|docker.sock|not found|ENOENT/i.test(t) ? 'Docker is not running (or not installed). Start Docker Desktop and try again.' : t || 'docker failed';
}

// Moves what `src` has and `dst` lacks into `dst`; a file name taken in both is kept as name + suffix.
function mergeInto(src, dst, suffix) {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const a = path.join(src, e.name); const b = path.join(dst, e.name);
    if (!exists(b)) { fs.cpSync(a, b, { recursive: true, verbatimSymlinks: true }); continue; }
    if (e.isDirectory() && fs.statSync(b).isDirectory()) { mergeInto(a, b, suffix); continue; }
    if (e.isFile() && fs.readFileSync(a).equals(fs.readFileSync(b))) continue;
    let alt = b + suffix; let i = 2; while (exists(alt)) alt = b + suffix + '-' + i++;
    fs.cpSync(a, alt, { recursive: true, verbatimSymlinks: true });
  }
}

export function httpError(status, message) { return Object.assign(new Error(message), { status }); }
