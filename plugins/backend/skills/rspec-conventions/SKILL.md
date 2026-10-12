---
name: rspec-conventions
description: RSpec conventions for specs under spec/.
paths:
  - "spec/**/*.rb"
user-invocable: false
---
# RSpec conventions

Match the project's existing spec style first (read a neighbouring spec before writing a new one).

- Spec path mirrors the app path: `app/services/foo/bar.rb` → `spec/services/foo/bar_spec.rb`.
- `describe` the class / `#method` / `.class_method`; `context` for scenarios ("when …", "with …", "without …"); `it` names state behaviour. `expect` syntax, `subject` for the thing under test.
- Cover the happy path **and** edges: invalid/nil/empty input, boundaries, permissions denied, external failures, large collections (batching), idempotency for jobs.
- FactoryBot (or the project's fixtures): minimal attributes, traits for variants, `build`/`build_stubbed` when persistence isn't needed. `let` lazily; `let!` only when the record must exist.
- Every example independent — no order dependence, no shared mutable state, freeze time (`travel_to`) when time matters.
- Stub external HTTP/services at the boundary (WebMock/VCR or the project's helpers); never hit the network.
- Shared examples for repeated behaviour; custom matchers/helpers for repeated setup.
- Request specs for endpoints (status, body shape, authorization); rswag specs for the documented contract (see api-conventions).
- Before calling a step done, run the affected specs with `tests.cmd` from `.claude/backend.yml` (default `bundle exec rspec <files>`) and make them green. A bug fix starts with a spec that fails for the reported reason.
