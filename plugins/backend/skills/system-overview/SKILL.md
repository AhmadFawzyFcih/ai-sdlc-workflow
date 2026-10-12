---
name: system-overview
description: HTML overview of the whole codebase (business, domains, integrations, flows, hotspots) plus a short markdown summary; cached.
when_to_use: '"overview of this system", "what does this app do", before planning in an unfamiliar area.'
argument-hint: "[--refresh | --full] [focus or questions]"
allowed-tools: Read, Glob, Grep, Bash(git *), Bash(ruby *), Bash(open *), Bash(xdg-open *)
---
# System overview

Follow `${CLAUDE_PLUGIN_ROOT}/shared/skill-contract.md` (config first). Output lives in `<plans_dir>/_system/`.

## Cache status
```!
P=$(ruby -ryaml -e 'puts((YAML.load_file(".claude/backend.yml")["plans_dir"] rescue nil) || ".plans")' 2>/dev/null || echo .plans); cat "$P/_system/overview.meta.json" 2>/dev/null || echo "no overview yet"; echo; echo "HEAD: $(git rev-parse HEAD 2>/dev/null) ($(git log -1 --format=%cd --date=short 2>/dev/null))"; true
```

## 1. Decide the mode
- No overview yet, or `--full` → **full**.
- Overview exists and `--refresh` (or HEAD moved by > 50 commits since the cached sha) → **incremental** from the cached `sha`.
- Overview exists and HEAD barely moved and no flag → tell the developer it is current (date + sha), offer `--refresh`, and open it. Stop.

## 2. Delegate
Spawn the `backend:system-explorer` subagent (Agent tool) with: mode, `since_sha` (incremental), `out_dir` = `<plans_dir>/_system`, and the developer's focus/questions from `$ARGUMENTS`. While it runs, don't explore yourself — keep this context light.

## 3. Present
- Open the HTML (`open <path>` on macOS, `xdg-open` on Linux) and give its path.
- Show the agent's highlights (5 bullets) and gaps.
- Suggest next: `/backend:feature-overview <key or name>` for a specific area, or `/backend:plan-feature <epic> --thoughts "..."`.

No work item is involved, so no state/context updates — but if the current branch belongs to a work item, log `artifact.created` there.
