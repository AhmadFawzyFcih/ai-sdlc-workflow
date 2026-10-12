---
name: setup
description: Detects the Rails project and writes .claude/backend.yml — run once per project or to update it.
when_to_use: 'First use of a backend skill in a project, or a skill reports a missing backend.yml.'
argument-hint: "[--review]"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(git *), Bash(glab auth status*), Bash(gh auth status*), Bash(ruby *)
---
# Setup — configure this project

You prepare the current Rails project for every other `backend:*` skill. The output is one file, `.claude/backend.yml`, whose schema is the template at `${CLAUDE_PLUGIN_ROOT}/skills/setup/templates/backend.yml`.

## Detected facts
```!
ruby "${CLAUDE_PLUGIN_ROOT}/scripts/detect-project.rb" || echo '{"error":"detection failed"}'
```

## 1. Sanity checks
- `rails_project` is false → tell the developer this plugin targets Rails projects and stop (offer to continue anyway only if they insist).
- `existing.backend_yml` is true → read the current `.claude/backend.yml`; you are in **review mode**: show what you would change (only differences vs detection) and ask before touching it.

## 2. Draft the config
Start from the template and fill every key you can from the detected facts:
- `project.*`: `app_name` (snake/kebab-case it), `ruby`, `rails`. `project.description`: one line from `README.md` if obvious, otherwise leave empty.
- `git.*`: `host`, `cli` (`glab` for gitlab, `gh` for github), `remote`, `base_branch` = `default_branch`. Infer branch patterns from `branch_examples` when they show a clear convention (e.g. `feature/PROJ-1-x`, `PROJ-1/x`) — otherwise keep the template defaults. `merge_strategy`: `merge` if `merge_commits_last_100` > 0, else ask.
- `jira.project_key`: `jira_project_key_guess`.
- `api.*`: `controllers_path`, `versions`, `serializers_path`, `swagger.specs_path` (`swagger_specs` or `spec/integration`), `swagger.output_path`, `swagger.tool` = `rswag` if `rswag`/`rswag-specs` is present else `none`. `permissions_file`: only if exactly one candidate looks right — otherwise ask.
- `tests.*`, `lint.*` (empty string for a linter whose gem is absent), `background_jobs`, `authorization`, `observability.errors`.
- `app.local_url`: `http://localhost:<local_port>`. `app.runner_cmd`: `docker compose exec -T <rails service> bin/rails runner` when a `docker-compose.yml`/`compose.yml` runs the app, else `bin/rails runner`.

## 3. Ask only what detection can't know
One `AskUserQuestion` call, up to 4 questions, only for values still unknown or ambiguous. Typical ones:
- Jira site URL + project key (if no guess) · Confluence space key / default folder URL (optional — "skip" is fine).
- Which permissions file (list the candidates) or "none".
- Merge strategy if unclear (explain: squash collapses split commits).
- Commit `.claude/backend.yml` for the team, or keep it personal? · Add `.plans/` to `.gitignore`? (recommend yes)
Never ask for tokens or passwords.

## 4. Write
1. Write `.claude/backend.yml` (create `.claude/` if needed). Keep the template's comments.
2. If the developer chose so: append `.plans/` to `.gitignore`, and/or `.claude/backend.yml` to `.gitignore` (personal mode). Don't commit anything.
3. Create `.plans/` if missing.

## 5. Connectivity check (report, don't fix)
- Git host CLI: run `glab auth status` or `gh auth status`. Not installed / not logged in → tell them the one command to fix it (`brew install glab && glab auth login`, or the `gh` equivalent).
- Atlassian MCP: if a Jira/Confluence tool is available, call its current-user tool once; otherwise say Jira/Confluence steps will need the Atlassian MCP connected.
- Figma MCP: same, if `figma.enabled`.
- Ruby for helper scripts: `ruby -v` must work (any Ruby ≥ 2.6 — the macOS system Ruby is fine; never switch Rubies just for the scripts).

## 6. Finish
Show a compact summary table: key settings, what was asked vs detected, connectivity status (✅/⚠️ with the fix). Then the next steps:
- `/backend:system-overview` — get the big picture of this codebase (cached in `.plans/_system/`).
- `/backend:plan-feature <epic-url> --thoughts "..."` — start a feature.
- `/backend:fix-bug <ticket-url>` — fix a bug.
- Optional status line: add to `~/.claude/settings.json` → `"statusLine": {"type":"command","command":"ruby ${CLAUDE_PLUGIN_ROOT}/scripts/statusline.rb"}` — write the **resolved absolute path** shown here (the variable is not expanded in settings); with a local marketplace it is stable.
