#!/usr/bin/env ruby
# frozen_string_literal: true
Encoding.default_external = Encoding::UTF_8
Encoding.default_internal = Encoding::UTF_8
#
# PreToolUse(Bash) hook:
#  1. `git commit` → block if staged Ruby adds debug statements (binding.pry/irb, byebug, debugger, stray puts/p/pp).
#  2. `git push --force` without `--force-with-lease` → block.
#  3. `git commit`/`git push` that targets the configured base branch → block.
# Exit 2 + stderr = block the call and tell Claude why.

require 'json'
input = JSON.parse($stdin.read.to_s) rescue exit(0)
cmd = input.dig('tool_input', 'command').to_s
exit 0 unless cmd.match?(/\bgit\b/)

ENV['CLAUDE_PROJECT_DIR'] ||= input['cwd'] if input['cwd']
require_relative '../lib/plans'
root = Plans.project_root
exit 0 unless File.exist?(File.join(root, '.claude', 'backend.yml')) # only in configured projects

def block(msg)
  warn msg
  exit 2
end

push_segments = cmd.scan(/\bgit\s+push\b[^;&|]*/)
if push_segments.any? { |seg| seg.match?(/(\s--force(?!-with-lease)\b|\s-f\b)/) }
  block 'BLOCKED by backend plugin: use `git push --force-with-lease` (never plain --force), and only after the developer confirms.'
end

base = Plans.config.dig('git', 'base_branch') || 'main'
branch = Plans.current_branch
if branch == base && cmd.match?(/\bgit\s+(commit|push)\b/)
  block "BLOCKED by backend plugin: you are on the base branch `#{base}`. Create/switch to a feature, subtask or bugfix branch first (see shared/git-flow.md)."
end
if cmd.match?(/\bgit\s+push\b[^;&|]*\s(#{Regexp.escape(base)}|HEAD:#{Regexp.escape(base)})(\s|$)/)
  block "BLOCKED by backend plugin: pushing to the base branch `#{base}` is not allowed from this workflow."
end

exit 0 unless cmd.match?(/\bgit\s+commit\b/)

diff = `git -C "#{root}" diff --cached --unified=0 -- '*.rb' '*.rake' 2>/dev/null`
hits = []
file = nil
diff.each_line do |line|
  if line.start_with?('+++ ')
    file = line.sub(%r{\A\+\+\+ (b/)?}, '').strip
  elsif line.start_with?('+') && !line.start_with?('+++')
    code = line[1..]
    next if code.strip.start_with?('#')
    if code.match?(/binding\.(pry|irb)|\bbyebug\b|\bdebugger\b|^\s*(puts|pp?)[\s(]/)
      hits << "#{file}: #{code.strip}"
    end
  end
end

unless hits.empty?
  block "BLOCKED by backend plugin: debug statements in staged Ruby changes — remove them, re-stage, then commit:\n" + hits.first(20).join("\n")
end
exit 0
