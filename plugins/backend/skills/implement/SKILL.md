---
name: implement
description: Implements a planned story subtask by subtask (stacked branch + draft MR each, code + specs, committer agent, optional review/docs), or a bug fix with --bugfix. Resumable.
argument-hint: "<STORY | SUBTASK | EPIC> [<story-plan.md>] [--only <SUBTASK>] [--thoughts \"...\"] [--no-review] [--no-docs]  |  --bugfix <BUG-KEY>"
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(git *), Bash(ruby *), Bash(bundle exec rspec*), Bash(bundle exec rubocop*), Bash(bundle exec rake rswag*), Bash(glab mr *), Bash(gh pr *)
---
# Implement

Senior Rails engineer. One subtask at a time: build → verify → commit → ask before the next. **Never skip ahead.** Rules: `${CLAUDE_PLUGIN_ROOT}/shared/skill-contract.md`; branches/MRs/commits: `${CLAUDE_PLUGIN_ROOT}/shared/git-flow.md`. `P` = `ruby "${CLAUDE_PLUGIN_ROOT}/scripts/plans.rb"`.

## 0. What to implement
- `--bugfix <KEY>` → **bugfix mode**: work item = the bug, plan = `<dir>/plan.md`, branch/MR already made by fix-bug. Skip §1, run the plan's steps as one unit (§2.2 on).
- Arguments: a key or Jira URL; an optional path ending in `.md` = **the story plan to use** (instead of `stories/<STORY>/plan.md`); `--thoughts` = the developer's instructions for this run — they win over defaults (e.g. "branch out from X and point the MR to it", "implement only this subtask").
- A **subtask** key/URL as the argument = `--only <SUBTASK>`: implement just that one and stop after its gates.
- Else `P resolve <arg>`; story = the given one, the one holding the given subtask, or the first with unfinished subtasks. `P show <dir>` + `context.md` → where we are.
- Read **only what this subtask needs**: `P outline stories/<STORY>/plan.md`, then `P section` for the current `ST<n>` and `Architecture decisions`; from `feature-plan.md` only the section the subtask points at (never the whole file).
- Next subtask = `--only`, else lowest `order` not `committed`/`in_review`/`done`. Status `in_progress` → resume: `git status`, `git log <base>..HEAD` on its branch tell what's already done.
- No story plan → stop, suggest `/backend:plan-story <STORY>`.

## 1. Architecture (feature mode, once per story)
Only if the story plan's `## Architecture decisions` is empty: read `${CLAUDE_PLUGIN_ROOT}/shared/references/architecture-topics.md` and ask **one** `AskUserQuestion` with ≤ 4 questions (your proposal as the recommended option each). Write the answers into `## Architecture decisions` + Changelog row and `context.md` → Decisions.

## 2. Subtask loop — `SUB` (n of N)

### 2.1 Branch + draft MR (skip in bugfix mode or when it exists)
Base = the branch named in `--thoughts` if any, else branch of ST n-1, or the feature branch for n = 1 (none → ask: create it, or use `git.base_branch`). Clean tree required (else ask). Start the branch + draft MR per git-flow (Steps = this subtask's steps, "Stacked on !<prev>"). Then one `P update … --subtask SUB status=in_progress branch=… base=… 'mr={…}'` and one event `subtask.started` (data: branch, base, mr). Optional Jira → `jira.in_progress_status`.

### 2.2 Build
For each step: one-line announcement → code + specs (read neighbouring code first; conventions skills apply; API steps follow api-conventions) → run that step's spec files with coverage off (`tests.cmd <spec files>`, e.g. `COVERAGE=false`); failing → fix, re-run, repeat until green. **No state/context/event writes per step** — keep a short running list (step → files → result) in your head for §2.4.

### 2.3 Verify
The subtask's spec files green — only specs the subtask created or changed plus the specs of changed code files, coverage off; never whole unrelated request-spec files (filter big ones by line or `-e`) · `lint.rubocop` on changed files (safe autocorrect only) · API checklist if API touched · diff vs the subtask's "Done when". Deviation from the plan → edit the plan section in place + Changelog. Short summary to the developer.

### 2.4 Commit, push, MR — once
Spawn `backend:committer` (`key`, `branch`, `push=yes`, `context` = the running list). Then, per `git.auto_mr_comments` (else ask once): **one comment per step** (`✅ Step k — what changed (shas)`) and **one** description update ticking all steps. `P update … status=committed`.

### 2.5 Review? (skip with `--no-review`)
`AskUserQuestion`: **Run the code-reviewer agent** · **Skip**. Yes → spawn **one** `backend:code-reviewer` (local, `--plan <story plan>`, `out_dir` = `<dir>/stories/<STORY>/reviews/`; bugfix mode `<dir>/reviews/`), present report path + counts, ask which numbers to fix, apply → specs → committer (`fix(<SUB>): address review — …`) → one MR comment. Fix belongs to an earlier subtask → fix there, `git rebase --update-refs` from the top, `--force-with-lease` after asking.

### 2.6 Docs? (skip with `--no-docs`)
Only when API files changed: `AskUserQuestion` **New Confluence page** (folder link) · **Update a page** (page link) · **Postman collection** · **Skip**. Postman → run the `/backend:postman <SUB>` workflow (read `${CLAUDE_PLUGIN_ROOT}/skills/postman/SKILL.md`), then ask the docs question again without that option. Yes → spawn `backend:doc-writer` (mode, link, dir, plan section, base); update mode: show its diff page, ask numbers, resume it with `apply: …`; rswag changes via committer; URL → `links.docs_page`.

### 2.7 Close — the checkpoint
`P update … status=in_review` (`done` only after merge) · optional Jira → `jira.review_status` · `P event <dir> subtask.done "…"` · `context.md`: Where we are, Next step (`/backend:implement <STORY>` → ST n+1), one Log line. Then `AskUserQuestion`: **Continue with ST n+1** · **Stop here**. Never auto-advance.

## 3. Story finished
Story `status=done|in_review`; tick it on the feature MR + one comment ("✅ <STORY> — MRs !a !b !c", per `git.auto_mr_comments`). Next: `/backend:plan-story <next>`; all stories done → ask before marking the feature MR ready.

## 4. Bugfix mode
Steps from the bug plan (failing spec → fix → regression specs); same verify, committer (`fix(<BUG>): …`), review gate, docs gate only if API changed. Hand back to fix-bug for browser verification.

## Errors
Specs stay red → stop, show, ask. Plan wrong → say so, fix in place, ask. Push rejected → never force; report.
