// Builds a small "Rails-like" project for the end-to-end test: docker-compose.yml shaped like the real
// one (shared Postgres/MinIO, per-branch web/worker/anycable/redis), a fake `rails` that runs
// migrations with psql, a fake web server that reports which database/Redis it reached, a Vite
// frontend that proxies /api to the backend, .plans/, and branches with their own migrations.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const w = (root, rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' }).toString();

const DBNAME_JS = `
// The database name exactly as Rails would end up with it for RAILS_ENV: the LAST block of that env wins.
module.exports = function dbName(file, env) {
  env = env || process.env.RAILS_ENV || 'development';
  const lines = require('fs').readFileSync(file || '/app/config/database.yml', 'utf8').split('\\n');
  let start = -1;
  lines.forEach((l, i) => { if (new RegExp('^' + env + ':').test(l)) start = i; });
  let name = null; let anchor = null;
  for (let i = start + 1; i < lines.length && !/^\\S/.test(lines[i]); i++) {
    const m = lines[i].match(/^\\s+database:\\s*"?([\\w-]+)"?/); if (m) name = m[1];
    const a = lines[i].match(/^\\s+<<:\\s*\\*([\\w-]+)/); if (a) anchor = a[1];
  }
  if (!name && anchor) { // follow the anchor
    const i = lines.findIndex((l) => l.includes('&' + anchor));
    for (let j = i + 1; j < lines.length && !/^\\S/.test(lines[j]); j++) { const m = lines[j].match(/^\\s+database:\\s*"?([\\w-]+)"?/); if (m) name = m[1]; }
  }
  return name;
};`;

const FAKE_WEB = `
const http = require('http'); const net = require('net');
const dbName = require('./dbname.js');
const tcp = (host, port, read) => new Promise((r) => {
  const s = net.connect(port, host); let d = ''; const t = setTimeout(() => { s.destroy(); r(read ? 'timeout' : false); }, 2000);
  s.on('connect', () => { if (!read) { clearTimeout(t); s.end(); r(true); } });
  s.on('data', (x) => { d += x; }); s.on('end', () => { clearTimeout(t); if (read) r(d.trim()); });
  s.on('error', (e) => { clearTimeout(t); r(read ? 'ERR ' + e.code : false); });
});
http.createServer(async (q, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ path: q.url, host: q.headers.host, db: dbName(), redis: await tcp('redis', 6379, true), postgres: await tcp('postgres', 5432), minio: await tcp('minio', 9000), env: process.env.BACKEND_DASH_DATABASE || null }));
}).listen(3000, '0.0.0.0', () => console.log('web listening on 3000'));`;

const FAKE_RAILS = `
// A tiny stand-in for "rails db:setup / db:migrate / db:migrate:down VERSION=…" using psql.
const { execFileSync } = require('child_process'); const fs = require('fs');
const db = require('./dbname.js')('config/database.yml');
console.log('RAILS_ENV=' + (process.env.RAILS_ENV || 'development') + ' → ' + db);
const host = process.env.POSTGRES_HOST || 'postgres';
const psql = (sql, d) => execFileSync('psql', ['-h', host, '-U', 'postgres', '-d', d || db, '-v', 'ON_ERROR_STOP=1', '-Atc', sql]).toString().trim();
const exists = () => psql("SELECT count(*) FROM pg_database WHERE datname = '" + db + "'", 'postgres') === '1';
const migrations = fs.readdirSync('db/migrate').filter((f) => /^\\d+_.*\\.rb$/.test(f)).sort().map((f) => {
  const t = fs.readFileSync('db/migrate/' + f, 'utf8');
  return { version: f.split('_')[0], up: (t.match(/# UP: (.*)/) || [])[1], down: (t.match(/# DOWN: (.*)/) || [])[1] };
});
const table = () => psql('CREATE TABLE IF NOT EXISTS schema_migrations (version varchar PRIMARY KEY)');
const applied = () => new Set(psql('SELECT version FROM schema_migrations').split('\\n').filter(Boolean));
const [cmd, arg] = process.argv.slice(2);
if (cmd === 'db:setup') {
  if (!exists()) psql('CREATE DATABASE "' + db + '"', 'postgres');
  table();
  const a = applied();
  for (const m of migrations) if (!a.has(m.version)) { psql(m.up); psql("INSERT INTO schema_migrations VALUES ('" + m.version + "')"); }
  console.log('setup ' + db);
} else if (cmd === 'db:schema:load') {
  if (!exists()) { console.error('ActiveRecord::NoDatabaseError: database "' + db + '" does not exist'); process.exit(1); }
  table();
  const a = applied();
  for (const m of migrations) if (!a.has(m.version)) { psql(m.up); psql("INSERT INTO schema_migrations VALUES ('" + m.version + "')"); }
  console.log('schema loaded into ' + db);
} else if (cmd === 'db:migrate') {
  if (!exists()) { console.error('ActiveRecord::NoDatabaseError: database "' + db + '" does not exist'); process.exit(1); }
  table();
  const a = applied();
  for (const m of migrations) if (!a.has(m.version)) { psql(m.up); psql("INSERT INTO schema_migrations VALUES ('" + m.version + "')"); console.log('== ' + m.version + ' migrated on ' + db); }
} else if (cmd === 'db:migrate:down') {
  const v = String(arg || '').replace('VERSION=', '');
  const m = migrations.find((x) => x.version === v);
  if (!m) { console.error('No migration with version number ' + v); process.exit(1); }
  psql(m.down); psql("DELETE FROM schema_migrations WHERE version = '" + v + "'");
  console.log('== ' + v + ' reverted on ' + db);
} else { console.error('unknown ' + cmd); process.exit(2); }`;

