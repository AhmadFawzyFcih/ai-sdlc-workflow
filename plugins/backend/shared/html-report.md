# HTML pages

1. Write only the body to `<dir>/.body.html`: `<section id="x" data-title="Nav label">…</section>` blocks — no `<html>/<head>/<style>`.
2. `ruby "${CLAUDE_PLUGIN_ROOT}/scripts/render-html.rb" --in <dir>/.body.html --out <dir>/<name>.html --title ".." --eyebrow ".." --subtitle ".." --meta ".."` — inlines the shared theme, builds the nav, adds Mermaid only when used, deletes the fragment.

Classes: `grid` + `stat` (label/value/hint) · `card` · `grid-2` · `badge ok|warn|bad|info|accent` · `callout [warn|bad|ok]` · `table-wrap` > `table` · `details` > `summary` + `.body` · `timeline` > `li.done|active|blocked` · `progress` > `span[style=width]` · `diagram` > `pre.mermaid` · `endpoint` > `.head` (`.method get|post|put|patch|delete`) + `.content` · selectable `item` (`input[data-n]`) + `selection-bar` (`#selection-out`, `#selection-copy`).

Rules: business first, then technical · keep it scannable · Mermaid ≤ 15 nodes · HTML-escape code/ticket text · fake example data · no secrets · keep pages short — every line is output tokens.
