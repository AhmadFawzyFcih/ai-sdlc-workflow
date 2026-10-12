// Skill forms: fields, defaults taken from the ticket you have open, and the command they build.
// A field's default is recomputed from the fields above it until you edit it yourself.
(function () {
  'use strict';
  const KEY = /[A-Z][A-Z0-9]+-\d+/;

  function keyOf(v) { const m = String(v || '').toUpperCase().match(KEY); return m ? m[0] : null; }

  function helpers(ctx) {
    const ix = ctx.index || { items: [], parentOf: {}, mdFiles: [], jiraBase: '' };
    const stories = {}; const subtasks = {}; const roots = {};
    ix.items.forEach((it) => {
      roots[it.key] = it;
      it.stories.forEach((st) => { stories[st.key] = Object.assign({ feature: it.key }, st); st.subtasks.forEach((t, i) => { subtasks[t.key] = Object.assign({ story: st.key, prev: i > 0 ? st.subtasks[i - 1] : null, featureBranch: it.branch }, t); }); });
    });
    const url = (key) => {
      if (!key) return '';
      const known = (subtasks[key] && subtasks[key].url) || (stories[key] && stories[key].url) || (roots[key] && roots[key].url);
      return known || (ix.jiraBase ? ix.jiraBase + key : key);
    };
    const kind = (key) => subtasks[key] ? 'subtask' : stories[key] ? 'story' : roots[key] ? roots[key].kind : null;
    const storyOf = (key) => subtasks[key] ? subtasks[key].story : stories[key] ? key : null;
    const featureOf = (key) => { let k = key; for (let i = 0; i < 4 && ix.parentOf[k]; i++) k = ix.parentOf[k]; return roots[k] ? k : (k || null); };
    const nextSubtask = (storyKey) => {
      const st = stories[storyKey]; if (!st || !st.subtasks.length) return null;
      const open = st.subtasks.find((t) => !/done|merged|committed|review/i.test(t.status || ''));
      return (open || st.subtasks[st.subtasks.length - 1]).key;
    };
    // For a feature: its next open subtask, and its next story that has no subtasks yet.
    const featureNext = (fKey) => {
      const it = roots[fKey]; if (!it) return { subtask: null, story: null };
      let subtask = null; let story = null;
      for (const st of it.stories) {
        if (!subtask) { const t = st.subtasks.find((x) => !/done|merged|committed|review/i.test(x.status || '')); if (t) subtask = t.key; }
        if (!story && !st.subtasks.length) story = st.key;
      }
      const active = it.stories.find((st) => st.subtasks.length && !/done|merged/i.test(st.status || ''));
      return { subtask, story, activeStory: active ? active.key : null };
    };
    const baseFor = (subKey) => {
      const t = subtasks[subKey]; if (!t) return null;
      const base = t.base || (t.prev && t.prev.branch) || t.featureBranch || null;
      // A merged (done) parent's branch is gone: use the branch that parent was merged into.
      const sibs = stories[t.story].subtasks;
      const parent = sibs.slice(0, sibs.findIndex((x) => x.key === subKey)).find((x) => x.branch && x.branch === base && /done|merged/i.test(x.status || ''));
      return parent ? (baseFor(parent.key) || t.featureBranch || null) : base;
    };
    // Plan files for a ticket. prefer: 'story' | 'feature' | 'any'
    const rankFiles = (keys, prefer) => {
      keys = keys.filter(Boolean);
      if (!keys.length) return [];
      const has = (P, k) => new RegExp(k + '(?!\\d)').test(P);
      const rank = (p) => {
        const P = p.toUpperCase();
        if (!keys.some((k) => has(P, k))) return 99;
        const name = P.split('/').pop();
        const storyPlan = keys.some((k) => P.endsWith('/STORIES/' + k + '/PLAN.MD'));
        const featurePlan = /FEATURE-PLAN\.MD$/.test(P);
        if (/\/STORIES\//.test(P) && !keys.some((k) => P.indexOf('/STORIES/' + k + '/') !== -1)) return 50;
        if (prefer === 'feature') return featurePlan ? 1 : /PLAN/.test(name) ? 2 : storyPlan ? 3 : /CONTEXT\.MD$/.test(P) ? 4 : 10;
        return storyPlan ? 1 : featurePlan ? 2 : /PLAN/.test(name) ? 3 : /CONTEXT\.MD$/.test(P) ? 4 : 10;
      };
      return ix.mdFiles.filter((p) => rank(p) < 99).sort((a, b) => rank(a) - rank(b) || (a.indexOf('/features/') === -1) - (b.indexOf('/features/') === -1) || a.localeCompare(b));
    };
    return { ix, url, kind, storyOf, featureOf, nextSubtask, featureNext, baseFor, rankFiles, stories, subtasks };
  }

  const focus = (ctx) => ctx.focusKey || '';

  const CATALOG = [
    { group: 'Continue', skills: [
      { id: 'resume', short: 'Pick up where you stopped', desc: 'Loads state and context.md, checks git and the MR, then continues from the file you pick.',
        fields: [
          { k: 'key', label: 'Ticket', hint: '· Jira key or URL', def: (c) => focus(c) },
          { k: 'file', label: 'Continue from', hint: '· picked from the ticket', type: 'file', prefer: 'any', keysFrom: (h, v) => { const k = keyOf(v.key); return [k, h.storyOf(k) !== k ? h.storyOf(k) : null]; } }
        ] }
    ] },
    { group: 'Plan', skills: [
      { id: 'plan-feature', short: 'Epic → feature plan + API contract', desc: 'Builds or updates feature-plan.md in place, the JSON-examples contract, the feature branch and its draft MR.',
        fields: [
          { k: 'epic', label: 'Epic', hint: '· Jira key or URL', def: (c, h) => h.url(h.featureOf(focus(c)) || focus(c)) },
          { k: 'thoughts', label: 'Your thoughts', type: 'area', flag: '--thoughts', def: () => '' },
          { k: 'figma', label: 'Figma links', hint: '· optional', flag: '--figma', raw: true, def: () => '', placeholder: 'https://figma.com/design/…' }
        ] },
      { id: 'plan-story', short: 'Story → plan + subtasks in Jira', desc: 'Writes the story plan from the main plan, proposes stacked subtasks and creates them in Jira after you confirm.',
        always: ['No estimation', 'You as assignee and reporter', 'Status: Selected for Development'],
        fields: [
          { k: 'story', label: 'Story', hint: '· Jira key or URL', def: (c, h) => { const k = focus(c); return h.url(h.storyOf(k) || (h.kind(k) === 'feature' ? h.featureNext(k).story : null) || k); } },
          { k: 'plan', label: 'Main plan', hint: '· picked from the story', type: 'file', prefer: 'feature', keysFrom: (h, v) => { const k = keyOf(v.story); return [h.featureOf(k), k]; } },
          { k: 'thoughts', label: 'Your thoughts', type: 'area', flag: '--thoughts', derived: true, def: (c, h, v) => {
            const k = keyOf(v.story); const st = h.stories[k];
            return st && st.subtasks.length ? 'Update the story plan from the main plan if it changed and propose the remaining subtasks.' : 'Use the main plan to plan this story and split it into stacked subtasks. How many subtasks would you create?';
          } },
          { k: 'labels', label: 'Jira labels', hint: '· empty = the story\u2019s labels', flag: '--labels', def: () => '', placeholder: 'team-label' },
          { k: 'figma', label: 'Figma links', hint: '· optional', flag: '--figma', raw: true, def: () => '', placeholder: 'https://figma.com/design/…' }
        ] },
      { id: 'analyze-requirements', short: 'Jira stories vs Figma', desc: 'Maps stories to designs and reports mismatches, optionally to Confluence.',
        fields: [
          { k: 'keys', label: 'Stories, sprint or project', def: (c) => focus(c), placeholder: 'PROJ-101 PROJ-102 or "Sprint 5"', raw: true },
          { k: 'figma', label: 'Figma links', hint: '· optional', flag: '--figma', raw: true, def: () => '', placeholder: 'https://figma.com/design/…' }
        ] }
    ] },
    { group: 'Build', skills: [
      { id: 'implement', short: 'One subtask on a stacked branch', desc: 'Branches out, opens a draft MR, implements this subtask from its plan, commits, then asks about review and docs.',
        always: ['Draft MR with one comment per step', 'Commits split by the committer agent'],
        fields: [
          { k: 'subtask', label: 'Subtask', hint: '· Jira key or URL', def: (c, h) => { const k = focus(c); const kd = h.kind(k); return h.url(kd === 'subtask' ? k : kd === 'story' ? k : (h.featureNext(k).subtask || h.featureNext(k).activeStory || k)); } },
          { k: 'plan', label: 'Story plan', hint: '· picked from the subtask', type: 'file', prefer: 'story', keysFrom: (h, v) => { const k = keyOf(v.subtask); return [h.storyOf(k) || k]; } },
          { k: 'thoughts', label: 'Your thoughts', type: 'area', flag: '--thoughts', derived: true, def: (c, h, v) => {
            const k = keyOf(v.subtask);
            if (h.kind(k) !== 'subtask') return 'Implement the next subtask of this story from its plan, stacked on the previous one.';
            return 'Branch out from ' + (h.baseFor(k) || 'the current branch') + ' and point the MR to it. Implement only this subtask from its plan.';
          } }
        ] },
      { id: 'fix-bug', short: 'Root cause → failing spec → fix', desc: 'Two investigators find the root cause, a failing spec proves it, then the fix, commits and a Chrome check.',
        fields: [
          { k: 'bug', label: 'Bug ticket', hint: '· Jira key or URL', def: (c, h) => (h.kind(focus(c)) === 'bug' ? h.url(focus(c)) : ''), placeholder: 'PROJ-555' },
          { k: 'thoughts', label: 'Hints', hint: '· optional', type: 'area', flag: '--thoughts', def: () => '' }
        ] },
      { id: 'address-review', short: 'Answer reviewer threads', desc: 'Fetches open threads on the MR, proposes fixes and replies, pushes, answers the threads.',
        fields: [{ k: 'mr', label: 'Subtask or MR URL', def: (c, h) => (h.kind(focus(c)) === 'subtask' ? focus(c) : ''), placeholder: 'PROJ-124 or https://gitlab…/merge_requests/1' }] }
    ] },
    { group: 'Check & document', skills: [
      { id: 'review', short: 'Checklist review → HTML report', desc: 'The Rails review checklist on your local diff or an MR, with an interactive report.',
        fields: [
          { k: 'target', label: 'MR URL', hint: '· empty = local diff', def: () => '', placeholder: 'https://gitlab…/merge_requests/43' },
          { k: 'plan', label: 'Plan to check against', hint: '· optional', type: 'file', optional: true, prefer: 'story', flag: '--plan', keysFrom: (h, v, c) => { const k = focus(c); return [h.storyOf(k) || k]; } }
        ] },
      { id: 'document', short: 'rswag + Confluence page', desc: 'rswag specs first, then a new Confluence API page (folder link) or an update of an existing page.',
        fields: [
          { k: 'page', label: 'Confluence page — or folder for a new page', def: () => '', placeholder: 'https://…/wiki/spaces/X/pages/123 or …/folder/456', raw: true, transform: (v) => (/\/folder\//.test(v) ? '--new ' + v : v) },
          { k: 'key', label: 'Work item', def: (c) => focus(c) }
        ] },
      { id: 'postman', short: 'Postman collection for changed APIs', desc: 'Builds a versioned Postman collection (v1, v2, …) with chained requests, error cases and real local IDs, saved in the ticket\u2019s postman/ folder.',
        fields: [{ k: 'target', label: 'Ticket or MR', hint: '· empty = current branch', def: (c) => focus(c), placeholder: 'PROJ-124 or https://gitlab…/merge_requests/1' }] }
    ] },
    { group: 'Understand', skills: [
      { id: 'feature-overview', short: 'Hand-over briefing', desc: 'Business and technical picture of one feature: done, in progress, left, where to continue.',
        fields: [{ k: 'key', label: 'Feature', hint: '· key, branch or MR URL', def: (c, h) => h.featureOf(focus(c)) || focus(c) }] },
      { id: 'system-overview', short: 'Whole codebase overview', desc: 'HTML overview of domains, integrations, flows and hotspots; cached and refreshed incrementally.',
        fields: [
          { k: 'mode', label: 'Mode', type: 'select', options: [['', 'Use the cache when fresh'], ['--refresh', 'Refresh what changed'], ['--full', 'Rebuild from scratch']], def: () => '', raw: true },
          { k: 'focus', label: 'Focus or questions', hint: '· optional', def: () => '', raw: true }
        ] },
      { id: 'setup', short: 'Configure this project', desc: 'Detects the Rails project and writes .claude/backend.yml.', fields: [] }
    ] }
  ];

  const quote = (s) => '"' + String(s).replace(/(["\\])/g, '\\$1') + '"';

  // Resolve every field of a skill: value, options, note. `manual` = values the developer typed.
  function resolve(skill, ctx, manual) {
    const h = helpers(ctx);
    const v = {};
    const out = skill.fields.map((f) => {
      const isManual = manual[f.k] !== undefined;
      let value = isManual ? manual[f.k] : (f.def ? f.def(ctx, h, v) : '');
      let options = null; let note = '';
      if (f.type === 'file') {
        const keys = f.keysFrom(h, v, ctx).filter(Boolean);
        const ranked = h.rankFiles(keys, f.prefer);
        const rest = h.ix.mdFiles.filter((p) => ranked.indexOf(p) === -1);
        options = ranked.map((p) => [p, '★ ' + p.replace(/^[^/]+\//, '')]).concat(rest.map((p) => [p, p.replace(/^[^/]+\//, '')]));
        if (!isManual) value = f.optional ? '' : (ranked[0] || '');
        if (f.optional || !value) options.unshift(['', f.optional ? '— none —' : '— choose a file —']);
        const key = keys[0];
        note = !key ? 'Type a ticket above to pick its file' : ranked.length ? (isManual ? 'Your pick · ★ = files of ' + keys.join(', ') : 'Auto-picked for ' + keys.join(' › ') + ' · ★ = files of this ticket') : 'No file mentions ' + key + ' — pick one';
        if (f.optional) note = ranked.length ? '★ = files of ' + key : '';
      } else if (f.type === 'select') {
        options = f.options;
      }
      v[f.k] = value;
      return Object.assign({}, f, { value, options, note, manual: isManual });
    });
    const parts = ['/backend:' + skill.id];
    out.forEach((f) => {
      let val = String(f.value || '').trim();
      if (!val) return;
      if (f.transform) val = f.transform(val);
      if (f.flag) parts.push(f.flag + ' ' + (f.raw ? val : quote(val)));
      else parts.push(val);
    });
    return { fields: out, command: parts.join(' '), key: keyOf(out.map((f) => f.value).join(' ')) };
  }

  window.Skills = { CATALOG, resolve, keyOf, all: () => CATALOG.flatMap((g) => g.skills) };
})();
