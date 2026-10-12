# Jira & Confluence (Atlassian MCP)

Use whatever Atlassian tools are connected (names vary). None → say so, continue with what the developer pastes. `getAccessibleAtlassianResources` once per session for the `cloudId`.

**Read**: `getJiraIssue` (summary, description, status, parent, labels, attachments, comments, links, subtasks) · epic children `searchJiraIssuesUsingJql` `parent = EPIC ORDER BY rank` (fallback `"Epic Link" = EPIC`) · me `atlassianUserInfo` · Confluence `getConfluencePage` (id from `/pages/<id>/`). Collect Figma/Confluence URLs found in descriptions/comments.

**Create subtasks** (in order, stop on the first hard error):
1. `createJiraIssue`: project of the parent, type `jira.subtask_issue_type`, `parent` = story, summary, markdown description, assignee = me (`jira.assign_to_me`), labels = parent's (`jira.copy_parent_labels`, via `additional_fields` if needed). **No estimates.** Check the tool schema for exact parameter names.
2. Reporter = me (`jira.reporter_me`) via `editJiraIssue`; rejected → note once, continue.
3. `getTransitionsForJiraIssue` → transition whose name or target = `jira.ready_status` → `transitionJiraIssue`.
4. `P update <dir> --story S --subtask KEY order=n title=… status=pending`.

**Other**: optional status moves `jira.in_progress_status` / `jira.review_status` (skip when empty). Jira comments → always ask first.

**Confluence**: folder URL `/wiki/spaces/<KEY>/folder/<ID>` = space + parent; page URL `/pages/<ID>/` = page. `createConfluencePage` / `updateConfluencePage` (markdown if supported, else storage XHTML — `getContentFormatGuide` when unsure). Never delete. Save URL in `links.*`. Publish fails → save locally, report.
