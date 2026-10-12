# Architecture — one question round per story

Asked once per story before ST1 (feature mode), and in bugfix mode only when the fix needs a structural change. **Skip entirely** when the story plan's `## Architecture decisions` already has entries.

Propose concretely for THIS story and ask **one** `AskUserQuestion` call with at most these four questions — your proposal as the "(Recommended)" option, 1–2 real alternatives, skip a question that clearly doesn't apply:

1. **Classes & layers** — which classes/services/modules own what; what lives in models vs controllers vs services vs serializers/policies (nothing fat); what is injected instead of hardcoded.
2. **Flow & patterns** — direct calls vs background jobs vs events; transactions, idempotency, failure handling; a pattern only if it genuinely fits (Strategy, Factory, Query/Form object, Command, Decorator…).
3. **API versions** — current API only, or V2/other versions too? Drives every API subtask.
4. **Files** — the proposed tree (controllers, services, jobs, serializers, specs incl. request + rswag).

Record each answer as `- [YYYY-MM-DD] <topic>: <decision> — <why>` in `## Architecture decisions` (+ Changelog row) and `context.md` → Decisions.
