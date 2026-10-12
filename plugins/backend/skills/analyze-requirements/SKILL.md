---
name: analyze-requirements
description: Jira stories vs Figma designs mismatch report, optionally published to Confluence.
argument-hint: "<PROJ-123 ...> | \"Sprint 5\" | PROJ  [--figma <url...>] [--check-linked-tasks] [--feature <EPIC>] [--confluence-folder <url>]"
disable-model-invocation: true
allowed-tools: Read, Write, Glob, Bash(ruby *)
---
# Analyze requirements

Follow `${CLAUDE_PLUGIN_ROOT}/shared/skill-contract.md`.

## 1. Parse `$ARGUMENTS`
Ticket keys (comma/space separated) · quoted sprint name · bare project key · Figma URLs (inline or after `--figma`) · `--check-linked-tasks` · `--feature <EPIC>` · `--confluence-folder <url>`.

## 2. Where the report goes
- `--feature` given, or the stories share a parent epic that has a work item → that feature folder.
- Parent epic has no work item → `plans.rb init feature <EPIC> "<epic title>" --url <url>` (stage stays `plan-feature`).
- No epic (loose stories / sprint) → `<plans_dir>/requirements/`.
File: `requirements-<YYYYMMDD-HHMM>.md`.

## 3. Delegate
Spawn the `backend:requirements-analyst` subagent with the stories, Figma URLs, `check_linked`, `out_path`.

## 4. Unmapped items
If the agent reports unmapped stories/frames → show the mapping and `AskUserQuestion` (confirm as-is / I'll give more Figma links / re-map these). Re-run the agent with the extra input when needed.

## 5. Present & publish
- Show the mismatch bullets (they are ready-made `--thoughts` for planning) and the report path.
- `AskUserQuestion`: publish to Confluence? (folder from `--confluence-folder`, else `confluence.default_folder_url`, else ask for the folder URL) · skip.
- Publish per `${CLAUDE_PLUGIN_ROOT}/shared/jira-flow.md` with title `Requirements analysis — <keys or sprint> — <YYYY-MM-DD>`.
- Report in a feature folder → store the URL in `links.requirements_page`, log `artifact.created` (+ `doc.published`), add a line to `context.md` → Log. Report in `<plans_dir>/requirements/` (no work item) → skip state/events.
- Next: `/backend:plan-feature <EPIC> --thoughts "<mismatch summary + your decisions>"` or `/backend:plan-story <story>`.
