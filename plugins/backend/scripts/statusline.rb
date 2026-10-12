#!/usr/bin/env ruby
# frozen_string_literal: true
Encoding.default_external = Encoding::UTF_8
Encoding.default_internal = Encoding::UTF_8
#
# Optional Claude Code status line: "⎇ branch · PROJ-100 › PROJ-123 (2/4) · implement · Opus".
# Plugins can't set the status line, so add it yourself in ~/.claude/settings.json:
#   "statusLine": { "type": "command", "command": "ruby ~/ai-sdlc-workflow/plugins/backend/scripts/statusline.rb" }

require 'json'
input = JSON.parse($stdin.read.to_s) rescue {}
cwd = input.dig('workspace', 'current_dir') || input['cwd'] || Dir.pwd
ENV['CLAUDE_PROJECT_DIR'] = `git -C "#{cwd}" rev-parse --show-toplevel 2>/dev/null`.strip.then { |t| t.empty? ? cwd : t }
require_relative 'lib/plans'

parts = []
branch = Plans.current_branch
parts << "⎇ #{branch}" if branch
begin
  res = Plans.resolve
  if res[:found]
    item = res[:key].dup
    if res[:subtask]
      state = Plans.read_state(File.join(Plans.project_root, res[:dir]))
      story = (state['stories'] || []).find { |s| s['key'] == res[:story] } || {}
      subs = story['subtasks'] || []
      st = subs.find { |s| s['key'] == res[:subtask] } || {}
      item << " › #{res[:subtask]} (#{st['order'] || '?'}/#{subs.size})"
    end
    parts << item
    parts << res[:stage].to_s
  end
rescue StandardError
  nil
end
model = input.dig('model', 'display_name')
parts << model if model
print parts.join(' · ')
