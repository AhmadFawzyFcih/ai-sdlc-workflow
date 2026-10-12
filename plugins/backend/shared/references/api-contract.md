# API contract page (`api-contract.html`)

The initial agreement with the clients of this feature (web, mobile, integrations). Built by `plan-feature`, updated whenever the plan's API changes, optionally published to Confluence.

## Content
1. **Overview** section — what the API enables, in business words; base URL; auth scheme; versions covered; conventions reused from the existing API (error format, pagination, naming).
2. **Summary table** — Method · Path · Purpose · Permission · Versions · Story · Status (`proposed` / `agreed` / `implemented`).
3. **One endpoint block per endpoint** (`.endpoint` component):
   - Description, required permission, when clients should call it.
   - Path / query parameters table (name, type, required, default, description).
   - Request body JSON example (for writes) with a field table (type, required, constraints).
   - Success response JSON example — realistic, complete, matching the serializer that will be built.
   - Error responses table (status, when, example body) using the project's existing error format.
   - cURL example.
   - Notes for clients: idempotency, pagination, async behaviour (e.g. 202 + polling), rate limits, deprecations.
4. **Changes since last version** — callout listing what changed (from the plan Changelog) so clients can react.
5. **Open questions** for client teams.

## Rules
- Derive shapes from the real codebase: read neighbouring controllers/serializers and an existing rswag spec so names, casing, envelopes, pagination meta and error bodies match.
- JSON must be valid and HTML-escaped inside `<pre><code>`.
- Fake but realistic data. No real customer names, emails or ids.

## Confluence version
Same content as the HTML, as a page titled `<Feature title> — API contract` (markdown/storage per `jira-flow.md`). Put the summary table first, then each endpoint with code blocks. Keep a "Changelog" table at the bottom.
