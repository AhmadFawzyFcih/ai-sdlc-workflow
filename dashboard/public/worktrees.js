// backend dashboard — worktrees, the project switcher, the Environment tab and the Monitor page.
// Loaded before app.js; app.js calls window.WTUI(ctx) with its helpers and state.
(function () {
  'use strict';

  window.WTUI = function (X) {
    const { h, add, api, icon, toast, copy, S, ago, qs, apiError, baseName } = X;
    const BRANCH = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="4.5" cy="3.5" r="1.75"/><circle cx="4.5" cy="12.5" r="1.75"/><circle cx="11.5" cy="5.5" r="1.75"/><path d="M4.5 5.25v5.5M11.5 7.25c0 2.5-3 2.75-7 3.5"/></svg>';
    const PULSE = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M1.5 8.5h3l2-5 3 9 2-4h3"/></svg>';
    const SERVER = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="4.5" rx="1"/><rect x="2.5" y="9" width="11" height="4.5" rx="1"/><path d="M5 4.75h.01M5 11.25h.01"/></svg>';
    const FOLDER = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M1.75 4.25c0-.69.56-1.25 1.25-1.25h3.2l1.5 1.6H13c.69 0 1.25.56 1.25 1.25v6.4c0 .69-.56 1.25-1.25 1.25H3c-.69 0-1.25-.56-1.25-1.25Z"/></svg>';
    const svg = (s, cls) => h('span', { class: cls || '', html: s, 'aria-hidden': 'true', style: 'display:inline-flex' });
    const tilde = (p) => String(p || '').replace(/^\/(Users|home)\/[^/]+/, '~');
    const GB = 1024 ** 3;
    const fmtBytes = (n) => (n === null || n === undefined ? '—' : n >= GB ? (n / GB).toFixed(1) + ' GB' : n >= 1048576 ? Math.round(n / 1048576) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B');

    S.wt = { list: [], mainEnvs: [], banner: [], shared: {}, mains: [], docker: true, dockerError: null, loaded: false, detail: {} };
    S.page = null; S.menuOpen = false; S.dockerPct = null;
    S.mon = { snap: null, history: [], disk: null, diskLoading: false };

    // ---------- projects ----------
    const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const projectKey = (p) => (p.worktree ? p.worktree.id : slug(p.name) || 'project');
    const cur = () => S.projects.find((p) => p.path === S.project) || null;
    // The environment of the current project: its worktree, or the main checkout's own environment.
    const envOf = (p) => (!p || !p.env ? null : S.wt.list.find((w) => w.id === p.env.id) || S.wt.mainEnvs.find((w) => w.id === p.env.id) || null);
    const curWt = () => envOf(cur());
    const mainOf = (path) => { const p = S.projects.find((x) => x.path === path); return p && p.worktree ? p.worktree.main : path; };
    const wtOfPath = (path) => S.wt.list.find((w) => w.path === path) || null;
    const newTab = (p) => window.open(location.pathname + '?p=' + encodeURIComponent(projectKey(p)), '_blank', 'noopener');
    const titleOf = (key) => {
      const ix = S.index; if (!ix || !key) return '';
      for (const it of ix.items || []) {
        if (it.key === key) return it.title;
        for (const st of it.stories || []) { if (st.key === key) return st.title; for (const t of st.subtasks || []) if (t.key === key) return t.title; }
      }
      return '';
    };

    function bstate(w) { const s = w && w.status; return s ? s.backend.state : 'down'; }
    function fstate(w) { const s = w && w.status; return s ? s.frontend.state : 'down'; }
    function statePill(state, label) {
      const cls = { up: 'up', partial: 'partial', down: 'down', starting: 'running' }[state] || 'down';
      const txt = label || { up: 'Up', partial: 'Partly up', down: 'Stopped', starting: 'Starting…' }[state] || state;
      return h('span', { class: 'pill dotted ' + cls }, txt);
    }
    // "● 2 need you ↗" on a menu row: opens the newest of those sessions where it belongs (its tab, or a new one).
    function needsButton(p) {
      if (p.path === S.project) return null; // this environment's count is in the top bar
      const list = X.needsElsewhere().filter((s) => s.project === p.path);
      if (!list.length) return null;
      return h('button', { class: 'needs', title: 'Open ' + list[0].title, onclick: (e) => { e.stopPropagation(); S.menuOpen = false; renderSwitcher(); X.goToSession(list[0]); } },
        `● ${list.length} need${list.length > 1 ? '' : 's'} you ↗`);
    }
    function menuPill(w) {
      const b = bstate(w); const f = fstate(w);
      if (b === 'up' && f === 'up') return h('span', { class: 'pill dotted up' }, 'up');
      if (b !== 'down' || f !== 'down') return h('span', { class: 'pill dotted warn' }, b !== 'down' ? 'backend only' : 'frontend only');
      return h('span', { class: 'pill dotted down' }, 'stopped');
    }
    const dotColor = (w) => (bstate(w) === 'up' ? '--okDot' : bstate(w) === 'partial' || fstate(w) === 'up' ? '--warnDot' : '--faint');

    async function load() {
      try {
        const d = await api('GET', '/api/worktrees');
        Object.assign(S.wt, { list: d.worktrees, mainEnvs: d.mainEnvs || [], banner: d.banner, shared: d.shared, mains: d.mains, docker: d.docker, dockerError: d.dockerError, loaded: true });
      } catch (e) { S.wt.dockerError = apiError(e); }
      rerender();
    }
    async function loadDetail(id) {
      try { S.wt.detail[id] = await api('GET', '/api/worktrees/' + id); } catch (e) { S.wt.detail[id] = { error: apiError(e) }; }
      const w = curWt();
      if (w && w.id === id && S.active === 'env' && !S.page) renderEnv();
    }
    function rerender() {
      renderSwitcher(); renderNav();
      if (S.page) renderGlobal();
      else if (S.active === 'env') { const w = curWt(); if (w) loadDetail(w.id); }
      else if (S.active === 'home') { const el = document.getElementById('envstrip'); if (el) el.replaceWith(envStrip() || h('span', { id: 'envstrip', style: 'display:none' })); }
      X.renderTabs();
    }
    let soon = null;
    const loadSoon = () => { clearTimeout(soon); soon = setTimeout(load, 400); };
    let pollTimer = null;
    function poll() {
      clearTimeout(pollTimer);
      pollTimer = setTimeout(async () => {
        if (document.visibilityState === 'visible' && (S.page === 'worktrees' || S.menuOpen || curWt())) await load();
        poll();
      }, 10000);
    }

    // ---------- top bar: project switcher + Worktrees / Monitor ----------
    function switcher() {
      const box = h('div', { class: 'switch', id: 'switch' });
      fillSwitcher(box);
      return box;
    }
    function fillSwitcher(box) {
      box.textContent = '';
      const p = cur();
      const w = curWt();
      const btn = h('button', { class: 'proj', 'aria-haspopup': 'listbox', 'aria-expanded': String(S.menuOpen), 'aria-label': 'Project', title: p ? p.path : '',
        onclick: (e) => { e.stopPropagation(); S.menuOpen = !S.menuOpen; if (S.menuOpen) load(); else fillSwitcher(box); } },
      svg(p && p.worktree ? BRANCH : FOLDER, 'ic'),
      h('span', { class: 'nm' },
        h('b', {}, p ? p.name : 'No project yet', p && p.worktree ? h('i', {}, ' · ' + baseName(p.worktree.main) + ' worktree') : null),
        h('small', {}, p ? tilde(p.path) : 'Add a project folder')),
      w ? h('span', { class: 'dot', style: `background:var(${dotColor(w)})`, title: 'Backend ' + bstate(w) }) : null,
      h('span', { class: 'caret', 'aria-hidden': 'true' }, '▾'));
      // Sessions that need you in the other environments; the menu shows where.
      const away = X.needsElsewhere().length;
      if (away) {
        add(btn, h('span', { class: 'needs-badge', 'aria-hidden': 'true' }, String(away)));
        btn.setAttribute('aria-label', `Project — ${away} session${away > 1 ? 's' : ''} need${away > 1 ? '' : 's'} you in other environments`);
      }
      add(box, btn);
      if (S.menuOpen) add(box, menu());
    }
    function renderSwitcher() { const box = document.getElementById('switch'); if (box) fillSwitcher(box); }

    function menu() {
      const m = h('div', { class: 'pmenu', role: 'listbox', 'aria-label': 'Projects', onclick: (e) => e.stopPropagation() });
      const mains = S.projects.filter((p) => !p.worktree);
      const withKids = mains.filter((p) => S.projects.some((x) => x.worktree && x.worktree.main === p.path));
      const others = mains.filter((p) => !withKids.includes(p));
      const row = (p, child) => {
        const w = envOf(p);
        const on = p.path === S.project;
        return h('div', { class: 'mi' + (child ? ' child' : '') + (on ? ' on' : ''), role: 'option', 'aria-selected': String(on) },
          h('button', { class: 'mi', style: 'padding:0;flex:1;min-width:0', onclick: () => { S.menuOpen = false; X.switchProject(p.path); } },
            svg(p.worktree ? BRANCH : FOLDER),
            h('span', { class: 'nm' }, h('b', {}, p.worktree ? `${p.name} · slot ${p.worktree.slot}` : p.name + (child === false && withKids.includes(p) ? ' · main checkout' : '')),
              h('small', {}, p.worktree ? (w ? (w.status && w.status.git ? w.status.git.branch : w.branch) : p.worktree.branch) : tilde(p.path)))),
          needsButton(p),
          w ? menuPill(w) : null,
          h('button', { class: 'nt', 'aria-label': 'Open ' + p.name + ' in a new browser tab', title: 'Open in a new browser tab', onclick: () => { S.menuOpen = false; renderSwitcher(); newTab(p); } }, '↗'));
      };
      for (const p of withKids) {
        add(m, h('div', { class: 'grp' }, p.name), row(p, false));
        S.projects.filter((x) => x.worktree && x.worktree.main === p.path).forEach((x) => add(m, row(x, true)));
      }
      if (others.length) {
        if (withKids.length) add(m, h('div', { class: 'sep' }), h('div', { class: 'grp' }, 'Other projects'));
        others.forEach((p) => add(m, row(p)));
      }
      const p = cur();
      add(m, h('div', { class: 'sep' }),
        p && (p.hasCompose || p.worktree) ? h('button', { class: 'mi', onclick: () => { S.menuOpen = false; renderSwitcher(); newDialog(mainOf(S.project)); } }, svg(BRANCH), h('span', { class: 'nm' }, h('b', {}, 'New worktree…'))) : null,
        h('button', { class: 'mi', onclick: () => { S.menuOpen = false; renderSwitcher(); X.addProjectDialog(); } }, svg(FOLDER), h('span', { class: 'nm' }, h('b', {}, 'Add project…'))),
        p && !p.worktree ? h('button', { class: 'mi', onclick: () => { S.menuOpen = false; renderSwitcher(); X.removeProject(); } }, h('span', { style: 'width:15px' }), h('span', { class: 'nm' }, h('b', { style: 'font-weight:500;color:var(--muted)' }, 'Remove this project from the list'))) : null);
      return m;
    }
    document.addEventListener('click', () => { if (S.menuOpen) { S.menuOpen = false; renderSwitcher(); } });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.menuOpen) { S.menuOpen = false; renderSwitcher(); } });

    function nav() {
      const box = h('nav', { class: 'gnav', id: 'gnav', 'aria-label': 'Pages' });
      fillNav(box);
      return box;
    }
    function fillNav(box) {
      box.textContent = '';
      const high = S.dockerPct !== null && S.dockerPct >= 85;
      const atHome = !S.page && S.active === 'home';
      add(box,
        h('button', { class: 'gbtn' + (atHome ? ' on' : ''), 'aria-pressed': String(atHome), onclick: () => { if (S.page) openPage(null); X.activate('home'); } },
          X.icon('home'), 'Home'),
        h('button', { class: 'gbtn' + (S.page === 'worktrees' ? ' on' : ''), 'aria-pressed': String(S.page === 'worktrees'), onclick: () => openPage(S.page === 'worktrees' ? null : 'worktrees') },
          svg(BRANCH), 'Worktrees', S.wt.list.length ? h('span', { class: 'count' }, String(S.wt.list.length)) : null),
        h('button', { class: 'gbtn' + (S.page === 'monitor' ? ' on' : ''), 'aria-pressed': String(S.page === 'monitor'), onclick: () => openPage(S.page === 'monitor' ? null : 'monitor') },
          svg(PULSE), 'Monitor', S.dockerPct !== null ? h('span', { class: 'pill dotted ' + (high ? 'warn' : 'down'), title: 'Docker memory in use' }, 'Docker ' + S.dockerPct + '%') : null));
    }
    function renderNav() { const box = document.getElementById('gnav'); if (box) fillNav(box); }

    function openPage(page) {
      const was = S.page;
      S.page = page;
      document.getElementById('app').classList.toggle('global', !!page);
      if (was === 'monitor' && page !== 'monitor') X.send({ t: 'monitor', on: false });
      if (page === 'monitor') { X.send({ t: 'monitor', on: true }); loadMonitor(); }
      if (page === 'worktrees') load();
      renderNav();
      if (page) renderGlobal(); else X.activate(S.active);
    }

    function renderGlobal() {
      const box = document.getElementById('global');
      if (!S.page) { box.textContent = ''; return; }
      const scroll = box.scrollTop;
      box.textContent = '';
      add(box, S.page === 'worktrees' ? worktreesPage() : monitorPage());
      box.scrollTop = scroll;
    }

    // ---------- Worktrees page ----------
    function worktreesPage() {
      const page = h('main', { class: 'page', 'aria-label': 'Worktrees', style: 'max-width:1400px' });
      const main = mainOf(S.project);
      add(page, h('div', { class: 'section-head', style: 'align-items:flex-start' },
        h('div', { style: 'display:flex;flex-direction:column;gap:4px' }, h('h1', {}, 'Worktrees'),
          h('span', { class: 'sub' }, 'One folder per branch, each with its own backend, frontend, Redis and ports. Postgres and the other services are shared.')),
        h('button', { class: 'btn primary', onclick: () => newDialog(main), disabled: !main || !S.wt.mains.includes(main) }, '+ New worktree')));
      if (!S.wt.loaded) { add(page, h('span', { class: 'sub' }, 'Loading…')); return page; }
      if (!S.wt.docker) add(page, h('div', { class: 'banner err', role: 'alert' }, h('b', {}, 'Docker is not running'), h('span', {}, S.wt.dockerError || 'Start Docker Desktop, then come back.')));
      if (!S.wt.mains.length) add(page, h('div', { class: 'banner' }, h('span', {}, 'None of your projects has a docker-compose.yml. Add the Rails project from the Project menu.')));

      for (const m of S.wt.mains) {
        const sh = S.wt.shared[m] || { services: [], running: 0, total: 0 };
        const mp = S.projects.find((p) => p.path === m);
        add(page, h('section', { class: 'card', style: 'padding:14px 18px;display:flex;flex-direction:column;gap:10px', 'aria-label': 'Shared services of ' + baseName(m) },
          h('div', { class: 'section-head', style: 'align-items:center' },
            h('div', { class: 'row-gap' }, h('h2', {}, 'Shared services'), h('span', { class: 'faint' }, `from ${tilde(m)}` + (sh.project ? ` · docker-compose project “${sh.project}”` : ''))),
            h('div', { class: 'row-gap' },
              h('span', { class: 'pill dotted ' + (sh.total && sh.running === sh.total ? 'up' : sh.running ? 'warn' : 'down') }, `${sh.running} / ${sh.total} up`),
              sh.running < sh.total ? h('button', { class: 'btn sm primary', onclick: () => sharedAction(m, 'start') }, '▶ Start shared') : null,
              sh.running ? h('button', { class: 'btn sm', onclick: () => sharedAction(m, 'stop') }, 'Stop shared') : null,
              h('button', { class: 'btn sm', onclick: () => sharedAction(m, 'logs') }, 'Logs'))),
          sh.error ? h('span', { class: 'sub', style: 'color:var(--errText)' }, sh.error) : null,
          h('div', { class: 'services' }, sh.services.map((s) => h('span', { class: 'svc', title: s.state }, h('span', { class: 'dot', style: `width:7px;height:7px;background:var(${s.state === 'running' ? '--okDot' : s.state === 'missing' ? '--faint' : '--warnDot'})` }), s.service)))));

        for (const b of S.wt.banner.filter((x) => x.main === m)) {
          add(page, h('div', { class: 'banner warn', role: 'status' },
            h('b', {}, 'Shared DB is ahead of main'),
            h('span', { style: 'flex:1 1 320px' }, `${b.migrations.length} migration${b.migrations.length > 1 ? 's' : ''} from `, h('b', {}, b.key), ' ran on the shared database: ',
              b.migrations.map((x) => h('code', { style: 'margin-right:6px' }, x.file.replace(/\.rb$/, ''))),
              h('br'), h('span', { style: 'font-size:12px' }, 'Running db:migrate in main before rolling back writes it into main’s db/schema.rb.')),
            h('button', { class: 'btn sm', onclick: () => rollback(b.id) }, 'Roll back')));
        }

        const kids = S.wt.list.filter((w) => w.main === m);
        const me = S.wt.mainEnvs.find((x) => x.main === m);
        add(page, h('div', { class: 'wt-grid' }, me ? wtCard(me) : null, kids.map(wtCard)));
        if (!kids.length) add(page, h('div', { class: 'banner' }, h('span', {}, 'No worktrees yet. “+ New worktree” checks out a branch into its own folder, with its own ports.')));
      }
      return page;
    }

    function wtCard(w) {
      const st = w.status || {};
      const p = S.projects.find((x) => x.path === w.path);
      const sessions = [...S.sessions.values()].filter((s) => s.project === w.path && s.alive);
      const backendPort = (w.ports || []).find((x) => x.main === 3000) || (w.ports || [])[0];
      const db = w.isMain ? 'Its own' + (w.db.test ? ' + test' : '') : (w.db.mode === 'shared' ? 'Shared' : w.db.mode === 'fresh' ? 'Fresh · own' : 'Private copy') + (w.db.test ? ' + own test' : '');
      const anyUp = bstate(w) !== 'down' || fstate(w) === 'up';
      return h('article', { class: 'card wt-card', 'aria-label': w.key },
        h('div', { class: 'section-head', style: 'align-items:flex-start;flex-wrap:nowrap' },
          h('div', { style: 'display:flex;flex-direction:column;gap:2px;min-width:0' },
            h('button', { class: 'title', onclick: () => { openPage(null); X.switchProject(w.path).then(() => X.activate('env')); } }, w.isMain ? w.key + ' · main checkout' : w.key + (titleOf(w.key) ? ' · ' + titleOf(w.key) : '')),
            h('span', { class: 'faint mono', style: 'overflow-wrap:anywhere' }, '⎇ ' + (st.git ? st.git.branch : w.branch || ''))),
          h('span', { class: 'chip' }, w.isMain ? 'main' + (w.autoStart ? ' · starts with the dashboard' : '') : 'slot ' + w.slot)),
        st.exists === false ? h('div', { class: 'banner err' }, h('span', {}, 'The folder is gone: ' + tilde(w.path) + ' — delete this worktree to clean up the rest.')) : null,
        h('div', { class: 'wt-boxes' },
          h('div', { class: 'wt-box' }, h('span', { class: 'faint' }, 'Backend' + (backendPort ? ' · :' + backendPort.port : '')), statePill(bstate(w))),
          h('div', { class: 'wt-box' }, h('span', { class: 'faint' }, 'Frontend' + (w.frontend ? ' · :' + w.frontend.port : '')), w.frontend ? statePill(fstate(w)) : h('span', { class: 'faint' }, 'none')),
          h('div', { class: 'wt-box' }, h('span', { class: 'faint' }, 'Database'), h('b', {}, db))),
        w.isMain && st.backend ? h('span', { class: 'faint' }, `${st.backend.allRunning || 0} / ${st.backend.all || 0} services running (shared ones included)`) : null,
        w.sharedMigrations.length ? h('span', { class: 'pill dotted warn', style: 'align-self:flex-start' }, `Ran ${w.sharedMigrations.length} migration${w.sharedMigrations.length > 1 ? 's' : ''} on the shared DB`) : null,
        st.git && (st.git.dirty || st.git.unpushed) ? h('div', { class: 'row-gap' }, st.git.dirty ? h('span', { class: 'pill dotted warn' }, st.git.dirty + ' uncommitted') : null, st.git.unpushed ? h('span', { class: 'pill dotted warn' }, st.git.unpushed + ' not pushed') : null) : null,
        h('div', { class: 'section-head', style: 'align-items:center' },
          h('span', { class: 'faint' }, sessions.length ? `${sessions.length} Claude session${sessions.length > 1 ? 's' : ''} running here` : 'No Claude session running'),
          h('div', { class: 'row-gap', style: 'gap:6px' },
            fstate(w) === 'up' && w.url ? h('a', { class: 'btn sm', href: w.url, target: '_blank', rel: 'noopener' }, w.url.replace(/^https?:\/\//, '') + ' ↗') : null,
            st.exists !== false ? editorBtn(w.path, st.editor, true) : null,
            anyUp ? h('button', { class: 'btn sm', onclick: () => stopWt(w.id) }, 'Stop') : h('button', { class: 'btn sm primary', onclick: () => runStep(w.id, 'all') }, '▶ Start all'),
            p && p.path !== S.project ? h('button', { class: 'btn sm', onclick: () => { openPage(null); X.switchProject(w.path); } }, 'Switch to') : null,
            p ? h('button', { class: 'btn sm', 'aria-label': 'Open ' + w.key + ' in a new browser tab', onclick: () => newTab(p) }, '↗ New tab') : null)));
    }

    // Opens the checkout's folder in VS Code (or the "editor" setting) on this machine — Source Control shows its changes.
    const editorName = (ed) => (ed ? String(ed).trim().split(/\s+/)[0].split('/').pop() : 'VS Code');
    async function openEditor(dir, ed) {
      try { await api('POST', '/api/open-editor', { path: dir }); toast({ title: 'Opened in ' + editorName(ed), body: tilde(dir), timeout: 2500 }); }
      catch (e) { toast({ title: 'Could not open ' + editorName(ed), body: apiError(e), timeout: 10000 }); }
    }
    const editorBtn = (dir, ed, sm) => h('button', { class: 'btn' + (sm ? ' sm' : ''), title: 'Open ' + tilde(dir) + ' in ' + editorName(ed) + ' to see its changes', onclick: () => openEditor(dir, ed) }, '</> ' + (sm ? editorName(ed) : 'Open in ' + editorName(ed)));

    async function sharedAction(main, action) {
      try {
        const r = await api('POST', '/api/shared/' + action, { project: main });
        if (action === 'logs') X.openProc(r.proc.id);
        else toast({ small: true, title: action === 'start' ? 'Starting shared services…' : 'Stopping shared services…', timeout: 2500 });
      } catch (e) { toast({ title: 'Shared services', body: apiError(e), timeout: 8000 }); }
    }

    // ---------- steps ----------
    async function runStep(id, step, opts) {
      try {
        const r = await api('POST', `/api/worktrees/${id}/step`, Object.assign({ step }, opts || {}));
        if (r.proc && (step === 'bash' || step === 'logs')) X.openProc(r.proc.id);
        else if (r.started) toast({ small: true, title: 'Starting everything: migrate → up → install → vite', timeout: 3000 });
        loadDetail(id); load();
        return r;
      } catch (e) {
        const d = e.data || {};
        if (e.status === 409 && d.needsChoice) return migrateDialog(id, step, d, opts);
        if (e.status === 409 && d.confirm) return confirmDialog('Start anyway?', d.message, 'Start anyway', () => runStep(id, step, Object.assign({}, opts, { forceStart: true })));
        toast({ title: 'Could not run ' + step, body: apiError(e), timeout: 9000 });
      }
    }
    async function stopWt(id) {
      toast({ small: true, title: 'Stopping…', timeout: 2000 });
      try {
        const r = await api('POST', `/api/worktrees/${id}/stop`);
        if (r.keptShared && r.keptShared.length) toast({ title: 'Stopped — shared services kept running', body: 'Postgres and the other shared services are used by ' + r.keptShared.join(', ') + '. Stop them on the Worktrees page when nothing needs them.', timeout: 8000 });
        else toast({ small: true, title: r.ok ? 'Stopped' : 'Stop finished with errors — see its output', timeout: 3000 });
      } catch (e) { toast({ title: 'Could not stop', body: apiError(e), timeout: 8000 }); }
      load(); loadDetail(id);
    }
    async function rollback(id) {
      toast({ small: true, title: 'Rolling back on the shared database…', timeout: 3000 });
      try { const r = await api('POST', `/api/worktrees/${id}/rollback`); toast({ small: true, title: 'Rolled back ', mono: r.rolledBack.join(', '), timeout: 4000 }); }
      catch (e) { toast({ title: 'Roll back failed', body: apiError(e), timeout: 9000 }); }
      load(); loadDetail(id);
    }
    async function setDb(id, mode) {
      toast({ small: true, title: mode === 'shared' ? 'Switching to the shared database…' : mode === 'refresh-test' ? 'Copying the test database…' : 'Copying the shared database…', timeout: 3000 });
      try { await api('POST', `/api/worktrees/${id}/db`, { mode }); toast({ small: true, title: 'Done — start the backend again to use it.', timeout: 4000 }); }
      catch (e) { toast({ title: 'Database', body: apiError(e), timeout: 9000 }); }
      load(); loadDetail(id);
    }

    // ---------- dialogs ----------
    function dialog(cls, build) {
      const dlg = h('dialog', { class: cls || '' });
      const close = () => { try { dlg.close(); } catch {} dlg.remove(); };
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
      add(document.body, dlg);
      build(dlg, close);
      dlg.showModal();
      return { dlg, close };
    }
    function confirmDialog(title, message, okLabel, ok) {
      dialog('confirm', (dlg, close) => {
        add(dlg, h('div', { class: 'confirm-body' }, h('span', { class: 'confirm-icon', 'aria-hidden': 'true', style: 'background:var(--warnSoft);color:var(--warnText)' }, '!'),
          h('div', {}, h('h2', {}, title), h('p', {}, message))),
        h('div', { class: 'confirm-actions' }, h('button', { class: 'btn big', onclick: close }, 'Cancel'), h('button', { class: 'btn big primary', onclick: () => { close(); ok(); } }, okLabel)));
        dlg.querySelector('.btn.big').focus();
      });
    }

    function migrateDialog(id, step, d, opts) {
      dialog('wide', (dlg, close) => {
        const ms = d.migrations || [];
        add(dlg, h('div', { class: 'dlg', role: 'document' },
          h('h2', {}, ms.length > 1 ? 'This branch has its own migrations' : 'This branch has its own migration'),
          h('p', { class: 'sub', style: 'margin:0' }, 'Running ', ms.length > 1 ? 'them' : 'it', ' on the ', h('b', {}, 'shared'), ` database${d.sharedDb ? ' (' + d.sharedDb + ')' : ''} changes the schema for main and every other worktree.`),
          h('div', { style: 'display:flex;flex-direction:column;gap:4px' }, ms.map((m) => h('code', { style: 'align-self:flex-start' }, m.file))),
          h('div', { style: 'display:flex;flex-direction:column;gap:8px' },
            h('button', { class: 'btn primary choice', onclick: async () => { close(); await setDb(id, 'copy'); runStep(id, step, opts); } },
              h('span', {}, h('b', {}, 'Make a private copy, then migrate'), h('span', { style: 'font-weight:400;opacity:.85' }, ' · shared stays clean'))),
            h('button', { class: 'btn choice', onclick: () => { close(); runStep(id, step, Object.assign({}, opts, { force: true })); } },
              h('span', {}, h('b', {}, 'Run on shared anyway'), h('span', { class: 'faint' }, ' · remembered, with a Roll back button'))),
            h('button', { class: 'btn choice', onclick: close }, 'Cancel'))));
        dlg.querySelector('.btn.primary').focus();
      });
    }

    async function newDialog(main) {
      if (!main) return;
      let info;
      try { info = await api('GET', '/api/worktrees/inspect?' + qs({ project: main })); }
      catch (e) { return toast({ title: 'Cannot create a worktree here', body: apiError(e), timeout: 9000 }); }
      const st = { mode: 'copy', branch: null, newBranch: '', base: 'HEAD', folderEdited: false, name: '', nameEdited: false, start: true, newTabAfter: true, services: info.services.map((s) => s.name), busy: false, source: info.sharedDb, testSource: info.sharedTestDb || '' };
      const focus = X.focusKey();
      const local = new Map(info.branches.map((b) => [b.name, b]));
      const planned = info.planBranches.filter((b, i, a) => a.findIndex((x) => x.name === b.name) === i);
      const free = (name) => !(local.get(name) && local.get(name).openAt);
      const pick = planned.find((b) => b.key === focus && free(b.name)) || planned.find((b) => free(b.name)) || info.branches.find((b) => free(b.name));
      st.branch = pick ? pick.name : '__new';
      if (!info.databases.length) st.mode = 'shared';
      const keyOf = (b) => ((b.match(/[A-Z][A-Z0-9]+-\d+/) || [])[0] || b.split('/').pop());
      const nameFor = () => (st.nameEdited ? st.name : keyOf(st.branch === '__new' ? st.newBranch || 'new' : st.branch));
      const folderFor = () => info.folderBase + '/' + nameFor();
      dialog('wide', (dlg, close) => {
        const body = h('div', { class: 'dlg' });
        add(dlg, body);
        const render = () => {
          const folderInput = body.querySelector('[data-k="folder"]');
          const folder = folderInput && st.folderEdited ? folderInput.value : folderFor();
          body.textContent = '';
          const branchSel = h('select', { class: 'select mono', 'aria-label': 'Branch', onchange: (e) => { st.branch = e.target.value; render(); } },
            planned.length ? h('optgroup', { label: 'From your plans' }, planned.map((b) => { const lb = local.get(b.name); return h('option', { value: b.name, selected: st.branch === b.name, disabled: !!(lb && lb.openAt) }, `${b.name} — ${b.key}${b.title ? ' · ' + b.title : ''}${lb ? (lb.openAt ? ' · open in ' + tilde(lb.openAt) : '') : ' · new branch'}`); })) : null,
            h('optgroup', { label: 'Local branches' }, info.branches.filter((b) => !planned.some((p) => p.name === b.name)).map((b) => h('option', { value: b.name, selected: st.branch === b.name, disabled: !!b.openAt }, b.name + (b.openAt ? ' — already open in ' + tilde(b.openAt) : '')))),
            h('option', { value: '__new', selected: st.branch === '__new' }, '+ New branch…'));
          const opt = (mode, title, note, extra) => h('label', { class: 'opt' + (st.mode === mode ? ' on' : '') },
            h('input', { type: 'radio', name: 'db', checked: st.mode === mode, disabled: mode !== 'shared' && !info.databases.length && mode === 'copy', onchange: () => { st.mode = mode; render(); } }),
            h('span', {}, h('b', {}, title), extra || null, h('br'), h('span', { class: 'faint' }, note)));
          const vite = info.vitePort;
          const portLine = info.ports.filter((p) => [3000, 8080].includes(p.main) || p.service === 'web').slice(0, 3).map((p) => `${p.service} :${p.port}`).join(' · ');
          add(body,
            h('div', { class: 'section-head', style: 'align-items:center' }, h('h2', {}, 'New worktree'), h('button', { class: 'btn icon', 'aria-label': 'Close', onclick: close }, '×')),
            h('label', { class: 'field' }, h('span', {}, 'Branch'), branchSel,
              h('span', { class: 'faint' }, 'A branch can be open in only one folder at a time (git rule), so branches already open elsewhere are greyed out.')),
            st.branch === '__new' ? h('div', { class: 'row-gap', style: 'align-items:flex-end' },
              h('label', { class: 'field', style: 'flex:2 1 240px' }, h('span', {}, 'New branch name'), h('input', { class: 'input', 'data-k': 'newBranch', value: st.newBranch, placeholder: 'feature/PROJ-123-short-name', oninput: (e) => { st.newBranch = e.target.value; if (!st.folderEdited) { const f = body.querySelector('[data-k="folder"]'); if (f) f.value = folderFor(); } } })),
              h('label', { class: 'field', style: 'flex:1 1 140px' }, h('span', {}, 'From'), h('select', { class: 'select', onchange: (e) => { st.base = e.target.value; } }, ['HEAD'].concat(info.branches.map((b) => b.name)).map((b) => h('option', { value: b, selected: st.base === b }, b === 'HEAD' ? 'current branch of main' : b))))) : null,
            h('label', { class: 'field' }, h('span', {}, 'Name'),
              h('input', { class: 'input', 'data-k': 'name', value: nameFor(), placeholder: 'PROJ-123', oninput: (e) => { st.name = e.target.value; st.nameEdited = true; if (!st.folderEdited) { const f = body.querySelector('[data-k="folder"]'); if (f) f.value = folderFor(); } } }),
              h('span', { class: 'faint' }, 'The worktree’s own name — its folder, databases and tab. You can check out other branches in it later.')),
            h('label', { class: 'field' }, h('span', {}, 'Folder'), h('input', { class: 'input', 'data-k': 'folder', value: folder, oninput: () => { st.folderEdited = true; } })),
            h('div', { class: 'field' }, h('span', {}, 'Database'),
              opt('shared', 'Shared', 'Same data as main. Fine when the branch has no migrations.'),
              opt('copy', 'Private copy of shared', 'Copied once, then yours: migrate and test freely.' + (info.databases.length ? '' : ' (start the shared services first)'), h('span', { class: 'pill accent', style: 'margin-left:6px' }, 'recommended for migrations')),
              opt('fresh', 'Fresh', 'Empty database, set up with db:setup on the first migrate.'),
              info.databases.length ? h('label', { class: 'field' }, h('span', { class: 'faint', style: 'font-weight:400' }, st.mode === 'copy' ? 'Copy from' : 'Shared database (for migration checks)'),
                h('select', { class: 'select mono', onchange: (e) => { st.source = e.target.value; } }, info.databases.map((d) => h('option', { value: d.name, selected: d.name === st.source }, `${d.name} · ${fmtBytes(d.size)}`)))) : null,
              info.testDb ? h('label', { class: 'field' }, h('span', { class: 'faint', style: 'font-weight:400' }, 'Test database — always its own, copied from'),
                h('select', { class: 'select mono', onchange: (e) => { st.testSource = e.target.value; } },
                  info.databases.map((d) => h('option', { value: d.name, selected: d.name === st.testSource }, `${d.name} · ${fmtBytes(d.size)}`)),
                  h('option', { value: '', selected: !st.testSource }, '— none: start empty, load the schema on the first migrate'))) : null,
              !info.pgRunning ? h('div', { class: 'banner warn' }, h('span', { style: 'flex:1 1 200px' }, info.dockerError || 'The shared Postgres is not running.'), h('button', { class: 'btn sm', onclick: async () => { await sharedAction(main, 'start'); close(); setTimeout(() => newDialog(main), 6000); } }, 'Start shared services')) : null),
            h('details', { class: 'svcs' }, h('summary', {}, `Runs in this worktree: ${st.services.join(', ')}`),
              h('div', { style: 'display:flex;flex-direction:column;padding-top:6px' }, info.services.map((s) => h('label', { class: 'check' },
                h('input', { type: 'checkbox', checked: st.services.includes(s.name), onchange: (e) => { st.services = e.target.checked ? st.services.concat(s.name) : st.services.filter((x) => x !== s.name); render(); } }),
                h('span', {}, h('b', { class: 'mono' }, s.name), h('span', { class: 'faint' }, ' · ' + s.why))))),
              h('span', { class: 'faint' }, 'Shared: ' + info.shared.join(', '))),
            info.slot ? h('div', { class: 'row-gap faint' }, h('span', { class: 'chip' }, 'slot ' + info.slot), [portLine, vite ? 'vite :' + vite : null, 'own Redis'].filter(Boolean).join(' · ')) : h('div', { class: 'banner warn' }, 'No free port slot.'),
            h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.start, onchange: (e) => { st.start = e.target.checked; } }), h('span', {}, 'Start everything after creating it (migrate → up → yarn install → vite)')),
            h('label', { class: 'check', style: 'padding-top:0' }, h('input', { type: 'checkbox', checked: st.newTabAfter, onchange: (e) => { st.newTabAfter = e.target.checked; } }), h('span', {}, 'Open it in a new browser tab — it shows up in the project list')),
            h('div', { class: 'err sub', style: 'color:var(--errText)', 'data-k': 'err' }),
            h('div', { class: 'row-gap', style: 'justify-content:flex-end' },
              h('button', { class: 'btn', onclick: close }, 'Cancel'),
              h('button', { class: 'btn primary', 'data-k': 'create', disabled: st.busy || !info.slot, onclick: async (e) => {
                const errEl = body.querySelector('[data-k="err"]');
                const btn = e.currentTarget;
                st.busy = true; btn.disabled = true; btn.textContent = st.mode === 'copy' ? 'Creating — copying the database…' : 'Creating…';
                try {
                  const r = await api('POST', '/api/worktrees', {
                    main, name: body.querySelector('[data-k="name"]').value.trim(), branch: st.branch === '__new' ? null : st.branch, newBranch: st.branch === '__new' ? st.newBranch : null, base: st.base,
                    folder: body.querySelector('[data-k="folder"]').value, dbMode: st.mode, sourceDb: st.source, sourceTestDb: st.testSource || null, services: st.services, start: st.start
                  });
                  close();
                  await X.loadProjects();
                  await load();
                  toast({ small: true, title: 'Worktree created ', mono: r.worktree.key + ' · ' + tilde(r.worktree.path), timeout: 4000 });
                  if (st.newTabAfter) { X.renderTopbar(); newTab(r.project); }
                  else { openPage(null); await X.switchProject(r.worktree.path); X.activate('env'); }
                } catch (x) {
                  st.busy = false; btn.disabled = false; btn.textContent = 'Create worktree';
                  errEl.textContent = apiError(x);
                }
              } }, 'Create worktree')));
        };
        render();
      });
    }

    async function deleteDialog(id) {
      let plan;
      try { plan = await api('GET', `/api/worktrees/${id}/delete-plan`); } catch (e) { return toast({ title: 'Cannot delete', body: apiError(e), timeout: 8000 }); }
      const w = plan.record;
      const g = plan.git || { dirty: 0, unpushed: 0 };
      const st = { ack: false, dropDb: true, rollback: plan.sharedMigrations.length > 0, branch: false, busy: false };
      // uncommitted work is always lost; commits no other branch has only when the branch goes too
      const risky = () => g.dirty > 0 || (st.branch && g.unpushed > 0);
      dialog('wide', (dlg, close) => {
        const body = h('div', { class: 'dlg' });
        add(dlg, body);
        const render = () => {
          body.textContent = '';
          const freed = (plan.sizes.folder || 0) + (w.db.name && st.dropDb ? plan.sizes.db || 0 : 0) + (plan.sizes.testDb || 0);
          add(body,
            h('h2', {}, `Delete worktree ${w.key}?`),
            risky() ? h('div', { class: 'banner err' }, h('span', { style: 'flex:1 1 260px' },
              g.dirty ? h('b', {}, `${g.dirty} uncommitted change${g.dirty > 1 ? 's' : ''}`) : null, g.dirty && st.branch && g.unpushed ? ' and ' : '',
              st.branch && g.unpushed ? h('b', {}, `${g.unpushed} commit${g.unpushed > 1 ? 's' : ''} not pushed`) : null,
              ' on ', h('span', { class: 'mono' }, g.branch || w.branch), ' would be lost.'),
            h('button', { class: 'btn sm', onclick: () => { close(); X.switchProject(w.path).then(() => X.startSession('Commit the changes in this worktree as logical commits and push the branch.', 'commit · ' + w.key, w.key)); } }, 'Commit & push first')) : null,
            h('div', { style: 'display:flex;flex-direction:column' },
              h('span', { class: 'faint', style: 'padding-bottom:4px' }, 'This removes'),
              h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: true, disabled: true }), h('span', {}, 'Containers: ' + w.services.join(', '))),
              h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: true, disabled: true }), h('span', {}, 'Docker volumes' + (plan.volumes.length ? ': ' + plan.volumes.map((v) => v.replace('bd-' + w.id + '_', '')).join(', ') : '') + ' and its network')),
              w.db.name ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.dropDb, onchange: (e) => { st.dropDb = e.target.checked; render(); } }),
                h('span', {}, 'Private database ', h('span', { class: 'mono' }, w.db.name), h('span', { class: 'faint' }, plan.sizes.db ? ' · ' + fmtBytes(plan.sizes.db) : ''))) : null,
              w.db.test ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: true, disabled: true }),
                h('span', {}, 'Test database ', h('span', { class: 'mono' }, w.db.test.name), h('span', { class: 'faint' }, plan.sizes.testDb ? ' · ' + fmtBytes(plan.sizes.testDb) : ''))) : null,
              h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: true, disabled: true }), h('span', {}, 'Folder ', h('span', { class: 'mono' }, tilde(w.path)), ' incl. node_modules', h('span', { class: 'faint' }, plan.sizes.folder ? ' · ' + fmtBytes(plan.sizes.folder) : ''))),
              h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: true, disabled: true }), h('span', {}, `Generated compose + vite config, port slot ${w.slot}`)),
              plan.sharedMigrations.length ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.rollback, onchange: (e) => { st.rollback = e.target.checked; } }),
                h('span', {}, `Roll back its ${plan.sharedMigrations.length} migration${plan.sharedMigrations.length > 1 ? 's' : ''} on the shared database`)) : null,
              h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.branch, onchange: (e) => { st.branch = e.target.checked; st.ack = false; render(); } }),
                h('span', {}, 'Also delete the local branch ', h('span', { class: 'mono' }, g.branch || w.branch), h('span', { class: 'faint' }, g.unpushed ? ` · has ${g.unpushed} commit${g.unpushed > 1 ? 's' : ''} not pushed` : ' · kept by default')))),
            risky() ? h('label', { class: 'check', style: 'border-top:1px solid var(--line2);padding-top:12px' }, h('input', { type: 'checkbox', checked: st.ack, onchange: (e) => { st.ack = e.target.checked; render(); } }), h('span', {}, g.dirty ? 'I understand the uncommitted work is lost' : 'I understand those commits are lost')) : null,
            h('div', { class: 'result', 'data-k': 'result' }),
            h('div', { class: 'section-head', style: 'align-items:center' }, h('span', { class: 'faint' }, 'Frees about ' + fmtBytes(freed)),
              h('div', { class: 'row-gap' }, h('button', { class: 'btn', onclick: close }, 'Cancel'),
                h('button', { class: 'btn end', disabled: (risky() && !st.ack) || st.busy, onclick: async (e) => {
                  const btn = e.currentTarget; st.busy = true; btn.disabled = true; btn.textContent = 'Deleting…';
                  try {
                    const r = await api('POST', `/api/worktrees/${id}/delete`, { force: risky() && st.ack, dropDb: st.dropDb, rollback: st.rollback, deleteBranch: st.branch });
                    close();
                    toast({ title: r.ok ? `Deleted ${w.key}` : `Deleted ${w.key}, with problems`, body: r.steps.map((s) => (s.ok ? '✓ ' : '✗ ') + s.label + (s.detail ? ' — ' + s.detail : '')).join('\n'), timeout: r.ok ? 6000 : 0, actions: [{ label: 'OK' }] });
                    if (S.project === w.path) await X.switchProject(w.main);
                    await X.loadProjects(); X.renderTopbar(); load();
                  } catch (x) {
                    st.busy = false; btn.disabled = false; btn.textContent = 'Delete worktree';
                    body.querySelector('[data-k="result"]').textContent = apiError(x);
                  }
                } }, 'Delete worktree'))));
        };
        render();
      });
    }

    // ---------- Home strip + Environment tab ----------
    function envStrip() {
      const w = curWt();
      if (!w) return null;
      const st = w.status || {};
      const port = (w.ports || []).find((x) => x.main === 3000) || (w.ports || [])[0];
      return h('section', { class: 'card envstrip', id: 'envstrip', 'aria-label': 'Environment' },
        h('span', { class: 'row-gap' }, svg(w.isMain ? FOLDER : BRANCH), h('b', {}, w.isMain ? w.key + ' · main' : w.key), h('span', { class: 'faint mono' }, (st.git ? st.git.branch : w.branch || '') + (w.isMain ? '' : ' · slot ' + w.slot))),
        h('span', { class: 'row-gap', style: 'gap:6px' },
          statePill(bstate(w), 'Backend' + (port ? ' :' + port.port : '')), w.frontend ? statePill(fstate(w), 'Frontend :' + w.frontend.port) : null,
          w.isMain ? null : h('span', { class: 'chip' }, w.db.mode === 'shared' ? 'DB shared' : 'DB private'), w.isMain ? null : h('span', { class: 'chip' }, 'own Redis')),
        h('span', { style: 'flex:1' }),
        h('span', { class: 'row-gap', style: 'gap:6px' },
          w.url ? h('a', { class: 'btn sm' + (fstate(w) === 'up' ? ' primary' : ''), href: w.url, target: '_blank', rel: 'noopener' }, 'Open ' + w.url.replace(/^https?:\/\//, '') + ' ↗') : null,
          bstate(w) !== 'down' || fstate(w) === 'up' ? h('button', { class: 'btn sm', onclick: () => stopWt(w.id) }, '■ Stop') : h('button', { class: 'btn sm', onclick: () => runStep(w.id, 'all') }, '▶ Start all'),
          h('button', { class: 'btn sm', onclick: () => X.activate('env') }, 'Environment →')));
    }

    function stepRow(n, title, cmd, note, s, actions) {
      const state = s ? s.status : null;
      const cls = state === 'ok' ? 'ok' : state === 'running' ? 'running' : state === 'failed' ? 'failed' : '';
      return h('div', { class: 'step' },
        h('span', { class: 'num ' + cls, 'aria-hidden': 'true' }, state === 'ok' ? '✓' : state === 'failed' ? '✗' : String(n)),
        h('div', { class: 'body' },
          h('b', {}, title), h('code', { title: cmd }, cmd),
          h('span', { class: 'faint' }, s ? (state === 'running' ? 'Running… ' : state === 'ok' ? 'Done ' + ago(s.endedAt) + ' ago' : state === 'failed' ? `Failed (exit ${s.exitCode}) ` + ago(s.endedAt) + ' ago' : 'Stopped') + (note ? ' · ' + note : '') : note || '')),
        h('div', { class: 'row-gap', style: 'gap:6px' }, actions, s ? h('button', { class: 'btn sm', onclick: () => X.openProc(s.procId) }, 'Output') : null));
    }

    function renderEnv() {
      const v = X.viewEl('env');
      if (!v.classList.contains('on')) return;
      const w = curWt();
      if (!w) { v.textContent = ''; return; }
      const d = S.wt.detail[w.id];
      const scroll = v.scrollTop;
      v.textContent = '';
      const page = h('main', { class: 'page', 'aria-label': 'Environment of ' + w.key, style: 'max-width:1400px' });
      add(v, page);
      if (!d) { add(page, h('span', { class: 'sub' }, 'Loading…')); loadDetail(w.id); return; }
      if (d.error) { add(page, h('div', { class: 'banner err' }, d.error)); return; }
      const rec = d.record;
      const s = d.settings || {};
      const svc = rec.services.includes('web') ? 'web' : rec.services[0];
      const port = (rec.ports || []).find((x) => x.main === 3000) || (rec.ports || [])[0];
      const branchOnly = d.migrations || [];
      const pending = branchOnly.filter((m) => !m.applied);
      const bs = d.backend ? d.backend.state : 'down';
      const fs = d.frontend ? d.frontend.state : 'down';
      add(page,
        h('div', { class: 'section-head', style: 'align-items:flex-start' },
          h('div', { style: 'display:flex;flex-direction:column;gap:4px;min-width:0' },
            h('span', { class: 'faint' }, `Environment · ${tilde(rec.path)}` + (rec.isMain ? ' · main checkout' : ` · slot ${rec.slot}`)),
            h('h1', {}, rec.isMain ? rec.key + ' · main checkout' : rec.key + (titleOf(rec.key) ? ' · ' + titleOf(rec.key) : '')),
            h('span', { class: 'mono sub' }, '⎇ ' + (d.git ? d.git.branch : rec.branch))),
          h('div', { class: 'row-gap' },
            d.url ? h('a', { class: 'btn' + (fs === 'up' ? ' primary' : ''), href: d.url, target: '_blank', rel: 'noopener' }, 'Open ' + d.url.replace(/^https?:\/\//, '') + ' ↗') : null,
            editorBtn(rec.path, s.editor),
            h('button', { class: 'btn', onclick: () => runStep(rec.id, 'all') }, '▶ Start all'),
            h('button', { class: 'btn', onclick: () => stopWt(rec.id), disabled: bs === 'down' && fs === 'down' }, '■ Stop all'))),
        d.dockerError ? h('div', { class: 'banner err' }, h('b', {}, 'Docker'), h('span', {}, d.dockerError)) : null,
        !d.pgRunning && !d.dockerError && !rec.isMain ? h('div', { class: 'banner warn' }, h('span', { style: 'flex:1 1 240px' }, 'The shared services are not running — the backend needs them.'), h('button', { class: 'btn sm', onclick: () => sharedAction(rec.main, 'start') }, '▶ Start shared')) : null,
        rec.isMain ? h('label', { class: 'check', style: 'padding:0' }, h('input', { type: 'checkbox', checked: !!rec.autoStart, onchange: async (e) => { try { await api('POST', `/api/worktrees/${rec.id}/settings`, { autoStart: e.target.checked }); } catch (x) { toast({ title: 'Setting', body: apiError(x), timeout: 6000 }); } load(); loadDetail(rec.id); } }),
          h('span', {}, 'Start everything (migrate → ', h('code', {}, 'docker compose up'), ' → ', h('code', {}, (rec.frontend && rec.frontend.run) || 'yarn start'), ') when the dashboard starts')) : null);

      const grid = h('div', { class: 'wt-grid' });
      add(page, grid);
      add(grid,
        h('section', { class: 'card', style: 'padding:14px 18px', 'aria-label': 'Backend' },
          h('div', { class: 'section-head', style: 'align-items:center;padding-bottom:4px' }, h('h2', {}, 'Backend'), statePill(bs, { up: 'Up', partial: 'Partly up', down: 'Stopped' }[bs] + (port ? ' · :' + port.port : ''))),
          h('div', { class: 'steps' },
            stepRow(1, 'Open web bash · pulls new images', `docker compose run ${svc} ${s.bash || 'bash'}`, 'an interactive shell in a tab', d.steps.bash, h('button', { class: 'btn sm', onclick: () => runStep(rec.id, 'bash') }, 'Open bash')),
            stepRow(2, (rec.db.mode === 'fresh' && !rec.db.ready ? 'Set up + migrate' : 'Migrate') + (rec.db.test ? ' · development + test' : ''), d.migrateScript || s.migrate,
              (branchOnly.length ? `${branchOnly.length} migration${branchOnly.length > 1 ? 's' : ''} only in this branch` + (pending.length ? ` · ${pending.length} pending` : '') + ' → ' : '') + (rec.db.mode === 'shared' ? 'shared database' : rec.db.name) + (rec.db.test ? ' + ' + rec.db.test.name : ''),
              d.steps.migrate, h('button', { class: 'btn sm', onclick: () => runStep(rec.id, 'migrate') }, 'Run')),
            stepRow(3, 'Start', 'docker compose up', (rec.isMain ? 'all services, shared ones included' : rec.services.join(' · ')) + ' · stays attached: its output is the log', d.steps.up,
              [bs === 'down' ? h('button', { class: 'btn sm', onclick: () => runStep(rec.id, 'up') }, 'Start') : h('button', { class: 'btn sm', onclick: () => runStep(rec.id, 'down') }, 'Stop'),
                d.steps.up ? null : h('button', { class: 'btn sm', onclick: () => runStep(rec.id, 'logs') }, 'Logs')]))),
        h('section', { class: 'card', style: 'padding:14px 18px', 'aria-label': 'Frontend' },
          h('div', { class: 'section-head', style: 'align-items:center;padding-bottom:4px' }, h('h2', {}, 'Frontend'), rec.frontend ? statePill(fs, (fs === 'up' ? 'Up' : 'Stopped') + ' · :' + rec.frontend.port) : h('span', { class: 'faint' }, 'no Vite config found')),
          rec.frontend ? h('div', { class: 'steps' },
            stepRow(1, 'Install packages', rec.frontend.install, rec.frontend.dir !== '.' ? 'in ' + rec.frontend.dir + '/' : '', d.steps.install, h('button', { class: 'btn sm', onclick: () => runStep(rec.id, 'install') }, 'Run')),
            stepRow(2, 'Start', rec.isMain ? (rec.frontend.run || 'yarn start') : rec.frontend.start || 'vite --config vite.worktree.config.mjs', `vite :${rec.frontend.port} → backend :${port ? port.port : '?'}` + (d.url && d.url.includes('.localhost') ? ` · own cookies on ${d.url.replace(/^https?:\/\//, '').replace(/:\d+$/, '')} · API calls through Vite (no CORS)` : ''), d.steps.vite,
              fs === 'up' ? h('button', { class: 'btn sm', onclick: () => runStep(rec.id, 'stop-vite') }, 'Stop') : h('button', { class: 'btn sm', onclick: () => runStep(rec.id, 'vite') }, 'Start'))) : null),
        h('section', { class: 'card', style: 'padding:14px 18px;display:flex;flex-direction:column;gap:12px', 'aria-label': 'Database' },
          h('div', { class: 'section-head', style: 'align-items:center' }, h('h2', {}, 'Database'),
            h('span', { class: 'pill ' + (rec.db.mode === 'shared' ? 'down' : 'accent') }, { shared: 'Shared', copy: 'Private copy', fresh: 'Fresh · own' }[rec.db.mode])),
          h('dl', { class: 'kv' },
            h('dt', {}, 'Name'), h('dd', { class: 'mono' }, rec.isMain ? (rec.db.source || 'from config/database.yml') + (d.dbSize ? ' · ' + fmtBytes(d.dbSize) : '') : rec.db.mode === 'shared' ? (rec.db.source || 'the shared development database') : rec.db.name),
            rec.db.mode !== 'shared' && !rec.isMain ? [h('dt', {}, 'Size'), h('dd', {}, fmtBytes(d.dbSize) + (rec.db.mode === 'copy' && rec.db.source ? ' · copied from ' + rec.db.source : ''))] : null,
            rec.db.test && rec.isMain ? [h('dt', {}, 'Test'), h('dd', { class: 'mono' }, (rec.db.test.name || 'from config/database.yml') + (d.testSize ? ' · ' + fmtBytes(d.testSize) : ''))] : null,
            rec.db.test && !rec.isMain ? [h('dt', {}, 'Test'), h('dd', {}, h('span', { class: 'mono' }, rec.db.test.name), ' · ' + fmtBytes(d.testSize) + (rec.db.test.source ? ' · copied from ' + rec.db.test.source : ' · own') + (rec.db.test.ready ? '' : ' · schema loads on the first migrate'))] : null,
            h('dt', {}, 'Redis'), h('dd', {}, rec.isMain ? 'the main checkout’s' : 'own (per worktree)')),
          rec.isMain ? null : h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
            h('span', { class: 'faint' }, 'Migrations only in this branch'),
            branchOnly.length ? branchOnly.map((m) => h('span', { class: 'row-gap', style: 'gap:8px' }, h('code', {}, m.file.replace(/\.rb$/, '')),
              m.applied ? h('span', { class: 'pill dotted up' }, 'applied') : h('span', { class: 'pill dotted down' }, 'pending'),
              m.appliedTest === null ? null : m.appliedTest ? h('span', { class: 'pill dotted up' }, 'test ✓') : h('span', { class: 'pill dotted down' }, 'test pending'),
              m.onShared ? h('span', { class: 'pill dotted warn' }, 'on shared') : null)) : h('span', { class: 'sub' }, 'None — this branch has the same migrations as main.')),
          rec.isMain ? null : h('div', { class: 'row-gap', style: 'gap:6px' },
            rec.db.mode !== 'shared' ? h('button', { class: 'btn sm', onclick: () => confirmDialog('Refresh the copy?', `${rec.db.name} is replaced with a fresh copy of ${rec.db.source}. Its current data is lost; the backend is stopped first.`, 'Refresh copy', () => setDb(rec.id, 'refresh')) }, 'Refresh copy from shared') : null,
            rec.db.mode !== 'shared' ? h('button', { class: 'btn sm', onclick: () => setDb(rec.id, 'shared') }, 'Switch to shared') : h('button', { class: 'btn sm', onclick: () => setDb(rec.id, 'copy') }, 'Make a private copy'),
            rec.db.test ? h('button', { class: 'btn sm', onclick: () => confirmDialog('Refresh the test database?', `${rec.db.test.name} is replaced with a fresh copy of the shared test database (or an empty one). Run Migrate afterwards.`, 'Refresh test DB', () => setDb(rec.id, 'refresh-test')) }, 'Refresh test DB') : null,
            rec.sharedMigrations.length ? h('button', { class: 'btn sm', onclick: () => rollback(rec.id) }, 'Roll back on shared') : null)),
        h('section', { class: 'card', style: 'padding:14px 18px;display:flex;flex-direction:column;gap:12px', 'aria-label': 'Ports and git' },
          h('h2', {}, 'Ports & git'),
          h('table', { class: 'plain' }, h('thead', {}, h('tr', {}, h('th', {}, 'Service'), h('th', {}, 'Port'), rec.isMain ? null : h('th', {}, 'Main uses'))),
            h('tbody', {}, (rec.ports || []).map((p) => h('tr', {}, h('td', {}, p.service), h('td', { class: 'mono' }, String(p.port)), rec.isMain ? null : h('td', { class: 'mono faint' }, String(p.main)))),
              rec.frontend ? h('tr', {}, h('td', {}, 'vite'), h('td', { class: 'mono' }, String(rec.frontend.port)), rec.isMain ? null : h('td', { class: 'mono faint' }, '5173')) : null)),
          d.git ? h('div', { class: 'row-gap' },
            d.git.dirty ? h('span', { class: 'pill dotted warn' }, d.git.dirty + ' uncommitted') : h('span', { class: 'pill dotted up' }, 'clean'),
            d.git.unpushed ? h('span', { class: 'pill dotted warn' }, d.git.unpushed + ' not pushed') : null) : null,
          (rec.repos || []).length ? h('div', { style: 'display:flex;flex-direction:column;gap:4px' }, h('span', { class: 'faint' }, 'Also brought from the main checkout'),
            rec.repos.map((x) => h('div', { class: 'row-gap', style: 'gap:8px' }, h('code', {}, x.path), h('span', { class: 'pill dotted ' + (x.ok ? 'up' : 'warn') }, x.ok ? { submodule: 'submodule', clone: 'own clone', link: 'linked' }[x.how] : 'failed'),
              x.ok ? null : h('span', { class: 'faint', style: 'flex:1 1 200px' }, x.error || '')))) : null));

      const sessions = [...S.sessions.values()].filter((x) => x.project === rec.path);
      add(page, h('section', { class: 'card', style: 'padding:14px 18px;display:flex;flex-direction:column;gap:10px', 'aria-label': 'Claude in this worktree' },
        h('div', { class: 'section-head', style: 'align-items:center' }, h('h2', {}, rec.isMain ? 'Claude in this checkout' : 'Claude in this worktree'), h('button', { class: 'btn sm primary', onclick: () => X.startSession('', 'claude', null) }, '+ New Claude session here')),
        sessions.length ? sessions.map((x) => h('div', { class: 'row-gap', style: 'gap:10px;font-size:13px' }, X.termGlyph(x), h('b', {}, x.title), h('span', { class: 'faint', style: 'flex:1 1 200px' }, (X.STATUS_LABEL[x.status] || x.status) + ' · ' + (x.detail || '')), h('button', { class: 'btn sm', onclick: () => X.openSession(x.id) }, 'Open')))
          : h('span', { class: 'sub' }, 'No sessions yet. Skills you run from Home while this project is selected run in this folder.')));
      if (rec.isMain) {
        add(page, h('section', { class: 'card', style: 'padding:14px 18px;display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between', 'aria-label': 'Stop' },
          h('div', { style: 'display:flex;flex-direction:column;gap:2px' }, h('h2', {}, 'Stop'), h('span', { class: 'faint' }, 'Stops everything this checkout runs — frontend, web, workers — and removes the app containers. Postgres and the other shared services stop too, unless a worktree is running: then they keep running for it.')),
          h('button', { class: 'btn', onclick: () => stopWt(rec.id) }, '■ Stop all')));
        v.scrollTop = scroll;
        return;
      }
      add(page, h('section', { class: 'card danger-card', style: 'padding:14px 18px;display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between', 'aria-label': 'Stop or delete' },
        h('div', { style: 'display:flex;flex-direction:column;gap:2px' }, h('h2', {}, 'Stop or delete'), h('span', { class: 'faint' }, 'Stop keeps the folder, database and Redis data. Delete removes everything this worktree created.')),
        h('div', { class: 'row-gap' }, h('button', { class: 'btn', onclick: () => stopWt(rec.id) }, '■ Stop everything'), h('button', { class: 'btn danger', onclick: () => deleteDialog(rec.id) }, 'Delete worktree…'))));
      v.scrollTop = scroll;
    }

    // ---------- Monitor ----------
    async function loadMonitor() {
      try { const s = await api('GET', '/api/monitor'); S.mon.history = s.history || []; if (s.at) S.mon.snap = s; } catch {}
      if (!S.wt.loaded) await load();
      if (S.page === 'monitor') renderGlobal();
      loadDisk(false);
    }
    async function loadDisk(refresh) {
      S.mon.diskLoading = true;
      if (S.page === 'monitor') renderGlobal();
      try { S.mon.disk = await api('GET', '/api/monitor/disk' + (refresh ? '?refresh=1' : '')); } catch {}
      S.mon.diskLoading = false;
      if (S.page === 'monitor') renderGlobal();
    }
    function onSample(snap) {
      S.mon.snap = snap;
      const last = (snap.history || [])[0];
      if (last && (!S.mon.history.length || S.mon.history[S.mon.history.length - 1].at !== last.at)) { S.mon.history.push(last); if (S.mon.history.length > 360) S.mon.history.shift(); }
      if (snap.docker && snap.docker.total) S.dockerPct = Math.round((snap.docker.used / snap.docker.total) * 100);
      renderNav();
      if (S.page === 'monitor') renderGlobal();
    }
    const meter = (pct, plain) => h('div', { class: 'meter' + (pct >= 85 && !plain ? ' high' : ''), role: 'img', 'aria-label': Math.round(pct) + '%' }, h('i', { style: `width:${Math.max(0, Math.min(100, pct))}%` }));

    function monitorPage() {
      const page = h('main', { class: 'page', 'aria-label': 'Monitor', style: 'max-width:1400px' });
      const s = S.mon.snap;
      add(page, h('div', { class: 'section-head', style: 'align-items:flex-start' },
        h('div', { style: 'display:flex;flex-direction:column;gap:4px' }, h('h1', {}, 'Monitor'), h('span', { class: 'sub' }, 'Live every 5 s while this page is open · what each worktree costs your Mac')),
        h('span', { class: 'faint' }, s ? 'Updated ' + new Date(s.at).toLocaleTimeString() : 'Measuring…')));
      if (!s || !s.host) { add(page, h('span', { class: 'sub' }, 'Taking the first sample…')); return page; }
      const hostPct = (s.host.used / s.host.total) * 100;
      const dk = s.docker || {};
      const dPct = dk.total ? (dk.used / dk.total) * 100 : 0;
      const diskUsedPct = s.disk && s.disk.total ? (1 - s.disk.free / s.disk.total) * 100 : 0;
      const wtDisk = S.mon.disk ? S.mon.disk.worktrees.reduce((a, w) => a + (w.folder || 0) + (w.db || 0) + (w.testDb || 0), 0) : null;
      add(page, h('div', { class: 'tiles' },
        h('section', { class: 'card tile', 'aria-label': 'Mac memory' }, h('span', { class: 'faint' }, 'Mac memory'),
          h('span', { class: 'big' }, (s.host.used / GB).toFixed(1), h('small', {}, ` / ${Math.round(s.host.total / GB)} GB`)), meter(hostPct),
          hostPct >= 85 ? h('span', { class: 'pill dotted warn', style: 'align-self:flex-start;white-space:normal' }, `High — ${Math.round(hostPct)}% used` + (s.host.swapUsed ? ` · ${fmtBytes(s.host.swapUsed)} swap` : ''))
            : h('span', { class: 'faint' }, `${Math.round(hostPct)}% used` + (s.host.swapUsed ? ` · ${fmtBytes(s.host.swapUsed)} swap` : ''))),
        h('section', { class: 'card tile', 'aria-label': 'Docker memory' }, h('span', { class: 'faint' }, 'Docker VM memory'),
          dk.ok ? [h('span', { class: 'big' }, (dk.used / GB).toFixed(1), h('small', {}, ` / ${(dk.total / GB).toFixed(0)} GB`)), meter(dPct),
            dPct >= 85 ? h('span', { class: 'pill dotted warn', style: 'align-self:flex-start;white-space:normal' }, 'High — stop a worktree or raise Docker’s memory limit') : h('span', { class: 'faint' }, `${Math.round(dPct)}% used by containers`)]
            : h('span', { class: 'sub' }, s.dockerError || 'Docker is not running')),
        h('section', { class: 'card tile', 'aria-label': 'CPU' }, h('span', { class: 'faint' }, 'CPU'),
          h('span', { class: 'big' }, s.host.cpu === null || s.host.cpu === undefined ? '…' : String(s.host.cpu), h('small', {}, '%')), meter(s.host.cpu || 0, true),
          h('span', { class: 'faint' }, `${s.host.cores} cores · load ${Number(s.host.load || 0).toFixed(1)}`)),
        h('section', { class: 'card tile', 'aria-label': 'Disk' }, h('span', { class: 'faint' }, 'Disk free'),
          h('span', { class: 'big' }, String(Math.round((s.disk ? s.disk.free : 0) / GB)), h('small', {}, ' GB')), meter(diskUsedPct),
          diskUsedPct >= 85 ? h('span', { class: 'pill dotted warn', style: 'align-self:flex-start;white-space:normal' }, `Disk ${Math.round(diskUsedPct)}% full` + (wtDisk !== null ? ' · worktrees use ' + fmtBytes(wtDisk) : ''))
            : h('span', { class: 'faint' }, wtDisk !== null ? 'Worktrees use ' + fmtBytes(wtDisk) : 'Measuring worktrees…'))));

      const cols = h('div', { class: 'mon-cols' });
      add(page, cols);
      const groups = s.groups || [];
      const max = Math.max(1, ...groups.flatMap((g) => g.items.map((i) => i.mem)));
      add(cols, h('section', { class: 'card', style: 'padding:14px 18px', 'aria-label': 'Memory by worktree' },
        h('div', { class: 'section-head' }, h('h2', {}, 'Memory by worktree'), h('span', { class: 'faint' }, 'RAM · CPU')),
        groups.length ? groups.map((g) => {
          const w = g.kind === 'worktree' ? S.wt.list.find((x) => x.id === g.id) : null;
          const running = g.items.length > 0;
          return h('div', { class: 'mgroup' },
            h('div', { class: 'section-head', style: 'align-items:center;padding-bottom:6px' },
              h('span', { class: 'row-gap' }, h('b', {}, g.label), g.kind === 'other' ? null : statePill(running ? 'up' : 'down')),
              h('span', { class: 'row-gap' }, h('span', { class: 'mono', style: 'font-weight:600' }, running ? fmtBytes(g.mem) : '0 B'),
                w && running ? h('button', { class: 'btn sm', onclick: () => stopWt(w.id) }, 'Stop') : null)),
            g.items.map((i) => h('div', { class: 'mbar', title: `${i.name}: ${fmtBytes(i.mem)} · ${i.cpu.toFixed(1)}% CPU` },
              h('span', { class: 'mono', style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, i.name),
              h('div', { class: 'm' }, h('i', { style: `width:${Math.max(1, Math.round((i.mem / max) * 100))}%` })),
              h('span', { class: 'r' }, fmtBytes(i.mem)), h('span', { class: 'r faint' }, i.cpu.toFixed(0) + '%'))));
        }) : h('span', { class: 'sub' }, 'Nothing running.')));
      add(cols, h('div', { style: 'display:flex;flex-direction:column;gap:16px;min-width:0' },
        h('section', { class: 'card', style: 'padding:14px 18px;display:flex;flex-direction:column;gap:8px', 'aria-label': 'Mac memory over time' },
          h('h2', {}, 'Mac memory · last 30 min'), memChart(S.mon.history, s.host.total)),
        h('section', { class: 'card', style: 'padding:14px 18px;display:flex;flex-direction:column;gap:8px', 'aria-label': 'Disk by worktree' },
          h('div', { class: 'section-head', style: 'align-items:center' }, h('h2', {}, 'Disk by worktree'),
            h('button', { class: 'btn sm', disabled: S.mon.diskLoading, onclick: () => loadDisk(true) }, S.mon.diskLoading ? 'Measuring…' : 'Measure again')),
          S.mon.disk && S.mon.disk.worktrees.length ? h('table', { class: 'plain' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Worktree'), h('th', { class: 'r' }, 'Folder'), h('th', { class: 'r' }, 'node_modules'), h('th', { class: 'r' }, 'Database'), h('th', { class: 'r' }, 'Test DB'))),
            h('tbody', {}, S.mon.disk.worktrees.map((w) => h('tr', {}, h('td', {}, w.key), h('td', { class: 'r mono' }, fmtBytes((w.folder || 0) - (w.modules || 0))), h('td', { class: 'r mono' }, fmtBytes(w.modules)),
              h('td', { class: 'r mono' + (w.dbMode === 'shared' ? ' faint' : '') }, w.dbMode === 'shared' ? 'shared' : fmtBytes(w.db)), h('td', { class: 'r mono' }, w.testDb ? fmtBytes(w.testDb) : '—')))))
            : h('span', { class: 'sub' }, S.mon.diskLoading ? 'Measuring folders (node_modules takes a moment)…' : 'No worktrees.'),
          S.mon.disk ? h('span', { class: 'faint' }, 'Measured ' + ago(S.mon.disk.at) + ' ago') : null)));
      return page;
    }

    // One series, one axis, a crosshair + tooltip on hover.
    function memChart(hist, total) {
      const box = h('div', { class: 'chart' });
      const pts = (hist || []).filter((p) => p.host);
      if (pts.length < 2) { add(box, h('span', { class: 'sub' }, 'Collecting… the line fills in over the next minutes.')); return box; }
      const W = 560; const H = 120; const pad = 4;
      const t0 = pts[0].at; const t1 = pts[pts.length - 1].at;
      const top = total || Math.max(...pts.map((p) => p.host)) * 1.1;
      const x = (t) => (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * W);
      const y = (v) => H - pad - (v / top) * (H - 2 * pad);
      const d = pts.map((p, i) => (i ? 'L' : 'M') + x(p.at).toFixed(1) + ',' + y(p.host).toFixed(1)).join(' ');
      const ns = 'http://www.w3.org/2000/svg';
      const el = (tag, a) => { const e = document.createElementNS(ns, tag); for (const k in a) e.setAttribute(k, a[k]); return e; };
      const s = el('svg', { viewBox: `0 0 ${W} ${H + 20}`, role: 'img', 'aria-label': `Mac memory used over ${Math.round((t1 - t0) / 60000)} minutes: now ${fmtBytes(pts[pts.length - 1].host)}` });
      s.append(el('line', { x1: 0, x2: W, y1: y(top), y2: y(top), stroke: 'var(--line)', 'stroke-dasharray': '3 4' }));
      const lab = el('text', { x: W, y: 10, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--faint)' }); lab.textContent = fmtBytes(top); s.append(lab);
      s.append(el('path', { d: d + ` L${x(t1).toFixed(1)},${H} L0,${H} Z`, fill: 'var(--accent)', opacity: 0.12 }));
      s.append(el('path', { d, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      const lx = el('text', { x: 0, y: H + 16, 'font-size': 11, fill: 'var(--faint)' }); lx.textContent = Math.round((t1 - t0) / 60000) + ' min ago'; s.append(lx);
      const rx = el('text', { x: W, y: H + 16, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--faint)' }); rx.textContent = 'now · ' + fmtBytes(pts[pts.length - 1].host); s.append(rx);
      const cross = el('line', { y1: 0, y2: H, stroke: 'var(--faint)', 'stroke-width': 1, visibility: 'hidden' });
      const dot = el('circle', { r: 4, fill: 'var(--accent)', stroke: 'var(--panel)', 'stroke-width': 2, visibility: 'hidden' });
      s.append(cross, dot);
      const hit = el('rect', { x: 0, y: 0, width: W, height: H, fill: 'transparent' });
      s.append(hit);
      const tip = h('div', { class: 'tip', style: 'display:none' });
      hit.addEventListener('mousemove', (e) => {
        const r = s.getBoundingClientRect();
        const t = t0 + ((e.clientX - r.left) / r.width) * (t1 - t0);
        const p = pts.reduce((a, b) => (Math.abs(b.at - t) < Math.abs(a.at - t) ? b : a));
        const px = x(p.at); const py = y(p.host);
        cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
        dot.setAttribute('cx', px); dot.setAttribute('cy', py); dot.setAttribute('visibility', 'visible');
        tip.style.display = 'block'; tip.style.left = (px / W) * r.width + 'px'; tip.style.top = (py / (H + 20)) * r.height + 'px';
        tip.textContent = new Date(p.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' + fmtBytes(p.host) + (p.docker ? ' (Docker ' + fmtBytes(p.docker) + ')' : '');
      });
      hit.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.style.display = 'none'; });
      add(box, s, tip);
      return box;
    }

    // ---------- websocket ----------
    function onWs(m) {
      if (m.t === 'worktrees') load();
      else if (m.t === 'monitor') onSample(m.snap);
      else if (m.t === 'dockerPct') { S.dockerPct = m.pct; renderNav(); }
      else if (m.t === 'wtask') { if (m.r.needsChoice) migrateDialog(m.id, m.step, m.r, {}); else if (m.r.confirm) confirmDialog('Start anyway?', m.r.message, 'Start anyway', () => runStep(m.id, m.step, { forceStart: true })); }
      else if (m.t === 'wterror') toast({ title: 'Worktree ' + m.id, body: m.error, timeout: 10000 });
      else if (m.t === 'proc' && m.p.wt) {
        const w = curWt();
        if (w && w.id === m.p.wt) loadDetail(w.id);
        if (['up', 'down', 'vite', 'migrate', 'install'].includes(m.p.kind)) loadSoon();
        if (!m.p.alive && m.p.status === 'failed' && m.p.kind !== 'logs') toast({ title: `${m.p.title} failed`, body: 'Exit code ' + m.p.exitCode, timeout: 10000, actions: [{ label: 'Show output', primary: true, fn: () => X.openProc(m.p.id) }, { label: 'Later' }] });
      }
    }

    poll();
    return { switcher, nav, load, loadDetail, renderEnv, envStrip, openPage, onWs, projectKey, curWt, newDialog, deleteDialog, renderGlobal, renderSwitcher, renderNav };
  };
})();
