---
name: plan-feature
description: Epic + thoughts → feature-plan.md, API contract (+ Confluence), feature branch and draft MR. Re-run to update.
argument-hint: "<epic-url|KEY> --thoughts \"...\" [--confluence <spec-url...>] [--figma <url...>]"
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(git *), Bash(ruby *), Bash(glab *), Bash(gh *), Bash(open *), Bash(xdg-open *)
---
# Plan feature

You are a senior software architect. Follow `${CLAUDE_PLUGIN_ROOT}/shared/skill-contract.md`. Git rules: `${CLAUDE_PLUGIN_ROOT}/shared/git-flow.md`. Jira/Confluence: `${CLAUDE_PLUGIN_ROOT}/shared/jira-flow.md`.

## 0. Inputs & mode
Parse `$ARGUMENTS`: epic URL or key, `--thoughts` (required — ask with `AskUserQuestion` if missing; offer "no extra thoughts, plan from the tickets"), `--confluence` spec URLs, `--figma` URLs.
`ruby "${CLAUDE_PLUGIN_ROOT}/scripts/plans.rb" resolve <EPIC>`:
- not found → **New** mode: fetch the epic title, then `plans.rb init feature <EPIC> "<title>" --url <url>`.
- found with `feature-plan.md` → **Update** mode (skip to §6).

## 1. Gather (parallel where independent)
- **Epic** + **all child stories** (JQL `parent = <EPIC> ORDER BY rank`): title, description, acceptance criteria, status, labels, links; collect Figma/Confluence URLs found inside.
- **Confluence specs** (given + discovered): full content.
- **System context**: `<plans_dir>/_system/overview.md` if present (if missing and the area is unfamiliar, offer `/backend:system-overview` first — or continue).
- **Code**: start from `_system/overview.md`. Only for what it doesn't cover, spawn **at most one** `Explore` subagent covering all the areas the epic touches (models/services/endpoints to extend, a similar feature to copy patterns from, permission/versioning conventions) and ask for one ≤ 60-line summary with file references.
- If requirements reports exist in the folder, read them.

## 2. Understand & challenge (gate)
Present a short brief: the feature in 5 lines, stories map, key technical questions, risks, and where you disagree with the thoughts (say so, propose the alternative). Then one `AskUserQuestion` (≤ 4 questions) for the real decisions — typically: API versions (V1 only / V1+V2), sync vs async for heavy work, feature flag, scope cuts. Record answers in the plan's Decisions and `context.md`.

## 3. Write `feature-plan.md`
From `${CLAUDE_PLUGIN_ROOT}/shared/templates/feature-plan.md`, in the work item folder. Be specific (exact models, columns, indexes, classes, endpoints, permissions). Every story appears in §3 with dependencies. Then:
`plans.rb update <dir> --story <KEY> title="..." url=... status=planned` for every story (in rank order), log `plan.written`.

## 4. API contract
If the feature adds/changes endpoints: build `api-contract.html` per `${CLAUDE_PLUGIN_ROOT}/shared/references/api-contract.md` (render with `${CLAUDE_PLUGIN_ROOT}/scripts/render-html.rb`, eyebrow "API contract"). Open it.
`AskUserQuestion`: document it on Confluence now? → **Yes** → ask for the Confluence **folder link** (suggest `confluence.default_folder_url` if set) → create the page → `plans.rb update <dir> links.contract_page=<url>` · **Not now**.
No API changes → skip and say so.

## 5. Feature branch & draft MR (gate)
`AskUserQuestion`: **Create a new feature branch** (`plans.rb name feature <EPIC> "<title>"` from `git.base_branch`) · **Use an existing branch** (list `git branch -a --list '*<EPIC>*'` + let them type one) · **Skip for now**.
- New: follow git-flow "Starting a branch + draft MR" — empty start commit, push, draft MR → base. MR description: summary, stories checklist (`- [ ] PROJ-101 Title`), link to contract page if published, notes.
- Existing: `git switch` (clean tree first), find its MR (`glab mr list --source-branch <b>` / `gh pr list --head <b>`); none → create the draft MR as above.
- Record: `plans.rb update <dir> branch=<b> 'mr={"id":..,"url":"..","draft":true}' stage=plan-story`; log `branch.created`/`mr.created`.
- Post one MR comment (when `git.auto_mr_comments`): "📋 Feature plan ready — N stories, M endpoints. Next: story planning." plus 3–5 summary bullets (no secrets, no internal links that don't belong).

## 6. Update mode
1. `P outline feature-plan.md`, then read only the sections the change touches (`P section`), plus `context.md`. Summarize the current plan and the requested change (`--thoughts`); ask clarifying questions with `AskUserQuestion` and **wait**.
2. Edit the plan **in place** (only affected sections) and add a Changelog row (date · change · why). No copies, no `-rev-N` files.
3. API affected → update `api-contract.html` (add a "Changes since last version" callout); if `links.contract_page` exists, ask to update the Confluence page too.
4. Stories added/removed → `plans.rb update` accordingly; story plans already written that are affected → list them and suggest `/backend:plan-story <KEY> --thoughts "..."`.
5. Comment on the feature MR (per `git.auto_mr_comments`, otherwise ask): "📝 Plan updated — <one line>".
6. Log `plan.updated`.

## 7. Finish
Update `context.md` (Where we are, Next step = `/backend:plan-story <first story URL> [--figma ...] --thoughts "..."`, Decisions, Log). Report: files, contract (+ Confluence URL), branch + MR URL, next command.
