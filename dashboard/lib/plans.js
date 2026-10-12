// Reads a project's plans workspace: file tree, work items (state.json + context.md),
// folder summaries and the ready-made commands shown next to stories and subtasks.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';

export const KEY_RE = /\b[A-Z][A-Z0-9]+-\d+\b/;
const MAX_ENTRIES = 4000;
const SKIP = new Set(['.git', 'node_modules', '.DS_Store']);

// ---------- config (.claude/backend.yml, tiny two-level YAML reader) ----------

export function readConfig(root) {
  const file = path.join(root, '.claude', 'backend.yml');
  const out = { plans_dir: '.plans', jira: {}, git: {} };
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return out; }
  let section = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '');
    if (!line.trim()) continue;
    const top = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (top) {
      section = top[2] ? null : top[1];
      if (top[2]) out[top[1]] = unquote(top[2]);
      else if (!out[top[1]] || typeof out[top[1]] !== 'object') out[top[1]] = {};
      continue;
    }
    const sub = line.match(/^ {2}([A-Za-z_][\w-]*):\s*(.*)$/);
    if (sub && section) out[section][sub[1]] = unquote(sub[2]);
  }
  return out;
}

function unquote(v) {
  const s = String(v).trim();
  return s.replace(/^(["'])(.*)\1$/, '$2');
}

export function plansDirOf(root) {
  const cfg = readConfig(root);
  const rel = (cfg.plans_dir || '.plans').replace(/\/+$/, '');
  return { rel, abs: path.resolve(root, rel), cfg };
}

// ---------- paths ----------

// Resolves a path shown in the UI (".plans/…") to an absolute path inside the plans dir, or null.
export function safeResolve(root, rel) {
  const { abs } = plansDirOf(root);
  const target = path.resolve(root, String(rel || ''));
  if (target !== abs && !target.startsWith(abs + path.sep)) return null;
  return target;
}

export function toRel(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/');
}

// ---------- git ----------

const branchCache = new Map();
export function currentBranch(root) {
  const hit = branchCache.get(root);
  if (hit && Date.now() - hit.at < 3000) return Promise.resolve(hit.value);
  return new Promise((resolve) => {
    execFile('git', ['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 3000 }, (err, stdout) => {
      const value = err ? null : (stdout.trim() === 'HEAD' ? null : stdout.trim() || null);
      branchCache.set(root, { at: Date.now(), value });
      resolve(value);
    });
  });
}

// ---------- tree ----------

export function tree(root) {
  const { rel, abs } = plansDirOf(root);
  let count = 0;
  const walk = (dir, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
    entries = entries.filter((e) => !SKIP.has(e.name) && !/\.tmp-\d+$/.test(e.name));
    entries.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    const out = [];
    for (const e of entries) {
      if (++count > MAX_ENTRIES) break;
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) { try { if (fs.statSync(full).isDirectory()) { out.push({ name: e.name, dir: true, children: depth < 10 ? walk(full, depth + 1) : [] }); continue; } } catch {} }
      if (e.isDirectory()) out.push({ name: e.name, dir: true, children: depth < 10 ? walk(full, depth + 1) : [] });
      else out.push({ name: e.name });
    }
    return out;
  };
  return { plansDir: rel, exists: fs.existsSync(abs), tree: fs.existsSync(abs) ? walk(abs, 0) : [], truncated: count > MAX_ENTRIES };
}

export function mdFiles(root) {
  const { rel } = plansDirOf(root);
  const out = [];
  const visit = (nodes, base) => nodes.forEach((n) => {
    const p = base + '/' + n.name;
    if (n.dir) visit(n.children || [], p);
    else if (/\.md$/i.test(n.name)) out.push(p);
  });
  visit(tree(root).tree, rel);
  return out;
}

// ---------- work items ----------

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function stateFiles(root) {
  const { abs } = plansDirOf(root);
  const out = [];
  for (const kind of ['features', 'bugs']) {
    const dir = path.join(abs, kind);
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      const f = path.join(dir, n, 'state.json');
      if (fs.existsSync(f)) out.push(f);
    }
  }
  return out;
}

export function jiraBase(root, states = []) {
  const { cfg } = plansDirOf(root);
  const site = (cfg.jira && cfg.jira.site) || '';
  if (site) return site.replace(/\/+$/, '') + '/browse/';
  for (const s of states) {
    const m = String((s && s.url) || '').match(/^(https?:\/\/[^/]+\/browse\/)/);
    if (m) return m[1];
  }
  return '';
}

const isDone = (status) => /done|merged/i.test(status || '');
// A story is done when all its subtasks are; one without subtasks only by its own status.
const storyDone = (st) => (st.subtasks || []).length ? st.subtasks.every((t) => isDone(t.status)) : isDone(st.status);

// Everything the skill forms need to pick defaults: keys, parents, plan files, branches.
export async function index(root) {
  const { rel } = plansDirOf(root);
  const items = [];
  const parentOf = {};
  const states = [];
  for (const f of stateFiles(root)) {
    const s = readJson(f);
    if (!s || !s.key) continue;
    states.push(s);
    const dir = toRel(root, path.dirname(f));
    const stories = (s.stories || []).map((st) => {
      parentOf[st.key] = s.key;
      const subtasks = (st.subtasks || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map((t) => {
        parentOf[t.key] = st.key;
        return { key: t.key, title: t.title || '', status: t.status || '', branch: t.branch || null, base: t.base || null, order: t.order || null, url: t.url || null };
      });
      return { key: st.key, title: st.title || '', status: storyDone(st) ? 'done' : (st.status || ''), url: st.url || null, subtasks };
    });
    items.push({ key: s.key, kind: s.kind, title: s.title || '', stage: s.stage || '', dir, branch: s.branch || null, url: s.url || null, stories });
  }
  return { plansDir: rel, items, parentOf, mdFiles: mdFiles(root), jiraBase: jiraBase(root, states), branch: await currentBranch(root) };
}

// ---------- context.md ----------

export function parseSections(md) {
  const out = {};
  let cur = null;
  for (const line of String(md || '').split('\n')) {
    const h = line.match(/^##\s+(.*)$/);
    if (h) { cur = h[1].trim().toLowerCase(); out[cur] = []; continue; }
    if (cur && line.trim()) out[cur].push(line.replace(/^\s*(?:[-*]|\d+\.)\s+/, '').trim());
  }
  return out;
}

function pick(sections, ...names) {
  for (const n of names) if (sections[n]) return sections[n];
  return [];
}

// ---------- commands ----------

export const q = (s) => '"' + String(s).replace(/(["\\])/g, '\\$1') + '"';

function findItemDir(root, abs) {
  const { abs: plans } = plansDirOf(root);
  let dir = abs;
  while (dir.startsWith(plans)) {
    if (fs.existsSync(path.join(dir, 'state.json'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

function fileInfo(abs, root) {
  try {
    const st = fs.statSync(abs);
    return { name: path.basename(abs) + (st.isDirectory() ? '/' : ''), path: toRel(root, abs) + (st.isDirectory() ? '/' : ''), dir: st.isDirectory(), size: st.size, mtime: st.mtimeMs };
  } catch { return null; }
}

const DESCRIBE = {
  'feature-plan.md': 'Feature plan', 'plan.md': 'Plan', 'context.md': 'Where we stopped · decisions · open questions',
  'state.json': 'Machine state (stories, subtasks, MRs)', 'events.jsonl': 'Milestone log', 'api-contract.html': 'API contract · JSON examples',
  'subtasks.md': 'Subtasks table', 'overview.html': 'System overview', 'overview.md': 'System overview (summary)'
};

export async function folder(root, rel) {
  const abs = safeResolve(root, rel);
  if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return { error: 'Not a folder inside the plans directory' };
  const branch = await currentBranch(root);
  let names = [];
  try { names = fs.readdirSync(abs).filter((n) => !SKIP.has(n) && !/\.tmp-\d+$/.test(n)); } catch {}
  const files = names.map((n) => fileInfo(path.join(abs, n), root)).filter(Boolean)
    .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((f) => Object.assign(f, { what: f.dir ? 'Folder' : (DESCRIBE[f.name] || (/plan/i.test(f.name) ? 'Plan' : '')) }));

  const out = { path: toRel(root, abs) + '/', name: path.basename(abs), files, branch, keyInName: (path.basename(abs).match(KEY_RE) || [null])[0] };
  const itemDir = findItemDir(root, abs);
  if (!itemDir) return out;

  const state = readJson(path.join(itemDir, 'state.json')) || {};
  const ctxText = (() => { try { return fs.readFileSync(path.join(itemDir, 'context.md'), 'utf8'); } catch { return ''; } })();
  const sec = parseSections(ctxText);
  const base = jiraBase(root, [state]);
  const url = (key, own) => own || (base ? base + key : key);
  const itemRel = toRel(root, itemDir);
  const featurePlan = ['feature-plan.md', 'plan.md'].map((n) => path.join(itemDir, n)).find((f) => fs.existsSync(f));
  const featurePlanRel = featurePlan ? toRel(root, featurePlan) : null;
  const inStory = toRel(root, abs).match(/\/stories\/([^/]+)/);

  let here = null;
  const stories = (state.stories || []).map((st) => {
    const planAbs = path.join(itemDir, st.plan || path.join('stories', st.key, 'plan.md'));
    const planned = fs.existsSync(planAbs);
    const planRel = planned ? toRel(root, planAbs) : null;
    const subs = (st.subtasks || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    // A merged (done) parent's branch is gone: branch out from where that parent was merged into instead.
    const bases = [];
    const subtasks = subs.map((t, i) => {
      const prev = i > 0 ? subs[i - 1].branch : null;
      let baseBranch = t.base || prev || state.branch || null;
      const merged = subs.findIndex((x, j) => j < i && x.branch && x.branch === baseBranch && /done|merged/i.test(x.status || ''));
      if (merged !== -1) baseBranch = bases[merged] || state.branch || null;
      bases.push(baseBranch);
      const thoughts = 'Branch out from ' + (baseBranch || 'the current branch') + ' and point the MR to it. Implement only this subtask from its plan.';
      const cmd = '/backend:implement ' + url(t.key, t.url) + (planRel ? ' ' + planRel : '') + ' --thoughts ' + q(thoughts);
      const review = /review/i.test(t.status || '') ? '/backend:address-review ' + url(t.key, t.url) : null;
      const s = { key: t.key, title: t.title || '', status: t.status || 'pending', order: t.order || i + 1, branch: t.branch || null, base: baseBranch, mr: t.mr || null, url: url(t.key, t.url), cmd, review };
      if (branch && t.branch === branch) here = t.key;
      return s;
    });
    const thoughts = planned
      ? 'Update the story plan from the main plan if it changed and propose the remaining subtasks.'
      : 'Use the main plan to plan this story and split it into stacked subtasks.';
    const cmd = '/backend:plan-story ' + url(st.key, st.url) + (featurePlanRel ? ' ' + featurePlanRel : '') + ' --thoughts ' + q(thoughts);
    const doneCount = subtasks.filter((t) => isDone(t.status)).length;
    const done = storyDone(st);
    return { key: st.key, title: st.title || '', status: done ? 'done' : (st.status || ''), url: url(st.key, st.url), planned, plan: planRel, subtasks, cmd, done, doneCount, total: subtasks.length };
  });
  if (!here) {
    for (const st of stories) {
      const t = st.subtasks.find((x) => /progress|review|committed/i.test(x.status));
      if (t) { here = t.key; break; }
    }
  }
  stories.forEach((st) => st.subtasks.forEach((t) => { t.here = t.key === here; }));

  const resumeFile = inStory && stories.find((s) => s.key === inStory[1] && s.plan) ? stories.find((s) => s.key === inStory[1]).plan : featurePlanRel;
  const resumeKey = inStory ? inStory[1] : state.key;
  out.item = {
    key: state.key, kind: state.kind, title: state.title || '', stage: state.stage || '', url: state.url || null,
    branch: state.branch || null, mr: state.mr || null, links: state.links || {}, dir: itemRel + '/', updatedAt: state.updated_at || null,
    where: pick(sec, 'where we are', 'where we stopped').slice(0, 8),
    next: pick(sec, 'next step', 'next steps').slice(0, 6),
    openQuestions: pick(sec, 'open questions').slice(0, 10),
    decisions: pick(sec, 'decisions').slice(-6),
    stories, focusStory: inStory ? inStory[1] : null,
    counts: { planned: stories.filter((s) => s.planned).length, notPlanned: stories.filter((s) => !s.planned).length, done: stories.filter((s) => s.done).length },
    resume: '/backend:resume ' + resumeKey + (resumeFile ? ' ' + resumeFile : ''),
    featurePlan: featurePlanRel
  };
  return out;
}

// ---------- files ----------

export function readFile(root, rel) {
  const abs = safeResolve(root, rel);
  if (!abs || !fs.existsSync(abs)) return { error: 'File not found inside the plans directory' };
  const st = fs.statSync(abs);
  if (st.isDirectory()) return { error: 'This is a folder' };
  const ext = path.extname(abs).toLowerCase();
  const kind = ext === '.md' ? 'md' : (ext === '.html' || ext === '.htm') ? 'html' : (ext === '.json' || ext === '.jsonl') ? 'json' : 'text';
  if (st.size > 5 * 1024 * 1024) return { path: toRel(root, abs), kind: 'text', size: st.size, mtime: st.mtimeMs, content: '(File is larger than 5 MB — open it in your editor.)' };
  return { path: toRel(root, abs), kind, size: st.size, mtime: st.mtimeMs, content: fs.readFileSync(abs, 'utf8') };
}

// ---------- trash ----------

// Moves a file or folder to the system Trash (never a permanent delete). macOS: ~/.Trash, or Finder
// when the file is on another volume; Linux: `gio trash`.
export function moveToTrash(abs) {
  return new Promise((resolve, reject) => {
    const run = (cmd, args) => execFile(cmd, args, (err, _out, stderr) => (err ? reject(new Error(String(stderr || err.message).trim())) : resolve()));
    if (process.platform === 'darwin') {
      const trash = path.join(os.homedir(), '.Trash');
      const name = path.basename(abs);
      let dest = path.join(trash, name);
      if (fs.existsSync(dest)) {
        const d = new Date(); const p = (n) => String(n).padStart(2, '0');
        const ext = path.extname(name);
        dest = path.join(trash, `${name.slice(0, name.length - ext.length)} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}${ext}`);
      }
      try { fs.renameSync(abs, dest); return resolve(); } catch {}
      // Other volume, no ~/.Trash, or no permission to it: let Finder do it.
      return run('osascript', ['-e', 'on run argv', '-e', 'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)', '-e', 'end run', abs]);
    }
    if (process.platform === 'linux') return run('gio', ['trash', abs]);
    reject(new Error('Moving to the Trash is not supported on ' + process.platform + ' — nothing was deleted.'));
  });
}

// ---------- manual subtask status (from the folder page) ----------
// Same files and shapes as the plugin's plans.rb: state.json rewritten atomically (2-space JSON, updated_at),
// one line appended to events.jsonl.
export const SUBTASK_STATUSES = ['pending', 'in_progress', 'committed', 'in_review', 'done'];
const isoNow = () => {
  const d = new Date(); const off = -d.getTimezoneOffset(); const p = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${off >= 0 ? '+' : '-'}${p(off / 60)}:${p(off % 60)}`;
};
export async function setSubtaskStatus(root, key, status) {
  if (!SUBTASK_STATUSES.includes(status)) throw Object.assign(new Error('Unknown status ' + status), { status: 400 });
  for (const file of stateFiles(root)) {
    const state = readJson(file);
    if (!state) continue;
    for (const story of state.stories || []) {
      const st = (story.subtasks || []).find((t) => t.key === key);
      if (!st) continue;
      const before = st.status || 'pending';
      st.status = status;
      // Keep the story's own status in step: done with its last subtask, back in progress when one reopens.
      const wasDone = isDone(story.status);
      const nowDone = storyDone(story);
      if (nowDone && !wasDone) story.status = 'done';
      else if (!nowDone && wasDone) story.status = 'in_progress';
      state.updated_at = isoNow();
      const tmp = file + '.tmp-' + process.pid;
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
      fs.renameSync(tmp, file);
      const branch = await currentBranch(root);
      const event = (type, msg) => JSON.stringify(Object.assign({ ts: isoNow(), type, msg }, branch ? { branch } : {})) + '\n';
      let lines = event(status === 'done' ? 'subtask.done' : 'note', `${key} ${before} → ${status} (set by hand in the dashboard)`);
      if (nowDone && !wasDone) lines += event('story.done', `${story.key} done: all ${story.subtasks.length} subtasks are done`);
      else if (!nowDone && wasDone) lines += event('note', `${story.key} reopened: ${key} is ${status} again`);
      fs.appendFileSync(path.join(path.dirname(file), 'events.jsonl'), lines);
      return { ok: true, before, status, story: story.key, storyDone: nowDone, storyBecameDone: nowDone && !wasDone, subtasks: story.subtasks.length };
    }
  }
  throw Object.assign(new Error('No subtask ' + key + ' in the plans'), { status: 404 });
}
