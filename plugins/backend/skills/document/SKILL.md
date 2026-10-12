---
name: document
description: rswag/Swagger specs first, then a new Confluence API page or a reviewed update of one.
argument-hint: "--new <confluence-folder-url> | <confluence-page-url>  [<KEY> | <plan.md>] [--thoughts \"...\"]"
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(git *), Bash(ruby *), Bash(bundle exec rspec*), Bash(bundle exec rake rswag*), Bash(open *), Bash(xdg-open *)
---
# Document

You are a senior technical writer. Follow `${CLAUDE_PLUGIN_ROOT}/shared/skill-contract.md` and `${CLAUDE_PLUGIN_ROOT}/shared/jira-flow.md` (Confluence part).

## Modes (from `$ARGUMENTS`)
- `--new <folder-url>` → **New** page under that folder (`/wiki/spaces/<KEY>/folder/<ID>`).
- `<page-url>` → **Update** that page (`/wiki/spaces/<KEY>/pages/<ID>/…`).
- Neither → `AskUserQuestion`: new page (ask folder link; suggest `confluence.default_folder_url`) or update (ask page link).
Work item: KEY / plan path / current branch → `plans.rb resolve`. Read only the API sections: `plans.rb section feature-plan.md "API"` and the story plan's API steps; `api-contract.html` for the endpoints involved.

## Gather
1. Base ref for the diff: the feature branch's base (`git.base_branch`) for a whole feature, or the subtask's `base`.
2. `git diff <base>...HEAD --stat` + read changed controllers, routes, serializers, policies, permissions file. For every endpoint capture: method + full path · controller#action · params (strong params) · request body · response (serializer) · auth · permission · error responses · versions.
3. Fold in `--thoughts`.

## Swagger first — always, both modes
If `api.swagger.tool` is `rswag`: per `${CLAUDE_PLUGIN_ROOT}/shared/references/rswag.md` create/update the specs (neighbouring spec style), run `api.swagger.generate_cmd`, fix until green, verify the endpoints appear in `api.swagger.output_path`. Leave the changes for the committer (implement/full-cycle call it) — when run standalone, ask whether to commit them via `backend:committer`.

## New mode
Build the page per `${CLAUDE_PLUGIN_ROOT}/shared/references/confluence-api-page.md` (mirror a sibling page under the folder if one exists). Title `<Feature> API`. Create it; save URL to `links.docs_page`; log `doc.published`.

## Update mode
1. Fetch the page; parse documented endpoints.
2. Diff against the code: **New** (add) · **Modified** (params/response/behaviour changed) · **Unchanged**.
3. Build `docs/doc-review-<YYYYMMDD-HHMM>.html` in the work item folder with `render-html.rb` (eyebrow "Docs review"): tiles `X new · Y updated · Z unchanged`; New → full doc block; Modified → before/after with `.diff-del`/`.diff-add`; Unchanged → one collapsed list; each item selectable (`data-n`) + selection bar. Open it.
4. `AskUserQuestion`: which numbers to apply (or all).
5. Apply **only** confirmed items, add a Changelog row, preserve everything else byte-for-byte; update the page; log `doc.published`.

## Errors
No endpoints found → say so and ask. Confluence inaccessible → ask to check the link / permissions. Publish fails → save `docs/<feature>-api.md` locally and report. No code changes → document from the plan + contract only (say so on the page as "planned").
