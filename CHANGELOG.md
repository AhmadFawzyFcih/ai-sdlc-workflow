# Changelog

## Dashboard 1.6.0 — 2026-10-13 · sessions per environment

- **Home shows the sessions of the environment you have open** — the main checkout or one worktree. The *All projects / This project* filter is gone; the status filters and *Clear ended* count this environment only, and so does the top-bar count.
- **Project switcher counts the rest**: a yellow number on it for sessions that need you in the other environments, and *● N needs you ↗* on each of those rows in its menu.
- **Open session goes where the session belongs** (toast, desktop notification, switcher): this tab when it is this environment; else the browser tab that already has that worktree open; else a new tab on that worktree, which opens the session as it loads (`?s=<id>`).
- **Sidebar**: files show the same MD / HTML / JSON badge as the tabs, and ticket keys in names are set in mono.
- **The sidebar stays on the Worktrees and Monitor pages**; opening a file or folder from it goes back to the tabs.
- **Home sits in the top bar with Worktrees and Monitor** (Home · Worktrees · Monitor), so you move between the three in one place; it is no longer a tab.

## Dashboard 1.5.0 — 2026-10-09 · worktrees

- **Worktrees**: one git worktree per branch, next to the project (`~/work/webapp-worktrees/PROJ-123`), with its **own backend, frontend, Redis and ports** (+10 per slot: web 3010, Vite 5183, AnyCable 8090…). Postgres, MinIO and the other services stay shared and are reachable under their usual names. The compose file for a worktree is generated outside the repo from your `docker-compose.yml`; `.plans/`, `.claude/backend.yml`, `.env` and keys are linked, not copied.
- **Database per worktree**: shared, a private copy of the shared one (`TEMPLATE`, or `pg_dump` while main is connected), or fresh (`db:setup`); switch or refresh later.
- **Own test database for every worktree** (copy of the shared test database, or empty + `db:schema:load`), and **migrate runs for development and then `RAILS_ENV=test`**. Claude sessions in a worktree get its `COMPOSE_PROJECT_NAME` / `COMPOSE_FILE`, so `docker compose run web bundle exec rspec` uses the worktree's stack and test database.
- **Migrations on the shared database ask first** (private copy · run on shared anyway · cancel). Ones you run on shared are remembered — banner on the Worktrees page and **Roll back**.
- **Environment tab** for a worktree project: `docker compose run web bash` · migrate · `up` · `yarn install` · Vite, each with its output in a terminal tab; *Run all*; database, ports, git; *Stop everything*; *Delete worktree…* removes containers, volumes, network, private database, folder and port slot (and, if you tick it, the branch) — uncommitted work needs a confirmation.
- **The main checkout is an environment too** — same Environment tab and card — and **starts with the dashboard** (migrate → `docker compose up` → `yarn start`; skipped when it already runs from a terminal; a checkbox turns it off). Stopping it keeps the shared services up for the worktrees.
- **`docker compose up` runs attached** (no `-d`): its tab is the live log; Run all waits for the web container before starting the frontend.
- **Worktrees have their own name** (ticket key by default) — folder, databases, tab — independent of the branch checked out in them.
- **No CORS on login**: API base URLs that point at the Rails port become the page's own origin, so calls go through Vite's proxy.
- **Stop really stops**: commands are stopped like Ctrl+C in a terminal (then killed if needed) — before, the interactive login shell kept `docker compose up`, Vite and yarn running. A worktree's *Stop all* ends with `docker compose down`; the main checkout's removes its app containers and stops the shared services too unless a worktree still needs them. Quitting the dashboard waits for its containers to stop (Ctrl+C twice to quit at once).
- **Worktrees get the code the frontend imports from outside git**: submodules are checked out (from the main checkout's copy, else their remote) and git-ignored repos inside the project (e.g. `frontend/planviewer`) are cloned locally on the same branch — before, Vite failed with *Failed to resolve import "…/planviewer/src"*. Shown under *Ports & git*.
- **Every worktree sees the main checkout's `.plans`**: its plans folder is always a link to main's; older worktrees with their own folder are repaired when the dashboard starts (their files are moved into main's first).
- Hiding/showing the sidebar with terminals open no longer stalls: terminals refit once the size settles.
- **Open in VS Code** on the Environment tab (before *Start all*) and on every card: opens that checkout's folder, so Source Control shows its changes (`editor` setting for Cursor or another editor).
- The **Environment tab can be closed** (×); it stays closed for that project until you open it again from Home or the Worktrees page.
- **Set a subtask's status by hand** on the folder page (written to `state.json`, logged in `events.jsonl`).
- **Project switcher**: worktrees are projects, listed under their main checkout with their state; **↗ opens a project in a new browser tab** (`?p=proj-123`, tab title `PROJ-123 · backend`). Desktop notifications show once across tabs.
- **Monitor**: Mac and Docker memory, CPU, disk; memory per worktree (containers, Vite, Claude); last 30 minutes; disk per worktree. Starting a third worktree, or one when Docker is low on memory, asks first; containers without a limit get one.
- Tests: `npm test` (generation, incl. `database.yml` through Ruby) and `npm run test:e2e` — real git, Docker, Postgres and Chromium.

## Dashboard 1.4.0 · plugin 0.12.1 — 2026-10-07

- **Keys open in Jira**: on a folder page the epic, story and subtask keys are links to their Jira tickets (new browser tab).
- **Docs chip**: the feature's Confluence documentation (`links.docs_page`) shows as an accent **Docs** chip right after Jira; other links read *API contract*, *Requirements*, *PRD*, …
- Plugin rule: a skill saves `links.docs_page` only when you say which page is the docs (or a docs skill creates/updates it for you) — never guessed.

## Dashboard 1.3.2 — 2026-10-07

- The `.plans/` sidebar tree **starts collapsed** on every load and project switch — only the top-level folders show until you open one. Filtering still expands the matches.

## Dashboard 1.3.1 — 2026-10-07

- Notifications (toasts) show in the **bottom-right** corner, clear of the sidebar; short ones like *Copied* hug the right edge and every toast fits narrow windows.

## Dashboard 1.3.0 — 2026-10-07

- **Reorder tabs** by dragging them before or after another tab, like browser tabs — an accent line shows where it lands and the active tab stays active. **Alt+Shift+←/→** moves the focused tab. Home stays first. File and folder tab order is remembered per project.

## Dashboard 1.2.0 — 2026-10-07

- **Resizable sidebar**: drag its right edge (200 px – 60 % of the window), arrow keys when the edge is focused, double-click resets to 290 px. The width is remembered.
- **Hide the sidebar** with the top-left button or ⌘B / Ctrl+B (Ctrl+B inside a Claude terminal stays with the terminal). Remembered across reloads.
- **Row actions** on every file and folder in the tree: copy path · **download** (folders as `.zip`) · **move to Trash** after a confirmation — open tabs of the item close. The `.plans/` root itself can't be downloaded or deleted, and nothing outside it is reachable.

## 0.12.0 — 2026-10-07 · postman

- **`/backend:postman [<KEY> | <jira-url> | <mr-url>]`**: Postman collection (v2.1) for the API endpoints the ticket, MR or current branch changed — numbered folders, chained IDs via collection variables, `pm.test` checks, 404/422/403 cases. Every variable holds a real value from the local database — the dev user's customer, a project its role can use, and each record the requests need — looked up with a read-only script through `app.runner_cmd` (Docker or plain `bin/rails runner`); only IDs the requests create start empty. Saved as `<KEY>-v<N>.postman_collection.json` in the story's (or bug's / feature's / top-level) `postman/` folder; each run writes the next version.
- `/backend:implement` docs gate offers **Postman collection** when API files changed.
- `backend.yml` has `app.runner_cmd`, detected by `/backend:setup`.
- `.plans/` layout has `postman/` folders; the dashboard lists the skill under *Check & document*.

## Dashboard 1.1.0 — 2026-10-07

- **Stop session** asks for confirmation; *End session* stops Claude and everything it started (SIGTERM to the process group, SIGKILL after 3 s) and closes the tab. Ended cards say *Stopped by you* / *Session ended* / *Ended with an error (code N)*.
- **Reopen** only when the session has a saved conversation (fixes `No conversation found with session ID`); a reopened session starts on a clean screen and shows *Waiting for you*.
- Fixed escape-sequence garbage (`^[[?31;3R…`) after reopening/reloading: replayed screens no longer send terminal answers to Claude.
- Claude tab fits exactly — the input box and status line (e.g. *auto mode on*) are always visible.
- Tabs show their type: folder icon, MD / HTML / JSON badges, `>_` + status dot for Claude sessions; generic file names show their folder.
- Home: filter sessions by status (All · Needs you · Running · Waiting · Ended) and project; *Clear ended*.
- Sessions start in an interactive login shell (`-lic`) so rvm/rbenv/asdf/nvm match your terminal; `BACKEND_DASH_SHELL_FLAGS` overrides.
- Fixed a stray `null` label in the session bar.

## 0.11.0 — 2026-10-07 · dashboard

- **Dashboard v1.0.0** (`dashboard/`, run `dashboard/bin/backend-dash`): local web UI — `.plans/` tree with filter and copy-path, preview tabs, folder pages with a ready command per story and subtask, plan reader (markdown + outline, HTML sandboxed), skill forms pre-filled from the open ticket with the plan file auto-picked, real Claude Code sessions in tabs (node-pty + xterm.js), live status from hooks injected with `--settings`, toasts + desktop notifications when a session needs approval, several projects, dark by default + light mode, live clock and calendar. Token-protected, `127.0.0.1` only.
- `/backend:resume` takes an optional second argument: the `.md` file to continue from.
- `/backend:plan-story` takes an optional main-plan path and `--labels`.
- `/backend:implement` takes an optional story-plan path and `--thoughts`; a subtask key implements only that subtask; a base branch named in `--thoughts` wins.

## 0.10.1 — 2026-10-06

- **Ruby 2.6 support**: helper scripts no longer use Ruby 3 syntax/methods (endless `def`, `filter_map`, `tally`), so they run under the macOS system Ruby 2.6. `/backend:setup` failed on macOS before this fix.

## 0.10.0 — 2026-10-06 · leaner

- **Section reading**: new `plans.rb outline <file>` / `plans.rb section <file> "<heading>"`; `implement`, `plan-story`, `plan-feature` (update mode), `resume`, `document` and `feature-explorer` read only the sections they need instead of whole plans.
- **Shared rules shrunk** from ~25 KB to ~11 KB (`skill-contract`, `workspace`, `git-flow`, `jira-flow`, `events`, `context-file`, `config`, `html-report`).
- **Shorter descriptions**: always-on cost ~2.7k → ~1.2k tokens per session; README recommends `--scope local` in Rails projects.
- **Fewer agents**: `plan-feature` and `plan-story` use at most one `Explore` agent; `system-explorer` no longer spawns nested agents.
- **implement**: no state/context/event writes per step — one checkpoint at the end of each subtask; MR keeps one comment per step, checklist ticked once.
- **Architecture discussion**: one question round (≤ 4 questions) per story, skipped when decisions are already recorded.
- **Hooks**: removed the post-edit hook (`file.changed` logging and the API reminder — the API checklist is covered by planning and `api-conventions`).

## 0.9.2 — 2026-10-06

- `fix-bug` runs **two** investigators (code path incl. data/config · regression); conflicts are settled in the main conversation, no tie-breaker agent.

## 0.9.1 — 2026-10-06

- Dashboard v1 removed (to be redesigned later).
- `review` skill and `code-reviewer` agent restored to the original versions (only the agent's path to the skill changed); implement/fix-bug review gates spawn one reviewer.

## 0.9.0 — 2026-10-06

- All skills: `system-overview`, `feature-overview`, `analyze-requirements`, `plan-feature`, `plan-story`, `implement`, `review`, `address-review`, `document`, `fix-bug`, `full-cycle`.
- Agents: `system-explorer`, `feature-explorer`, `requirements-analyst`, `bug-investigator`, `committer`, `code-reviewer`, `doc-writer`.
- Shared references: Jira/Confluence flow, plan templates, architecture topics, rswag, API contract, Confluence page; `codebase-stats.rb`.

## 0.1.0 — 2026-10-05 · foundation

- Local marketplace `ai-sdlc-workflow` + plugin `backend` (`/backend:*`).
- `.claude/backend.yml` + `/backend:setup` (project detection).
- Workspace `.plans/features|bugs/<KEY>-<slug>/` with `state.json`, `context.md`, `events.jsonl`; `plans.rb` CLI; `/backend:resume`.
- Path-scoped convention skills (Rails, RSpec, API).
- Hooks: session context, debug-statement / force-push / base-branch guards.
- Shared HTML theme + `render-html.rb`.

## Before the plugin

A `.claude/` folder copied into each project: `/analyze-requirements`, `/plan`, `/implement`, `/review`, `/document`, `/fix-bug`, `/full-cycle`, three agents, three rules, two hooks.
