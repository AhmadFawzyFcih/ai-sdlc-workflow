#!/usr/bin/env ruby
# frozen_string_literal: true
Encoding.default_external = Encoding::UTF_8
Encoding.default_internal = Encoding::UTF_8
#
# plans.rb — workspace helper for the `backend` plugin. Stdlib only (no bundler).
#
#   resolve [KEY]                         → JSON: which work item (by key, or by current git branch)
#   init feature|bug KEY "Title" [--url U] [--stage S]
#   update <dir|KEY> [--story K [--subtask K]] field=value ...   (values parsed as JSON when possible; dot.paths allowed)
#   event  <dir|KEY> <type> "<message>" [--data '<json>']
#   show   <dir|KEY>                      → compact human summary
#   list                                  → all work items
#   name   feature|subtask|bugfix KEY "Title" → branch name from git.*_branch_pattern
#   outline <file.md>                     → headings with line numbers (read big plans section by section)
#   section <file.md> "<heading regex>"   → just that section
#
# Paths printed are relative to the project root. See shared/workspace.md.

require_relative 'lib/plans'

def take_opt(args, name)
  i = args.index(name)
  return nil unless i
  args.delete_at(i)
  args.delete_at(i)
end

args = ARGV.map { |a| a.dup.force_encoding(Encoding::UTF_8).scrub }
cmd = args.shift
case cmd
when 'resolve'
  puts JSON.generate(Plans.resolve(args.first))
when 'init'
  url = take_opt(args, '--url')
  stage = take_opt(args, '--stage')
  kind, key, title = args
  abort 'usage: plans.rb init feature|bug KEY "Title" [--url U] [--stage S]' unless kind && key && title
  puts JSON.generate(Plans.init(kind, key, title, url: url, stage: stage))
when 'update'
  story = take_opt(args, '--story')
  subtask = take_opt(args, '--subtask')
  key_arg = args.first
  dir = Plans.dir_arg(args.shift)
  abort 'usage: plans.rb update <dir|KEY> [--story K [--subtask K]] field=value ...' if args.empty?
  if story.nil? && key_arg.to_s.match?(/\A#{Plans::KEY_RE}\z/)
    hit = Plans.resolve(key_arg)
    if hit[:story]
      target = "--story #{hit[:story]}#{" --subtask #{hit[:subtask]}" if hit[:subtask]}"
      abort "plans.rb update: #{key_arg} is not the work item root (#{hit[:key]}) — use: update #{hit[:key]} #{target} field=value"
    end
  end
  puts JSON.generate(Plans.update(dir, story, subtask, args))
when 'event'
  data = take_opt(args, '--data')
  dir = Plans.dir_arg(args.shift)
  type, msg = args
  abort 'usage: plans.rb event <dir|KEY> <type> "<message>" [--data json]' unless type && msg
  parsed = data ? (JSON.parse(data) rescue { 'raw' => data }) : nil
  puts JSON.generate(Plans.event(dir, type, msg, parsed))
when 'show'
  puts Plans.show(Plans.dir_arg(args.first))
when 'name'
  kind, key, title = args
  abort 'usage: plans.rb name feature|subtask|bugfix KEY "Title"' unless kind && key && title
  puts Plans.branch_name(kind, key, title)
when 'outline'
  abort 'usage: plans.rb outline <file.md>' unless args.first && File.exist?(args.first)
  puts Plans.outline(args.first)
when 'section'
  file, pattern = args
  abort 'usage: plans.rb section <file.md> "<heading regex>"' unless file && pattern && File.exist?(file)
  puts Plans.section(file, pattern)
when 'list'
  puts JSON.pretty_generate(Plans.list)
else
  warn 'usage: plans.rb resolve|init|update|event|show|list|name|outline|section (see header)'
  exit 1
end
