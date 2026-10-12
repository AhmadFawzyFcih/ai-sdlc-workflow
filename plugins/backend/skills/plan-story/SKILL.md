---
name: plan-story
description: Story → detailed plan with stacked subtasks → confirm → Jira subtasks. Re-run to update.
argument-hint: "<story-url|KEY> [<main-plan.md>] [--figma <url...>] [--thoughts \"...\"] [--feature <EPIC>] [--labels \"A,B\"]"
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(git *), Bash(ruby *), Bash(glab mr *), Bash(gh pr *)
---
# Plan story

You are a senior Rails architect breaking a story into small, reviewable, **stacked** subtasks. Follow `${CLAUDE_PLUGIN_ROOT}/shared/skill-contract.md`, `${CLAUDE_PLUGIN_ROOT}/shared/jira-flow.md`, `${CLAUDE_PLUGIN_ROOT}/shared/git-flow.md`.

## 0. Inputs & mode
Parse `$ARGUMENTS`: story URL/key (required), an optional path ending in `.md` = **the main plan to use** (instead of the work item's `feature-plan.md`, e.g. an older `implementation-plan-*.md`), `--figma` URLs (optional), `--thoughts` (optional here), `--feature <EPIC>`, `--labels "A,B"` (Jira labels for the new subtasks instead of the parent's).
Find the feature: `--feature`, else the story's parent epic → `plans.rb resolve <EPIC>`.
- Feature work item with `feature-plan.md` → normal.
- No feature plan → `AskUserQuestion`: run `/backend:plan-feature <EPIC>` first (recommended) · plan this story standalone (init the feature work item from the epic and continue without the feature plan).
Story plan already exists (`stories/<KEY>/plan.md`) → **Update** mode (§7).

## 1. Gather
- Story: title, description, AC, attachments, comments, links, labels, existing subtasks (don't duplicate them).
- From `feature-plan.md` only what concerns this story: `P outline`, then `P section` for its phase(s) and the API/decisions sections — never the whole file. Endpoints of this story from `api-contract.html` (grep, don't read it all); decisions in `context.md`.
- Figma (given + found in the story): frames for this story — states, fields, validations, copy. Note mismatches with the story (short list, not a full report; suggest `/backend:analyze-requirements` if there are many).
- Code: read the exact files you'll change; at most **one** `Explore` subagent, only for an area neither you nor `_system/overview.md` has covered.

## 2. Design the subtasks
Rules:
- Ordered and **stacked**: each builds on the previous one (ST1 branches from the feature branch, ST2 from ST1, …). Order by dependency: data → domain/services → API → integration/cleanup.
- Each subtask is independently reviewable (aim < 400 changed lines), has its own specs, leaves the suite green.
- API work respects the API versions decided in the feature plan; permissions and rswag land in the same subtask as the endpoint.
- Migrations get their own subtask when risky (big tables, backfills).

## 3. Write the plan
`stories/<KEY>/plan.md` from `${CLAUDE_PLUGIN_ROOT}/shared/templates/story-plan.md`: AC → subtask mapping, design notes, exact technical design, then ST1…STn with goal, files, steps, specs, edge cases, performance, maintenance, done-when. Log `plan.written`; `plans.rb update <dir> --story <KEY> title=... url=... plan=stories/<KEY>/plan.md status=planned`.

## 4. Show the subtasks (gate)
Write `stories/<KEY>/subtasks.md` — a table: `# · Title (Jira summary) · What it delivers · Size · Depends on` + each subtask's Jira description (goal, scope bullets, done-when; 5–10 lines; no estimates).
Display the table in the chat, then `AskUserQuestion`:
- **Create them in Jira** (recommended)
- **Modify** — the developer says what to change (titles, split/merge, order); apply to `plan.md` + `subtasks.md`, show again, ask again (loop)
- **Don't create in Jira** — keep them local only

## 5. Create in Jira
Per `jira-flow.md` "Creating subtasks", in order: parent = story, assignee = me, reporter = me, labels = `--labels` when given, else the parent's labels, **no estimation**, then transition to `jira.ready_status`.
After each: `plans.rb update <dir> --story <KEY> --subtask <SUB> order=<n> title="..." status=pending branch=<plans.rb name subtask SUB "title">`.
Write the created keys into `plan.md` (each `ST<n>` header) and `subtasks.md`. Log `jira.created` with all keys. Report any field Jira refused.

## 6. Trace on the feature MR
If the feature MR exists and `git.auto_mr_comments`: comment "🧩 <STORY> planned — N subtasks: SUB-1 …" and tick nothing yet. Update the feature MR description's story line with its subtask keys.

## 7. Update mode
Read the existing plan by section (`P outline` / `P section`) + subtasks state. Summarize what changes from `--thoughts`, ask clarifying questions, wait. Edit `plan.md` in place + Changelog row. Subtask changes:
- not yet started → update Jira summary/description (ask first), reorder in state;
- already implemented/committed → never rewrite history silently: propose a follow-up subtask or a fix on that branch (stack rebase per git-flow) and ask.
New subtasks → same create flow (§5).

## 8. Finish
`plans.rb update <dir> stage=implement`. `context.md`: Where we are (story planned, N subtasks), Next step = `/backend:implement <STORY>` (starts ST1), Log. Report: plan path, subtask keys with links, next command.
