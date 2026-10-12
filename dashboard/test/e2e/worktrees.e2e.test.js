// End-to-end: real git worktrees, real Docker containers, a real Postgres, the real dashboard server.
// Needs Linux + Docker + PostgreSQL 16 binaries (see build-images.sh). Run: npm run test:e2e
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createFixture } from './fixture.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DASH = path.resolve(HERE, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-e2e-'));
const MAIN = path.join(TMP, 'work', 'webapp');
const CONFIG = path.join(TMP, 'config');
const PORT = 4600 + Math.floor(Math.random() * 300);
const sh = (cmd, args, opts) => execFileSync(cmd, args, Object.assign({ stdio: 'pipe' }, opts || {})).toString();
const docker = (...args) => { try { return sh('docker', args).trim(); } catch (e) { return 'ERR ' + String(e.stderr || e.message); } };
const psql = (sql, db = 'postgres') => docker('exec', pgId(), 'psql', '-U', 'postgres', '-d', db, '-Atc', sql);
const pgId = () => docker('ps', '-q', '--filter', 'label=com.docker.compose.project=webapp', '--filter', 'label=com.docker.compose.service=postgres');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let server; let TOKEN; let ws; const wsMsgs = [];

async function api(method, p, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${p}`, { method, headers: { 'X-Dash-Token': TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
async function waitFor(fn, ms = 60000, label = 'condition') {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(500); }
  throw new Error('Timed out waiting for ' + label + (last instanceof Error ? ': ' + last.message : ''));
}
async function waitProc(key, ms = 240000) {
  const p = await waitFor(async () => { const { data } = await api('GET', '/api/procs'); const x = data.procs.filter((q) => q.key === key).pop(); return x && x.status !== 'running' ? x : null; }, ms, 'proc ' + key);
  if (p.status !== 'ok') { const { data } = await api('GET', `/api/procs/${p.id}/log`); throw new Error(`${key} ${p.status}:\n${data.log}`); }
  return p;
}
const get = (port, p = '/', host) => new Promise((resolve, reject) => {
  const req = http.get({ host: '127.0.0.1', port, path: p, headers: host ? { Host: host } : {}, timeout: 5000 }, (res) => {
    let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, body: d }));
  });
  req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')));
});

before(async () => {
  execFileSync(path.join(HERE, 'build-images.sh'), { stdio: 'inherit' });
  // a package-lock for the fixture frontend (npm caches the download for the worktree installs)
  const tpl = path.join(TMP, 'front-template');
  fs.mkdirSync(tpl, { recursive: true });
  fs.writeFileSync(path.join(tpl, 'package.json'), JSON.stringify({ name: 'front', private: true, devDependencies: { vite: '5.4.11' } }));
  sh('npm', ['install', '--no-audit', '--no-fund', '--silent'], { cwd: tpl });
  createFixture(MAIN, { viteModules: tpl });
  fs.mkdirSync(path.join(CONFIG, 'backend-dash'), { recursive: true });
  fs.writeFileSync(path.join(CONFIG, 'backend-dash', 'worktree-settings.json'), JSON.stringify({
    defaults: { migrate: 'node bin/fake-rails.js db:migrate', migrateDown: 'node bin/fake-rails.js db:migrate:down VERSION={version}', setup: 'node bin/fake-rails.js db:setup', testSetup: 'node bin/fake-rails.js db:schema:load', maxRunning: 1, minDockerFreeGb: 0, autoStartMain: false }
  }));
  await startServer();
});

async function startServer() {
  server = spawn(process.execPath, [path.join(DASH, 'server.js'), '--port', String(PORT), '--project', MAIN, '--no-open'], {
    env: Object.assign({}, process.env, { XDG_CONFIG_HOME: CONFIG, SHELL: '/bin/bash', BACKEND_DASH_SHELL_FLAGS: '-lic', BACKEND_DASH_CLAUDE: '/bin/false', DEP_HASH: 'dev1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  const html = await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/`)).text(), 15000, 'server');
  TOKEN = html.match(/name="dash-token" content="([^"]+)"/)[1];
  ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${TOKEN}`, { origin: `http://127.0.0.1:${PORT}` });
  ws.on('message', (m) => wsMsgs.push(JSON.parse(m)));
  await new Promise((r) => ws.on('open', r));
}
async function stopServer() {
  try { ws.close(); } catch {}
  const gone = new Promise((r) => server.once('exit', r));
  server.kill('SIGINT');
  await gone;
}
const backendUp = (id) => waitFor(async () => { const d = (await api('GET', '/api/worktrees/' + id)).data; return d.backend && d.backend.state === 'up' ? d : null; }, 300000, id + ' backend up');

