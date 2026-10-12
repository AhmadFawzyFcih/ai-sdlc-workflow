---
name: address-review
description: Handles reviewers' comments on your MR: fix or reply, push, answer the threads.
argument-hint: "[<mr-or-pr-url> | <SUBTASK>]"
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(git *), Bash(ruby *), Bash(bundle exec rspec*), Bash(bundle exec rubocop*), Bash(glab mr *), Bash(glab api *), Bash(gh pr *), Bash(gh api *)
---
# Address review

Follow `${CLAUDE_PLUGIN_ROOT}/shared/skill-contract.md` and `${CLAUDE_PLUGIN_ROOT}/shared/git-flow.md`.

## 1. Find the MR
URL given, or the subtask key / current branch → its `mr` in `state.json`. Make sure the local branch is checked out, clean and up to date with its remote (`git fetch`; behind → `git pull --ff-only` after asking).

## 2. Fetch threads
GitLab: `glab api "projects/:id/merge_requests/<iid>/discussions?per_page=100"` → unresolved, resolvable notes not written by me. GitHub: `gh api graphql` → `repository(owner,name){ pullRequest(number){ reviewThreads(first:100){ nodes{ id isResolved path line comments(first:20){ nodes{ author{login} body url } } } } } }` → unresolved ones (reply with `gh api repos/:owner/:repo/pulls/<n>/comments/<id>/replies`).
For each: author, file:line, the code it points at (read it now), the comment, the replies so far.

## 3. Triage
Classify: **must-fix** (bug, contract, security) · **change requested** · **question** · **nit** · **disagree** (you believe the current code is right — explain why with evidence). Propose per thread: the code change (concise) and/or a reply draft (≤ 2 lines, friendly, specific; for disagreements: respectful reasoning + offer an alternative).
Show a numbered table; `AskUserQuestion`: **Apply all proposals** · **Pick numbers** · **Let me adjust replies first**.
This selection only scopes the work — it never authorises an edit or a post. The per-action gates in steps 4 and 5 always apply.

## 4. Apply
- **Before touching any file**, per thread: show the exact planned change (files + diff sketch) and `AskUserQuestion`: **Apply** · **Adjust** · **Skip**. Edit nothing that was not approved.
- Make the approved changes; run related specs; rubocop on changed files.
- **Before committing**, show the resulting `git diff` and ask once more (**Commit + push** · **Adjust** · **Stop**).
- Change belongs to an **earlier subtask** of the stack → make it on that branch, then from the top branch `git rebase --update-refs <feature-branch>` and push each moved branch with `--force-with-lease` (ask first).
- Commit via `backend:committer` (`fix(<KEY>): address review — <summary>`), push.

## 5. Reply
**Before posting**, show every reply in its final wording (with the real sha filled in) and `AskUserQuestion` per reply: **Post** · **Edit** · **Skip** — batched up to 4 per call. Never post an unapproved reply. Then post each approved reply (include the short sha when code changed: "Done in a1b2c3d — moved the query into the scope."). Resolve threads only if the developer says so (`AskUserQuestion` once: resolve the ones I fixed / leave for the reviewer). Log `mr.updated`, update `context.md`.

## 6. Finish
Report: threads handled (fixed / replied / skipped), commits, anything waiting on the reviewer. Suggest re-requesting review.
