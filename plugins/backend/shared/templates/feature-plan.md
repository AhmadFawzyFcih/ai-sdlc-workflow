# Feature plan: {{title}}

> **Epic**: [{{key}}]({{url}}) · **Updated**: {{date}} · **Branch**: `{{branch}}` · **MR**: {{mr}}
> Updated in place — see the Changelog at the bottom. Never create a copy of this file.

---

## 1. Summary
<!-- 3–5 lines, business language: what users get and why it matters now -->

## 2. Goals / non-goals
- **Goals**: …
- **Non-goals**: … (explicitly out of scope)

## 3. Stories
| # | Story | What it delivers | Depends on | Status |
|---|-------|------------------|------------|--------|
| 1 | [PROJ-101](…) Title | … | — | planned |

## 4. Current system (what we build on)
<!-- relevant domains, models, endpoints, jobs; link .plans/_system/overview.md sections; existing patterns to reuse -->

## 5. Design
### 5.1 Domain & data
<!-- new/changed models, columns, indexes, associations, migrations (safe-migration notes), backfills -->
### 5.2 Services, jobs, policies
<!-- each class: responsibility, public interface, collaborators; sync vs async; idempotency -->
### 5.3 API
<!-- table of endpoints: method, path, purpose, auth/permission, versions (v1/v2), story; full examples live in api-contract.html -->
| Method | Path | Purpose | Permission | Versions | Story |
|--------|------|---------|------------|----------|-------|
### 5.4 Permissions & multi-tenancy
### 5.5 Feature flag & rollout
### 5.6 Observability
<!-- logs, metrics, error reporting, alerts -->

## 6. Cross-cutting concerns
- **Edge cases**: …
- **Performance**: … (query plans, N+1 risks, pagination, batch sizes, caching)
- **Security**: …
- **Backward compatibility**: …
- **Maintainability**: … (patterns, extension points, what NOT to over-engineer)

## 7. Testing strategy
<!-- unit / request / rswag / integration; data setup; what must be covered per story -->

## 8. Risks & open questions
| # | Risk / question | Impact | Owner | Status |
|---|-----------------|--------|-------|--------|

## 9. Decisions
<!-- [YYYY-MM-DD] decision — why (architecture topics, V2 yes/no, etc.) -->

---

## Changelog
| Date | Change | Why |
|------|--------|-----|
| {{date}} | Initial plan | — |
