---
name: rails-conventions
description: Rails conventions for Ruby under app/, lib/ and migrations.
paths:
  - "app/**/*.rb"
  - "lib/**/*.rb"
  - "db/migrate/*.rb"
user-invocable: false
---
# Rails conventions

Project-specific rules in the project's own `CLAUDE.md` / `.claude/rules/` win over these. When in doubt, match the surrounding code — consistency with the codebase beats personal taste.

## Structure & responsibility
- Thin controllers: params, authorization, call one service/query, render. No business logic.
- Lean models: associations, validations, scopes, simple predicates. Shared behaviour → concerns; workflows → service objects (`app/services/<domain>/<verb>_<noun>.rb`, one public `call`).
- One responsibility per class and per method; methods short enough to read at a glance. Never duplicate logic — extract.
- Heavy, slow or retry-worthy work → background jobs (`background_jobs` in `.claude/backend.yml`); jobs are idempotent and take ids, not objects.
- RESTful routes and Rails folder conventions. New folders only when the codebase already uses that pattern.

## Style
- Idiomatic Ruby for the project's version (pattern matching, `&.`, `||=`, endless methods only where they read better).
- `snake_case` files/methods/vars, `CamelCase` classes/modules, predicate methods end in `?`, dangerous ones in `!`.
- Single quotes unless interpolating. Follow the project's RuboCop config when present (`lint.rubocop`) — run it on changed files.
- Descriptive names over comments; comment only the *why* of non-obvious code.

## Data & performance
- No N+1: `includes` / `preload` / `eager_load`, including what serializers touch. Use `strict_loading` where the project does.
- Select only needed columns on hot/fat queries; paginate collections; `find_each` / `in_batches` for bulk work; `exists?` over `present?` on relations.
- Index every new column used in `where` / `order` / joins / foreign keys; unique indexes back uniqueness validations.
- Migrations: reversible, safe on large tables (add column → backfill in batches → constraint), no model classes inside migrations, no data + schema change in one migration when the table is big.
- Cache only with a clear invalidation story.

## Errors & security
- Exceptions for exceptional cases, never for control flow. Never swallow errors; rescue narrowly and log with context (ids, not PII).
- Validations in models; strong parameters always; authorize every action (`authorization` in config).
- No string-interpolated SQL — use bind params / Arel / `sanitize_sql`. Escape output; no `html_safe` on user input; guard mass assignment.
- No secrets or credentials in code, specs, logs or commits.
