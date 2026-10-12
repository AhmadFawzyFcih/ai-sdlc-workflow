---
name: postman
description: Builds a versioned Postman collection (v2.1) for the API endpoints a ticket, MR or the current branch changed.
argument-hint: "[<KEY> | <jira-url> | <mr-url>] [--thoughts \"...\"]"
disable-model-invocation: true
allowed-tools: Read, Write, Glob, Grep, Bash(git *), Bash(ruby *), Bash(mkdir -p *), Bash(bin/rails runner *), Bash(bundle exec rails runner *), Bash(docker compose exec -T web bin/rails runner *), Bash(docker compose cp *), Bash(docker compose ps *), Bash(glab *), Bash(gh *)
---
# Postman collection

You are a senior Rails API developer. Follow `${CLAUDE_PLUGIN_ROOT}/shared/skill-contract.md`.

## 1. Target (from `$ARGUMENTS`)
- Jira key or URL → KEY; `P resolve KEY` → dir, story, subtask. Diff = subtask `base` (else `git.base_branch`) `...` its `branch`.
- MR/PR URL → source + target branch (`glab mr view <id>` / `gh pr view <id>`); fetch as in review's Remote mode; diff `target...source`. KEY from the source branch → `P resolve KEY`.
- Nothing → `P resolve` (current branch); diff `<base>...HEAD` plus `git diff` and `git diff --cached`.
- No API files in the diff → say so and ask (other key / whole feature / stop).

## 2. Gather
From the diff, read in full: routes, controllers (actions, strong params), serializers, policies/permissions (`api.permissions_file`), rswag and request specs (realistic bodies and error cases). Add the story plan's API section (`P section <plan> "API"`), the endpoints in `api-contract.html`, and `--thoughts`. Per endpoint record: method · path · version · body · permission · success status · error statuses (404 / 422 / 403).

## 3. Real data (always — no placeholders)
Every variable gets a real value from the local database.
- One read-only runner script via `app.runner_cmd` from `backend.yml` (e.g. `docker compose exec -T web bin/rails runner`; missing → ask once, write it back), wrapped in `ActiveRecord::Base.connected_to(role: :reading)`.
- Pick the dev user (`app.test_login_hint`), its customer, a project where its role allows every endpoint's permission, and every other record the requests take as input (location/node, form, list entry, existing ticket, …). Prefer the seeded dev ids (e.g. customer 100000, project 100003) when they fit.
- Print raw id + hashed id (the app's own encoder; grep `hashid`/`encode_id`) for each, and the token user's login — never a token.
- Only ids the requests create stay empty; their test scripts fill them.
- DB/container down → never fall back to placeholders: `AskUserQuestion` **Start the database and look up** (show the exact command) · **Stop here**.
- After the runner, `git status` must match the one taken before it (an app boot can rewrite generated files); revert only what the boot changed, after asking.

## 4. Build
Per `references/collection.md`. A previous version for this KEY exists → start from its variable values and descriptions; rebuild the requests from the current code.

## 5. Version and write
- Folder: story or subtask KEY → `<dir>/stories/<STORY>/postman/`; feature without story or bug → `<dir>/postman/`; no work item → `<plans_dir>/postman/`. `mkdir -p` it.
- File: `<KEY>-v<N>.postman_collection.json`, N = highest existing `v<N>` for KEY + 1 (first = `v1`). Never overwrite an older version.
- Validate: `ruby -rjson -e 'JSON.parse(File.read(ARGV[0]))' <file>`; fix until it parses.
- Work item found → `P event <dir> artifact.created "postman v<N>" --data '{"path":"<file>"}'`.

## 6. Finish
Path and version · endpoints / requests count · environment variables it needs · run order · import via Postman → Import.