export const COMPOSE = `services:
  postgres:
    image: bdtest/base:latest
    environment:
      - POSTGRES_USER=postgres
    command: ["/bin/bash", "/srv/pg-start.sh"]
    ports:
      - "15432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  minio:
    image: bdtest/base:latest
    command: ["node", "/srv/idle.js"]
    environment:
      PORT: "9000"
      NAME: minio

  redis:
    image: bdtest/base:latest
    command: ["node", "/srv/fake-redis.js"]
    volumes:
      - ./fakes3/redis/data:/data

  web:
    image: bdtest/base:\${DEP_HASH}
    environment:
      - POSTGRES_HOST=postgres
    command: ["node", "bin/fake-web.js"]
    working_dir: /app
    ports:
      - "3000:3000"
    links:
      - postgres
      - redis
      - minio
    volumes:
      - .:/app:cached
      - ./system:/shared_files
      - web_tmp:/app/tmp

  worker:
    image: bdtest/base:\${DEP_HASH}
    command: ["node", "/srv/idle.js"]
    working_dir: /app
    environment:
      - POSTGRES_HOST=postgres
    volumes:
      - .:/app
    links:
      - postgres
      - redis

  anycable:
    image: bdtest/base:\${DEP_HASH}
    command: ["node", "/srv/idle.js"]
    working_dir: /app
    volumes:
      - .:/app
    depends_on:
      - anycable-go
      - postgres
      - redis

  anycable-go:
    image: bdtest/base:latest
    command: ["node", "/srv/idle.js"]
    environment:
      ANYCABLE_RPC_HOST: "anycable:50051"
      ANYCABLE_REDIS_URL: "redis://redis:6379"
      PORT: "8080"
    ports:
      - "8080:8080"

volumes:
  pgdata:
  web_tmp:
`;

const DATABASE_YML = `default: &default
  adapter: postgresql
  host: <%= ENV.fetch('POSTGRES_HOST', 'localhost') %>
  username: postgres

development:
  <<: *default
  database: webapp_development

test:
  <<: *default
  database: webapp_test<%= ENV['TEST_ENV_NUMBER'] %>
`;

const VITE_CONFIG = `import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  server: {
    host: 'localhost',
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/cable': { target: 'ws://localhost:8080', ws: true }
    }
  }
}));
`;

const migration = (name, up, down) => `class X < ActiveRecord::Migration[7.0]\n  # ${name}\nend\n# UP: ${up}\n# DOWN: ${down}\n`;