after(async () => {
  try { ws.close(); } catch {}
  try { server.kill('SIGTERM'); } catch {}
  for (const p of ['webapp', 'bd-proj-100', 'bd-proj-300', 'bd-answers-wt']) docker('compose', '-p', p, '-f', path.join(MAIN, 'docker-compose.yml'), 'down', '-v', '--remove-orphans');
  for (const n of ['bd-proj-100', 'bd-proj-300']) docker('network', 'rm', n);
  if (!process.env.KEEP) fs.rmSync(TMP, { recursive: true, force: true });
});

test('shared services start and the main database is set up', async () => {
  const r = await api('POST', '/api/shared/start', { project: MAIN });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  await waitProc('shared-start:' + MAIN);
  await waitFor(() => psql('SELECT 1') === '1', 60000, 'postgres');
  sh('docker', ['compose', '-p', 'webapp', 'run', '--rm', 'web', 'node', 'bin/fake-rails.js', 'db:setup'], { cwd: MAIN, env: Object.assign({}, process.env, { DEP_HASH: 'dev1' }) });
  sh('docker', ['compose', '-p', 'webapp', 'run', '--rm', '-e', 'RAILS_ENV=test', 'web', 'node', 'bin/fake-rails.js', 'db:setup'], { cwd: MAIN, env: Object.assign({}, process.env, { DEP_HASH: 'dev1' }) });
  assert.equal(psql('SELECT version FROM schema_migrations', 'webapp_development'), '20260101000000');
  assert.equal(psql('SELECT version FROM schema_migrations', 'webapp_test'), '20260101000000');
  // main's own web is not running; only shared services (and main's redis started by the run)
  const st = await api('GET', '/api/worktrees');
  assert.equal(st.data.docker, true);
  assert.ok(st.data.shared[MAIN].running >= 2, JSON.stringify(st.data.shared[MAIN]));
});

test('inspect: services, shared database and branches for the New worktree dialog', async () => {
  const { status, data } = await api('GET', '/api/worktrees/inspect?project=' + encodeURIComponent(MAIN));
  assert.equal(status, 200, JSON.stringify(data));
  assert.deepEqual(data.services.map((s) => s.name).sort(), ['anycable', 'anycable-go', 'redis', 'web', 'worker']);
  assert.deepEqual(data.shared.sort(), ['minio', 'postgres']);
  assert.equal(data.sharedDb, 'webapp_development');
  assert.equal(data.sharedTestDb, 'webapp_test');
  assert.equal(data.testDb, true);
  assert.equal(data.slot, 1);
  assert.ok(data.branches.find((b) => b.name === 'master' && b.openAt === MAIN), 'master is open in the main checkout');
  assert.ok(data.planBranches.find((b) => b.name === 'feature/PROJ-100-answers'), 'branch from state.json');
  assert.equal(data.frontend.dir, 'frontend');
});

