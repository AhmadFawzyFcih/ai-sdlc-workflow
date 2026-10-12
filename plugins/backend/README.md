# backend — Claude Code plugin for Rails backend work

Every skill is `/backend:<skill>`. Project values live in the project's `.claude/backend.yml` (created by `/backend:setup`). Overview, install and the full skill list: [root README](../../README.md).

## Layout

```
backend/
├── .claude-plugin/plugin.json
├── skills/<name>/SKILL.md           # 13 skills + 3 path-scoped convention skills
├── agents/                          # system-explorer, feature-explorer, requirements-analyst,
│                                    # bug-investigator, committer, code-reviewer, doc-writer
├── hooks/hooks.json                 # SessionStart · PreToolUse(Bash)
├── scripts/
│   ├── plans.rb                     # workspace CLI (below)
│   ├── lib/plans.rb                 # library shared by the CLI and hooks
│   ├── detect-project.rb            # /backend:setup
│   ├── codebase-stats.rb            # system-explorer
│   ├── render-html.rb               # body fragment → themed page
│   ├── statusline.rb                # optional status line
│   └── hooks/{session_context,pre_bash}.rb
└── shared/                          # compact rules the skills open when needed
    ├── skill-contract.md            # the 8 rules every skill follows
    ├── workspace.md                 # .plans/ layout, CLI, state.json shape
    ├── git-flow.md                  # stacked branches, draft MRs, commits, glab↔gh
    ├── jira-flow.md                 # Jira subtasks & Confluence via Atlassian MCP
    ├── config.md · context-file.md · events.md · html-report.md
    ├── references/                  # architecture topics, rswag, API contract, Confluence page
    ├── templates/                   # context, feature/story/bugfix plans
    └── html/{theme.css,shell.html}
```

## `plans.rb`

```bash
P="ruby plugins/backend/scripts/plans.rb"
$P resolve [KEY]                                  # which work item (by key or current branch) → JSON
$P init feature|bug KEY "Title" [--url U]         # create folder + state.json + context.md
$P update <dir|KEY> [--story S [--subtask T]] k=v # upsert state (values parsed as JSON)
$P event <dir|KEY> <type> "msg" [--data '{}']     # milestone log
$P show <dir|KEY> · $P list                       # summaries
$P name feature|subtask|bugfix KEY "Title"        # branch name from git.*_branch_pattern
$P outline <file.md>                              # headings with line numbers
$P section <file.md> "<heading regex>"            # print just that section
```
Stdlib-only Ruby ≥ 2.6 — runs under the macOS system Ruby, no bundler. Keep it that way: no endless `def x = …`, `filter_map`, `tally`, `Hash#except`, pattern matching or `{x:}` shorthand.

## Hooks

| Event | Does | Active when |
|-------|------|-------------|
| `SessionStart` | Current branch belongs to a work item → prints its state + `context.md` into the session; Rails project without config → one-line hint to run setup | git repo |
| `PreToolUse(Bash)` | Blocks debug statements in staged Ruby on `git commit`, plain `--force` pushes, commits/pushes on the base branch | `.claude/backend.yml` exists |
