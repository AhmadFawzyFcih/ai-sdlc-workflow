// Turns the main project's docker-compose.yml into a compose file for one worktree:
// only the services that belong to a branch (the ones that mount the code, Redis, and whatever
// talks to them) run per worktree; everything else (Postgres, MinIO, a document engine…) stays shared.
// Pure functions — no Docker, no file system — so they are easy to test.
import YAML from 'yaml';
import path from 'node:path';

export const SLOT_STEP = 10; // host ports move by 10 × slot: web 3000 → 3010 (slot 1), 3020 (slot 2)…

export function parseCompose(text) {
  const doc = YAML.parse(String(text || ''), { merge: true, maxAliasCount: -1 }) || {};
  if (!doc.services || typeof doc.services !== 'object') throw new Error('No services in docker-compose.yml');
  return doc;
}

// ---------- ports ----------
// Short syntax: "3000", "3000:3000", "127.0.0.1:3000:3000", "22348:22347", "8080:8080/udp",
// ranges "3000-3002:3000-3002". Long syntax: { target, published, host_ip, protocol }.
export function parsePort(p) {
  if (p && typeof p === 'object') {
    const pub = p.published === undefined || p.published === null ? null : String(p.published);
    return { ip: p.host_ip || null, host: pub, container: String(p.target), proto: p.protocol || null, long: true };
  }
  let s = String(p).trim().replace(/^["']|["']$/g, '');
  let proto = null;
  const slash = s.lastIndexOf('/');
  if (slash > 0) { proto = s.slice(slash + 1); s = s.slice(0, slash); }
  // IPv6 host ips come in brackets: [::1]:3000:3000
  let ip = null;
  const v6 = s.match(/^\[([^\]]+)\]:(.*)$/);
  if (v6) { ip = v6[1]; s = v6[2]; }
  const parts = s.split(':');
  if (parts.length === 1) return { ip, host: null, container: parts[0], proto };
  if (parts.length === 2) return { ip, host: parts[0] || null, container: parts[1], proto };
  return { ip: ip || parts[0], host: parts[1] || null, container: parts[2], proto };
}

const shift = (range, by) => String(range).split('-').map((n) => String(Number(n) + by)).join('-');
export function shiftPort(p, by) {
  const q = parsePort(p);
  if (!q.host) return p; // container-only port: Docker picks a free host port
  const host = shift(q.host, by);
  if (q.long) return Object.assign({}, p, { published: /^\d+$/.test(host) ? Number(host) : host });
  const ip = q.ip ? (q.ip.includes(':') ? `[${q.ip}]` : q.ip) + ':' : '';
  return `${ip}${host}:${q.container}${q.proto ? '/' + q.proto : ''}`;
}

export function hostPortsOf(svc) {
  const out = [];
  for (const p of (svc && svc.ports) || []) {
    const q = parsePort(p);
    if (!q.host) continue;
    const [a, b] = q.host.split('-').map(Number);
    for (let n = a; n <= (b || a); n++) out.push({ host: n, container: q.container });
  }
  return out;
}

// ---------- volumes ----------
// Returns { kind: 'bind'|'volume'|'other', source, target, mode, long }.
export function parseVolume(v) {
  if (v && typeof v === 'object') {
    return { kind: v.type === 'bind' ? 'bind' : v.type === 'volume' ? 'volume' : 'other', source: v.source || null, target: v.target, long: true, raw: v };
  }
  const s = String(v);
  const parts = s.split(':');
  if (parts.length === 1) return { kind: 'other', source: null, target: parts[0], mode: null }; // anonymous volume
  const [source, target, ...rest] = parts;
  const bind = /^[./~]/.test(source);
  return { kind: bind ? 'bind' : 'volume', source, target, mode: rest.length ? rest.join(':') : null };
}

const isCodeSource = (src) => /^\.\/?$/.test(String(src || '').trim());

export function codeMountTarget(svc) {
  for (const v of (svc && svc.volumes) || []) {
    const q = parseVolume(v);
    if (q.kind === 'bind' && isCodeSource(q.source)) return q.target;
  }
  return null;
}

// ---------- which services run per worktree ----------
const flat = (x) => {
  if (x === null || x === undefined) return [];
  if (Array.isArray(x)) return x.map(String);
  if (typeof x === 'object') return Object.entries(x).map(([k, v]) => `${k}=${v === null || v === undefined ? '' : v}`);
  return [String(x)];
};
function envValues(svc) {
  const env = svc.environment;
  const vals = [];
  if (Array.isArray(env)) env.forEach((e) => { const s = String(e); const i = s.indexOf('='); vals.push(i >= 0 ? s.slice(i + 1) : ''); });
  else if (env && typeof env === 'object') Object.values(env).forEach((v) => vals.push(v === null || v === undefined ? '' : String(v)));
  return vals;
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Does this service talk to `name` (an env value or its command uses the host name)?
export function refersTo(svc, name) {
  const re = new RegExp(`(^|[^A-Za-z0-9_.-])${escapeRe(name)}($|[^A-Za-z0-9_.-]|\\.(?![A-Za-z]))`);
  return [...envValues(svc), ...flat(svc.command), ...flat(svc.entrypoint)].some((v) => re.test(v));
}

const isRedis = (name, svc) => /^redis\b/i.test(name) || /(^|\/)redis(:|$)/i.test(String(svc.image || ''));
const isPostgres = (name, svc) => /postgres|postgis/i.test(name + ' ' + String(svc.image || ''));

// Code-mounting services + Redis + anything that talks to one of them (repeated until nothing changes).
export function classify(compose) {
  const all = compose.services;
  const why = {};
  for (const [n, s] of Object.entries(all)) if (codeMountTarget(s)) why[n] = 'runs the code of this branch';
  for (const [n, s] of Object.entries(all)) if (!why[n] && isRedis(n, s)) why[n] = 'own Redis per worktree';
  let changed = true;
  while (changed) {
    changed = false;
    for (const [n, s] of Object.entries(all)) {
      if (why[n] || isPostgres(n, s)) continue;
      const hit = Object.keys(why).find((m) => refersTo(s, m));
      if (hit) { why[n] = `talks to ${hit}`; changed = true; }
    }
  }
  const app = Object.keys(all).filter((n) => why[n]);
  const shared = Object.keys(all).filter((n) => !why[n]);
  const postgres = shared.find((n) => isPostgres(n, all[n])) || null;
  return { app, shared, why, postgres };
}

// ---------- the worktree compose file ----------
/**
 * @param o.compose      parsed main docker-compose.yml
 * @param o.services     names to run in the worktree
 * @param o.mainDir      main checkout (absolute)
 * @param o.wtDir        worktree folder (absolute)
 * @param o.slot         1, 2, 3…
 * @param o.network      external network shared with the connected shared services
 * @param o.dbName       private database name, or null for the shared one
 * @param o.testDbName   the worktree's own test database, or null
 * @param o.dbYml        absolute path of the generated database.yml copy (mounted when set)
 * @param o.existsInWt   (rel) => boolean — is this path present in the worktree?
 * @param o.memLimits    { code: '3g', other: '1g' } defaults when a service sets none
 */
export function buildWorktreeCompose(o) {
  const keep = new Set(o.services);
  const by = SLOT_STEP * o.slot;
  const services = {};
  const volumes = {};
  const ports = [];
  const memLimits = Object.assign({ code: '3g', other: '1g' }, o.memLimits || {});
  const abs = (rel, base) => path.resolve(base, String(rel).replace(/^~(?=\/)/, process.env.HOME || '~'));
  const bindSource = (src, code) => {
    if (isCodeSource(src)) return o.wtDir;
    if (src.startsWith('/') || src.startsWith('~')) return src;
    if (o.existsInWt && o.existsInWt(src)) return abs(src, o.wtDir); // tracked config files
    return code ? abs(src, o.mainDir) : null; // shared uploads etc.; null → private named volume
  };

  for (const name of o.services) {
    const src = o.compose.services[name];
    if (!src) continue;
    const svc = JSON.parse(JSON.stringify(src));
    const code = codeMountTarget(src);
    delete svc.container_name;
    delete svc.networks;
    if (svc.network_mode && /^service:/.test(svc.network_mode) && !keep.has(svc.network_mode.slice(8))) delete svc.network_mode;

    if (typeof svc.build === 'string') svc.build = abs(svc.build, o.wtDir);
    else if (svc.build && typeof svc.build === 'object') svc.build.context = abs(svc.build.context || '.', o.wtDir);
    if (svc.env_file) {
      const files = Array.isArray(svc.env_file) ? svc.env_file : [svc.env_file];
      svc.env_file = files.map((f) => (typeof f === 'string' ? (o.existsInWt && o.existsInWt(f) ? abs(f, o.wtDir) : abs(f, o.mainDir)) : f));
    }

    if (Array.isArray(svc.volumes)) {
      let i = 0;
      svc.volumes = svc.volumes.map((v) => {
        const q = parseVolume(v);
        if (q.kind === 'volume') { volumes[q.source] = {}; return v; }
        if (q.kind !== 'bind') return v;
        let source = bindSource(q.source, code);
        if (source === null) { source = `${name}-data${i ? i : ''}`; i++; volumes[source] = {}; }
        if (q.long) return Object.assign({}, q.raw, { source, type: /^[/~]/.test(source) ? 'bind' : 'volume' });
        return `${source}:${q.target}${q.mode ? ':' + q.mode : ''}`;
      });
    }

    if (Array.isArray(svc.ports)) {
      for (const hp of hostPortsOf(src)) ports.push({ service: name, main: hp.host, port: hp.host + by, container: hp.container });
      svc.ports = svc.ports.map((p) => shiftPort(p, by));
    }

    if (Array.isArray(svc.depends_on)) svc.depends_on = svc.depends_on.filter((d) => keep.has(d));
    else if (svc.depends_on && typeof svc.depends_on === 'object') {
      for (const d of Object.keys(svc.depends_on)) if (!keep.has(d)) delete svc.depends_on[d];
    }
    if (svc.depends_on && !Object.keys(svc.depends_on).length) delete svc.depends_on;
    if (Array.isArray(svc.links)) {
      svc.links = svc.links.filter((l) => keep.has(String(l).split(':')[0]));
      if (!svc.links.length) delete svc.links;
    }

    if (code && o.dbYml) {
      svc.volumes = (svc.volumes || []).concat([`${o.dbYml}:${path.posix.join(code, 'config', 'database.yml')}:ro`]);
      if (o.dbName) setEnv(svc, 'BACKEND_DASH_DATABASE', o.dbName);
      if (o.testDbName) setEnv(svc, 'BACKEND_DASH_TEST_DATABASE', o.testDbName);
    }

    const hasLimit = svc.mem_limit || (svc.deploy && svc.deploy.resources && svc.deploy.resources.limits && svc.deploy.resources.limits.memory);
    if (!hasLimit) svc.mem_limit = code ? memLimits.code : memLimits.other;
    svc.labels = Object.assign({}, Array.isArray(svc.labels) ? Object.fromEntries(svc.labels.map((l) => String(l).split('='))) : svc.labels || {}, { 'dev.backend-dash.worktree': o.id || '' });
    services[name] = svc;
  }

  const doc = { services, networks: { default: { name: o.network, external: true } } };
  if (Object.keys(volumes).length) doc.volumes = volumes;
  return { doc, ports, text: '# Generated by backend-dash for a worktree — do not edit; it is rewritten on every start.\n' + YAML.stringify(doc, { lineWidth: 0, defaultStringType: 'QUOTE_DOUBLE', defaultKeyType: 'PLAIN' }) };
}

function setEnv(svc, key, value) {
  if (Array.isArray(svc.environment)) {
    svc.environment = svc.environment.filter((e) => !String(e).startsWith(key + '=')).concat(`${key}=${value}`);
  } else {
    svc.environment = Object.assign({}, svc.environment || {}, { [key]: value });
  }
}

// All host ports the main compose file publishes (so worktree slots never collide with them).
export function mainHostPorts(compose) {
  const set = new Set();
  for (const s of Object.values(compose.services)) hostPortsOf(s).forEach((p) => set.add(p.host));
  return set;
}

// ---------- database.yml override ----------
// The worktree's containers get a copy of config/database.yml (mounted over the real one, inside the
// containers only) that ends with a second `development:` / `test:` block: same settings through a YAML
// merge, only the database name changes. Plain YAML at the end, so Rails' ERB pass and its "dummy ERB"
// pass (used by db:* tasks to list databases) both still see a normal file.
//   names: { development: 'app_proj_1', test: 'app_proj_1_test' } — leave an env out to keep it as is.
//   A plain string means { development: string }. Returns null when a requested env has no section.
export function databaseYmlOverride(original, names) {
  if (typeof names === 'string') names = { development: names };
  const lines = String(original || '').replace(/\r\n/g, '\n').split('\n');
  const anchorOf = (line) => (line.match(/:\s*&([\w-]+)/) || [])[1] || null;
  const setAnchor = (i, name) => {
    if (!anchorOf(lines[i])) lines[i] = lines[i].replace(/:\s*(#.*)?$/, (m, c) => `: &${name}` + (c ? ' ' + c : ''));
    return anchorOf(lines[i]);
  };
  let out = '';
  for (const [env, dbName] of Object.entries(names)) {
    if (!dbName) continue;
    const at = lines.findIndex((l) => new RegExp(`^${env}:\\s*(&[\\w-]+)?\\s*(#.*)?$`).test(l));
    if (at < 0) return null;
    let end = lines.length;
    for (let i = at + 1; i < lines.length; i++) if (/^\S/.test(lines[i]) && !/^#/.test(lines[i])) { end = i; break; }
    const kids = [];
    let indent = null;
    for (let i = at + 1; i < end; i++) {
      const m = lines[i].match(/^(\s+)([\w<]+[\w-]*):(.*)$/);
      if (!m || /^\s*#/.test(lines[i])) continue;
      if (indent === null) indent = m[1].length;
      if (m[1].length === indent) kids.push({ i, key: m[2], rest: m[3].trim() });
    }
    const blockEnd = (k) => { const nx = kids.find((x) => x.i > k.i); return nx ? nx.i : end; };
    const dbLine = (from, to) => lines.slice(from, to).find((l) => /^\s+database:/.test(l)) || '';
    // parallel_tests style names (app_test<%= ENV['TEST_ENV_NUMBER'] %>) keep their number
    const value = (line) => JSON.stringify(String(dbName)).replace(/"$/, (/TEST_ENV_NUMBER/.test(line) ? "<%= ENV['TEST_ENV_NUMBER'] %>" : '') + '"');
    const hasDb = (k) => /database:/.test(dbLine(k.i + 1, blockEnd(k)));
    const nested = !kids.some((k) => k.key === 'database') && kids.filter((k) => k.key !== '<<' && (k.rest === '' || /^&[\w-]+\s*(#.*)?$/.test(k.rest)) && hasDb(k));
    const base = 'backend_dash_' + env;
    if (!nested || !nested.length) {
      const a = setAnchor(at, base);
      out += `${env}:\n  <<: *${a}\n  database: ${value(dbLine(at + 1, end))}\n`;
    } else {
      const pa = setAnchor(at, base);
      out += `${env}:\n  <<: *${pa}\n`;
      for (const k of nested) {
        const ca = setAnchor(k.i, base + '_' + k.key.replace(/[^\w-]/g, ''));
        out += `  ${k.key}:\n    <<: *${ca}\n    database: ${value(dbLine(k.i + 1, blockEnd(k)))}\n`;
      }
    }
  }
  return lines.join('\n').replace(/\n*$/, '\n') + '\n# Added by backend-dash: this worktree\'s own databases.\n' + out;
}

// Top-level environments in database.yml (development, test, …).
export const ymlEnvs = (text) => String(text || '').split('\n').map((l) => (l.match(/^([a-z_]+):\s*(&[\w-]+)?\s*(#.*)?$/) || [])[1]).filter(Boolean);

// ---------- frontend (Vite) ----------
const VITE_CONFIGS = ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs'];
export const VITE_WRAPPER = 'vite.worktree.config.mjs';

export function findViteConfig(listDir, root) {
  const at = (dir) => { const names = listDir(dir) || []; return VITE_CONFIGS.find((f) => names.includes(f)) || null; };
  const top = at(root);
  if (top) return { dir: root, config: top };
  for (const d of (listDir(root, true) || [])) {
    if (/^(node_modules|\.git|tmp|log|vendor|public|coverage)$/.test(d)) continue;
    const f = at(path.join(root, d));
    if (f) return { dir: path.join(root, d), config: f };
  }
  return null;
}

// The wrapper imports the project's own Vite config and only changes ports: the dev-server port,
// and every proxy target that points at a main-checkout port (localhost:3000 → localhost:3010).
// allow: folders outside the worktree that Vite may serve (code linked in from elsewhere).
export function viteWrapper({ config, offset, portMap, allow = [] }) {
  return `// Generated by backend-dash for this worktree — do not edit, do not commit (it is git-excluded).
// It loads ./${config} unchanged and only moves the ports to this worktree's slot.
import base from './${config}';
${allow.length ? "import { searchForWorkspaceRoot } from 'vite';\n" : ''}
const OFFSET = ${Number(offset)};
const PORTS = ${JSON.stringify(portMap)};
const swap = (s) => s.replace(/(\\/\\/(?:localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::1\\])):(\\d+)/g, (m, host, p) => (PORTS[p] ? host + ':' + PORTS[p] : m));
const plain = (v) => v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
const deep = (v) => (typeof v === 'string' ? swap(v) : Array.isArray(v) ? v.map(deep) : plain(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : v);

export default async (env) => {
  const cfg = (typeof base === 'function' ? await base(env) : await base) || {};
  const server = Object.assign({}, cfg.server || {});
  const basePort = Number(server.port) || 5173;
  server.port = basePort + OFFSET;
  server.strictPort = true;
  if (server.allowedHosts !== true) server.allowedHosts = [...(Array.isArray(server.allowedHosts) ? server.allowedHosts : []), '.localhost'];
  if (server.proxy) server.proxy = deep(server.proxy);
  if (plain(server.hmr) && server.hmr.port) server.hmr = Object.assign({}, server.hmr, { port: Number(server.hmr.port) + OFFSET });
  if (server.origin) server.origin = swap(String(server.origin));
${allow.length ? `  const fsOpts = Object.assign({}, server.fs || {});
  fsOpts.allow = [...(fsOpts.allow || [searchForWorkspaceRoot(process.cwd())]), ...${JSON.stringify(allow)}];
  server.fs = fsOpts;
` : ''}  return Object.assign({}, cfg, { server });
};
`;
}

// .env values the frontend reads (e.g. VITE_CABLE_URL=ws://localhost:8080/cable): the ones that point
// at a main-checkout port are passed to Vite with the worktree port (process env wins over .env files).
// sameOrigin: { port: '3000', origin: 'http://proj-1.localhost:5183' } — http(s) URLs to the Rails port become
// the page's own origin, so API calls go through Vite's proxy (same origin: no CORS, cookies on the worktree host).
export function envOverrides(files, portMap, sameOrigin) {
  const out = {};
  for (const text of files) {
    for (const line of String(text || '').split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const raw = m[2].replace(/^(['"])(.*)\1$/, '$2');
      let next = raw;
      if (sameOrigin && sameOrigin.port && sameOrigin.origin) next = next.replace(new RegExp('https?:\\/\\/(?:localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0):' + sameOrigin.port + '(?!\\d)', 'g'), sameOrigin.origin);
      next = next.replace(/(\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)):(\d+)/g, (x, host, p) => (portMap[p] ? host + ':' + portMap[p] : x));
      if (next !== raw) out[m[1]] = next;
    }
  }
  return out;
}

// The start script with the wrapper config: "NODE_OPTIONS=… vite" → "NODE_OPTIONS=… vite --config vite.worktree.config.mjs".
export function startScript(pkg) {
  const s = (pkg && pkg.scripts && (pkg.scripts.start || pkg.scripts.dev)) || 'vite';
  if (!/(^|[\s;&|])vite(\s|$)/.test(s)) return null;
  return s.replace(/(^|[\s;&|])vite(\s+(?:serve|dev))?(?=\s|$)/, `$1vite$2 --config ${VITE_WRAPPER}`);
}

// ---------- names ----------
export const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'wt';
// Docker Compose v2's default project name: the folder name, lower-cased, without other characters.
export const composeProjectName = (dir) => path.basename(dir).toLowerCase().replace(/[^a-z0-9_-]/g, '').replace(/^[-_]+/, '') || 'app';
export const dbIdent = (s) => String(s).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
