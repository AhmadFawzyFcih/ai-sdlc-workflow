// Unit tests for the worktree compose / Vite / database.yml generation.  Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import * as C from '../lib/compose.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const compose = C.parseCompose(fs.readFileSync(path.join(HERE, 'fixtures', 'webapp-compose.yml'), 'utf8'));

test('ports: short, long, ip, protocol, range and container-only', () => {
  assert.deepEqual(C.parsePort('3000:3000'), { ip: null, host: '3000', container: '3000', proto: null });
  assert.deepEqual(C.parsePort('127.0.0.1:5432:5432'), { ip: '127.0.0.1', host: '5432', container: '5432', proto: null });
  assert.equal(C.shiftPort('22348:22347', 10), '22358:22347');
  assert.equal(C.shiftPort('127.0.0.1:3000:3000', 20), '127.0.0.1:3020:3000');
  assert.equal(C.shiftPort('8080:8080/udp', 10), '8090:8080/udp');
  assert.equal(C.shiftPort('3000-3002:3000-3002', 10), '3010-3012:3000-3002');
  assert.equal(C.shiftPort('3000', 10), '3000');
  assert.deepEqual(C.shiftPort({ target: 80, published: 8080 }, 10), { target: 80, published: 8090 });
  assert.equal(C.shiftPort(5000, 10), 5000);
});

test('classify: code services, own redis, and what talks to them run per worktree', () => {
  const c = C.classify(compose);
  assert.deepEqual(c.app.sort(), ['anycable', 'anycable-go', 'async_worker', 'file_converter', 'pdf_generator', 'redis', 'web', 'worker'].sort());
  assert.equal(c.why.web, 'runs the code of this branch');
  assert.equal(c.why.redis, 'own Redis per worktree');
  assert.equal(c.why['anycable-go'], 'talks to anycable');
  assert.equal(c.why.pdf_generator, 'talks to redis');
  for (const s of ['postgres', 'minio', 'document_engine', 'virus_scanner', 'memcached', 'mailcatcher', 'compare_service', 'render-service', 'headless-chrome-service']) assert.ok(c.shared.includes(s), s + ' stays shared');
  assert.equal(c.postgres, 'postgres');
});

test('refersTo matches host names, not substrings', () => {
  assert.ok(C.refersTo({ environment: ['REDIS_HOST=redis'] }, 'redis'));
  assert.ok(C.refersTo({ environment: { URL: 'redis://redis:6379/0' } }, 'redis'));
  assert.ok(C.refersTo({ command: 'wait-for web:3000' }, 'web'));
  assert.ok(!C.refersTo({ environment: ['A=webpack'] }, 'web'));
  assert.ok(!C.refersTo({ environment: ['A=anycable-go:8080'] }, 'anycable'));
  assert.ok(!C.refersTo({ environment: ['REDIS_HOST=redis'] }, 'redis-cache'));
});

function build(slot = 1, dbName = null) {
  const c = C.classify(compose);
  return C.buildWorktreeCompose({
    id: 'proj-1', compose, services: c.app, mainDir: '/w/webapp', wtDir: '/w/wt/PROJ-1', slot, network: 'bd-proj-1',
    dbName, dbYml: dbName ? '/cfg/proj-1/database.yml' : null, existsInWt: (rel) => rel === './config/scanner.conf'
  });
}

test('worktree compose: only branch services, shifted ports, no shared links', () => {
  const { doc, ports, text } = build(1);
  assert.deepEqual(Object.keys(doc.services).sort(), C.classify(compose).app.sort());
  assert.deepEqual(doc.services.web.ports, ['3010:3000', '22356:22346']);
  assert.deepEqual(doc.services.async_worker.ports, ['22358:22347']);
  assert.deepEqual(doc.services['anycable-go'].ports, ['8090:8080']);
  assert.deepEqual(doc.services.web.links, ['redis']);
  assert.deepEqual(doc.services.anycable.depends_on, ['anycable-go', 'redis']);
  assert.equal(doc.services.postgres, undefined);
  assert.deepEqual(doc.networks, { default: { name: 'bd-proj-1', external: true } });
  assert.ok(ports.find((p) => p.service === 'web' && p.main === 3000 && p.port === 3010));
  assert.ok(text.includes('${DEP_HASH}'), 'image variables stay for compose to fill in');
  assert.ok(!/container_name/.test(text));
});

