---
name: api-conventions
description: API endpoint checklist: permissions, versions, rswag contract, backward compatibility.
paths:
  - "config/routes.rb"
  - "config/routes/**/*.rb"
  - "app/controllers/api/**/*.rb"
  - "app/serializers/**/*.rb"
  - "app/blueprints/**/*.rb"
  - "spec/integration/**/*.rb"
  - "spec/requests/api/**/*.rb"
user-invocable: false
---
# API endpoint conventions

Read `api.*` from `.claude/backend.yml` — paths, versions, permissions file and swagger settings come from there, never from assumptions.

Whenever an endpoint is added or its params/response/behaviour change:

1. **Permissions** — if `api.permissions_file` is set, register/update the action there. Non-negotiable.
2. **Versions** — implement the change in every API version confirmed for this feature (the plan or `context.md` records which). Shared logic lives in services, not duplicated across version controllers.
3. **Contract** — when `api.swagger.tool` is `rswag`: add/update the integration spec under `api.swagger.specs_path/<version>/`, copying a neighbouring spec's helpers, auth setup, tags and schema refs (never a generic template). Cover every parameter, the request body schema + example for writes, and one `response` block per status (2xx, 401, 403, 404, 422 as applicable) with realistic examples. Then run `api.swagger.generate_cmd` and confirm the endpoint appears in `api.swagger.output_path`.
4. **Backward compatibility** — no breaking change to existing params, response shapes, status codes or serializers without a new version or a feature flag. Additive changes only on live endpoints. Migrations reversible.
5. **Consistency** — follow the existing error format, pagination meta, naming (snake_case JSON keys unless the API already uses camelCase) and authentication scheme of neighbouring endpoints.
6. **Performance** — eager-load what the serializer touches; paginate list endpoints; no unbounded queries.

If a feature-level API contract exists (`api-contract.html` in the feature folder), the implementation must match it — or the contract (and Confluence page, if published) is updated in the same step and the change is noted in the plan's Changelog.
