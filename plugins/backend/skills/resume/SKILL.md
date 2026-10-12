---
name: resume
description: Continues a feature or bug from its context.md and state, checks git/MR reality, proposes the next step.
when_to_use: '"continue where we stopped", "resume PROJ-100", "where were we".'
argument-hint: "[KEY | path/to/context.md] [<file.md to continue from>]"
allowed-tools: Read, Glob, Grep, Bash(git *), Bash(glab mr view*), Bash(gh pr view*), Bash(ruby *)
---
# Resume

Follow `${CLAUDE_PLUGIN_ROOT}/shared/skill-contract.md`.

## Current workspace
```!
ruby "${CLAUDE_PLUGIN_ROOT}/scripts/plans.rb" list || true
```

## 1. Find the work item
- `$ARGUMENTS` is a key → `ruby "${CLAUDE_PLUGIN_ROOT}/scripts/plans.rb" resolve $ARGUMENTS`.
- `$ARGUMENTS` is a path to a `context.md` (e.g. a teammate's) → read it; if it has no work item folder in this project, offer to create one with `plans.rb init` using the key/title from the file, then copy the content in.
- A second argument ending in `.md` (any plan under `.plans/`, e.g. `stories/<KEY>/plan.md` or an older `implementation-plan-*.md`) = **the file to continue from**: use it as the plan in §2 and §4 instead of guessing, even if it lives outside the work item folder.
- Empty → resolve by current branch; nothing found → show the list above with `AskUserQuestion` (most recently updated first).

## 2. Load
Read `context.md`, run `plans.rb show <dir>`, read the last ~20 lines of `events.jsonl`, and only the plan section for the current step (`plans.rb outline` → `plans.rb section`) — from the file given as second argument when there is one.

## 3. Reality check (read-only)
Compare what the files say with what is true now, and list every mismatch:
- `git status --short` (uncommitted work?), current branch vs the branch the next step needs, local vs remote (`git rev-list --left-right --count <branch>...<remote>/<branch>`).
- MR state of the current subtask/bug (`glab mr view <id>` / `gh pr view <id>`): merged? new review comments? target branch still correct (stacked MRs get retargeted after merges)?
- Jira status only if the next step depends on it.

## 4. Brief the developer
Short, scannable:
- **Item**: key, title, stage, progress (e.g. story 2/3, subtask 3/5)
- **Last done** · **Next step** (from `context.md`, adjusted by the reality check)
- **Mismatches** found, each with the fix you propose
- **Open questions** from `context.md`

Then `AskUserQuestion`: continue with the next step (name the exact skill/command) · fix the mismatches first · show more detail · do something else.

## 5. Continue
On "continue", switch to the needed branch if required (clean tree first) and run the named skill's workflow from the right point — e.g. `/backend:implement <KEY>` resumes the current subtask at the recorded phase. Log `note` "Resumed" and update `context.md` → Log.
