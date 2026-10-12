# Bugfix plan: {{key}} — {{title}}

> **Ticket**: [{{key}}]({{url}}) · **Updated**: {{date}} · **Branch**: `{{branch}}` · **MR**: {{mr}}

## Bug
- **Reported**: what the user sees
- **Expected**: …
- **Steps to reproduce**: 1. … 2. …
- **Environment / data**: …

## Root cause
- **Where**: `file:line`
- **What**: what the code does wrong
- **Why**: mechanism + trigger conditions
- **Since**: commit / MR that introduced it (if found)
- **Evidence**: how we know (spec output, logs, data)

## Impact
Who is affected, severity, blast radius of the fix.

## Fix
### Step 1 — Failing spec
Spec that reproduces the bug for the right reason: `spec/...`
### Step 2 — Fix
Minimal change: files, methods. No drive-by refactors.
### Step 3 — Regression specs
Related edge cases.
<!-- extra steps only if needed: migration / data fix (separate step, reversible, batched), monitoring -->

## Verification
- [ ] Failing spec now green; related suites green
- [ ] rubocop clean on changed files
- [ ] Steps to reproduce re-run in the browser (`app.local_url`) — bug gone
- [ ] No regression in: …

## Changelog
| Date | Change | Why |
|------|--------|-----|
| {{date}} | Initial plan | — |
