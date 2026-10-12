# `events.jsonl`

Append-only audit trail in the work item folder, written with `P event <dir> <type> "msg" [--data '{...}']` (adds `ts` and `branch`). Log **milestones only** — one line per checkpoint, not per small step.

Types: `item.created` (automatic) · `stage.changed` (automatic) · `plan.written` / `plan.updated` · `artifact.created` · `decision` · `branch.created` · `mr.created` / `mr.updated` / `mr.ready` · `jira.created` · `subtask.started` / `subtask.done` · `commit.created` · `review.done` · `doc.published` · `error` · `note`.

Keep `msg` short — `P show` prints the last five.
