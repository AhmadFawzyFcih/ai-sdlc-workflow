// Shared setup for the end-to-end tests: test image, fixture project, dashboard server, API helpers.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createFixture } from './fixture.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DASH = path.resolve(HERE, '..', '..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const sh = (cmd, args, opts) => execFileSync(cmd, args, Object.assign({ stdio: 'pipe' }, opts || {})).toString();
export const docker = (...args) => { try { return sh('docker', args).trim(); } catch (e) { return 'ERR ' + String(e.stderr || e.message); } };

export async function startHarness({ settings } = {}) {
  // BD_E2E_ROOT=/home/demo gives the screenshots realistic paths (~/work/webapp); it is wiped at the end.
  const TMP = process.env.BD_E2E_ROOT ? (fs.rmSync(process.env.BD_E2E_ROOT, { recursive: true, force: true }), fs.mkdirSync(process.env.BD_E2E_ROOT, { recursive: true }), process.env.BD_E2E_ROOT) : fs.mkdtempSync(path.join(os.tmpdir(), 'bd-e2e-'));
  const MAIN = path.join(TMP, 'work', 'webapp');
  const CONFIG = path.join(TMP, 'config');
  const PORT = 4600 + Math.floor(Math.random() * 300);
  execFileSync(path.join(HERE, 'build-images.sh'), { stdio: 'inherit' });
  const tpl = path.join(TMP, 'front-template');
  fs.mkdirSync(tpl, { recursive: true });
  fs.writeFileSync(path.join(tpl, 'package.json'), JSON.stringify({ name: 'front', private: true, devDependencies: { vite: '5.4.11' } }));
  sh('npm', ['install', '--no-audit', '--no-fund', '--silent'], { cwd: tpl });
  createFixture(MAIN, { viteModules: tpl });
  fs.mkdirSync(path.join(CONFIG, 'backend-dash'), { recursive: true });
  fs.writeFileSync(path.join(CONFIG, 'backend-dash', 'worktree-settings.json'), JSON.stringify({
    defaults: Object.assign({ migrate: 'node bin/fake-rails.js db:migrate', migrateDown: 'node bin/fake-rails.js db:migrate:down VERSION={version}', setup: 'node bin/fake-rails.js db:setup', testSetup: 'node bin/fake-rails.js db:schema:load', maxRunning: 3, minDockerFreeGb: 0, autoStartMain: false }, settings || {})
  }));
  const server = spawn(process.execPath, [path.join(DASH, 'server.js'), '--port', String(PORT), '--project', MAIN, '--no-open'], {
    env: Object.assign({}, process.env, { XDG_CONFIG_HOME: CONFIG, SHELL: '/bin/bash', BACKEND_DASH_SHELL_FLAGS: '-lic', BACKEND_DASH_CLAUDE: '/bin/false', DEP_HASH: 'dev1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  const H = { TMP, MAIN, CONFIG, PORT, server, url: `http://127.0.0.1:${PORT}` };
  H.waitFor = async (fn, ms = 60000, label = 'condition') => {
    const end = Date.now() + ms; let last;
    while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(500); }
    throw new Error('Timed out waiting for ' + label + (last instanceof Error ? ': ' + last.message : ''));
  };
  const html = await H.waitFor(async () => (await fetch(H.url + '/')).text(), 15000, 'server');
  H.TOKEN = html.match(/name="dash-token" content="([^"]+)"/)[1];
  H.api = async (method, p, body) => {
    const res = await fetch(H.url + p, { method, headers: { 'X-Dash-Token': H.TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  H.waitProc = async (key, ms = 240000) => {
    const p = await H.waitFor(async () => { const { data } = await H.api('GET', '/api/procs'); const x = data.procs.filter((q) => q.key === key).pop(); return x && x.status !== 'running' ? x : null; }, ms, 'proc ' + key);
    if (p.status !== 'ok') { const { data } = await H.api('GET', `/api/procs/${p.id}/log`); throw new Error(`${key} ${p.status}:\n${data.log}`); }
    return p;
  };
  H.pgId = () => docker('ps', '-q', '--filter', 'label=com.docker.compose.project=webapp', '--filter', 'label=com.docker.compose.service=postgres');
  H.psql = (sql, db = 'postgres') => docker('exec', H.pgId(), 'psql', '-U', 'postgres', '-d', db, '-Atc', sql);
  H.get = (port, p = '/', host) => new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: p, headers: host ? { Host: host } : {}, timeout: 5000 }, (res) => {
      let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')));
  });
  // shared services + the main database, like a developer's machine before the first worktree
  H.setupShared = async () => {
    await H.api('POST', '/api/shared/start', { project: MAIN });
    await H.waitProc('shared-start:' + MAIN);
    await H.waitFor(() => H.psql('SELECT 1') === '1', 60000, 'postgres');
    sh('docker', ['compose', '-p', 'webapp', 'run', '--rm', 'web', 'node', 'bin/fake-rails.js', 'db:setup'], { cwd: MAIN, env: Object.assign({}, process.env, { DEP_HASH: 'dev1' }) });
    sh('docker', ['compose', '-p', 'webapp', 'run', '--rm', '-e', 'RAILS_ENV=test', 'web', 'node', 'bin/fake-rails.js', 'db:setup'], { cwd: MAIN, env: Object.assign({}, process.env, { DEP_HASH: 'dev1' }) });
  };
  H.stop = async () => {
    try { server.kill('SIGTERM'); } catch {}
    await sleep(500);
    const projects = docker('ps', '-a', '--format', '{{.Label "com.docker.compose.project"}}').split('\n').filter((p) => p === 'webapp' || p.startsWith('bd-'));
    for (const p of new Set(projects)) docker('compose', '-p', p, '-f', path.join(MAIN, 'docker-compose.yml'), 'down', '-v', '--remove-orphans');
    for (const n of docker('network', 'ls', '-q', '--filter', 'name=bd-').split('\n').filter(Boolean)) docker('network', 'rm', n);
    if (!process.env.KEEP) fs.rmSync(TMP, { recursive: true, force: true });
  };
  return H;
}