test('a branch that is open elsewhere cannot get a worktree', async () => {
  const r = await api('POST', '/api/worktrees', { main: MAIN, branch: 'master', dbMode: 'shared' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /already (checked out|used by worktree)/);
});

let A;
test('create a worktree with a private copy of the database', async () => {
  const r = await api('POST', '/api/worktrees', { main: MAIN, branch: 'feature/PROJ-100-answers', dbMode: 'copy', sourceDb: 'webapp_development', sourceTestDb: 'webapp_test' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  A = r.data.worktree;
  assert.equal(A.id, 'proj-100');
  assert.equal(A.path, path.join(path.dirname(MAIN), 'webapp-worktrees', 'PROJ-100'));
  assert.equal(A.db.name, 'webapp_proj_100');
  // linked, not copied: plans, settings, env, keys
  for (const l of ['.plans', '.claude/backend.yml', '.env', 'config/master.key', 'frontend/.env.development.local']) {
    assert.ok(fs.lstatSync(path.join(A.path, l)).isSymbolicLink(), l + ' is a link');
  }
  assert.equal(sh('git', ['-C', A.path, 'status', '--porcelain']).trim(), '', 'links and the vite wrapper stay out of git');
  assert.equal(psql("SELECT count(*) FROM pg_database WHERE datname = 'webapp_proj_100'"), '1', 'private copy exists');
  assert.equal(psql('SELECT version FROM schema_migrations', 'webapp_proj_100'), '20260101000000', 'copied with its data');
  assert.equal(A.db.test.name, 'webapp_proj_100_test');
  assert.equal(A.db.test.ready, true);
  assert.equal(psql('SELECT version FROM schema_migrations', 'webapp_proj_100_test'), '20260101000000', 'own test database, copied from webapp_test');
  const projects = (await api('GET', '/api/projects')).data.projects;
  assert.deepEqual(projects.map((p) => p.path), [MAIN, A.path], 'listed right after its main checkout');
  assert.equal(projects[1].worktree.id, 'proj-100');
  assert.equal(projects[1].name, 'PROJ-100');
  const compose = fs.readFileSync(path.join(CONFIG, 'backend-dash', 'worktrees', 'proj-100', 'docker-compose.yml'), 'utf8');
  assert.match(compose, /"3010:3000"/);
  assert.ok(!/postgres:\n/.test(compose.split('networks:')[0].replace(/links:[\s\S]*?volumes/g, '')), 'postgres is not part of the worktree');
});

test('run all: migrate (private DB) → up → npm install → vite', async () => {
  const r = await api('POST', `/api/worktrees/${A.id}/step`, { step: 'all' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  await waitProc('migrate:proj-100');
  await backendUp('proj-100'); // `docker compose up` stays attached
  await waitProc('install:proj-100', 300000);
  await waitFor(async () => { try { return (await get(5183, '/')).status === 200; } catch { return false; } }, 60000, 'vite on 5183');
  assert.equal(psql("SELECT count(*) FROM schema_migrations WHERE version = '20261001000000'", 'webapp_proj_100'), '1', 'branch migration ran on the private copy');
  assert.equal(psql("SELECT count(*) FROM schema_migrations WHERE version = '20261001000000'", 'webapp_development'), '0', 'shared database untouched');
  assert.equal(psql("SELECT count(*) FROM schema_migrations WHERE version = '20261001000000'", 'webapp_proj_100_test'), '1', 'RAILS_ENV=test migrate ran on its own test database');
  assert.equal(psql("SELECT count(*) FROM schema_migrations WHERE version = '20261001000000'", 'webapp_test'), '0', 'shared test database untouched');
  const migr = (await api('GET', '/api/procs')).data.procs.filter((p) => p.key === 'migrate:proj-100').pop();
  const log = (await api('GET', '/api/procs/' + migr.id + '/log')).data.log;
  assert.match(log, /RAILS_ENV=development → webapp_proj_100\b/);
  assert.match(log, /RAILS_ENV=test → webapp_proj_100_test/);
});

test('the worktree backend reaches its own Redis, the shared Postgres/MinIO and its private database', async () => {
  const body = await waitFor(async () => { try { return JSON.parse((await get(3010, '/x')).body); } catch { return null; } }, 60000, 'web on 3010');
  const ownRedis = docker('ps', '-q', '--filter', 'label=com.docker.compose.project=bd-proj-100', '--filter', 'label=com.docker.compose.service=redis');
  const ownHost = docker('inspect', '-f', '{{.Config.Hostname}}', ownRedis);
  assert.equal(body.redis, 'ID ' + ownHost, 'its own Redis, not main\'s');
  assert.equal(body.postgres, true);
  assert.equal(body.minio, true);
  assert.equal(body.db, 'webapp_proj_100');
  assert.equal(body.env, 'webapp_proj_100');
});

test('plain `docker compose` in the worktree (as Claude runs it) reaches the worktree stack and its test database', async () => {
  const env = Object.assign({}, process.env, { COMPOSE_PROJECT_NAME: 'bd-proj-100', COMPOSE_FILE: path.join(CONFIG, 'backend-dash', 'worktrees', 'proj-100', 'docker-compose.yml') });
  delete env.DEP_HASH; // comes from the worktree's .env, like on a developer's machine
  const out = sh('docker', ['compose', 'run', '--rm', '-e', 'RAILS_ENV=test', 'web', 'node', '-e', "console.log(require('/app/bin/dbname.js')())"], { cwd: A.path, env });
  assert.equal(out.trim().split('\n').pop(), 'webapp_proj_100_test');
});

test('vite: own port, proxy to the worktree backend, .localhost host allowed, env moved', async () => {
  const via = JSON.parse((await get(5183, '/api/ping', 'proj-100.localhost:5183')).body);
  assert.equal(via.path, '/api/ping');
  assert.equal(via.db, 'webapp_proj_100', 'proxied to :3010, not :3000');
  const js = (await get(5183, '/src/main.js', 'proj-100.localhost:5183')).body;
  assert.match(js, /http:\/\/proj-100\.localhost:5183\/api/, 'VITE_API is the page’s own origin: API calls go through the Vite proxy (no CORS)');
  assert.match(js, /ws:\/\/localhost:8090\/cable/, 'other ports move to the worktree ports');
  // the submodule and the git-ignored nested repo are there, so the imports resolve
  for (const [f, text] of [['/planviewer/src/index.js', 'planviewer ok'], ['/shared-ui/index.js', 'shared-ui ok']]) {
    const r = await get(5183, f, 'proj-100.localhost:5183');
    assert.equal(r.status, 200, f + ': ' + r.body.slice(0, 200)); assert.match(r.body, new RegExp(text));
  }
  const repos = (await api('GET', '/api/worktrees/proj-100')).data.record.repos;
  assert.deepEqual(repos.map((x) => [x.path, x.how, x.ok]).sort(), [['frontend/planviewer', 'clone', true], ['frontend/shared-ui', 'submodule', true]]);
  const A_DIR = (await api('GET', '/api/worktrees/proj-100')).data.record.path;
  assert.equal(sh('git', ['-C', path.join(A_DIR, 'frontend/planviewer'), 'remote', 'get-url', 'origin']).trim(), 'git@example.com:team/planviewer.git', 'same origin as main\'s copy');
  assert.equal(sh('git', ['-C', path.join(A_DIR, 'frontend/planviewer'), 'rev-parse', '--abbrev-ref', 'HEAD']).trim(), 'develop');
  assert.equal(sh('git', ['-C', A_DIR, 'status', '--porcelain']).trim(), '', 'nothing new shows as a change in the worktree');
  const up = (await api('GET', '/api/procs')).data.procs.find((p) => p.key === 'up:proj-100');
  assert.equal(up.status, 'running', 'docker compose up runs attached (no -d)');
  assert.doesNotMatch(up.cmd, / -d\b/);
  const d = (await api('GET', '/api/worktrees/proj-100')).data;
  assert.equal(d.backend.state, 'up');
  assert.equal(d.frontend.state, 'up');
  assert.equal(d.url, 'http://proj-100.localhost:5183');
  assert.ok(d.migrations.find((m) => m.version === '20261001000000' && m.applied));
});

let B;
test('shared database: a branch migration asks first; "run on shared" is tracked and can be rolled back', async () => {
  const c = await api('POST', '/api/worktrees', { main: MAIN, branch: 'feature/PROJ-300-hide', dbMode: 'shared', sourceDb: 'webapp_development' });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  B = c.data.worktree;
  assert.equal(B.slot, 2);
  const ask = await api('POST', `/api/worktrees/${B.id}/step`, { step: 'migrate' });
  assert.equal(ask.status, 409);
  assert.equal(ask.data.needsChoice, true);
  assert.deepEqual(ask.data.migrations.map((m) => m.version), ['20261002000000']);
  const run = await api('POST', `/api/worktrees/${B.id}/step`, { step: 'migrate', force: true });
  assert.equal(run.status, 200, JSON.stringify(run.data));
  await waitProc('migrate:proj-300');
  assert.equal(psql("SELECT count(*) FROM schema_migrations WHERE version = '20261002000000'", 'webapp_development'), '1');
  assert.equal(psql("SELECT count(*) FROM schema_migrations WHERE version = '20261002000000'", 'webapp_proj_300_test'), '1', 'shared development, own test database');
  assert.equal(psql("SELECT count(*) FROM schema_migrations WHERE version = '20261002000000'", 'webapp_test'), '0');
  const list = await waitFor(async () => { const d = (await api('GET', '/api/worktrees')).data; return d.banner.length ? d : null; }, 10000, 'banner');
  assert.equal(list.banner[0].key, 'PROJ-300');
  const rb = await api('POST', `/api/worktrees/${B.id}/rollback`);
  assert.equal(rb.status, 200, JSON.stringify(rb.data));
  assert.equal(psql("SELECT count(*) FROM schema_migrations WHERE version = '20261002000000'", 'webapp_development'), '0', 'rolled back');
  assert.equal(psql("SELECT to_regclass('hidden_answers') IS NULL", 'webapp_development'), 't');
  assert.equal((await api('GET', '/api/worktrees')).data.banner.length, 0);
});

test('memory guard: a second running worktree needs a confirmation', async () => {
  const r = await api('POST', `/api/worktrees/${B.id}/step`, { step: 'up' });
  assert.equal(r.status, 409);
  assert.equal(r.data.confirm, 'max');
  const ok = await api('POST', `/api/worktrees/${B.id}/step`, { step: 'up', forceStart: true });
  assert.equal(ok.status, 200);
  await backendUp('proj-300');
  const body = await waitFor(async () => { try { return JSON.parse((await get(3020, '/')).body); } catch { return null; } }, 60000, 'web on 3020');
  assert.equal(body.db, 'webapp_development', 'shared database');
});

test('fresh database: first migrate runs setup; a busy source falls back to pg_dump; switching to a private copy', async () => {
  // new branch from master, empty database, and no shared test database to copy → its test database starts empty
  psql('ALTER DATABASE webapp_test RENAME TO webapp_test_away');
  const c = await api('POST', '/api/worktrees', { main: MAIN, newBranch: 'feature/PROJ-400-fresh', base: 'master', dbMode: 'fresh', sourceDb: 'webapp_development', sourceTestDb: 'webapp_test' });
  psql('ALTER DATABASE webapp_test_away RENAME TO webapp_test');
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const D = c.data.worktree;
  assert.equal(D.slot, 3);
  assert.equal(psql("SELECT count(*) FROM pg_database WHERE datname = 'webapp_proj_400'"), '0', 'not created until the first migrate');
  const m = await api('POST', `/api/worktrees/${D.id}/step`, { step: 'migrate' });
  assert.equal(m.status, 200, JSON.stringify(m.data));
  await waitProc('migrate:proj-400');
  assert.equal(psql('SELECT version FROM schema_migrations', 'webapp_proj_400'), '20260101000000');
  assert.equal(psql('SELECT version FROM schema_migrations', 'webapp_proj_400_test'), '20260101000000', 'empty test database got the schema');
  const dd = (await api('GET', `/api/worktrees/${D.id}`)).data;
  assert.equal(dd.record.db.ready, true);
  assert.equal(dd.record.db.test.ready, true);
  assert.equal(dd.record.db.test.source, null);
  assert.doesNotMatch(dd.migrateScript, /schema:load/, 'only the first migrate loads the schema');
  // someone is connected to the shared database → CREATE DATABASE … TEMPLATE fails → pg_dump fallback
  docker('exec', '-d', pgId(), 'psql', '-U', 'postgres', '-d', 'webapp_development', '-c', 'SELECT pg_sleep(30)');
  await waitFor(() => Number(psql("SELECT count(*) FROM pg_stat_activity WHERE datname = 'webapp_development'")) > 0, 10000, 'busy source');
  const sw = await api('POST', `/api/worktrees/${D.id}/db`, { mode: 'refresh' });
  assert.equal(sw.status, 200, JSON.stringify(sw.data));
  const procs = (await api('GET', '/api/procs')).data.procs;
  assert.ok(procs.some((p) => p.key === 'db:proj-400' && p.status === 'ok'), 'copied with pg_dump');
  assert.equal(psql('SELECT version FROM schema_migrations', 'webapp_proj_400'), '20260101000000');
  // back to shared and then "make a private copy" (the migrate dialog's first button)
  assert.equal((await api('POST', `/api/worktrees/${D.id}/db`, { mode: 'shared' })).status, 200);
  const shared = fs.readFileSync(path.join(CONFIG, 'backend-dash', 'worktrees', 'proj-400', 'docker-compose.yml'), 'utf8');
  assert.ok(!shared.includes('BACKEND_DASH_DATABASE='), 'development back on the shared database');
  assert.ok(shared.includes('BACKEND_DASH_TEST_DATABASE=webapp_proj_400_test'), 'test database stays its own');
  assert.equal((await api('POST', `/api/worktrees/${D.id}/db`, { mode: 'copy' })).status, 200);
  assert.ok(fs.readFileSync(path.join(CONFIG, 'backend-dash', 'worktrees', 'proj-400', 'docker-compose.yml'), 'utf8').includes('BACKEND_DASH_DATABASE=webapp_proj_400'));
  const del = await api('POST', `/api/worktrees/${D.id}/delete`, { force: true, deleteBranch: true });
  assert.ok(del.data.ok, JSON.stringify(del.data));
  assert.equal(psql("SELECT count(*) FROM pg_database WHERE datname IN ('webapp_proj_400', 'webapp_proj_400_test')"), '0');
});

test('a worktree has its own name; it can switch branches; subtask status set by hand', async () => {
  const c = await api('POST', '/api/worktrees', { main: MAIN, name: 'answers-wt', branch: 'feature/PROJ-100-answers', dbMode: 'shared', sourceDb: 'webapp_development', sourceTestDb: 'webapp_test' });
  assert.equal(c.status, 400, 'feature/PROJ-100-answers is open in PROJ-100');
  const n = await api('POST', '/api/worktrees', { main: MAIN, name: 'answers-wt', newBranch: 'spike/answers', base: 'master', dbMode: 'shared', sourceDb: 'webapp_development', sourceTestDb: 'webapp_test' });
  assert.equal(n.status, 200, JSON.stringify(n.data));
  const E = n.data.worktree;
  assert.equal(E.id, 'answers-wt');
  assert.equal(E.key, 'answers-wt');
  assert.ok(E.path.endsWith('/webapp-worktrees/answers-wt'));
  assert.equal(E.db.test.name, 'webapp_answers_wt_test');
  assert.equal((await api('POST', '/api/worktrees', { main: MAIN, name: 'answers-wt', newBranch: 'spike/two', base: 'master' })).status, 400, 'names are unique');
  sh('git', ['-C', E.path, 'checkout', '-q', '-b', 'spike/second']);
  const list = (await api('GET', '/api/worktrees')).data.worktrees.find((w) => w.id === 'answers-wt');
  assert.equal(list.status.git.branch, 'spike/second', 'the card shows the branch checked out now');
  const del = await api('POST', '/api/worktrees/answers-wt/delete', { force: true, deleteBranch: true });
  assert.ok(del.data.steps.some((s) => s.label === 'Local branch spike/second deleted' && s.ok), 'deletes the branch checked out now');
  // manual status of a subtask (folder page)
  const r = await api('POST', '/api/subtask-status', { project: MAIN, key: 'PROJ-102', status: 'done' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const state = JSON.parse(fs.readFileSync(path.join(MAIN, '.plans/features/PROJ-100-answers/state.json'), 'utf8'));
  assert.equal(state.stories[0].subtasks[1].status, 'done');
  assert.ok(state.updated_at);
  const ev = fs.readFileSync(path.join(MAIN, '.plans/features/PROJ-100-answers/events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).pop();
  assert.equal(ev.type, 'subtask.done');
  assert.match(ev.msg, /PROJ-102 in_progress → done/);
  assert.equal((await api('POST', '/api/subtask-status', { project: MAIN, key: 'PROJ-102', status: 'merged-ish' })).status, 400);
});

test('open in editor: the "editor" setting gets the folder; VS Code missing is explained; unknown folders are refused', async () => {
  const wt = (await api('GET', '/api/worktrees')).data.worktrees.find((w) => w.id === 'proj-100');
  const file = path.join(CONFIG, 'backend-dash', 'worktree-settings.json');
  const before = fs.readFileSync(file, 'utf8');
  const missing = await api('POST', '/api/open-editor', { path: MAIN });
  assert.equal(missing.status, 500);
  assert.match(missing.data.error, /VS Code was not found[\s\S]*Install 'code' command in PATH/);
  const log = path.join(TMP, 'editor.log');
  const s = JSON.parse(before); s.defaults.editor = `printf '%s\\n' >> ${log}`;
  fs.writeFileSync(file, JSON.stringify(s));
  try {
    for (const dir of [MAIN, wt.path]) assert.equal((await api('POST', '/api/open-editor', { path: dir })).status, 200);
    assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), [MAIN, wt.path]);
    assert.equal((await api('GET', '/api/worktrees')).data.worktrees.find((w) => w.id === 'proj-100').status.editor, s.defaults.editor, 'the cards know the editor');
    assert.equal((await api('POST', '/api/open-editor', { path: TMP })).status, 400, 'only projects and worktrees');
  } finally { fs.writeFileSync(file, before); }
});

test('monitor: memory per worktree and disk sizes', async () => {
  await waitFor(async () => { const s = (await api('GET', '/api/monitor')).data; return s.groups && s.groups.some((g) => g.key === 'wt:proj-100' && g.items.some((i) => i.name === 'web')) ? s : null; }, 90000, 'monitor sample');
  const s = (await api('GET', '/api/monitor')).data;
  assert.ok(s.host.total > 0 && s.host.used > 0);
  assert.ok(s.docker.total > 0 && s.docker.used > 0);
  const g = s.groups.find((x) => x.key === 'wt:proj-100');
  assert.ok(g.items.some((i) => i.name === 'vite' && i.kind === 'process'), 'vite process counted');
  assert.ok(s.groups.some((x) => x.kind === 'shared' && x.items.some((i) => i.name === 'postgres')));
  const disk = (await api('GET', '/api/monitor/disk')).data;
  const a = disk.worktrees.find((w) => w.id === 'proj-100');
  assert.ok(a.folder > a.modules && a.modules > 1_000_000, JSON.stringify(a));
  assert.ok(a.db > 1_000_000);
});

test('.plans is watched once and every project that shares it is told', async () => {
  wsMsgs.length = 0;
  fs.writeFileSync(path.join(MAIN, '.plans', 'note.md'), '# hi\n');
  const m = await waitFor(() => wsMsgs.find((x) => x.t === 'tree'), 10000, 'tree event');
  assert.deepEqual(m.projects.sort(), [MAIN, A.path].concat(B ? [B.path] : []).sort());
  const tree = (await api('GET', '/api/tree?project=' + encodeURIComponent(A.path))).data;
  assert.ok(tree.tree.some((n) => n.name === 'note.md'), 'visible from the worktree');
});

test('main checkout: its own environment — run all, attached up, stop keeps shared services, starts with the dashboard', async () => {
  const projects = (await api('GET', '/api/projects')).data.projects;
  const env = projects.find((p) => p.path === MAIN).env;
  assert.deepEqual(env, { id: 'main-webapp', main: true });
  assert.equal((await api('POST', '/api/worktrees/main-webapp/delete', { force: true })).status, 400, 'cannot be deleted');
  const r = await api('POST', '/api/worktrees/main-webapp/step', { step: 'all' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  await waitProc('migrate:main-webapp');
  const log = (await api('GET', '/api/procs/' + (await api('GET', '/api/procs')).data.procs.filter((p) => p.key === 'migrate:main-webapp').pop().id + '/log')).data.log;
  assert.match(log, /RAILS_ENV=development → webapp_development/);
  assert.match(log, /RAILS_ENV=test → webapp_test\b/);
  await backendUp('main-webapp');
  const body = await waitFor(async () => { try { return JSON.parse((await get(3000, '/')).body); } catch { return null; } }, 60000, 'main web on 3000');
  assert.equal(body.db, 'webapp_development');
  await waitFor(async () => { try { return (await get(5173, '/')).status === 200; } catch { return false; } }, 120000, 'main vite on 5173');
  const vite = (await api('GET', '/api/procs')).data.procs.find((p) => p.key === 'vite:main-webapp');
  assert.equal(vite.cmd, 'npm start', 'main runs its own start script');
  // stop while PROJ-100 runs: everything of main stops, its app containers are removed, shared ones keep running
  const st = await api('POST', '/api/worktrees/main-webapp/stop');
  assert.equal(st.status, 200, JSON.stringify(st.data));
  assert.ok(st.data.keptShared.includes('PROJ-100'), JSON.stringify(st.data));
  assert.equal((await api('GET', '/api/worktrees/main-webapp')).data.backend.state, 'down');
  assert.equal((await api('GET', '/api/procs')).data.procs.filter((p) => p.wt === 'main-webapp' && p.alive).length, 0, 'no command of main still running');
  assert.equal(docker('ps', '-aq', '--filter', 'label=com.docker.compose.project=webapp', '--filter', 'label=com.docker.compose.service=web'), '', 'app containers removed');
  assert.equal(psql('SELECT 1'), '1', 'shared Postgres still up');
  await assert.rejects(get(5173, '/'), 'main vite stopped');
  // starts by itself when the dashboard starts
  assert.equal((await api('POST', '/api/worktrees/main-webapp/settings', { autoStart: true })).status, 200);
  // an older worktree with its own .plans folder instead of the link: repaired when the dashboard starts
  const wtPlans = path.join(A.path, '.plans');
  fs.unlinkSync(wtPlans);
  fs.mkdirSync(path.join(wtPlans, 'features', 'PROJ-555-only-here'), { recursive: true });
  fs.writeFileSync(path.join(wtPlans, 'features', 'PROJ-555-only-here', 'context.md'), '# only in the worktree\n');
  fs.mkdirSync(path.join(wtPlans, 'features', 'PROJ-100-answers'), { recursive: true });
  fs.writeFileSync(path.join(wtPlans, 'features', 'PROJ-100-answers', 'state.json'), '{"differs":true}');
  await stopServer();
  await startServer();
  assert.ok(fs.lstatSync(wtPlans).isSymbolicLink(), 'the worktree .plans is a link again');
  assert.equal(fs.realpathSync(wtPlans), fs.realpathSync(path.join(MAIN, '.plans')));
  assert.ok(fs.existsSync(path.join(MAIN, '.plans/features/PROJ-555-only-here/context.md')), 'its own files moved to main');
  assert.ok(fs.existsSync(path.join(MAIN, '.plans/features/PROJ-100-answers/state.json.from-proj-100')), 'a clash is kept next to main\'s file');
  const wtTree = (await api('GET', '/api/tree?project=' + encodeURIComponent(A.path))).data.tree;
  const feats = wtTree.find((n) => n.name === 'features').children.map((n) => n.name);
  assert.ok(feats.includes('PROJ-100-answers') && feats.includes('PROJ-555-only-here'), feats.join(','));
  fs.rmSync(path.join(MAIN, '.plans/features/PROJ-555-only-here'), { recursive: true });
  fs.rmSync(path.join(MAIN, '.plans/features/PROJ-100-answers/state.json.from-proj-100'));
  await backendUp('main-webapp');
  await waitFor(async () => { try { return (await get(5173, '/')).status === 200; } catch { return false; } }, 120000, 'main vite after restart');
  assert.equal((await api('POST', '/api/worktrees/main-webapp/settings', { autoStart: false })).status, 200);
  await api('POST', '/api/worktrees/main-webapp/stop');
  // the dashboard restart stopped the worktrees too (Ctrl+C stops what it started): start PROJ-100 again
  await api('POST', '/api/shared/start', { project: MAIN });
  await waitFor(() => psql('SELECT 1') === '1', 60000, 'postgres');
  assert.equal((await api('POST', `/api/worktrees/${A.id}/step`, { step: 'all', forceStart: true })).status, 200);
  await backendUp(A.id);
  await waitFor(async () => (await api('GET', `/api/worktrees/${A.id}`)).data.frontend.state === 'up', 120000, 'PROJ-100 vite');
});

test('stop keeps the database and folder; containers and vite stop', async () => {
  await api('POST', `/api/worktrees/${A.id}/step`, { step: 'logs' }); // one more running command
  const r = await api('POST', `/api/worktrees/${A.id}/stop`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(docker('ps', '-aq', '--filter', 'label=com.docker.compose.project=bd-proj-100'), '', 'containers removed (down)');
  assert.equal((await api('GET', '/api/procs')).data.procs.filter((p) => p.wt === A.id && p.alive).length, 0, 'no command of the worktree still running');
  assert.equal(sh('ps', ['-A', '-o', 'args=']).split('\n').filter((l) => /docker.*compose.*bd-proj-100|vite --config/.test(l)).join('\n'), '', 'no process left behind');
  await assert.rejects(get(5183, '/'), 'vite port closed');
  await waitFor(async () => (await api('GET', `/api/worktrees/${A.id}`)).data.frontend.state === 'down', 10000, 'vite stopped');
  assert.ok(fs.existsSync(A.path));
  assert.equal(psql("SELECT count(*) FROM pg_database WHERE datname = 'webapp_proj_100'"), '1');
});

test('delete refuses uncommitted work unless confirmed, then cleans up everything', async () => {
  fs.writeFileSync(path.join(A.path, 'scratch.txt'), 'wip');
  const plan = (await api('GET', `/api/worktrees/${A.id}/delete-plan`)).data;
  assert.equal(plan.git.dirty, 1);
  assert.ok(plan.sizes.folder > 0 && plan.sizes.db > 0);
  const no = await api('POST', `/api/worktrees/${A.id}/delete`, {});
  assert.equal(no.status, 409);
  const r = await api('POST', `/api/worktrees/${A.id}/delete`, { force: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.ok, JSON.stringify(r.data.steps));
  assert.equal(docker('ps', '-aq', '--filter', 'label=com.docker.compose.project=bd-proj-100'), '', 'containers gone');
  assert.equal(docker('volume', 'ls', '-q', '--filter', 'label=com.docker.compose.project=bd-proj-100'), '', 'volumes gone');
  assert.match(docker('network', 'inspect', 'bd-proj-100'), /^ERR/, 'network gone');
  assert.equal(psql("SELECT count(*) FROM pg_database WHERE datname = 'webapp_proj_100'"), '0', 'private database dropped');
  assert.equal(psql("SELECT count(*) FROM pg_database WHERE datname = 'webapp_proj_100_test'"), '0', 'test database dropped');
  assert.ok(r.data.steps.some((s) => /Test database webapp_proj_100_test dropped/.test(s.label)));
  assert.ok(!fs.existsSync(A.path), 'folder gone');
  assert.ok(!fs.existsSync(path.join(CONFIG, 'backend-dash', 'worktrees', 'proj-100')), 'generated config gone');
  assert.ok(!sh('git', ['-C', MAIN, 'worktree', 'list']).includes('PROJ-100'));
  assert.ok(sh('git', ['-C', MAIN, 'branch']).includes('feature/PROJ-100-answers'), 'branch kept by default');
  assert.ok(!(await api('GET', '/api/projects')).data.projects.some((p) => p.path === A.path), 'removed from the project list');
  assert.equal(psql('SELECT count(*) FROM schema_migrations', 'webapp_development'), '1', 'shared database untouched');
  // the shared Postgres is still connected to nothing of ours
  assert.ok(!docker('inspect', '-f', '{{json .NetworkSettings.Networks}}', pgId()).includes('bd-proj-100'));
});

test('delete with "also delete the branch"', async () => {
  const r = await api('POST', `/api/worktrees/${B.id}/delete`, { force: true, deleteBranch: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.ok, JSON.stringify(r.data.steps));
  assert.ok(!sh('git', ['-C', MAIN, 'branch']).includes('feature/PROJ-300-hide'));
  assert.equal((await api('GET', '/api/worktrees')).data.worktrees.length, 0);
  assert.ok(psql('SELECT 1') === '1', 'shared Postgres still running');
  assert.equal(psql("SELECT count(*) FROM pg_database WHERE datname LIKE 'webapp_proj%'"), '0', 'no worktree database left');
  assert.equal(psql("SELECT count(*) FROM pg_database WHERE datname IN ('webapp_development', 'webapp_test')"), '2', 'shared databases kept');
});

test('main checkout with no worktree running: stop stops the shared services too', async () => {
  assert.equal((await api('POST', '/api/worktrees/main-webapp/step', { step: 'up' })).status, 200);
  await backendUp('main-webapp');
  const st = await api('POST', '/api/worktrees/main-webapp/stop');
  assert.deepEqual(st.data.keptShared, []);
  assert.equal(docker('ps', '-q', '--filter', 'label=com.docker.compose.project=webapp'), '', 'nothing of webapp running');
  assert.equal(sh('ps', ['-A', '-o', 'args=']).split('\n').filter((l) => /docker.*compose.* up\b/.test(l)).join('\n'), '', 'docker compose up has exited');
});
