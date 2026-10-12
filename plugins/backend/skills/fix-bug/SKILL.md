---
name: fix-bug
description: Fixes a Jira bug: 2 investigators find the root cause, failing spec, fix, commits, optional review, Chrome check.
argument-hint: "<bug-url|KEY> [--thoughts \"hints\"]"
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(git *), Bash(ruby *), Bash(bundle exec rspec*), Bash(bundle exec rubocop*), Bash(glab mr *), Bash(gh pr *), Bash(curl -s -o /dev/null -w *)
---
# Fix bug

Follow `${CLAUDE_PLUGIN_ROOT}/shared/skill-contract.md`, `${CLAUDE_PLUGIN_ROOT}/shared/git-flow.md`, `${CLAUDE_PLUGIN_ROOT}/shared/jira-flow.md`.
Every file this skill writes — `investigation.md`, `plan.md`, screenshots, review reports — goes into the bug folder (`<plans_dir>/bugs/<KEY>-<slug>/`); never a `bugfix-*.md` or report at the top of `<plans_dir>`.

## 1. Intake
- Fetch the ticket: title, description, steps to reproduce, expected vs actual, environment, attachments, comments (QA clues), linked issues. Merge `--thoughts`.
- `plans.rb resolve <KEY>`; not found → `plans.rb init bug <KEY> "<title>" --url <url>`.
- If error-tracking/log tools are available (Sentry, Datadog, …) search for matching errors now — pass stack traces to the investigators.
- One-paragraph understanding to the developer (no question yet — keep moving).

## 2. Investigate in parallel
Spawn **exactly 2 `backend:bug-investigator` subagents in one message** — no more, never a third — with the same ticket summary and angles `code-path` and `regression`. Then judge **yourself** (no extra agents):
- Agreeing hypotheses with evidence → root cause.
- Conflicting → settle it in this context: read the specific lines both point at and check them against the ticket (a quick read-only spec run is fine). Still unclear → say so and ask the developer for more info.
- Either says **not a bug** (expected behaviour, data issue, frontend, config) with stronger evidence → present it and a suggested ticket reply; `AskUserQuestion`: agree & stop (offer to post the reply on Jira) · investigate further · fix anyway.
Write `investigation.md` in the bug folder: the two reports (condensed), the verdict, evidence.

## 3. Confirm the root cause (gate)
```
Root cause
Where:  file:line
What:   what the code does wrong
Why:    mechanism + trigger conditions
Since:  commit / MR (if found)
Impact: who/what, severity
```
`AskUserQuestion`: **Matches — write the plan & fix** · **Add info / I disagree** (re-investigate with it) · **Stop**.

## 4. Plan
`plan.md` from `${CLAUDE_PLUGIN_ROOT}/shared/templates/bugfix-plan.md`. Steps: failing spec → minimal fix → regression specs (+ separate migration/data-fix step only if needed). Log `plan.written`; `plans.rb update <dir> stage=plan`, then `stage=implement` when §6 starts.

## 5. Branch & draft MR
`AskUserQuestion` once: **New branch** `plans.rb name bugfix <KEY> "<title>"` from `git.base_branch` (recommended; or a release/hotfix branch they name) · **Existing branch** (list `*<KEY>*`). Then git-flow start: empty commit, `git push -u <git.remote> <branch>`, draft MR with description = Bug / Root cause / Fix steps checklist. Record branch/MR; log events.

## 6. Implement — failing spec first
Run `/backend:implement --bugfix <KEY>` workflow (read `${CLAUDE_PLUGIN_ROOT}/skills/implement/SKILL.md` §4):
- **Architecture discussion is skipped** — unless the fix needs a structural change (new class, changed contract, migration); then ask only about that.
- Write the reproducing spec, run it, and show it **fails for the reported reason** (that's the proof it is real). Then fix minimally, run it green, add regression specs, run related suites + rubocop.

## 7. Commit
`backend:committer` with `key=<KEY>`, `push=yes`. Tick steps + one comment per step on the MR (`git.auto_mr_comments`).

## 8. Review? (gate)
`AskUserQuestion`: **Run the code-reviewer subagent** · **Skip → go to verification**.
`plans.rb update <dir> stage=review`. Yes → spawn **one** `backend:code-reviewer` subagent (local mode, `--plan <bug plan path>`, `out_dir` = `<dir>/reviews/`); it writes the HTML report and replies with report path + counts. Present it; `AskUserQuestion`: **Fix selected comments** (numbers) · **Don't fix, continue**. Fixes → specs → committer → MR comment (per `git.auto_mr_comments`). Then step 9.

## 9. Verify in the browser (Claude in Chrome)
`plans.rb update <dir> stage=verify`.
- Browser tools available (Claude in Chrome connected: started with `claude --chrome` or enabled via `/chrome`)?
  - App reachable? `curl -s -o /dev/null -w '%{http_code}' <app.local_url>`; not running → ask the developer to start it (`bin/dev` / `rails s`) and wait for their go.
  - Log in per `app.test_login_hint` (ask the developer to log in if a login page appears — never type real passwords you weren't given).
  - Follow the ticket's **steps to reproduce** exactly, then confirm the **expected** behaviour; check the console/network for errors. Take a screenshot of the result (save to the bug folder).
  - Still broken → back to §2 with the new evidence (again 2 investigators at most).
- No browser tools → say how to enable them (`/chrome`), and give the developer a 3–5 line manual check list instead; the failing→passing spec remains the proof.
Log `note` "Verified in browser" (or manual).

## 10. Finish
- MR description: add **Root cause**, **Fix**, **How verified** (spec + browser, screenshot if useful). Comment "🐞 Fixed & verified" (per `git.auto_mr_comments`, otherwise ask).
- `AskUserQuestion`: mark MR ready? · comment on the Jira ticket with root cause + fix summary (draft shown first)? · move ticket to `jira.review_status`? — do only what they confirm.
- Stage stays `verify` until the MR is merged → then `plans.rb update <dir> stage=done`. `context.md` updated. Report: root cause, MR link, specs, verification result.
