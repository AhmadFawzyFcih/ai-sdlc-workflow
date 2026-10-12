# HTML Review Report

Self-contained (inline CSS/JS, no external assets). Dark theme, monospace for code.

Layout:
- Header: "Code Review Report" · Mode (Local / Remote MR #ID + URL) · date · files reviewed.
- Summary bar: `🔴 N Critical  🟡 N Warning  🔵 N Suggestion`.
- Sections in order: CRITICAL → WARNING → SUGGESTION.
- Each concern: checkbox · unique sequential `#N` · category badge · `file:line` · code snippet block · description · recommendation.
- Checked items can be collected into a "Selected: #1, #4, #7" line at the bottom so the developer can paste it back.

Keep it readable at a glance; the developer decides from this page which numbers to send back.
