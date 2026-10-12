---
name: review
description: Reviews Rails code changes — the local uncommitted diff or a remote GitLab MR / GitHub PR URL — against the Rails review checklist and produces an interactive HTML report with selectable fixes. Use when asked to review changes, check a diff, or review an MR.
argument-hint: "[local | <mr-or-pr-url>] [--plan <plan.md>]"
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(ruby *), Bash(mkdir -p *), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git fetch:*), Bash(bundle exec rspec:*)
---
# Review

You are a senior Rails reviewer.

## Working-tree snapshot
!`git status --short`
!`git diff --stat`

## Mode
- No argument or `local` → **Local**: review uncommitted changes (staged + unstaged).
- URL containing `merge_requests` or `pull` → **Remote**: review that MR/PR. **Comment only — never edit code or run specs in remote mode.**
- `--plan <path>` (local only) → offer a plan revision afterwards if fixes changed the design.
- `--out <dir>` → write the report there (callers pass the work item's `reviews/` folder).

## Workflow
1. Get the diff. Local: `git diff`, `git diff --cached`, `git status`. Remote: GitLab `git fetch origin merge-requests/<ID>/head:mr-<ID> && git diff main...mr-<ID>`; GitHub `git fetch origin pull/<ID>/head:pr-<ID> && git diff main...pr-<ID>`; fall back to fetching the MR page.
2. Read each changed file in full for context, not just the hunks.
3. Read `references/checklist.md` and apply every category to every file.
4. For each concern record: file:line · category · severity (Critical / Warning / Suggestion) · what's wrong · how to fix · code snippet.
5. Build the report per `references/html-report.md` into a `reviews/` folder — **never loose in `<plans_dir>`** (`shared/workspace.md`):
   - Folder: `--out` if given; else `ruby "${CLAUDE_PLUGIN_ROOT}/scripts/plans.rb" resolve [KEY]` (local: current branch; remote: the key in the MR's source branch) → feature with a story: `<dir>/stories/<STORY>/reviews/`; feature without story or bug: `<dir>/reviews/`; not found: `<plans_dir>/reviews/`. `mkdir -p` it.
   - File: Local → `review-<date>-<HHMMSS>.html`; Remote → `review-mr-<ID>-<date>.html`. Present it.
6. `AskUserQuestion`: which numbered concerns to act on (or "all" / "skip").
   - Local: apply fixes → `bundle exec rspec <changed spec files>` → fix failures → confirm.
   - Remote: post the selected concerns as MR/PR comments via the available API; if none, output them formatted for copy-paste.
7. If `--plan` was given and fixes changed the design, offer: `/plan <plan.md> --thoughts "<summary of changes>"`.

## Errors
No local changes → say there is nothing to review. Bad/inaccessible URL → ask to check it. Specs fail after fixes → report and fix before finishing. No git → ask for the diff.
