# Git flow

Names/CLI from `git.*` in `backend.yml`. Examples use `glab`; `gh` equivalents at the end.

## Stacked branches
`base_branch` → `feature/<EPIC>-…` (draft MR → base) → ST1 `<SUB>-…` (MR → feature) → ST2 (MR → ST1) → …
Bugs: `bugfix/<KEY>-…` from `base_branch`, MR → base.

## Never
Commit/push on `base_branch` · plain `--force` (only `--force-with-lease`, only on branches this workflow made, only after a yes) · switch branches with a dirty tree without asking · delete branches / close MRs without asking.

## Start a branch + draft MR
```bash
git fetch <remote> && git switch -c <branch> <base>
git commit --allow-empty -m "chore(<KEY>): start <title>"      # hosts refuse MRs without a diff
git push -u <remote> <branch>
glab mr create --draft --source-branch <branch> --target-branch <base> --title "Draft: <KEY> <Title>" --description "<desc>" --yes
```
Description: `## <KEY> — <Title>` · ticket link · 2–4 lines what & why · `### Steps` checklist (from the plan) · notes for reviewers · "Stacked on !<prev>".
Progress (when `git.auto_mr_comments`): one short comment per finished step (`✅ Step k — what changed (shas)`); tick the checklist **once** at the end of the subtask.

## Commits (committer agent)
Logical units in order: db → models → services/jobs/policies → controllers/routes/serializers/permissions → specs (or with their unit) → swagger/docs → chore. Message: `git.commit_format` (default `<type>(<KEY>): <imperative summary>`, ≤ 72 chars), body only for a non-obvious why. Never commit debug code, secrets, `.plans/`. Squash-merge collapses the split.

## Keep the stack healthy
Fix in an earlier subtask → commit there, then from the **top** branch `git rebase --update-refs <feature-branch>`, push each moved branch with `--force-with-lease` (ask first). Earlier subtask merged → check the MR on the host; state `merged` → `P update <dir> --story S --subtask SUB status=done` + `P event <dir> mr.merged`. Then **ask first** (`AskUserQuestion`), then retarget every MR that targeted the merged branch to the branch it merged into (`glab mr update <id> --target-branch <feature>`; GitLab may do it itself). Never merge an MR remotely — the developer merges in the host UI.

## glab ↔ gh
| | glab | gh |
|---|---|---|
| auth | `glab auth status` | `gh auth status` |
| draft | `glab mr create --draft --source-branch B --target-branch T …` | `gh pr create --draft --head B --base T …` |
| view / diff | `glab mr view <id>` / `glab mr diff <id>` | `gh pr view <n>` / `gh pr diff <n>` |
| comment | `glab mr note <id> -m ".."` | `gh pr comment <n> --body ".."` |
| edit / retarget / ready | `glab mr update <id> --description .. / --target-branch T / --ready` | `gh pr edit <n> --body .. / --base T` · `gh pr ready <n>` |
Flag fails on the installed version → check `--help`, adapt.