export function createFixture(root, { viteModules } = {}) {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  w(root, 'docker-compose.yml', COMPOSE);
  w(root, '.env', 'DEP_HASH=dev1\n');
  w(root, '.gitignore', '.plans/\n.claude/backend.yml\n.env\nsystem/\nfakes3/\nnode_modules/\ntmp/\nconfig/master.key\nfrontend/.env.development.local\nfrontend/planviewer/\n');
  w(root, 'config/database.yml', DATABASE_YML);
  w(root, 'config/master.key', 'not-a-real-key\n');
  w(root, 'bin/dbname.js', DBNAME_JS);
  w(root, 'bin/fake-web.js', FAKE_WEB);
  w(root, 'bin/fake-rails.js', FAKE_RAILS);
  w(root, 'db/migrate/20260101000000_create_projects.rb', migration('projects', 'CREATE TABLE projects (id int)', 'DROP TABLE projects'));
  w(root, 'system/uploads/readme.txt', 'shared uploads\n');
  w(root, 'frontend/package.json', JSON.stringify({ name: 'front', private: true, type: 'module', scripts: { start: 'NODE_OPTIONS=--max-http-header-size=65536 vite' }, devDependencies: { vite: '5.4.11' } }, null, 2) + '\n');
  w(root, 'frontend/vite.config.ts', VITE_CONFIG);
  w(root, 'frontend/index.html', '<!doctype html><title>front</title><script type="module" src="/src/main.js"></script>\n');
  w(root, 'frontend/src/main.js', "import pv from '../planviewer/src/index.js';\nimport ui from '../shared-ui/index.js';\nconsole.log(import.meta.env.VITE_API, pv, ui);\n");
  w(root, 'frontend/.env.development.local', 'VITE_API=http://localhost:3000/api\nVITE_CABLE_URL=ws://localhost:8080/cable\n');
  if (viteModules) {
    // a package-lock.json from a previous install keeps "npm install" quick and offline-friendly
    fs.copyFileSync(path.join(viteModules, 'package-lock.json'), path.join(root, 'frontend', 'package-lock.json'));
  }
  w(root, '.plans/features/PROJ-100-answers/state.json', JSON.stringify({ key: 'PROJ-100', kind: 'feature', title: 'Answers', stage: 'implementing', branch: 'feature/PROJ-100-answers', stories: [{ key: 'PROJ-101', title: 'Answer sets', status: 'in_progress', subtasks: [{ key: 'PROJ-103', title: 'Model', order: 1, status: 'in_review' }, { key: 'PROJ-102', title: 'API', order: 2, status: 'in_progress' }] }] }, null, 2));
  w(root, '.claude/backend.yml', 'plans_dir: .plans\n');

  git(root, 'init', '-q', '-b', 'master');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  // code the frontend imports that a fresh worktree does not have: a git submodule (frontend/shared-ui) and
  // a separately cloned, git-ignored repo (frontend/planviewer)
  const ui = path.join(path.dirname(root), 'shared-ui-origin');
  w(ui, 'index.js', "export default 'shared-ui ok';\n");
  git(ui, 'init', '-q', '-b', 'main'); git(ui, '-c', 'user.email=t@e.com', '-c', 'user.name=T', 'add', '-A'); git(ui, '-c', 'user.email=t@e.com', '-c', 'user.name=T', 'commit', '-q', '-m', 'ui');
  git(root, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', ui, 'frontend/shared-ui');
  git(root, 'commit', '-q', '-m', 'shared-ui submodule');
  const pv = path.join(root, 'frontend', 'planviewer');
  w(pv, 'src/index.js', "export default 'planviewer ok';\n");
  git(pv, 'init', '-q', '-b', 'develop'); git(pv, 'remote', 'add', 'origin', 'git@example.com:team/planviewer.git');
  git(pv, '-c', 'user.email=t@e.com', '-c', 'user.name=T', 'add', '-A'); git(pv, '-c', 'user.email=t@e.com', '-c', 'user.name=T', 'commit', '-q', '-m', 'pv');
  // a branch with its own migration (private copy), and one for the shared-database flow
  git(root, 'checkout', '-q', '-b', 'feature/PROJ-100-answers');
  w(root, 'db/migrate/20261001000000_create_answers.rb', migration('answers', 'CREATE TABLE answers (id int)', 'DROP TABLE answers'));
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'answers');
  git(root, 'checkout', '-q', 'master');
  git(root, 'checkout', '-q', '-b', 'feature/PROJ-300-hide');
  w(root, 'db/migrate/20261002000000_add_hidden.rb', migration('hidden', 'CREATE TABLE hidden_answers (id int)', 'DROP TABLE hidden_answers'));
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'hidden');
  git(root, 'checkout', '-q', 'master');
  return root;
}
