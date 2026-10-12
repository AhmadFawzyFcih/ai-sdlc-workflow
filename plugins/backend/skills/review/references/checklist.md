# Review Checklist — apply ALL categories to EVERY changed file

1. **N+1** — associations eager-loaded (`includes`/`preload`/`eager_load`)? Loops issuing per-iteration queries? `has_many`/`belongs_to` accessed without preload? Serializers included.
2. **Performance** — unnecessary queries; unscoped/unindexed queries; missing pagination; expensive work that belongs in a job; missing caching; fat `select *`; missing indexes for new `where`/`order` columns.
3. **Security** — strong params; authorization on every action; raw SQL without sanitization; unsanitized user input in output; mass assignment; unauthenticated API endpoints.
4. **SOLID** — SRP, Open/Closed, Liskov, Interface Segregation, Dependency Inversion.
5. **Structure** — thin controllers; logic in services; lean models; short methods; duplication; files in the conventional location.
6. **Syntax & style** — Ruby style guide; naming; quotes; unused vars/methods; commented-out code; leftover `puts`/`p`/`debugger`/`binding.pry`/`byebug`.
7. **Specs** — changes covered; happy path AND edges; factories not fixtures; independent examples; existing suite still green.
8. **Backward compatibility** — API contract changes; irreversible migrations; serializer/response-shape breaks; impact on existing clients; feature flag needed?
9. **Error handling** — swallowed errors; unhelpful messages; exceptions as control flow; missing logging.
10. **Rails practice** — RESTful routes; callbacks not overused; validations in models; scopes for common queries; jobs for heavy work.

Severity guide: **Critical** = bug, data loss, security hole, N+1 on a hot path · **Warning** = will hurt soon (perf, structure, missing specs) · **Suggestion** = style / polish.
