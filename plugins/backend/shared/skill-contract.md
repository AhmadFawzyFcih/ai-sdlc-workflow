# Rules for every `backend:*` skill

`P` below = `ruby "${CLAUDE_PLUGIN_ROOT}/scripts/plans.rb"`.

1. **Config** — read `.claude/backend.yml`; missing → run the setup workflow first. Never hardcode what it defines; a missing key → ask once, write it back. No secrets anywhere.
2. **Work item** — `P resolve [KEY]` (no key = current branch). New work → `P init`. Layout: `shared/workspace.md`.
3. **Read little** — big plan files are read **by section**: `P outline <file>` then `P section <file> "<heading>"` for the phase/story you need. Never load a whole `feature-plan.md`; `.plans/_system/overview.md` instead of re-exploring code you already summarised. Open shared docs only when the step needs them.
4. **State** — structure/status only via `P update`. Update `context.md` and log events (`P event`) at **checkpoints only**: gate answered, subtask/phase finished, stopping. Not after every small step.
5. **Gates** — real decisions only, via `AskUserQuestion` (batch related questions, max 4 per call). Always ask before: creating tickets, Confluence publishing, Jira comments, comments on MRs you didn't create, force-push, delete. Progress comments on draft MRs this workflow created are fine without asking when `git.auto_mr_comments` is true.
6. **Agents** — only the ones the skill names, never extra fan-out.
7. **Git** — `shared/git-flow.md`; CLI from config (`glab`/`gh`).
8. **Finish** — what was produced (paths/URLs), state, the exact next command.
9. **Docs link** — when the developer says a Confluence page is this work item's documentation (or a docs skill creates/updates that page at their request): `P update <dir> links.docs_page=<url>` + `P event <dir> doc.published "docs page linked"`. Never guess one from searches, Jira links or similar titles — no developer word, no `docs_page`.
