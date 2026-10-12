# Roadmap & design decisions

This file is the single place that records **what we agreed** and **what is built**. Update it whenever a decision changes.

## Goals

- A strong, reusable Claude Code setup for Rails backend work that drops onto **any** Rails project.
- Nothing company-specific inside the plugin — every project detail lives in the project's `.claude/backend.yml`.
- Two versions: **`backend`** (Rails, built first) and later **`dev`** (stack-agnostic core). `backend` is built as *neutral core + Rails pack* so `dev` is mostly "swap the pack".
- Runs at user level first (local marketplace), becomes a shared plugin once proven.
- A local browser dashboard (`dashboard/`, v2 built 2026-10-07) reads `.plans/` and runs Claude Code sessions in tabs.

## Decisions

| # | Decision |
|---|----------|
| D1 | Ship as a **plugin** named `backend` → every skill is `/backend:<skill>`. Plugin skills never collide with a project's own skills (project `/plan` and `/backend:plan` both load). |
| D2 | Distributed through a **local marketplace** (`ai-sdlc-workflow`) — `claude plugin marketplace add ~/ai-sdlc-workflow`, install at `user`, `local` or `project` scope. Edits apply on next session or `/reload-plugins`. |
| D3 | Plugins can't ship `rules/` → conventions are **skills with `paths:`** (`rails-conventions`, `rspec-conventions`, `api-conventions`) that auto-load when matching files are touched. Project-specific rules stay in the project's own `.claude/rules/`. |
| D4 | One config file per project: `.claude/backend.yml`, created by `/backend:setup`. No secrets in it. |
| D5 | Workspace: `.plans/features/<KEY>-<slug>/`, `.plans/bugs/<KEY>-<slug>/`, `.plans/_system/`. |
| D6 | Each work item has `state.json` (machine state, source of truth for structure/status), `context.md` (human resume file — "where we stopped, what's next") and `events.jsonl` (append-only audit log). |
| D7 | **No plan versions.** Plans are updated in place; every change adds a row to the plan's `## Changelog`. |
| D8 | Subtasks are **stacked**: subtask N branches from subtask N-1 (first one from the feature branch); MR N targets branch N-1. Upstream changes propagate with `git rebase --update-refs`. |
| D9 | Every MR starts as a **draft** with an empty "start" commit (hosts refuse MRs without a diff) and a step checklist in the description; each finished step is ticked and gets an MR comment. |
| D10 | Commits are made by a dedicated `committer` subagent, split by logical unit with descriptive conventional messages. Note: squash-merge collapses them on the target branch. |
| D11 | `/backend:analyze-requirements` stays a separate skill. |
| D12 | Resume after a break: `SessionStart` hook auto-loads the work item for the current branch; `/backend:resume <KEY>` does it explicitly; `context.md` can be sent to a teammate. |
| D14 | 2026-10-06 feedback: dashboard v1 removed; `review` skill + `code-reviewer` agent restored to the original versions (single agent, fewer tokens). |
| D15 | 2026-10-06 feedback: fix-bug runs 2 investigators (code path incl. data/config · regression), conflicts settled in the main context — fewer tokens and faster. |
| D16 | 2026-10-06 leaner (v0.10.0): plans read by section (`plans.rb outline/section`), shared rules ~11 KB, short descriptions (~1.2k always-on), ≤ 1 Explore agent in planning, no nested agents in system-explorer, implement writes state/context/events once per subtask, architecture = one question round, post-edit hook (file log + API reminder) removed. |
| D17 | 2026-10-07 dashboard v2: designed with Ahmed on a canvas first. Sidebar = `.plans/` tree (filter, copy path); Home = sessions (top) + skill forms; folder tab = commands per story/subtask; real Claude Code in tabs (node-pty) — not a custom chat UI; status via hooks injected with `--settings` (curl → dashboard), so normal `claude` runs are untouched; desktop + in-page notifications; projects + switcher; dark by default. |
| D18 | 2026-10-13 dashboard 1.6: sessions belong to the environment that is open (main checkout or worktree) — no project filter; the project switcher counts sessions that need you elsewhere (*● N needs you ↗* per row, rows still switch as before); *Open session* opens here, else in the tab that has that worktree, else in a new tab on it. Look: only the sidebar file badges changed. In-dashboard branch switching was considered and dropped. |
| D13 | All HTML outputs share one theme (`shared/theme.css`) so reports, overviews and contracts look like one product. |

## Skills — status

All skills and agents are built (v0.10.0 — beta: validated and script-tested, not yet battle-tested on a real project).

| Skill | Notes |
|-------|-------|
| `setup` | Detects the project, writes `.claude/backend.yml` |
| `resume` | Loads state + context, checks git/MR reality, proposes the next step |
| `rails-` / `rspec-` / `api-conventions` | Auto-load by `paths:` |
| `system-overview` | `system-explorer` agent → `_system/overview.html` + `overview.md` (cached, incremental) |
| `feature-overview` | `feature-explorer` agent → business + technical hand-over page |
| `analyze-requirements` | `requirements-analyst` agent → mismatch report (+ Confluence) |
| `plan-feature` | `feature-plan.md` (in place + Changelog), `api-contract.html` (+ Confluence), feature branch + draft MR |
| `plan-story` | Story plan + stacked subtasks → confirm → Jira (me as assignee/reporter, parent labels, no estimate, ready status) |
| `implement` | Per subtask: stacked branch + empty start commit + draft MR → steps with specs → committer → MR ticks/comments → review gate → docs gate → continue gate; `--bugfix` mode |
| `review` | Original skill kept as Ahmed wrote it (checklist + interactive HTML report; local fixes or MR comments) |
| `address-review` | Reviewer threads → fix/reply → stack propagation |
| `document` | rswag first → new Confluence page or diff-reviewed update |
| `fix-bug` | 2 parallel `bug-investigator`s (code path · regression) → root cause gate → failing spec → fix → committer → review? → Chrome verification |
| `full-cycle` | Orchestrates all of the above, resumable |

## Agents

`system-explorer`, `feature-explorer`, `requirements-analyst`, `bug-investigator`, `committer`, `code-reviewer`, `doc-writer`.

## Later

- `dev` plugin (generic core) in the same marketplace — swap the Rails pack (conventions skills, detect/stats scripts, rswag reference) for stack packs.
- Evals for the most-used skills (`claude plugin eval`).
- Dashboard: Windows support; a `/backend:dashboard` skill to start it; show MR pipeline/threads.
