# `.claude/backend.yml`

One per Rails project, written by `/backend:setup` from `skills/setup/templates/backend.yml` (the template documents every key). No secrets — tokens live in `glab`/`gh` auth and the MCP servers. Committed (team defaults) or git-ignored (personal): the developer's choice.

Patterns: `{key}` ticket key · `{slug}` ≤ 5 kebab words · `{type}` feat|fix|refactor|test|docs|chore|perf|db · `{summary}` imperative, ≤ 72 chars line.

Script access: `ruby -ryaml -e 'puts YAML.load_file(".claude/backend.yml").dig("git","base_branch")'`.