test('worktree compose: code from the worktree, uploads from main, private data for redis', () => {
  const { doc } = build(2);
  const v = doc.services.web.volumes;
  assert.ok(v.includes('/w/wt/PROJ-1:/app:cached'), 'code mount');
  assert.ok(v.includes('/w/webapp/system:/shared_files:delegated'), 'shared uploads stay with main');
  assert.ok(v.includes('/w/wt/PROJ-1/config/scanner.conf:/etc/scanner/scanner.conf'), 'tracked config from the worktree');
  assert.ok(v.includes('web_tmp:/app/tmp'), 'named volume (project-scoped by compose)');
  assert.deepEqual(doc.services.redis.volumes, ['redis-data:/data'], 'redis gets its own data');
  assert.ok(doc.volumes['redis-data'] !== undefined && doc.volumes.web_tmp !== undefined);
  assert.equal(doc.services.web.build.context, '/w/wt/PROJ-1');
  assert.equal(doc.services.web.mem_limit, '3g');
  assert.equal(doc.services.redis.mem_limit, '1g');
  assert.deepEqual(doc.services.web.ports, ['3020:3000', '22366:22346']);
});

test('worktree compose: private database mounts the database.yml copy', () => {
  const { doc } = build(1, 'webapp_proj_1');
  assert.ok(doc.services.web.volumes.includes('/cfg/proj-1/database.yml:/app/config/database.yml:ro'));
  assert.ok(doc.services.web.environment.includes('BACKEND_DASH_DATABASE=webapp_proj_1'));
  assert.ok(!(doc.services.redis.volumes || []).some((x) => x.includes('database.yml')), 'only code services');
  const shared = build(1).doc;
  assert.ok(!shared.services.web.volumes.some((x) => x.includes('database.yml')));
});

test('worktree compose is valid YAML that round-trips', () => {
  const { text } = build(3, 'x_db');
  const back = YAML.parse(text);
  assert.equal(back.services.web.ports[0], '3030:3000');
});

test('main host ports are known so slots never collide', () => {
  const s = C.mainHostPorts(compose);
  for (const p of [5432, 1080, 9000, 5000, 3000, 22346, 4000, 22347, 22348, 8080, 3001, 3310, 9222]) assert.ok(s.has(p), String(p));
});

// ---------- database.yml ----------
const RUBY = (() => { try { execFileSync('ruby', ['-v']); return true; } catch { return false; } })();
function rubyLoad(text, env = {}) {
  const f = path.join(os.tmpdir(), 'bd-db-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.yml');
  fs.writeFileSync(f, text);
  const script = `
    require 'yaml'; require 'erb'; require 'json'
    src = File.read(ARGV[0])
    full = YAML.respond_to?(:unsafe_load) ? YAML.unsafe_load(ERB.new(src).result) : YAML.load(ERB.new(src).result)
    dummy = src.gsub(/<%=.*?%>/m, 'dummy_compiler').gsub(/<%.*?%>/m, '')
    d = YAML.respond_to?(:unsafe_load) ? YAML.unsafe_load(dummy) : YAML.load(dummy)
    puts JSON.generate({ full: full, dummy_is_hash: d.is_a?(Hash), dummy_keys: d.is_a?(Hash) ? d.keys : nil })`;
  try { return JSON.parse(execFileSync('ruby', ['-e', script, f], { env: Object.assign({}, process.env, env) }).toString()); }
  finally { fs.unlinkSync(f); }
}

const SIMPLE = `default: &default
  adapter: postgresql
  encoding: unicode
  host: <%= ENV.fetch('POSTGRES_HOST', 'localhost') %>
  username: <%= ENV['POSTGRES_USER'] %>
  pool: 5

development:
  <<: *default
  database: app_development

test:
  <<: *default
  database: app_test<%= ENV['TEST_ENV_NUMBER'] %>
`;

test('database.yml: only the development database changes (simple file)', { skip: !RUBY && 'ruby not installed' }, () => {
  const out = C.databaseYmlOverride(SIMPLE, 'app_proj_1');
  const r = rubyLoad(out, { POSTGRES_HOST: 'postgres', POSTGRES_USER: 'pg' });
  assert.equal(r.full.development.database, 'app_proj_1');
  assert.equal(r.full.development.host, 'postgres');
  assert.equal(r.full.development.adapter, 'postgresql');
  assert.equal(r.full.test.database, 'app_test', 'test database untouched');
  assert.ok(r.dummy_is_hash, "Rails' dummy-ERB pass still sees a hash");
  assert.deepEqual(r.dummy_keys.sort(), ['default', 'development', 'test']);
});

