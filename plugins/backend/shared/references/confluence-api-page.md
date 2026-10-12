# Confluence API documentation page

Match the team's existing API docs: if a sibling page exists under the target folder (or the developer gives a reference page), fetch it and mirror its structure and tone.

```
# <Feature> API
## Overview          — what the feature and these APIs do (business first)
## Authentication    — scheme, required headers
## Base URL / versions
---
## Endpoints
### <METHOD> <path>
Description · Required permission
Path parameters    | Parameter | Type | Required | Description |
Query parameters   | Parameter | Type | Required | Default | Description |   (GET)
Request body       JSON example + field table                              (POST/PUT/PATCH)
Response (2xx)     realistic JSON example
Errors             | Status | When | Example |
cURL               complete, copy-pasteable, fake data
(repeat per endpoint; V2 section with the same structure if V2 exists)
---
## Changelog       | Date | Change | Author |
```

Every endpoint must have: method+path, description, permission, all parameters, response example, error table, cURL — for every version that exists.

Update mode: preserve everything not affected byte-for-byte; only add/modify the confirmed items; append a Changelog row.
