#!/usr/bin/env ruby
# frozen_string_literal: true
Encoding.default_external = Encoding::UTF_8
Encoding.default_internal = Encoding::UTF_8
#
# Wraps an HTML body fragment in the shared shell + theme, producing one self-contained page.
#
#   ruby render-html.rb --in body.html --out page.html --title "Checklist export" \
#        [--eyebrow "Feature overview"] [--subtitle "One-line lede"] \
#        [--meta "PROJ-100" --meta "Branch: feature/PROJ-100-x"] [--nav-title "On this page"]
#
# Navigation is built from <section id="..." data-title="Label"> elements in the fragment.
# Mermaid is loaded (CDN) only if the fragment contains class="mermaid".
# The body fragment file is deleted after a successful render unless --keep is given.

require 'optparse'
require 'cgi'
require 'time'

opts = { meta: [], eyebrow: '', subtitle: '', nav_title: 'On this page', keep: false }
OptionParser.new do |o|
  o.on('--in PATH') { |v| opts[:in] = v }
  o.on('--out PATH') { |v| opts[:out] = v }
  o.on('--title TEXT') { |v| opts[:title] = v }
  o.on('--eyebrow TEXT') { |v| opts[:eyebrow] = v }
  o.on('--subtitle TEXT') { |v| opts[:subtitle] = v }
  o.on('--meta TEXT') { |v| opts[:meta] << v }
  o.on('--nav-title TEXT') { |v| opts[:nav_title] = v }
  o.on('--keep') { opts[:keep] = true }
end.parse!

abort 'render-html: --in, --out and --title are required' unless opts[:in] && opts[:out] && opts[:title]
abort "render-html: #{opts[:in]} not found" unless File.exist?(opts[:in])

root  = File.expand_path('../shared/html', __dir__)
shell = File.read(File.join(root, 'shell.html'))
css   = File.read(File.join(root, 'theme.css'))
body  = File.read(opts[:in])

esc = ->(s) { CGI.escapeHTML(s.to_s) }

nav = body.scan(/<section\b[^>]*>/i).map do |tag|
  id    = tag[/\bid\s*=\s*"([^"]+)"/i, 1]
  label = tag[/\bdata-title\s*=\s*"([^"]+)"/i, 1]
  next unless id && label
  %(    <a href="##{esc.(id)}">#{esc.(label)}</a>)
end.compact.join("\n")

meta = opts[:meta].map { |m| %(<span>#{esc.(m)}</span>) }.join

mermaid = if body.include?('class="mermaid"')
  <<~HTML
    <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
    const dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
      (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
    mermaid.initialize({ startOnLoad: true, theme: dark ? 'dark' : 'neutral', securityLevel: 'strict' });
    </script>
  HTML
else
  ''
end

page = shell
  .gsub('{{THEME_CSS}}') { css }
  .gsub('{{TITLE}}') { esc.(opts[:title]) }
  .gsub('{{EYEBROW}}') { esc.(opts[:eyebrow]) }
  .gsub('{{SUBTITLE}}') { esc.(opts[:subtitle]) }
  .gsub('{{META}}') { meta }
  .gsub('{{NAV_TITLE}}') { esc.(opts[:nav_title]) }
  .gsub('{{NAV_LINKS}}') { nav }
  .gsub('{{GENERATED_AT}}') { Time.now.strftime('%Y-%m-%d %H:%M') }
  .gsub('{{MERMAID}}') { mermaid }
  .gsub('{{BODY}}') { body }

dir = File.dirname(opts[:out])
Dir.mkdir(dir) unless Dir.exist?(dir) || dir == '.'
File.write(opts[:out], page)
File.delete(opts[:in]) unless opts[:keep] || File.expand_path(opts[:in]) == File.expand_path(opts[:out])
puts File.expand_path(opts[:out])
