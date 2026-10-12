# Postman collection format (v2.1)

## Top level
```json
{ "info": { "_postman_id": "<new uuid>", "name": "<Title> (<KEY>) v<N>", "description": "…",
            "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
  "item": [ …folders… ],
  "variable": [ { "key": "customer_id", "value": "ymjxnx", "description": "HashIds of customer 100000" } ] }
```
`info.description` (markdown): which environment it needs (`api_url`, `api_v2_url`, `token` — from the developer's Postman environment, never in the file) · the real local data used (`record id → hashed id (variable)`, the token user and why it has access) · the run order ("Run folder 1 first: …") · the docs link (`links.docs_page`) when there is one.

## Variables
Collection variables only. IDs found in step 3 get their real value and a description naming the record, e.g. `"HashIds of customer 100000 (<name>)"`. Only IDs that requests create start empty, with `"description": "Set by '<request name>'"`. No `auth` block, no environment file, no secrets.

## Folders and requests
- Folders numbered by resource or flow: `1. Answer sets`, `2. Form fields (…)`. Later folders may use IDs saved by earlier ones.
- Order inside a folder: create → list → search/filter → show → update → delete → error cases.
- Names: `Create answer set — Severity (5 answers)`, `List answer sets`, `Show unknown answer set → 404`, `Create invalid answer set → 422`.
- Error cases from the code: unknown/other customer's id → 404 · validation failures → 422 (one per meaningful rule) · missing permission → 403 when a policy applies.

## One request
```json
{ "name": "Create answer set — Severity",
  "event": [ { "listen": "test", "script": { "type": "text/javascript", "exec": [
    "pm.test(\"status 201\", () => pm.response.to.have.status(201));",
    "const j = pm.response.json();",
    "pm.collectionVariables.set(\"answer_set_id\", j.data.id);" ] } } ],
  "request": {
    "method": "POST",
    "header": [ { "key": "<auth header>", "value": "{{token}}", "type": "text" },
                { "key": "Content-Type", "value": "application/json", "type": "text" } ],
    "body": { "mode": "raw", "raw": "<pretty JSON string>", "options": { "raw": { "language": "json" } } },
    "url": { "raw": "{{api_v2_url}}/{{customer_id}}/checklist_answer_sets",
             "host": ["{{api_v2_url}}"], "path": ["{{customer_id}}", "checklist_answer_sets"] },
    "description": "One line: what it does and which variable it saves." },
  "response": [] }
```
- Auth header: the one the API authenticates with (read the base API controller), e.g. `X-Api-Key`.
- Host variable by version: `{{api_url}}` for v1, `{{api_v2_url}}` for v2 (one variable per entry in `api.versions`).
- Body in the API's own shape (JSON:API `data/type/attributes` when the serializers use it), dasherized keys if the API uses them; values realistic, from specs/factories.
- Query strings go in `url.raw` and as `url.query` entries.
- Every request has a status `pm.test`; add one or two assertions that prove the behaviour (e.g. ids assigned, filter applied). GET/DELETE have no body.