test('database.yml: existing anchor, comments and multiple databases', { skip: !RUBY && 'ruby not installed' }, () => {
  const anchored = SIMPLE.replace('development:\n', 'development: &dev # local\n');
  const r1 = rubyLoad(C.databaseYmlOverride(anchored, 'x1'));
  assert.equal(r1.full.development.database, 'x1');
  const multi = `default: &default
  adapter: postgresql
development:
  primary:
    <<: *default
    database: app_dev
  cache:
    <<: *default
    database: app_dev_cache
    migrations_paths: db/cache_migrate
test:
  primary:
    <<: *default
    database: app_test
`;
  const r2 = rubyLoad(C.databaseYmlOverride(multi, 'x2'));
  assert.equal(r2.full.development.primary.database, 'x2');
  assert.equal(r2.full.development.cache.database, 'x2');
  assert.equal(r2.full.development.cache.migrations_paths, 'db/cache_migrate');
  assert.equal(r2.full.test.primary.database, 'app_test');
  assert.ok(r2.dummy_is_hash);
});

test('database.yml: no development section → null (the dashboard then refuses a private DB)', () => {
  assert.equal(C.databaseYmlOverride('production:\n  database: x\n', 'y'), null);
});

// ---------- Vite ----------
test('vite: start script uses the wrapper config', () => {
  assert.equal(C.startScript({ scripts: { start: 'NODE_OPTIONS=--max-http-header-size=65536 vite' } }), 'NODE_OPTIONS=--max-http-header-size=65536 vite --config vite.worktree.config.mjs');
  assert.equal(C.startScript({ scripts: { dev: 'vite serve --host' } }), 'vite serve --config vite.worktree.config.mjs --host');
  assert.equal(C.startScript({ scripts: { start: 'react-scripts start' } }), null);
});

test('vite: .env values pointing at main ports move to the worktree ports', () => {
  const o = C.envOverrides(['VITE_CABLE_URL=ws://localhost:8080/cable\nVITE_API="http://127.0.0.1:3000/api"\nOTHER=http://example.com:3000\n'], { 8080: 8090, 3000: 3010 });
  assert.deepEqual(o, { VITE_CABLE_URL: 'ws://localhost:8090/cable', VITE_API: 'http://127.0.0.1:3010/api' });
});

test('vite: finds the config at the root or one folder down', () => {
  const fsMap = { '/r': ['frontend', 'app', 'node_modules'], '/r/frontend': ['vite.config.ts', 'package.json'] };
  const list = (d) => fsMap[d] || [];
  assert.deepEqual(C.findViteConfig(list, '/r'), { dir: '/r/frontend', config: 'vite.config.ts' });
  assert.equal(C.findViteConfig(() => [], '/r'), null);
});

// ---------- own test database ----------
const PARALLEL = SIMPLE.replace("database: app_test<%= ENV['TEST_ENV_NUMBER'] %>", "database: app_test<%= ENV['TEST_ENV_NUMBER'] %>");

test('database.yml: development and test both get their own database', { skip: !RUBY && 'ruby not installed' }, () => {
  const r = rubyLoad(C.databaseYmlOverride(PARALLEL, { development: 'app_proj_1', test: 'app_proj_1_test' }), { POSTGRES_HOST: 'postgres' });
  assert.equal(r.full.development.database, 'app_proj_1');
  assert.equal(r.full.test.database, 'app_proj_1_test');
  assert.equal(r.full.test.host, 'postgres', 'test keeps its settings');
  assert.ok(r.dummy_is_hash);
});

test('database.yml: shared development, own test database; parallel_tests number kept', { skip: !RUBY && 'ruby not installed' }, () => {
  const text = C.databaseYmlOverride(PARALLEL, { test: 'app_proj_1_test' });
  const r = rubyLoad(text, { TEST_ENV_NUMBER: '2' });
  assert.equal(r.full.development.database, 'app_development', 'development untouched');
  assert.equal(r.full.test.database, 'app_proj_1_test2');
  assert.deepEqual(C.ymlEnvs(PARALLEL), ['default', 'development', 'test']);
});

test('worktree compose: shared development + own test database still mounts the copy', () => {
  const c = C.classify(compose);
  const { doc } = C.buildWorktreeCompose({ id: 'k', compose, services: c.app, mainDir: '/w/webapp', wtDir: '/w/wt/K', slot: 1, network: 'n', dbName: null, testDbName: 'webapp_k_test', dbYml: '/cfg/k/database.yml', existsInWt: () => false });
  assert.ok(doc.services.web.volumes.includes('/cfg/k/database.yml:/app/config/database.yml:ro'));
  assert.ok(doc.services.web.environment.includes('BACKEND_DASH_TEST_DATABASE=webapp_k_test'));
  assert.ok(!doc.services.web.environment.some((e) => e.startsWith('BACKEND_DASH_DATABASE=')));
});
