// backend dashboard — client. Plain JS, no build step.
(function () {
  'use strict';

  const TOKEN = document.querySelector('meta[name="dash-token"]').content;
  const KEY_G = /[A-Z][A-Z0-9]+-\d+/g;

  // ---------- small helpers ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('bd:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('bd:' + k, JSON.stringify(v)); } catch {} }
  };

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v; // trusted, static markup only (icons)
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(5)) {
      if (c === null || c === undefined || c === false) continue;
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return el;
  }

  // Append children, skipping null/false (Element.append would print the word "null").
  function add(el, ...kids) {
    for (const c of kids.flat(5)) if (c !== null && c !== undefined && c !== false) el.append(c);
    return el;
  }

  const ICONS = {
    home: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2.5 7 8 2.5 13.5 7v6.25a.75.75 0 0 1-.75.75H3.25a.75.75 0 0 1-.75-.75Z"/></svg>',
    folder: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M1.75 4.25c0-.69.56-1.25 1.25-1.25h3.2l1.5 1.6H13c.69 0 1.25.56 1.25 1.25v6.4c0 .69-.56 1.25-1.25 1.25H3c-.69 0-1.25-.56-1.25-1.25Z"/></svg>',
    file: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M4 1.75h5.5L13 5.25v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10.5a1 1 0 0 1 1-1Z"/><path d="M9.5 1.75v3.5H13"/></svg>',
    chev: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4.5 2.5 8 6l-3.5 3.5"/></svg>',
    copy: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="5.25" y="5.25" width="8.5" height="8.5" rx="1.5"/><path d="M10.75 5.25V3.5a1.25 1.25 0 0 0-1.25-1.25H3.5A1.25 1.25 0 0 0 2.25 3.5v6a1.25 1.25 0 0 0 1.25 1.25h1.75"/></svg>',
    run: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m3 4.5 3.5 3.5L3 11.5M8.5 12H13"/></svg>',
    moon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z"/></svg>',
    sun: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"/></svg>',
    download: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 2.25v8M4.75 7 8 10.25 11.25 7M2.75 13.25h10.5"/></svg>',
    trash: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4 4.25l.7 9a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-9M6.75 6.75v4.5M9.25 6.75v4.5"/></svg>',
    doc: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 1.75h5.5L13 5.25v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10.5a1 1 0 0 1 1-1Z"/><path d="M5.5 8h5M5.5 10.5h5M5.5 5.5h2"/></svg>',
    side: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5"/><path d="M6 2.75v10.5"/></svg>',
    server: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="4.5" rx="1"/><rect x="2.5" y="9" width="11" height="4.5" rx="1"/><path d="M5 4.75h.01M5 11.25h.01"/></svg>',
    term: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5"/><path d="m4.5 6.5 2 1.5-2 1.5M8 10h3"/></svg>'
  };
  const icon = (name, cls) => h('span', { class: cls || '', html: ICONS[name], 'aria-hidden': 'true', style: 'display:inline-flex' });

  async function api(method, path, body) {
    const res = await fetch(path, { method, headers: { 'X-Dash-Token': TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status, data });
    return data;
  }
  // A 404 from an /api/ route this page knows means the server process predates the page.
  const STALE = 'The running dashboard server is older than this page. Restart it (Ctrl+C in its terminal, then backend-dash again) and reload.';
  const apiError = (e) => (e.status === 404 ? STALE : e.message);
  const qs = (o) => Object.entries(o).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');

  async function copy(text, label) {
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = h('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch {} ta.remove();
    }
    toast({ small: true, title: (label || 'Copied') + ' ', mono: text, timeout: 2200 });
  }

  const ago = (t) => {
    if (!t) return '';
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return s + 's'; if (s < 3600) return Math.round(s / 60) + ' min'; if (s < 86400) return Math.round(s / 3600) + ' h';
    return Math.round(s / 86400) + ' d';
  };
  // Inline markdown from context.md bullets (bold, code, links) — sanitized.
  const md = (text) => {
    const el = h('span');
    el.innerHTML = window.DOMPurify.sanitize(window.marked.parseInline(String(text || '')));
    el.querySelectorAll('a[href]').forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
    return el;
  };
  const lastKey = (s) => { const m = String(s || '').match(KEY_G); return m ? m[m.length - 1] : null; };
  const baseName = (p) => String(p || '').replace(/\/+$/, '').split('/').pop();

  // ---------- state ----------
  const S = {
    theme: store.get('theme', 'dark'),
    projects: [], project: null, plansDir: '.plans', tree: [], treeExists: true, branch: null, index: null,
    open: {}, selected: null, q: '',
    tabs: [{ id: 'home', type: 'home' }], active: 'home', focusPath: null,
    sessions: new Map(), terms: new Map(), procs: new Map(),
    wizard: store.get('wizard', 'resume'), manual: {}, showWizard: true,
    statusFilter: store.get('statusFilter', 'all'),
    pendingSid: new URLSearchParams(location.search).get('s'), booted: false,
    calOpen: false, calOffset: 0,
    openStories: {}, toasts: [], dragTab: null,
    sideW: store.get('sideW', 290), sideHidden: store.get('sideHidden', false)
  };

  // ---------- theme ----------
  function applyTheme() {
    document.documentElement.className = S.theme === 'light' ? 'lt' : 'dk';
    S.terms.forEach((t) => t.term && (t.term.options.theme = termTheme()));
  }

  // ---------- websocket ----------
  let ws = null; let wsRetry = 0;
  function connect() {
    ws = new WebSocket(`ws://${location.host}/ws?token=${TOKEN}`);
    ws.onopen = () => { wsRetry = 0; S.terms.forEach((t, id) => send({ t: 'attach', id })); };
    ws.onclose = () => { setTimeout(connect, Math.min(5000, 500 * ++wsRetry)); };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'sessions') { S.sessions = new Map(m.list.map((s) => [s.id, s])); sessionsChanged(); openPending(); }
      else if (m.t === 'session') { S.sessions.set(m.s.id, m.s); sessionsChanged(m.s.id); }
      else if (m.t === 'removed') { S.sessions.delete(m.id); closeTab('s:' + m.id); sessionsChanged(); }
      else if (m.t === 'out') { const t = S.terms.get(m.id); if (t && t.ready) t.term.write(m.data); }
      else if (m.t === 'procs') { S.procs = new Map(m.list.map((p) => [p.id, p])); renderTabs(); }
      else if (m.t === 'proc') { S.procs.set(m.p.id, m.p); renderTabs(); renderProcBar(m.p.id); W.onWs(m); }
      else if (m.t === 'procRemoved') { S.procs.delete(m.id); closeTab('p:' + m.id); }
      else if (m.t === 'buffer') {
        const t = S.terms.get(m.id);
        if (t) { t.replaying = true; t.term.reset(); t.ready = true; t.term.write(m.data, () => { t.replaying = false; }); }
      }
      else if (m.t === 'attention') attention(m.s, m.kind);
      else if (m.t === 'tree' && (m.projects || [m.project]).includes(S.project)) refreshProject();
      else W.onWs(m);
    };
  }
  const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

  // ---------- projects & data ----------
  async function loadProjects() {
    const data = await api('GET', '/api/projects');
    S.projects = data.projects;
    if (S.project && S.projects.some((p) => p.path === S.project)) return;
    // ?p=<key> picks the project of this browser tab (so each tab can hold its own project)
    const want = new URLSearchParams(location.search).get('p');
    const saved = store.get('project', null);
    S.project = (S.projects.find((p) => want && W.projectKey(p) === want) || S.projects.find((p) => p.path === saved) || S.projects[0] || {}).path || null;
    setUrl();
  }
  function setUrl() {
    const p = S.projects.find((x) => x.path === S.project);
    const url = new URL(location.href);
    if (p) url.searchParams.set('p', W.projectKey(p)); else url.searchParams.delete('p');
    history.replaceState(null, '', url.pathname + url.search);
    // Named after its environment, so "Open session" elsewhere can come back to this tab instead of opening another.
    try { window.name = p ? 'bd:' + W.projectKey(p) : ''; } catch {}
  }
  // Worktrees and main checkouts with a docker-compose.yml get the Environment tab.
  const isWorktreeProject = () => { const p = S.projects.find((x) => x.path === S.project); return !!(p && (p.worktree || p.env)); };
  // Closing it is remembered per project; the Environment buttons (cards, Home strip) bring it back.
  function ensureEnvTab(reopen) {
    const has = S.tabs.some((t) => t.type === 'env');
    if (reopen && S.project) store.set('envClosed:' + S.project, false);
    if (isWorktreeProject() && !has && !store.get('envClosed:' + S.project, false)) S.tabs.splice(1, 0, { id: 'env', type: 'env' });
    if (!isWorktreeProject() && has) { S.tabs = S.tabs.filter((t) => t.type !== 'env'); const v = document.getElementById('view-env'); if (v) v.remove(); if (S.active === 'env') S.active = 'home'; }
  }

  async function refreshProject() {
    if (!S.project) { S.tree = []; S.index = null; renderSidebar(); renderHome(); return; }
    const [t, ix] = await Promise.all([api('GET', '/api/tree?' + qs({ project: S.project })), api('GET', '/api/index?' + qs({ project: S.project }))]);
    S.tree = t.tree; S.plansDir = t.plansDir; S.treeExists = t.exists; S.branch = t.branch; S.index = ix;
    renderSidebar(); renderTabs();
    const tab = S.tabs.find((x) => x.id === S.active);
    if (!tab || tab.type === 'home') renderHome();
    else if (tab.type === 'folder') loadFolder(tab, true);
    else if (tab.type === 'file') loadFile(tab, true);
  }

  async function switchProject(path) {
    saveTabs();
    S.project = path; store.set('project', path); setUrl();
    S.open = {}; S.selected = null; S.q = ''; // the tree starts collapsed
    S.tabs = S.tabs.filter((t) => t.type === 'home' || t.type === 'session' || t.type === 'proc');
    ensureEnvTab();
    for (const t of store.get('tabs:' + path, [])) if (!S.tabs.find((x) => x.id === t.id)) S.tabs.push(t);
    if (!S.tabs.find((t) => t.id === S.active) || S.active === 'env') S.active = 'home';
    document.querySelectorAll('.view').forEach((v) => { if (!v.id.startsWith('view-s:') && !v.id.startsWith('view-p:') && v.id !== 'view-home') v.remove(); });
    renderTopbar(); renderSidebarShell();
    await refreshProject();
    if (!S.page) activate(S.active);
  }

  function saveTabs() {
    if (!S.project) return;
    store.set('tabs:' + S.project, S.tabs.filter((t) => t.type === 'folder' || t.type === 'file'));
  }

  // ---------- top bar ----------
  function renderTopbar() {
    const bar = document.getElementById('topbar');
    bar.textContent = '';
    add(bar, 
      h('button', { class: 'btn icon side-toggle' + (S.sideHidden ? '' : ' on'), 'aria-label': S.sideHidden ? 'Show the sidebar' : 'Hide the sidebar', 'aria-pressed': String(!S.sideHidden), title: (S.sideHidden ? 'Show' : 'Hide') + ' sidebar (' + MOD + '+B)', html: ICONS.side, onclick: toggleSidebar }),
      h('div', { class: 'logo' }, h('b', {}, 'b'), 'backend'),
      W.switcher(),
      W.nav(),
      h('div', { class: 'spacer' }),
      h('button', { class: 'pulse', id: 'pulse', onclick: () => { if (S.page) W.openPage(null); activate('home'); } }),
      h('div', { class: 'clock', id: 'clock' }),
      h('button', { class: 'btn', 'aria-label': 'Switch light or dark mode', onclick: () => { S.theme = S.theme === 'light' ? 'dark' : 'light'; store.set('theme', S.theme); applyTheme(); renderTopbar(); } },
        icon(S.theme === 'light' ? 'moon' : 'sun'), S.theme === 'light' ? 'Dark' : 'Light')
    );
    renderPulse(); renderClock();
  }

  // Sessions of the environment this tab has open (the main checkout or one worktree).
  const here = () => [...S.sessions.values()].filter((s) => s.project === S.project);
  function counts() {
    let needs = 0; let running = 0; let idle = 0;
    here().forEach((s) => { if (s.status === 'needs') needs++; else if (s.status === 'running') running++; else if (s.status === 'idle' && s.alive) idle++; });
    return { needs, running, idle };
  }

  function renderPulse() {
    const el = document.getElementById('pulse'); if (!el) return;
    const c = counts();
    el.textContent = '';
    const total = here().length;
    add(el, h('span', { class: 'dot', style: `background:var(${c.needs ? '--warnDot' : c.running ? '--accent' : '--faint'})` }),
      total ? `${total} session${total > 1 ? 's' : ''}` + (c.needs ? ` · ${c.needs} need${c.needs > 1 ? '' : 's'} you` : c.running ? ` · ${c.running} running` : '') : 'No sessions');
    const pr = S.projects.find((x) => x.path === S.project);
    const all = c.needs + needsElsewhere().length; // the switcher shows where the others are
    document.title = (all ? `(${all}) ` : '') + (pr ? pr.name + ' · ' : '') + 'backend';
  }
  // Sessions that need you in the other environments, newest first (the project switcher counts and opens them).
  const needsElsewhere = () => [...S.sessions.values()].filter((s) => s.project !== S.project && s.status === 'needs').sort((a, b) => b.updatedAt - a.updatedAt);

  // ---------- clock & calendar ----------
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const pad = (n) => String(n).padStart(2, '0');
  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dn = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - dn);
    return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  }
  let clockDay = null;
  function renderClock() {
    const el = document.getElementById('clock'); if (!el) return;
    const now = new Date(); clockDay = now.toDateString();
    const long = `${DAY[now.getDay()]}, ${now.getDate()} ${MONTH[now.getMonth()]} ${now.getFullYear()}`;
    el.textContent = '';
    add(el, h('button', { 'aria-expanded': String(S.calOpen), 'aria-label': long + ' — show calendar', onclick: (e) => { e.stopPropagation(); S.calOpen = !S.calOpen; S.calOffset = 0; renderClock(); } },
      h('span', { class: 'cal-icon', 'aria-hidden': 'true' }, h('span', {}, MON[now.getMonth()].toUpperCase()), h('span', {}, now.getDate())),
      h('span', { class: 'clock-text' }, h('span', { class: 'hm' }, h('span', { 'data-hm': '' }, pad(now.getHours()) + ':' + pad(now.getMinutes())), h('small', { 'data-sec': '' }, ':' + pad(now.getSeconds()))),
        h('span', { class: 'clock-date' }, `${DAY[now.getDay()].slice(0, 3)} · ${now.getDate()} ${MON[now.getMonth()]} ${now.getFullYear()}`))));
    if (!S.calOpen) return;
    const base = new Date(now.getFullYear(), now.getMonth() + S.calOffset, 1);
    const lead = (base.getDay() + 6) % 7;
    const daysIn = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    const prevDays = new Date(base.getFullYear(), base.getMonth(), 0).getDate();
    const total = Math.ceil((lead + daysIn) / 7) * 7;
    const cells = [];
    for (let i = 0; i < total; i++) {
      const n = i - lead + 1; const out = n < 1 || n > daysIn;
      const d = n < 1 ? prevDays + n : n > daysIn ? n - daysIn : n;
      const today = !out && S.calOffset === 0 && d === now.getDate();
      cells.push(h('span', { class: 'd' + (out ? ' out' : '') + (i % 7 >= 5 ? ' we' : '') + (today ? ' today' : ''), 'aria-current': today ? 'date' : null }, d));
    }
    add(el, h('div', { class: 'calendar', role: 'dialog', 'aria-label': 'Calendar', onclick: (e) => e.stopPropagation() },
      h('div', {}, h('div', { class: 'big-time' }, h('span', { 'data-hm': '' }, pad(now.getHours()) + ':' + pad(now.getMinutes())), h('small', { 'data-sec': '' }, ':' + pad(now.getSeconds()))),
        h('div', { class: 'sub' }, `${long} · week ${isoWeek(now)}`)),
      h('div', { class: 'cal-nav' },
        h('button', { class: 'btn icon', 'aria-label': 'Previous month', onclick: () => { S.calOffset--; renderClock(); } }, '‹'),
        h('span', {}, `${MONTH[base.getMonth()]} ${base.getFullYear()}`),
        h('button', { class: 'btn icon', 'aria-label': 'Next month', onclick: () => { S.calOffset++; renderClock(); } }, '›')),
      h('div', { class: 'cal-grid' }, ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((x) => h('span', { class: 'h' }, x)), cells),
      S.calOffset ? h('button', { class: 'btn', onclick: () => { S.calOffset = 0; renderClock(); } }, 'Back to today') : null));
  }
  setInterval(() => {
    const now = new Date();
    if (now.toDateString() !== clockDay) return renderClock();
    document.querySelectorAll('[data-hm]').forEach((e) => { e.textContent = pad(now.getHours()) + ':' + pad(now.getMinutes()); });
    document.querySelectorAll('[data-sec]').forEach((e) => { e.textContent = ':' + pad(now.getSeconds()); });
  }, 1000);
  document.addEventListener('click', () => { if (S.calOpen) { S.calOpen = false; renderClock(); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.calOpen) { S.calOpen = false; renderClock(); } });

  // ---------- sidebar ----------
  const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
  const SIDE_MIN = 200; const SIDE_DEFAULT = 290;
  const sideMax = () => Math.max(SIDE_MIN, Math.round(window.innerWidth * 0.6));
  function applySidebar() {
    S.sideW = Math.min(sideMax(), Math.max(SIDE_MIN, Math.round(S.sideW)));
    document.documentElement.style.setProperty('--side-w', S.sideW + 'px');
    document.getElementById('app').classList.toggle('side-hidden', !!S.sideHidden);
    const hd = document.getElementById('side-resize');
    if (hd) { hd.setAttribute('aria-valuenow', String(S.sideW)); hd.setAttribute('aria-valuemax', String(sideMax())); }
  }
  function toggleSidebar() {
    S.sideHidden = !S.sideHidden; store.set('sideHidden', S.sideHidden);
    applySidebar();
    const b = document.querySelector('#topbar .side-toggle'); // update the button only — no top-bar rebuild
    if (!b) return renderTopbar();
    b.classList.toggle('on', !S.sideHidden);
    b.setAttribute('aria-label', S.sideHidden ? 'Show the sidebar' : 'Hide the sidebar');
    b.setAttribute('aria-pressed', String(!S.sideHidden));
    b.title = (S.sideHidden ? 'Show' : 'Hide') + ' sidebar (' + MOD + '+B)';
  }
  // Drag the sidebar's right edge to resize; double-click resets; arrow keys step by 16px.
  function setupResize() {
    const hd = document.getElementById('side-resize');
    const save = () => store.set('sideW', S.sideW);
    hd.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); hd.setPointerCapture(e.pointerId);
      const left = document.getElementById('sidebar').getBoundingClientRect().left;
      document.body.classList.add('resizing');
      const move = (ev) => { S.sideW = ev.clientX - left; applySidebar(); };
      const up = () => { hd.removeEventListener('pointermove', move); hd.removeEventListener('pointerup', up); hd.removeEventListener('pointercancel', up); document.body.classList.remove('resizing'); save(); };
      hd.addEventListener('pointermove', move); hd.addEventListener('pointerup', up); hd.addEventListener('pointercancel', up);
    });
    hd.addEventListener('dblclick', () => { S.sideW = SIDE_DEFAULT; applySidebar(); save(); });
    hd.addEventListener('keydown', (e) => {
      const step = { ArrowLeft: -16, ArrowRight: 16 }[e.key];
      if (step) { e.preventDefault(); S.sideW += step; applySidebar(); save(); }
      else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); S.sideW = e.key === 'Home' ? SIDE_MIN : sideMax(); applySidebar(); save(); }
    });
    window.addEventListener('resize', applySidebar);
  }
  document.addEventListener('keydown', (e) => {
    // Ctrl+B inside a Claude terminal stays with the terminal; ⌘B works everywhere.
    const inTerm = !!(e.target.closest && e.target.closest('.xterm'));
    if ((e.metaKey || (e.ctrlKey && !inTerm)) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleSidebar(); }
  });

  function renderSidebarShell() {
    const side = document.getElementById('sidebar');
    side.textContent = '';
    add(side, 
      h('div', { class: 'side-head' }, h('b', { id: 'plans-name' }, (S.plansDir || '.plans') + '/'), h('span', {}, S.project ? baseName(S.project) : '')),
      h('label', {}, h('span', { class: 'sr' }, 'Filter files'),
        h('input', { class: 'input', type: 'search', placeholder: 'Ticket or file — e.g. PROJ-123', value: S.q, oninput: (e) => { S.q = e.target.value; renderTree(); } })),
      h('div', { class: 'tree', role: 'tree', id: 'tree' })
    );
  }

  function flatTree() {
    const out = [];
    const walk = (nodes, base, depth) => nodes.forEach((n) => {
      const rel = base ? base + '/' + n.name : n.name;
      out.push({ name: n.name, rel, depth, dir: !!n.dir });
      if (n.dir) walk(n.children || [], rel, depth + 1);
    });
    walk(S.tree, '', 0);
    return out;
  }

  function renderSidebar() {
    const nm = document.getElementById('plans-name');
    if (!nm) renderSidebarShell(); else nm.textContent = (S.plansDir || '.plans') + '/';
    renderTree();
  }

  function renderTree() {
    const box = document.getElementById('tree'); if (!box) return;
    box.textContent = '';
    if (!S.project) { add(box, h('p', { class: 'empty' }, 'Add a project from the Project menu.')); return; }
    if (!S.treeExists) { add(box, h('p', { class: 'empty' }, `No ${S.plansDir}/ folder in this project yet. Run /backend:setup or a planning skill.`)); return; }
    const all = flatTree();
    const q = S.q.trim().toLowerCase();
    let visible;
    if (q) {
      const keep = new Set();
      all.forEach((n) => {
        if (!n.rel.toLowerCase().includes(q)) return;
        keep.add(n.rel);
        const parts = n.rel.split('/');
        for (let i = 1; i < parts.length; i++) keep.add(parts.slice(0, i).join('/'));
        if (n.dir) all.forEach((m) => { if (m.rel.startsWith(n.rel + '/')) keep.add(m.rel); });
      });
      visible = all.filter((n) => keep.has(n.rel));
    } else {
      visible = all.filter((n) => { const p = n.rel.split('/'); for (let i = 1; i < p.length; i++) if (!S.open[p.slice(0, i).join('/')]) return false; return true; });
    }
    if (!visible.length) { add(box, h('p', { class: 'empty' }, q ? `Nothing matches “${S.q}”.` : 'Empty folder.')); return; }
    for (const n of visible) {
      const full = S.plansDir + '/' + n.rel + (n.dir ? '/' : '');
      const isOpen = q ? true : !!S.open[n.rel];
      const row = h('div', { class: 'row' + (S.selected === n.rel ? ' sel' : ''), role: 'treeitem', 'aria-expanded': n.dir ? String(isOpen) : null },
        h('button', { class: 'name', style: `padding-left:${6 + n.depth * 14}px`, title: full, onclick: () => {
          S.selected = n.rel;
          if (n.dir) { S.open[n.rel] = !(S.open[n.rel] && S.active === 'f:' + full); openFolder(full, true); }
          else openFile(full, true);
          renderTree();
        } },
        n.dir ? icon('chev', 'chev' + (isOpen ? ' open' : '')) : h('span', { style: 'width:12px;flex:0 0 auto' }),
        n.dir ? icon('folder', 'ic-folder') : fileBadge(n.name),
        h('span', { class: 'label' }, keyMono(n.name))),
        h('div', { class: 'acts' },
          h('button', { class: 'btn icon', 'aria-label': 'Copy path ' + full, title: 'Copy ' + full, html: ICONS.copy, onclick: () => copy(full, 'Copied') }),
          h('button', { class: 'btn icon', 'aria-label': 'Download ' + full, title: n.dir ? 'Download as .zip' : 'Download', html: ICONS.download, onclick: () => download(full) }),
          h('button', { class: 'btn icon del', 'aria-label': 'Move ' + full + ' to Trash', title: 'Move to Trash', html: ICONS.trash, onclick: () => confirmDelete(n) })));
      add(box, row);
    }
  }

  async function download(full) {
    try {
      const res = await fetch('/api/download?' + qs({ project: S.project, path: full }), { headers: { 'X-Dash-Token': TOKEN } });
      if (!res.ok) throw Object.assign(new Error((await res.json().catch(() => ({}))).error || res.statusText), { status: res.status });
      const cd = res.headers.get('Content-Disposition') || '';
      const m = cd.match(/filename\*=UTF-8''([^;]+)/);
      const name = m ? decodeURIComponent(m[1]) : baseName(full);
      const href = URL.createObjectURL(await res.blob());
      const a = h('a', { href, download: name, style: 'display:none' });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10000);
      toast({ small: true, title: 'Downloaded ', mono: name, timeout: 2200 });
    } catch (e) { toast({ title: 'Could not download', body: apiError(e), timeout: 8000 }); }
  }

  // Delete = move to the Trash, after asking. Closes tabs of the item and anything inside it.
  function confirmDelete(n) {
    const full = S.plansDir + '/' + n.rel + (n.dir ? '/' : '');
    const inside = n.dir ? flatTree().filter((m) => m.rel.startsWith(n.rel + '/')).length : 0;
    const dlg = h('dialog', { class: 'confirm', 'aria-labelledby': 'del-title' });
    const close = () => { dlg.close(); dlg.remove(); };
    add(dlg, h('div', { class: 'confirm-body' },
      h('span', { class: 'confirm-icon', 'aria-hidden': 'true' }, '!'),
      h('div', {}, h('h2', { id: 'del-title' }, 'Move to Trash?'),
        h('p', {}, h('b', { class: 'mono' }, full), n.dir ? ` and everything inside (${inside} item${inside === 1 ? '' : 's'})` : '', ' will be moved to the Trash. You can restore it from there.'))),
      h('div', { class: 'confirm-actions' },
        h('button', { class: 'btn big', onclick: close }, 'Cancel'),
        h('button', { class: 'btn big end', onclick: async () => {
          close();
          try {
            await api('POST', '/api/delete', { project: S.project, path: full });
            const root = S.plansDir + '/' + n.rel;
            S.tabs.filter((t) => (t.type === 'file' || t.type === 'folder') && (t.path === root || t.path === root + '/' || t.path.startsWith(root + '/'))).forEach((t) => closeTab(t.id));
            if (S.selected === n.rel || String(S.selected || '').startsWith(n.rel + '/')) S.selected = null;
            toast({ small: true, title: 'Moved to Trash ', mono: full, timeout: 3000 });
            refreshProject().catch(() => {});
          } catch (e) { toast({ title: 'Could not move to Trash', body: apiError(e), timeout: 8000 }); }
        } }, 'Move to Trash')));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    add(document.body, dlg);
    dlg.showModal();
    dlg.querySelector('.btn.big').focus();
  }

  // ---------- tabs ----------
  const GENERIC = /^(plan|context|subtasks|overview|readme)\.(md|html)$|^(state\.json|events\.jsonl)$/i;
  function tabLabel(t) {
    if (t.type === 'home') return 'Home';
    if (t.type === 'env') return 'Environment';
    if (t.type === 'session') { const s = S.sessions.get(t.sid); return s ? s.title : 'session'; }
    if (t.type === 'proc') { const p = S.procs.get(t.pid); return p ? p.title : 'output'; }
    const name = baseName(t.path);
    if (t.type === 'folder') return lastKey(name) && name.length > 24 ? lastKey(name) : name;
    const same = S.tabs.some((x) => x !== t && x.type === 'file' && baseName(x.path) === name);
    if (GENERIC.test(name) || same) {
      const parent = baseName(t.path.replace(/\/[^/]+$/, ''));
      return [h('span', { class: 'parent' }, (lastKey(parent) && parent.length > 24 ? lastKey(parent) : parent) + '/'), name];
    }
    return name;
  }
  function fileBadge(path) {
    const ext = (String(path).match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
    const map = { md: ['MD', 'md'], html: ['HTML', 'html'], htm: ['HTML', 'html'], json: ['JSON', 'json'], jsonl: ['JSON', 'json'] };
    const [txt, cls] = map[ext] || [ext ? ext.toUpperCase().slice(0, 4) : 'FILE', 'other'];
    return h('span', { class: 'badge ' + cls, 'aria-hidden': 'true' }, txt);
  }
  // A ticket key inside a file or folder name, set in mono: "PROJ-100-checklist-export".
  function keyMono(name) {
    const m = String(name).match(/[A-Z][A-Z0-9]+-\d+/);
    if (!m) return name;
    return [name.slice(0, m.index), h('span', { class: 'mono' }, m[0]), name.slice(m.index + m[0].length)];
  }
  function termGlyph(s) {
    return h('span', { class: 'term-glyph', 'aria-hidden': 'true' }, '>_', h('span', { class: 'gdot' + (s && s.status === 'needs' ? ' pulse-ring' : ''), style: `background:var(${statusVar(s)})` }));
  }

  function renderTabs() {
    if (S.dragTab) { S.tabsDirty = true; return; } // a live re-render would cancel the drag; redo it on drop
    S.tabsDirty = false;
    const bar = document.getElementById('tabs');
    bar.textContent = '';
    for (const t of S.tabs) {
      if (t.type === 'home') continue; // Home lives in the top bar, next to Worktrees and Monitor
      const on = t.id === S.active;
      const home = t.type === 'home' || t.type === 'env'; // stay first, not draggable
      const closable = t.type !== 'home';
      const s = t.type === 'session' ? S.sessions.get(t.sid) : null;
      const pr = t.type === 'proc' ? S.procs.get(t.pid) : null;
      const lead = t.type === 'home' ? icon('home') : t.type === 'env' ? envGlyph() : t.type === 'folder' ? icon('folder', 'ic-folder') : t.type === 'file' ? fileBadge(t.path) : t.type === 'proc' ? procGlyph(pr) : termGlyph(s);
      const tab = h('div', { class: 'tab' + (on ? ' on' : '') + (closable ? '' : ' home') + (t.type === 'session' || t.type === 'proc' ? ' term' : '') + (t.preview ? ' preview' : ''), role: 'tab', 'aria-selected': String(on), tabindex: '0', 'data-id': t.id,
        title: t.path || (s ? 'Claude session · ' + (s.command || 'claude') : pr ? pr.cmd : ''), draggable: home ? null : 'true',
        onclick: () => activate(t.id), ondblclick: () => { if (t.preview) { t.preview = false; saveTabs(); renderTabs(); } },
        onkeydown: (e) => {
          if (e.key === 'Enter') activate(t.id);
          else if (!home && e.altKey && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); stepTab(t.id, e.key === 'ArrowLeft' ? -1 : 1); }
        },
        onauxclick: (e) => { if (e.button === 1 && closable) closeTab(t.id); },
        ondragstart: (e) => { S.dragTab = t.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id); tab.classList.add('dragging'); },
        ondragend: endDrag,
        ondragover: (e) => {
          if (!S.dragTab) return;
          e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move';
          const before = dropBefore(e, tab, home);
          clearDropMarks(); if (S.dragTab !== t.id) tab.classList.add(before ? 'drop-before' : 'drop-after');
        },
        ondragleave: (e) => { if (!tab.contains(e.relatedTarget)) tab.classList.remove('drop-before', 'drop-after'); },
        ondrop: (e) => { if (!S.dragTab) return; e.preventDefault(); e.stopPropagation(); moveTab(S.dragTab, t.id, dropBefore(e, tab, home)); } },
      lead, h('span', { class: 't' }, tabLabel(t)), t.type === 'env' ? envPill() : null,
      closable ? h('button', { class: 'x', 'aria-label': 'Close tab', draggable: 'false', onclick: (e) => { e.stopPropagation(); closeTab(t.id); } }, '×') : null);
      add(bar, tab);
    }
    add(bar, h('button', { class: 'tab-add', title: 'New Claude session in this project', 'aria-label': 'New Claude session', onclick: () => startSession('', 'claude', null) }, '+'));
  }

  // ---------- tab reordering (drag, or Alt+Shift+←/→) — Home stays first ----------
  const dropBefore = (e, el, home) => { if (home) return false; const r = el.getBoundingClientRect(); return e.clientX < r.left + r.width / 2; };
  const clearDropMarks = () => document.querySelectorAll('#tabs .drop-before, #tabs .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
  function endDrag() {
    const dirty = S.tabsDirty || S.dragTab;
    S.dragTab = null; clearDropMarks();
    document.querySelectorAll('#tabs .dragging').forEach((x) => x.classList.remove('dragging'));
    if (dirty) renderTabs();
  }
  function moveTab(id, targetId, before) {
    S.dragTab = null; clearDropMarks();
    if (!id || id === 'home' || id === 'env' || id === targetId) { renderTabs(); return; }
    const from = S.tabs.findIndex((t) => t.id === id); if (from < 0) return;
    const [tab] = S.tabs.splice(from, 1);
    let to = targetId === null ? S.tabs.length : S.tabs.findIndex((t) => t.id === targetId) + (before ? 0 : 1);
    if (to < 0) to = S.tabs.length;
    S.tabs.splice(Math.max(S.tabs.some((t) => t.type === 'env') ? 2 : 1, to), 0, tab);
    saveTabs(); renderTabs();
  }
  function stepTab(id, dir) {
    const i = S.tabs.findIndex((t) => t.id === id); const j = i + dir;
    const first = S.tabs.some((t) => t.type === 'env') ? 2 : 1;
    if (i < first || j < first || j >= S.tabs.length) return;
    [S.tabs[i], S.tabs[j]] = [S.tabs[j], S.tabs[i]];
    saveTabs(); renderTabs();
    const el = document.querySelector(`#tabs .tab[data-id="${CSS.escape(id)}"]`); if (el) el.focus();
  }
  // Dropping on the empty part of the bar moves the tab to the end.
  (function () {
    const bar = document.getElementById('tabs');
    bar.addEventListener('dragover', (e) => { if (!S.dragTab) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; clearDropMarks(); const last = bar.querySelectorAll('.tab'); const el = last[last.length - 1]; if (el && el.dataset.id !== S.dragTab) el.classList.add('drop-after'); });
    bar.addEventListener('dragleave', (e) => { if (!bar.contains(e.relatedTarget)) clearDropMarks(); });
    bar.addEventListener('drop', (e) => { if (!S.dragTab) return; e.preventDefault(); moveTab(S.dragTab, null, false); });
  })();

  function envGlyph() { return icon('server'); }
  function envPill() {
    const w = W.curWt();
    const st = w && w.status;
    if (!st) return null;
    const b = st.backend.state;
    return h('span', { class: 'pill dotted ' + (b === 'up' ? 'up' : b === 'partial' ? 'warn' : 'down'), style: 'padding:0 7px;font-size:11px' }, b === 'up' ? 'up' : b === 'partial' ? 'partly' : 'down');
  }
  function procGlyph(p) {
    const c = !p ? '--faint' : p.status === 'running' ? '--accent' : p.status === 'ok' ? '--okDot' : p.status === 'failed' ? '--errDot' : '--faint';
    return h('span', { class: 'term-glyph', 'aria-hidden': 'true' }, '$', h('span', { class: 'gdot', style: `background:var(${c})` }));
  }

  function statusVar(s) {
    if (!s) return '--faint';
    return { needs: '--warnDot', running: '--accent', idle: '--okDot', exited: '--faint' }[s.status] || '--faint';
  }

  // Tabs opened from the tree are previews (italic) and replace each other, like VS Code.
  // Opening from a page, or double-clicking the tab, keeps it.
  function openTab(tab, preview) {
    if (S.page) W.openPage(null); // the sidebar stays on Worktrees / Monitor; opening a file goes back to the tabs
    const existing = S.tabs.find((t) => t.id === tab.id);
    if (existing) { if (!preview) existing.preview = false; }
    else {
      tab.preview = !!preview;
      const i = preview ? S.tabs.findIndex((t) => t.preview) : -1;
      if (i >= 0) { const old = S.tabs[i]; const v = document.getElementById('view-' + old.id); if (v) v.remove(); S.tabs.splice(i, 1, tab); }
      else S.tabs.push(tab);
    }
    saveTabs();
    activate(tab.id);
  }
  const openFolder = (path, preview) => openTab({ id: 'f:' + path, type: 'folder', path }, preview);
  const openFile = (path, preview) => openTab({ id: 'f:' + path, type: 'file', path }, preview);
  const openSession = (sid) => openTab({ id: 's:' + sid, type: 'session', sid });
  const openProc = (pid) => { if (S.page) W.openPage(null); openTab({ id: 'p:' + pid, type: 'proc', pid }); };

  function closeTab(id) {
    const i = S.tabs.findIndex((t) => t.id === id);
    if (i < 0 || id === 'home') return;
    const [t] = S.tabs.splice(i, 1);
    if (t.type === 'env' && S.project) store.set('envClosed:' + S.project, true);
    const v = document.getElementById('view-' + id);
    if (t.type === 'session' || t.type === 'proc') { const k = t.sid || t.pid; const term = S.terms.get(k); if (term) { term.term.dispose(); term.ro && term.ro.disconnect(); S.terms.delete(k); } }
    if (v) v.remove();
    saveTabs();
    if (S.active === id) activate((S.tabs[i - 1] || S.tabs[0]).id); else renderTabs();
  }

  function viewEl(id, cls) {
    let v = document.getElementById('view-' + id);
    if (!v) { v = h('div', { class: 'view ' + (cls || ''), id: 'view-' + id, role: 'tabpanel' }); add(document.getElementById('views'), v); }
    return v;
  }

  function activate(id) {
    if (id === 'env' && !S.tabs.some((t) => t.type === 'env')) { ensureEnvTab(true); if (!S.tabs.some((t) => t.type === 'env')) id = 'home'; }
    const tab = S.tabs.find((t) => t.id === id) || S.tabs[0];
    S.active = tab.id;
    if (tab.type === 'folder' || tab.type === 'file') S.focusPath = tab.path;
    if (tab.type === 'session') { const s = S.sessions.get(tab.sid); if (s && s.key) S.focusKeyHint = s.key; }
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('on'));
    renderTabs();
    if (tab.type === 'home') { viewEl('home').classList.add('on'); renderHome(); }
    else if (tab.type === 'folder') { viewEl(tab.id).classList.add('on'); loadFolder(tab); }
    else if (tab.type === 'file') { viewEl(tab.id).classList.add('on'); loadFile(tab); }
    else if (tab.type === 'session') { const v = viewEl(tab.id, 'session'); v.classList.add('on'); renderSession(tab); }
    else if (tab.type === 'proc') { const v = viewEl(tab.id, 'session proc'); v.classList.add('on'); renderProc(tab); }
    else if (tab.type === 'env') { viewEl('env').classList.add('on'); W.renderEnv(); const w = W.curWt(); if (w) W.loadDetail(w.id); }
    W.renderNav();
  }

  // ---------- sessions ----------
  async function startSession(command, title, key) {
    if (!S.project) return toast({ title: 'Add a project first', body: 'Project → Add a project folder…', timeout: 4000 });
    try {
      const r = await api('POST', '/api/sessions', { project: S.project, command, title, key });
      S.sessions.set(r.id, S.sessions.get(r.id) || { id: r.id, title, command, key, project: S.project, projectName: baseName(S.project), status: 'running', detail: 'Starting Claude…', startedAt: Date.now(), alive: true });
      openSession(r.id);
    } catch (e) { toast({ title: 'Could not start Claude', body: e.message, timeout: 6000 }); }
  }

  function sessionsChanged(id) {
    renderPulse(); renderTabs(); W.renderSwitcher();
    const tab = S.tabs.find((t) => t.id === S.active);
    if (tab && tab.type === 'home') renderSessionList();
    if (id) { const v = document.getElementById('view-s:' + id); if (v) renderSessionBar(id); }
    S.toasts.filter((t) => t.sid && (S.sessions.get(t.sid) || {}).status !== 'needs' && t.kind === 'needs').forEach((t) => t.close());
  }

  function termTheme() {
    return { background: '#0A0C10', foreground: '#E8EAF0', cursor: '#E8EAF0', cursorAccent: '#0A0C10', selectionBackground: '#3A4270', black: '#1D2129', brightBlack: '#5A6272' };
  }

  function renderSession(tab) {
    const v = viewEl(tab.id, 'session');
    if (!v.dataset.built) {
      v.dataset.built = '1';
      add(v, h('div', { class: 'sess-bar', id: 'bar-' + tab.sid }), h('div', { class: 'term-wrap' }, h('div', { class: 'term-inner', id: 'term-' + tab.sid })));
      const term = new window.Terminal({ fontFamily: "'IBM Plex Mono', ui-monospace, Menlo, monospace", fontSize: 13, lineHeight: 1.15, cursorBlink: true, scrollback: 10000, theme: termTheme(), allowProposedApi: false, macOptionIsMeta: true });
      const fit = new window.FitAddon.FitAddon();
      term.loadAddon(fit);
      const wrap = document.getElementById('term-' + tab.sid);
      term.open(wrap);
      // While an old screen is being replayed the terminal answers its old queries (cursor position,
      // device attributes…). Those answers must never reach Claude, so input is ignored until the replay ends.
      term.onData((d) => {
        const e = S.terms.get(tab.sid); const s = S.sessions.get(tab.sid);
        if (!e || e.replaying || !s || !s.alive) return;
        send({ t: 'in', id: tab.sid, data: d });
      });
      term.onResize(({ cols, rows }) => send({ t: 'resize', id: tab.sid, cols, rows }));
      const entry = { term, fit, ready: false };
      entry.ro = new ResizeObserver(() => fitLater(entry, v));
      entry.ro.observe(wrap);
      S.terms.set(tab.sid, entry);
      send({ t: 'attach', id: tab.sid });
    }
    renderSessionBar(tab.sid);
    const t = S.terms.get(tab.sid);
    requestAnimationFrame(() => { try { t.fit.fit(); send({ t: 'resize', id: tab.sid, cols: t.term.cols, rows: t.term.rows }); } catch {} t.term.focus(); });
  }

  // Resizing a terminal makes its program redraw (Claude Code repaints its whole screen), so while the
  // sidebar is hidden/shown or dragged, fit once when the size has settled — not on every frame. Running
  // it outside the ResizeObserver callback also avoids "ResizeObserver loop" errors.
  function fitLater(entry, v) {
    clearTimeout(entry.fitTimer);
    entry.fitTimer = setTimeout(() => {
      if (!v.classList.contains('on') || !v.isConnected) return;
      const el = v.querySelector('.term-inner');
      if (!el || el.clientWidth < 50 || el.clientHeight < 30) return;
      try { entry.fit.fit(); } catch {}
    }, 150);
  }

  const STATUS_LABEL = { needs: 'Needs you', running: 'Running', idle: 'Waiting for you', exited: 'Ended' };

  // ---------- command output (worktree steps: migrate, up, vite, bash…) ----------
  function renderProc(tab) {
    const v = viewEl(tab.id, 'session proc');
    if (!v.dataset.built) {
      v.dataset.built = '1';
      add(v, h('div', { class: 'sess-bar', id: 'pbar-' + tab.pid }), h('div', { class: 'term-wrap' }, h('div', { class: 'term-inner', id: 'term-' + tab.pid })));
      const term = new window.Terminal({ fontFamily: "'IBM Plex Mono', ui-monospace, Menlo, monospace", fontSize: 13, lineHeight: 1.15, cursorBlink: true, scrollback: 10000, theme: termTheme(), macOptionIsMeta: true });
      const fit = new window.FitAddon.FitAddon();
      term.loadAddon(fit);
      const wrap = document.getElementById('term-' + tab.pid);
      term.open(wrap);
      term.onData((d) => {
        const e = S.terms.get(tab.pid); const p = S.procs.get(tab.pid);
        if (!e || e.replaying || !p || !p.alive) return;
        send({ t: 'in', id: tab.pid, data: d });
      });
      term.onResize(({ cols, rows }) => send({ t: 'resize', id: tab.pid, cols, rows }));
      const entry = { term, fit, ready: false };
      entry.ro = new ResizeObserver(() => fitLater(entry, v));
      entry.ro.observe(wrap);
      S.terms.set(tab.pid, entry);
      send({ t: 'attach', id: tab.pid });
    }
    renderProcBar(tab.pid);
    const t = S.terms.get(tab.pid);
    requestAnimationFrame(() => { try { t.fit.fit(); send({ t: 'resize', id: tab.pid, cols: t.term.cols, rows: t.term.rows }); } catch {} t.term.focus(); });
  }
  const PROC_LABEL = { running: 'Running', ok: 'Done', failed: 'Failed', stopped: 'Stopped' };
  function renderProcBar(pid) {
    const bar = document.getElementById('pbar-' + pid); if (!bar) return;
    const p = S.procs.get(pid) || { title: 'output', status: 'stopped', cmd: '' };
    bar.textContent = '';
    add(bar,
      h('span', { class: 'pill ' + (p.status === 'running' ? 'running' : p.status) }, PROC_LABEL[p.status] + (p.status === 'failed' ? ' · exit ' + p.exitCode : '')),
      h('span', { class: 'mono', title: p.cmd }, `${p.title}  ·  ${p.cmd || ''}`),
      h('button', { class: 'btn', onclick: () => copy(p.cmd, 'Copied') }, 'Copy command'),
      p.alive ? h('button', { class: 'btn danger', onclick: () => api('POST', `/api/procs/${pid}/kill`).catch(() => {}) }, 'Stop') : null);
  }
  function renderSessionBar(sid) {
    const bar = document.getElementById('bar-' + sid); if (!bar) return;
    const s = S.sessions.get(sid) || { title: 'session', status: 'exited', detail: '' };
    bar.textContent = '';
    add(bar, 
      h('span', { class: 'pill ' + s.status }, STATUS_LABEL[s.status] || s.status),
      h('span', { class: 'mono', title: s.command || '' }, `${s.detail || ''}  ·  ${s.projectName || ''}  ·  ${ago(s.startedAt)}`),
      s.command ? h('button', { class: 'btn', onclick: () => copy(s.command, 'Copied') }, 'Copy command') : null,
      s.alive ? h('button', { class: 'btn danger', onclick: () => confirmStop(sid) }, 'Stop session')
        : s.canReopen ? h('button', { class: 'btn', onclick: () => reopen(sid) }, 'Reopen conversation')
          : h('span', { class: 'mono', style: 'flex:0 0 auto' }, 'No conversation to reopen'));
  }

  async function reopen(sid) {
    try {
      await api('POST', `/api/sessions/${sid}/reopen`);
      const t = S.terms.get(sid);
      if (t) { t.ready = false; t.term.reset(); }
      send({ t: 'attach', id: sid });
      if (S.active !== 's:' + sid) openSession(sid);
    } catch (e) { toast({ title: 'Could not reopen', body: e.message, timeout: 6000 }); }
  }

  // "Stop session" asks first; End stops Claude (and whatever it started) and closes the tab.
  function confirmStop(sid) {
    const s = S.sessions.get(sid) || { title: 'this session' };
    const dlg = h('dialog', { class: 'confirm', 'aria-labelledby': 'stop-title' });
    const close = () => { dlg.close(); dlg.remove(); };
    add(dlg, h('div', { class: 'confirm-body' },
      h('span', { class: 'confirm-icon', 'aria-hidden': 'true' }, '!'),
      h('div', {}, h('h2', { id: 'stop-title' }, 'End this Claude session?'),
        h('p', {}, h('b', {}, s.title), ' stops right away — anything it is doing now is interrupted — and this tab closes. ' + (s.canReopen || s.command ? 'The conversation is kept: you can reopen it from Home.' : '')))),
      h('div', { class: 'confirm-actions' },
        h('button', { class: 'btn big', onclick: close }, 'Cancel'),
        h('button', { class: 'btn big end', onclick: async () => { close(); try { await api('POST', `/api/sessions/${sid}/kill`); } catch {} closeTab('s:' + sid); } }, 'End session')));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    add(document.body, dlg);
    dlg.showModal();
    dlg.querySelector('.btn.big').focus();
  }

  // ---------- attention: toasts + desktop notifications ----------
  function attention(s, kind) {
    S.sessions.set(s.id, s); sessionsChanged(s.id);
    const viewing = S.active === 's:' + s.id && document.visibilityState === 'visible';
    if (viewing) return;
    const title = kind === 'needs' ? `${s.title} needs you` : `${s.title} finished`;
    toast({ kind, sid: s.id, title, body: s.detail, timeout: kind === 'needs' ? 0 : 9000,
      actions: [{ label: 'Open session', primary: true, fn: () => goToSession(S.sessions.get(s.id) || s) }, { label: 'Later' }] });
    if ('Notification' in window && Notification.permission === 'granted' && notifyHere(s) && (document.visibilityState !== 'visible' || kind === 'needs')) {
      const opts = { body: (s.detail || '') + ' — ' + (s.projectName || ''), tag: s.id + kind, requireInteraction: kind === 'needs' };
      (async () => {
        // Through the service worker, a click focuses the session's own tab (see sw.js); without it, this tab routes.
        const reg = await swReady();
        const target = await sessionTarget(s);
        if (reg && target) return reg.showNotification(title, Object.assign(opts, { data: { key: target.key, sid: s.id, url: target.url } }));
        const n = new Notification(title, opts);
        n.onclick = () => { n.close(); goToSession(S.sessions.get(s.id) || s); };
      })().catch(() => {});
    }
  }

  // The service worker that routes notification clicks to the right tab (null where unsupported).
  let swReg = null;
  async function swReady() {
    if (!('serviceWorker' in navigator)) return null;
    try { if (!swReg) swReg = await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; return swReg; } catch { return null; }
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      const m = e.data || {};
      if (m.open) { S.pendingSid = m.open; openPending(); } // waits for boot / the session list if needed
    });
  }

  // The tab a session belongs in: its environment's ?p= key and the URL that opens it there.
  // A session from a worktree this tab has not heard of yet (created in another tab) refreshes the project list first.
  async function sessionTarget(s) {
    let p = S.projects.find((x) => x.path === s.project);
    if (!p) { try { S.projects = (await api('GET', '/api/projects')).projects; } catch {} p = S.projects.find((x) => x.path === s.project); }
    if (!p) return null;
    const key = W.projectKey(p);
    return { key, url: location.pathname + '?p=' + encodeURIComponent(key) + '&s=' + encodeURIComponent(s.id) };
  }

  // Open a session where it belongs:
  //  1. its environment is the one this tab has open → open it here;
  //  2. otherwise the service worker focuses the tab that has that environment open and opens it there,
  //     or opens a new tab on that environment, which opens the session as it loads.
  async function goToSession(s) {
    if (!s) return;
    if (s.project === S.project) { try { window.focus(); } catch {} openSession(s.id); return; }
    const target = await sessionTarget(s);
    if (!target) { toast({ title: 'That session’s project is not in the list any more', body: s.project, timeout: 6000 }); return; }
    focusOrOpen(target.key, target.url, s.id);
  }

  // Switch to the dashboard tab that has environment `key` open (every dashboard tab is named 'bd:<key>' and
  // opened without noopener, so the browser can find it by name), asking it to open session `sid`.
  // No such tab → the browser hands back a fresh blank one, which is sent to `url`. Must run from a click.
  function focusOrOpen(key, url, sid) {
    const w = window.open('', 'bd:' + key);
    if (!w) { toast({ title: 'The browser blocked the new tab', body: 'Allow pop-ups for this page, then try again.', timeout: 8000 }); return; }
    let ours = false;
    try { ours = w.location.origin === location.origin && w.location.pathname === location.pathname; } catch {}
    if (!ours) { w.location.href = url; return; }
    if (sid) w.postMessage({ open: sid }, location.origin);
    try { w.focus(); } catch {}
  }
  // Another dashboard tab asking this one to open a session (focusOrOpen).
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data || !e.data.open) return;
    S.pendingSid = e.data.open; openPending();
  });

  // A tab opened by goToSession (?s=<id>) opens that session once it is known.
  function openPending() {
    if (!S.booted || !S.pendingSid || !S.sessions.has(S.pendingSid)) return;
    const id = S.pendingSid; S.pendingSid = null;
    const url = new URL(location.href); url.searchParams.delete('s');
    history.replaceState(null, '', url.pathname + url.search);
    openSession(id);
  }

  // Several browser tabs can be open (one per project). A desktop notification is shown once: by the tab
  // that has the session's project open, or — when no tab has it — by one tab chosen for all of them.
  const TAB_ID = Math.random().toString(36).slice(2);
  const others = new Map();
  let bc = null;
  try { bc = new BroadcastChannel('backend-dash'); } catch {}
  const beat = () => { if (bc) bc.postMessage({ id: TAB_ID, project: S.project, at: Date.now() }); };
  if (bc) {
    bc.onmessage = (e) => {
      const m = e.data || {};
      if (m.open) { if (m.to === TAB_ID) { try { window.focus(); } catch {} openSession(m.open); } return; }
      if (m.bye) others.delete(m.id); else if (m.id) others.set(m.id, m);
    };
    setInterval(beat, 4000);
    window.addEventListener('beforeunload', () => bc.postMessage({ id: TAB_ID, bye: true }));
  }
  function notifyHere(s) {
    const alive = [...others.values()].filter((m) => Date.now() - m.at < 12000);
    if (s.project === S.project) return true;
    if (alive.some((m) => m.project === s.project)) return false;
    return [TAB_ID, ...alive.map((m) => m.id)].sort()[0] === TAB_ID;
  }

  function toast(o) {
    const box = document.getElementById('toasts');
    const el = h('div', { class: 'toast' + (o.kind === 'needs' ? ' needs' : '') + (o.small ? ' small' : ''), role: 'status' });
    const close = () => { el.remove(); S.toasts = S.toasts.filter((t) => t.el !== el); };
    if (o.small) add(el, h('span', {}, o.title, o.mono ? h('span', { class: 'mono', style: 'word-break:break-all' }, o.mono) : null));
    else {
      add(el, o.kind ? h('span', { class: 'dot', style: `margin-top:6px;width:10px;height:10px;background:var(${o.kind === 'needs' ? '--warnDot' : '--okDot'})` }) : null,
        h('div', { class: 'body' }, h('b', {}, o.title), o.body ? h('span', {}, o.body) : null,
          o.actions ? h('div', { class: 'actions' }, o.actions.map((a) => h('button', { class: 'btn' + (a.primary ? ' primary' : ''), onclick: () => { close(); a.fn && a.fn(); } }, a.label))) : null));
    }
    add(box, el);
    const rec = { el, close, sid: o.sid, kind: o.kind };
    S.toasts.push(rec);
    if (o.timeout) setTimeout(close, o.timeout);
    return rec;
  }

  // ---------- home ----------
  function focusKey() {
    const tab = S.tabs.find((t) => t.id === S.active);
    const path = (tab && tab.path) || S.focusPath || (S.selected ? S.plansDir + '/' + S.selected : '');
    return lastKey(path) || S.focusKeyHint || null;
  }

  function renderHome() {
    const v = viewEl('home');
    if (!v.classList.contains('on')) return;
    v.textContent = '';
    const page = h('div', { class: 'page' },
      W.envStrip() || h('span', { id: 'envstrip', style: 'display:none' }),
      h('section', { 'aria-label': 'Sessions', style: 'display:flex;flex-direction:column;gap:12px' },
        h('div', { class: 'section-head', style: 'align-items:center' }, h('h1', {}, 'Sessions'), h('div', { id: 'session-filters', class: 'filters' })),
        notifBanner(),
        h('div', { id: 'session-list', class: 'grid-auto' })),
      h('section', { 'aria-label': 'Run a skill', style: 'display:flex;flex-direction:column;gap:14px' },
        h('div', { class: 'section-head' }, h('h2', {}, 'Run a skill'), h('span', { class: 'sub' }, focusKey() ? `Forms start from ${focusKey()} — the ticket you have open` : 'Open a ticket folder on the left and the forms fill themselves')),
        window.Skills.CATALOG.map((g) => h('div', { class: 'skill-group' }, h('span', {}, g.group),
          h('div', { class: 'skill-grid' }, g.skills.map((sk) => h('button', { class: 'skill' + (S.wizard === sk.id && S.showWizard ? ' sel' : ''), 'aria-pressed': String(S.wizard === sk.id && S.showWizard),
            onclick: () => { S.wizard = sk.id; S.showWizard = true; store.set('wizard', sk.id); renderHome(); } }, h('b', {}, sk.id), h('span', {}, sk.short))))))));
    const wrap = h('div', { class: 'home' }, page, S.showWizard ? h('aside', { class: 'wizard', id: 'wizard', 'aria-label': 'Skill form' }) : null);
    add(v, wrap);
    renderSessionList();
    if (S.showWizard) renderWizard();
  }

  function notifBanner() {
    if (!('Notification' in window) || Notification.permission !== 'default') return null;
    return h('div', { class: 'banner' }, h('span', { style: 'flex:1 1 240px' }, 'Get a desktop notification when a session needs your approval or finishes.'),
      h('button', { class: 'btn primary', onclick: async () => { await Notification.requestPermission(); renderHome(); } }, 'Turn on notifications'));
  }

  const STATUS_FILTERS = [['all', 'All', null], ['needs', 'Needs you', '--warnDot'], ['running', 'Running', '--accent'], ['idle', 'Waiting', '--okDot'], ['exited', 'Ended', '--faint']];
  function renderSessionFilters(inScope) {
    const box = document.getElementById('session-filters'); if (!box) return;
    box.textContent = '';
    const seg = (label, items) => h('div', { class: 'seg', role: 'group', 'aria-label': label }, items);
    const ended = inScope.filter((s) => s.status === 'exited');
    add(box,
      seg('Filter by status', STATUS_FILTERS.map(([k, label, dot]) => h('button', { class: S.statusFilter === k ? 'on' : '', 'aria-pressed': String(S.statusFilter === k),
        onclick: () => { S.statusFilter = k; store.set('statusFilter', k); renderSessionList(); } },
      dot ? h('span', { class: 'dot', style: `width:7px;height:7px;background:var(${dot})` }) : null, label,
      h('span', { class: 'n' }, String(k === 'all' ? inScope.length : inScope.filter((s) => s.status === k).length))))),
      ended.length ? h('button', { class: 'clear-ended', onclick: () => ended.forEach((s) => api('POST', `/api/sessions/${s.id}/dismiss`).catch(() => {})) }, '× Clear ended ', h('span', { class: 'n' }, String(ended.length))) : null);
  }

  function renderSessionList() {
    const box = document.getElementById('session-list'); if (!box) return;
    box.textContent = '';
    const order = { needs: 0, running: 1, idle: 2, exited: 3 };
    const inScope = here(); // only the environment this tab has open (main checkout or one worktree)
    renderSessionFilters(inScope);
    const list = inScope.filter((s) => S.statusFilter === 'all' || s.status === S.statusFilter)
      .sort((a, b) => (order[a.status] - order[b.status]) || b.updatedAt - a.updatedAt);
    if (!list.length) {
      add(box, h('div', { class: 'banner', style: 'grid-column:1/-1' }, h('span', {}, inScope.length ? 'No sessions with this status.' : 'No Claude sessions yet. Pick a skill below and press “Run in a Claude tab”, or use + in the tab bar.')));
      return;
    }
    for (const s of list) {
      add(box, h('div', { class: 'scard' + (s.status === 'needs' ? ' needs' : '') },
        h('div', { class: 'top' },
          h('span', { class: 'title' }, h('span', { class: 'dot', style: `background:var(${statusVar(s)})` }), h('span', { title: s.command || s.title }, s.title)),
          h('span', { class: 'pill ' + s.status }, STATUS_LABEL[s.status] || s.status)),
        h('span', { class: 'detail' }, s.detail || ''),
        h('span', { class: 'meta' }, `${s.projectName} · started ${ago(s.startedAt)} ago` + (s.status !== 'exited' ? ` · updated ${ago(s.updatedAt)} ago` : '')),
        h('div', { class: 'actions' },
          h('button', { class: 'btn' + (s.status === 'needs' ? ' primary' : ''), onclick: () => openSession(s.id) }, s.status === 'needs' ? 'Open session to answer' : 'Open'),
          !s.alive && s.canReopen ? h('button', { class: 'btn', onclick: () => reopen(s.id) }, 'Reopen') : null,
          !s.alive ? h('button', { class: 'btn', onclick: () => api('POST', `/api/sessions/${s.id}/dismiss`) }, 'Dismiss') : null)));
    }
  }
  setInterval(() => { const tab = S.tabs.find((t) => t.id === S.active); if (tab && tab.type === 'home') renderSessionList(); }, 30000);

  // ---------- skill wizard ----------
  function renderWizard() {
    const box = document.getElementById('wizard'); if (!box) return;
    const skill = window.Skills.all().find((s) => s.id === S.wizard) || window.Skills.all()[0];
    const manual = S.manual[skill.id] || (S.manual[skill.id] = {});
    const ctx = { focusKey: focusKey(), index: S.index };
    const r = window.Skills.resolve(skill, ctx, manual);

    const active = document.activeElement;
    const keep = active && active.dataset && active.dataset.field ? { k: active.dataset.field, s: active.selectionStart, e: active.selectionEnd } : null;

    box.textContent = '';
    [
      h('div', { style: 'display:flex;justify-content:space-between;gap:12px;align-items:flex-start' },
        h('div', { style: 'display:flex;flex-direction:column;gap:4px;min-width:0' }, h('h2', {}, '/backend:' + skill.id), h('span', { class: 'sub' }, skill.desc)),
        h('button', { class: 'btn icon', style: 'border:1px solid var(--line)', 'aria-label': 'Close form', onclick: () => { S.showWizard = false; renderHome(); } }, '×')),
      r.fields.map((f, i) => {
        const onChange = (e) => {
          manual[f.k] = e.target.value;
          r.fields.slice(i + 1).forEach((g) => { if (g.type === 'file' || g.derived) delete manual[g.k]; });
          renderWizard();
        };
        let input;
        if (f.type === 'area') input = h('textarea', { 'data-field': f.k, rows: '4', oninput: onChange }, f.value);
        else if (f.type === 'file' || f.type === 'select') {
          input = h('select', { class: 'select', 'data-field': f.k, onchange: onChange }, f.options.map(([v, label]) => h('option', { value: v, selected: v === f.value }, label)));
        } else input = h('input', { class: 'input', type: 'text', 'data-field': f.k, value: f.value, placeholder: f.placeholder || '', oninput: onChange, spellcheck: 'false' });
        if (f.type === 'area') input.value = f.value;
        return h('label', {}, h('span', {}, f.label + ' ', f.hint ? h('i', {}, f.hint) : null), input, f.note ? h('span', { class: 'note' }, f.note) : null);
      }),
      skill.always ? h('div', { class: 'always' }, h('b', {}, 'Always done by this skill'), skill.always.map((a) => h('span', {}, a))) : null,
      h('div', { style: 'display:flex;flex-direction:column;gap:6px' }, h('b', { style: 'font-size:13px' }, 'Command'), h('pre', { class: 'cmd-preview' }, r.command)),
      h('div', { style: 'display:flex;flex-wrap:wrap;gap:10px' },
        h('button', { class: 'btn primary big', onclick: () => startSession(r.command, skill.id + (r.key ? ' · ' + r.key : ''), r.key) }, icon('run'), 'Run in a Claude tab'),
        h('button', { class: 'btn big', onclick: () => copy(r.command, 'Copied') }, icon('copy'), 'Copy command'),
        Object.keys(manual).length ? h('button', { class: 'btn big', onclick: () => { S.manual[skill.id] = {}; renderWizard(); } }, 'Reset') : null),
      h('span', { class: 'note' }, S.project ? `Runs Claude Code in ${S.project.replace(/^\/(Users|home)\/[^/]+/, '~')}. Leave the tab whenever you like — Home keeps tracking it.` : 'Add a project first.')
    ].flat(5).forEach((c) => { if (c) add(box, c); });
    if (keep) {
      const el = box.querySelector(`[data-field="${keep.k}"]`);
      if (el) { el.focus(); try { if (keep.s !== null && el.setSelectionRange) el.setSelectionRange(keep.s, keep.e); } catch {} }
    }
  }

  // ---------- folder view ----------
  async function loadFolder(tab, quiet) {
    const v = viewEl(tab.id);
    if (!quiet || !v.childElementCount) { v.textContent = ''; add(v, h('div', { class: 'page' }, h('span', { class: 'sub' }, 'Loading…'))); }
    try { tab.data = await api('GET', '/api/folder?' + qs({ project: S.project, path: tab.path })); }
    catch (e) { tab.data = { error: e.message }; }
    if (S.active === tab.id) renderFolder(tab);
  }

  function cmdBar(cmd, label, title, key) {
    return h('div', { class: 'cmdbar' },
      h('code', { title: cmd }, cmd.replace(/https?:\/\/[^/]+\/browse\//g, '')),
      h('button', { class: 'btn icon', 'aria-label': 'Copy ' + label, title: 'Copy', html: ICONS.copy, onclick: () => copy(cmd, 'Copied') }),
      h('button', { class: 'btn icon run', 'aria-label': 'Run ' + label + ' in a Claude tab', title: 'Run in a Claude tab', html: ICONS.run, onclick: () => startSession(cmd, title, key) }));
  }

  function renderFolder(tab) {
    const v = viewEl(tab.id);
    const d = tab.data || {};
    v.textContent = '';
    const page = h('div', { class: 'page' });
    add(v, page);
    if (d.error) { add(page, h('h1', {}, baseName(tab.path)), h('p', { class: 'sub' }, d.error)); return; }
    const it = d.item;
    add(page, h('div', { style: 'display:flex;flex-direction:column;gap:8px' },
      h('div', { class: 'crumb' }, d.path, h('button', { class: 'btn icon', 'aria-label': 'Copy folder path', html: ICONS.copy, onclick: () => copy(d.path, 'Copied') })),
      h('div', { class: 'section-head' },
        h('h1', {}, it ? [jiraLink(it.key, it.url), ' · ' + it.title, it.focusStory && it.focusStory !== it.key ? ['  ›  ', jiraLink(it.focusStory, (it.stories.find((x) => x.key === it.focusStory) || {}).url)] : null] : d.name),
        it ? h('div', { class: 'chips' },
          h('span', { class: 'pill accent' }, `${it.kind === 'bug' ? 'Bug' : 'Feature'} · ${it.stage}`),
          it.url ? h('a', { class: 'chip', href: it.url, target: '_blank', rel: 'noopener' }, 'Jira ↗') : null,
          linkChips(it.links),
          it.mr && it.mr.url ? h('a', { class: 'chip', href: it.mr.url, target: '_blank', rel: 'noopener' }, 'MR ↗') : null) : null)));

    if (it) {
      add(page, h('section', { class: 'card where', 'aria-label': 'Where you stopped' },
        h('div', { class: 'section-head' }, h('h2', {}, 'Where you stopped'), h('span', { class: 'sub' }, 'from context.md' + (it.updatedAt ? ' · ' + new Date(it.updatedAt).toLocaleString() : ''))),
        it.where.length ? h('ul', {}, it.where.map((x) => h('li', {}, md(x)))) : h('span', { class: 'sub' }, 'context.md has no “Where we are” section yet.'),
        cmdBar(it.resume, 'resume', 'resume · ' + (it.focusStory || it.key), it.focusStory || it.key)));

      if (it.stories.length) {
        const stories = it.focusStory ? it.stories.filter((s) => s.key === it.focusStory) : it.stories;
        add(page, h('section', { class: 'card stories', 'aria-label': 'Stories' },
          h('div', { class: 'section-head' }, h('h2', {}, it.focusStory ? 'Story' : 'Stories'),
            h('div', { class: 'chips' },
              h('span', { class: 'pill planned' }, `${it.counts.planned} planned`),
              h('span', { class: 'pill none' }, `${it.counts.notPlanned} not planned`),
              h('span', { class: 'pill done' }, `${it.counts.done} done`))),
          stories.map((st) => storyBlock(tab, st, !!it.focusStory))));
      }
      if (it.next.length || it.openQuestions.length || it.decisions.length) {
        add(page, h('div', { class: 'two-col' },
          it.next.length ? h('section', { class: 'card list-card' }, h('h2', {}, 'Next step'), h('ul', {}, it.next.map((x) => h('li', {}, md(x))))) : null,
          it.openQuestions.length ? h('section', { class: 'card list-card' }, h('h2', {}, `Open questions · ${it.openQuestions.length}`), h('ul', {}, it.openQuestions.map((x) => h('li', {}, md(x))))) : null,
          it.decisions.length ? h('section', { class: 'card list-card' }, h('h2', {}, 'Recent decisions'), h('ul', {}, it.decisions.map((x) => h('li', {}, md(x))))) : null));
      }
    } else if (d.keyInName) {
      add(page, h('section', { class: 'card where' }, h('span', { class: 'sub' }, 'This folder has no state.json — it is not a plugin work item, but you can still continue from one of its files.'),
        cmdBar('/backend:resume ' + d.keyInName, 'resume', 'resume · ' + d.keyInName, d.keyInName)));
    }

    add(page, h('section', { 'aria-label': 'Files in this folder', style: 'display:flex;flex-direction:column;gap:10px' },
      h('h2', {}, 'In this folder'),
      d.files.length ? h('div', { class: 'files' }, d.files.map((f) => h('button', { class: 'file-card', onclick: () => (f.dir ? openFolder(f.path) : openFile(f.path)) },
        h('b', {}, f.name), f.what ? h('span', {}, f.what) : null, h('span', {}, (f.dir ? '' : fmtSize(f.size) + ' · ') + 'updated ' + ago(f.mtime) + ' ago')))) : h('span', { class: 'sub' }, 'Empty folder.')));
  }

  // A ticket key that opens in Jira when its URL is known; plain text otherwise.
  const isUrl = (u) => /^https?:\/\//.test(String(u || ''));
  function jiraLink(key, url) {
    if (!isUrl(url)) return key;
    return h('a', { class: 'key-link', href: url, target: '_blank', rel: 'noopener', title: 'Open ' + key + ' in Jira', onclick: (e) => e.stopPropagation() }, key);
  }
  // state.json links{} as chips: Docs first (only when the developer gave it), then the rest.
  const LINK_LABELS = { docs_page: 'Docs', contract_page: 'API contract', requirements_page: 'Requirements', prd: 'PRD' };
  function linkChips(links) {
    const entries = Object.entries(links || {}).filter(([, u]) => isUrl(u));
    entries.sort(([a], [b]) => (b === 'docs_page') - (a === 'docs_page'));
    return entries.map(([k, u]) => k === 'docs_page'
      ? h('a', { class: 'chip docs', href: u, target: '_blank', rel: 'noopener', title: 'Feature documentation on Confluence' }, icon('doc'), 'Docs ↗')
      : h('a', { class: 'chip', href: u, target: '_blank', rel: 'noopener' }, (LINK_LABELS[k] || k.replace(/_/g, ' ')) + ' ↗'));
  }

  const fmtSize = (n) => (n > 1024 * 1024 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? Math.round(n / 1024) + ' KB' : n + ' B');
  const SUB_PILL = (st) => /done|merged/i.test(st) ? 'done' : /review/i.test(st) ? 'needs' : /progress|committed/i.test(st) ? 'running' : 'none';

  function storyBlock(tab, st, forceOpen) {
    const key = tab.id + ':' + st.key;
    // A done story stays closed unless opened (or it holds the subtask you are on).
    const open = forceOpen || (S.openStories[key] !== undefined ? S.openStories[key] : st.subtasks.some((t) => t.here) && !st.done);
    const block = h('div', { class: 'story' + (st.done ? ' done' : '') });
    const pct = st.total ? Math.round((st.doneCount / st.total) * 100) : 0;
    add(block, h('div', { class: 'story-row' },
      h('button', { class: 'btn icon', 'aria-expanded': String(open), 'aria-label': 'Show subtasks of ' + st.key, disabled: !st.subtasks.length, style: st.subtasks.length ? '' : 'visibility:hidden',
        onclick: () => { S.openStories[key] = !open; renderFolder(tab); } }, icon('chev', 'chev' + (open ? ' open' : ''))),
      h('div', { class: 'info' },
        h('span', {}, st.done ? h('span', { class: 'story-check', 'aria-hidden': 'true' }, '✓') : null, h('span', { class: 'key' }, jiraLink(st.key, st.url)), '  ', st.title || ''),
        h('small', {}, st.planned ? `${st.plan.split('/').slice(-3).join('/')} · ${st.subtasks.length} subtask${st.subtasks.length === 1 ? '' : 's'}` : 'No story plan yet — plan it from the main plan'),
        st.total ? h('div', { class: 'story-progress' + (st.done ? ' full' : ''), title: `${st.doneCount} of ${st.total} subtasks done` },
          h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(st.total), 'aria-valuenow': String(st.doneCount), 'aria-label': 'Subtasks done' }, h('span', { style: `width:${pct}%` })),
          h('span', {}, `${st.doneCount} / ${st.total} subtasks done`)) : null),
      st.done ? h('span', { class: 'pill done story-done-pill' }, '✓ Done')
        : h('span', { class: 'pill ' + (st.planned ? 'planned' : 'none') }, st.planned ? 'Planned' : 'Not planned'),
      st.done ? null : cmdBar(st.cmd, 'plan-story for ' + st.key, 'plan-story · ' + st.key, st.key)));
    if (open && st.subtasks.length) {
      add(block, h('div', { class: 'subs' }, st.subtasks.map((t) => h('div', { class: 'sub-card' + (t.here ? ' here' : '') },
        h('div', { class: 'top' },
          h('div', { class: 'info' },
            h('span', { style: 'display:flex;flex-wrap:wrap;gap:8px;align-items:center' }, h('b', {}, `ST${t.order} · `, jiraLink(t.key, t.url), t.title ? ' · ' + t.title : ''), t.here ? h('span', { class: 'here-badge' }, 'You are here') : null),
            h('span', { class: 'meta' }, [t.branch ? '⎇ ' + t.branch : 'branches from ' + (t.base || 'the current branch'), t.mr && t.mr.url ? 'MR ' + (t.mr.id ? '!' + t.mr.id : '') : null].filter(Boolean).join(' · '))),
          t.mr && t.mr.url ? h('a', { class: 'chip', href: t.mr.url, target: '_blank', rel: 'noopener' }, 'MR ↗') : null,
          h('span', { class: 'pill ' + SUB_PILL(t.status) }, (t.status || 'pending').replace(/_/g, ' ')),
          h('select', { class: 'select sub-status', 'aria-label': 'Set the status of ' + t.key, title: 'Set the status by hand',
            onchange: async (e) => {
              const status = e.target.value;
              try {
                const r = await api('POST', '/api/subtask-status', { project: S.project, key: t.key, status });
                S.openStories[key] = !r.storyBecameDone; // stay open while editing; fold away once the story is done
                if (r.storyBecameDone) toast({ kind: 'ok', title: '✓ ' + st.key + ' is done', body: `All ${r.subtasks} subtask${r.subtasks === 1 ? ' is' : 's are'} done.`, timeout: 6000 });
                else toast({ small: true, title: t.key + ' → ' + status.replace(/_/g, ' '), timeout: 2500 });
              }
              catch (x) { toast({ title: 'Could not set the status', body: apiError(x), timeout: 8000 }); }
              loadFolder(tab, true);
            } },
          ['pending', 'in_progress', 'committed', 'in_review', 'done'].map((v) => h('option', { value: v, selected: (t.status || 'pending') === v }, v === 'done' ? '✓ done' : v.replace(/_/g, ' '))))),
        cmdBar(t.cmd, 'implement ' + t.key, 'implement · ' + t.key, t.key),
        t.review ? cmdBar(t.review, 'address-review ' + t.key, 'address-review · ' + t.key, t.key) : null))));
    }
    return block;
  }

  // ---------- file view ----------
  async function loadFile(tab, quiet) {
    const v = viewEl(tab.id);
    if (!quiet || !v.childElementCount) { v.textContent = ''; add(v, h('div', { class: 'page' }, h('span', { class: 'sub' }, 'Loading…'))); }
    try { tab.data = await api('GET', '/api/file?' + qs({ project: S.project, path: tab.path })); }
    catch (e) { tab.data = { error: e.message }; }
    if (tab.data.kind === 'html' && !tab.data.error) {
      try { tab.viewUrl = (await api('POST', '/api/view', { project: S.project, path: tab.path })).url; } catch {}
    }
    if (S.active === tab.id) renderFile(tab);
  }

  function renderFile(tab) {
    const v = viewEl(tab.id);
    const d = tab.data || {};
    const scroll = v.scrollTop;
    v.textContent = '';
    add(v, h('div', { class: 'filebar' },
      h('span', { class: 'mono' }, tab.path),
      h('button', { class: 'btn', onclick: () => copy(tab.path, 'Copied') }, icon('copy'), 'Copy path'),
      h('span', { class: 'spacer' }),
      d.size !== undefined ? h('span', { class: 'sub' }, `${fmtSize(d.size)} · updated ${ago(d.mtime)} ago`) : null,
      h('button', { class: 'btn', onclick: () => api('POST', '/api/open', { project: S.project, path: tab.path }) }, 'Open in editor')));
    if (d.error) { add(v, h('p', { class: 'raw' }, d.error)); return; }
    if (d.kind === 'md') {
      const doc = h('article', { class: 'doc' });
      doc.innerHTML = window.DOMPurify.sanitize(window.marked.parse(d.content, { gfm: true }), { ADD_ATTR: ['target'] });
      doc.querySelectorAll('a[href^="http"]').forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
      const heads = [...doc.querySelectorAll('h1, h2, h3')];
      heads.forEach((el, i) => { el.id = 'h-' + i; });
      const outline = h('nav', { class: 'outline', 'aria-label': 'On this page' }, h('b', {}, 'On this page'),
        heads.filter((x) => x.tagName !== 'H1').map((x) => h('button', { class: x.tagName === 'H3' ? 'l3' : '', onclick: () => x.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, x.textContent.slice(0, 70))));
      add(v, h('div', { class: 'reader' }, doc, heads.length > 2 ? outline : null));
    } else if (d.kind === 'html') {
      add(v, tab.viewUrl ? h('iframe', { class: 'html-frame', src: tab.viewUrl, title: baseName(tab.path), sandbox: 'allow-scripts allow-popups allow-popups-to-escape-sandbox' }) : h('pre', { class: 'raw' }, d.content));
    } else if (d.kind === 'json') {
      let pretty = d.content;
      try { pretty = /\.jsonl$/i.test(tab.path) ? d.content.trim().split('\n').map((l) => JSON.stringify(JSON.parse(l))).join('\n') : JSON.stringify(JSON.parse(d.content), null, 2); } catch {}
      add(v, h('pre', { class: 'raw' }, pretty));
    } else add(v, h('pre', { class: 'raw' }, d.content));
    v.scrollTop = scroll;
  }

  // ---------- project dialogs ----------
  function addProjectDialog() {
    const input = h('input', { class: 'input', placeholder: '~/work/webapp', required: true });
    const err = h('span', { class: 'sub', style: 'color:var(--errText)' });
    const dlg = h('dialog', {}, h('form', { method: 'dialog', onsubmit: async (e) => {
      e.preventDefault();
      try { const r = await api('POST', '/api/projects', { path: input.value }); dlg.close(); dlg.remove(); await loadProjects(); await switchProject(r.path); }
      catch (x) { err.textContent = x.message; }
    } },
    h('h2', { style: 'margin:0;font-size:17px' }, 'Add a project folder'),
    h('span', { class: 'sub' }, 'The root of a git repo. Its .plans/ folder (or plans_dir from .claude/backend.yml) shows in the sidebar.'),
    input, err,
    h('div', { style: 'display:flex;gap:8px;justify-content:flex-end' }, h('button', { class: 'btn', type: 'button', onclick: () => { dlg.close(); dlg.remove(); } }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Add project'))));
    add(document.body, dlg); dlg.showModal(); input.focus();
  }

  async function removeProject() {
    if (!S.project || !confirm('Remove ' + S.project + ' from the dashboard? (Nothing is deleted on disk.)')) return;
    await api('POST', '/api/projects/remove', { path: S.project });
    await loadProjects();
    await switchProject(S.project);
  }

  // ---------- worktrees, project switcher, monitor (public/worktrees.js) ----------
  const W = window.WTUI({
    h, add, api, icon, toast, copy, S, ago, qs, apiError, baseName,
    switchProject: (p) => switchProject(p), activate: (id) => activate(id), renderTabs: () => renderTabs(), viewEl: (id, c) => viewEl(id, c),
    openProc: (id) => openProc(id), openSession: (id) => openSession(id), startSession: (c, t, k) => startSession(c, t, k),
    addProjectDialog: () => addProjectDialog(), removeProject: () => removeProject(), loadProjects: () => loadProjects(), renderTopbar: () => renderTopbar(),
    focusKey: () => focusKey(), focusOrOpen: (k, u, sid) => focusOrOpen(k, u, sid), termGlyph: (s) => termGlyph(s), STATUS_LABEL, send: (o) => send(o),
    goToSession: (s) => goToSession(s), needsElsewhere: () => needsElsewhere()
  });

  // ---------- boot ----------
  async function boot() {
    applyTheme(); applySidebar(); setupResize();
    await loadProjects();
    S.open = {}; // the tree starts collapsed
    ensureEnvTab();
    if (S.project) for (const t of store.get('tabs:' + S.project, [])) S.tabs.push(t);
    renderTopbar(); renderSidebarShell(); renderTabs();
    connect();
    beat();
    swReady();
    W.load();
    await refreshProject().catch((e) => toast({ title: 'Could not read the project', body: e.message, timeout: 6000 }));
    activate('home');
    S.booted = true; openPending();
  }
  boot();
})();
