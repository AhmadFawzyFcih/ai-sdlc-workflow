---
name: full-cycle
description: Runs the whole epic workflow — plan, stories, subtasks, review, docs — pausing only at decisions; resumable.
argument-hint: "<epic-url|KEY> --thoughts \"...\" [--figma <url...>] [--analyze] [--confluence-folder <url>]"
disable-model-invocation: true
---
# Full cycle

You are the orchestrator. **Keep this context thin**: heavy read-only work runs in subagents; interactive stages run here because they need the developer. The work item's `state.json` + `context.md` are the single source of truth — re-read them instead of relying on memory, and update them after every stage. Follow `${CLAUDE_PLUGIN_ROOT}/shared/skill-contract.md`.

## 0. Start or resume
`plans.rb resolve <EPIC>`:
- Exists → read `state.json`/`context.md`, show where it stands (`plans.rb show`), `AskUserQuestion`: **continue from <stage/step>** · restart a stage · stop.
- New → continue with stage 1.

## Stages
Each stage = run the named skill's workflow (read its SKILL.md under `${CLAUDE_PLUGIN_ROOT}/skills/<name>/`) with the inputs below. Its own gates apply.

1. **Setup check** — `.claude/backend.yml` missing → `setup` workflow.
2. **System context** — `<plans_dir>/_system/overview.md` missing or older than 50 commits → `AskUserQuestion`: generate/refresh now (runs `system-overview` → `backend:system-explorer`) · skip.
3. **Requirements** (with `--analyze`, or ask once when Figma links exist) → `analyze-requirements` via `backend:requirements-analyst`; its mismatch bullets join the thoughts.
4. **Feature plan** → `plan-feature` with the epic, thoughts, Confluence specs, Figma; includes contract (+ Confluence, using `--confluence-folder` as the suggested folder) and the feature branch + draft MR.
5. **Per story, in rank order:**
   a. `plan-story` (Figma links found for this story) → plan + subtasks → confirm → Jira.
   b. `implement <STORY>` → subtask loop (stacked branch + draft MR, code + specs, committer, review gate, docs gate, continue gate).
   c. Story done → feature MR updated; `AskUserQuestion`: next story · stop here.
6. **Feature wrap-up** — all stories done: feature MR description complete (stories, subtask MRs, contract/docs links); `AskUserQuestion`: mark feature MR ready · final `review` of the whole feature branch vs base · update docs page · stop. `plans.rb update <dir> stage=done` only after merge.

## Pause points (only these)
Missing config · overview refresh · unmapped requirements · plan decisions · contract publishing · branch choice · subtask confirmation · architecture topics (once per story) · review gate · docs gate · continue gate · story/feature wrap-up. Everything else auto-continues.

## Errors
A stage fails → record it (`plans.rb event <dir> error ...`, `context.md` Open questions), `AskUserQuestion`: retry · skip · stop. Stopping is always safe — `/backend:resume <EPIC>` or `/backend:full-cycle <EPIC>` continues later.

## Finish
Summary: stories & subtasks with MR links, contract/docs URLs, decisions, open questions, total time (first to last event).
