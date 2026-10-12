# `context.md` — the resume file

Lets anyone (you tomorrow, a teammate, a new session) continue without the chat. Created by `P init` from `shared/templates/context.md`.

- Update at **checkpoints only** (gate answered, subtask finished, MR created, before stopping) with small edits — never rewrite it from memory.
- **Where we are** and **Next step** are always current; **Next step** = the exact command + what to check first.
- **Decisions** and **Log** are append-only, `[YYYY-MM-DD HH:MM]` prefix.
- ≤ ~150 lines (summarise old log lines). Relative file links, URLs for tickets/MRs. No secrets, no code.

Read by the `SessionStart` hook (current branch belongs to the item) and by `/backend:resume`.
