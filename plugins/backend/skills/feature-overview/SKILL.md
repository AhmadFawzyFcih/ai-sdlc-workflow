---
name: feature-overview
description: Hand-over briefing on one feature: business and technical picture, done / in progress / left, where to continue.
when_to_use: 'Taking over a feature, "explain feature X", "what is left on PROJ-100".'
argument-hint: "<epic/story key | feature name | branch | MR URL> [notes]"
allowed-tools: Read, Glob, Grep, Bash(git *), Bash(ruby *), Bash(glab mr list*), Bash(glab mr view*), Bash(gh pr list*), Bash(gh pr view*), Bash(open *), Bash(xdg-open *)
---
# Feature overview

Follow `${CLAUDE_PLUGIN_ROOT}/shared/skill-contract.md`.

## 1. Identify the feature
From `$ARGUMENTS`:
- A key → `ruby "${CLAUDE_PLUGIN_ROOT}/scripts/plans.rb" resolve <KEY>`; a found work item gives `work_item_dir`.
- A branch / MR URL → extract the key (`[A-Z][A-Z0-9]+-\d+`) and resolve as above.
- Free text → search Jira (`summary ~ "<text>"`, epics first) and branch names; if several candidates, `AskUserQuestion` to pick.
- Nothing given → the current branch's work item; none → ask.

Output path: `<work_item_dir>/overview.html` when a work item exists, otherwise `<plans_dir>/overviews/<KEY or slug>-<YYYYMMDD>.html` (don't create a work item just for reading).

## 2. Delegate
Spawn the `backend:feature-explorer` subagent with `query`, `out_path`, `work_item_dir` (if any) and the developer's notes. Stay light while it works.

## 3. Present
- Open the HTML and give its path.
- Show: progress, top 3 next actions, inconsistencies.
- `AskUserQuestion`: what next —
  - **Continue this feature with the workflow** → if no work item exists, `plans.rb init feature <EPIC> "<title>" --url <url>`, record known stories/subtasks/branches/MRs via `plans.rb update`, write `context.md` from the overview's "Where to continue", then suggest `/backend:resume <KEY>` or `/backend:plan-story <next story>`.
  - **Just the overview** → done.
If a work item exists, log `artifact.created` and add the overview link to `context.md` → Log.
