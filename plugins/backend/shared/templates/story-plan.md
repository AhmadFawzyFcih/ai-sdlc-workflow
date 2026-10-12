# Story plan: {{story_key}} — {{story_title}}

> **Story**: [{{story_key}}]({{story_url}}) · **Feature**: {{feature_key}} (`../../feature-plan.md`) · **Updated**: {{date}}
> **Figma**: {{figma}} · Updated in place — see Changelog.

---

## 1. What & why
<!-- business summary in 3–5 lines -->

## 2. Acceptance criteria → implementation
| # | Acceptance criterion | Covered by subtask | How it is verified |
|---|----------------------|--------------------|--------------------|

## 3. Design notes (from Figma / spec)
<!-- states (loading/empty/error/success), fields, validations, copy that affects the API; mismatches found and how they were resolved -->

## 4. Technical design
<!-- exact files, classes, methods, migrations, endpoints (request/response shapes), permissions; reuse of existing code -->

## 5. Subtasks (stacked, in order)
Each subtask = one branch on top of the previous one + one draft MR. Keep each reviewable in < 400 changed lines where possible.

### ST1 — {{title}}  ·  Jira: {{key or "not created"}}  ·  Size: S|M|L
- **Goal**: one sentence
- **Files**: `app/...`, `spec/...`
- **Steps**:
  1. …
  2. …
- **Specs**: what is covered (happy path + edges)
- **Edge cases**: …
- **Performance**: …
- **Maintenance**: …
- **Done when**: specs green · rubocop clean · API checklist (if API touched)

<!-- repeat ST2, ST3 … -->

## 6. Architecture decisions
<!-- filled by /backend:implement before ST1: one line per topic — [YYYY-MM-DD] topic: decision — why -->

## 7. Risks & open questions

## Changelog
| Date | Change | Why |
|------|--------|-----|
| {{date}} | Initial plan | — |
