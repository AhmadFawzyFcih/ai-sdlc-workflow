# Workspace — `.plans/`

```
.plans/                                   (plans_dir in backend.yml; suggest .gitignore)
├── _system/overview.html · overview.md · overview.meta.json
├── features/<KEY>-<slug>/
│   ├── state.json  context.md  events.jsonl
│   ├── feature-plan.md · api-contract.html · requirements-*.md · overview.html · docs/
│   ├── reviews/ · postman/
│   └── stories/<STORY>/plan.md · subtasks.md · reviews/ · postman/
├── bugs/<KEY>-<slug>/  state.json · context.md · events.jsonl · investigation.md · plan.md · screenshots · reviews/ · postman/
├── reviews/        review reports with no work item (someone else's MR, ad-hoc local diff)
├── postman/        Postman collections with no work item
├── requirements/   requirements reports with no epic
└── overviews/      feature overviews with no work item
```
Folder = `<KEY>-<slug>` (slug ≤ 5 kebab words). Plans are **never copied/versioned** — edit in place + `## Changelog` row.
**Nothing is written loose at the top of `.plans/`** — every file goes into one of the folders above. Bug plans and investigations live only in their `bugs/<KEY>-<slug>/` folder (never `bugfix-*.md` next to it); review reports go to a `reviews/` folder (see `skills/review/SKILL.md` §5); Postman collections to a `postman/` folder as `<KEY>-v<N>.postman_collection.json`, one new file per run (see `skills/postman/SKILL.md` §5).

## CLI (`P` = `ruby "${CLAUDE_PLUGIN_ROOT}/scripts/plans.rb"`)
```bash
P resolve [KEY]                                   # JSON: found, kind, key, dir, story, subtask (by key or current branch)
P init feature|bug KEY "Title" [--url U]          # folder + state.json + context.md (idempotent)
P update <dir|KEY> field=value ...                # root fields; values parsed as JSON; dot.paths ok
P update <dir|KEY> --story S [--subtask T] k=v    # upsert story / subtask
P event <dir|KEY> <type> "msg" [--data '{...}']   # append to events.jsonl
P show <dir|KEY> · P list                         # summaries
P name feature|subtask|bugfix KEY "Title"         # branch name from git.*_branch_pattern
P outline <file.md> · P section <file.md> "regex" # read big files by section
```

## `state.json` (written by the CLI — never by hand)
Root: `kind, key, title, url, stage, branch, mr{id,url,draft}, links{}, stories[]`. `links`: `docs_page` (the feature's Confluence docs — only when the developer gives it, see `skill-contract.md` rule 9), `contract_page`, `requirements_page`, plus any other named link.
Story: `key, title, url, status (planned|in_progress|done), plan, subtasks[]`.
Subtask: `key, title, order, status (pending|in_progress|committed|in_review|done), branch, base, mr`. `done` only when its MR's state on the host is `merged` (checked, never assumed) — whatever branch it merged into.
Stages — feature: `plan-feature → plan-story → implement → review → document → done`; bug: `investigate → plan → implement → review → verify → done`.
