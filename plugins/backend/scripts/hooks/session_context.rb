#!/usr/bin/env ruby
# frozen_string_literal: true
Encoding.default_external = Encoding::UTF_8
Encoding.default_internal = Encoding::UTF_8
#
# SessionStart hook: if the current branch belongs to a work item, print its state summary and
# context.md so Claude starts the session already knowing where we stopped. Plain stdout from a
# SessionStart hook is added to Claude's context. Silent (and fast) everywhere else.

require 'json'
begin
  input = JSON.parse($stdin.read.to_s)
rescue StandardError
  input = {}
end
ENV['CLAUDE_PROJECT_DIR'] ||= input['cwd'] if input['cwd']

require_relative '../lib/plans'

root = Plans.project_root
exit 0 unless Dir.exist?(File.join(root, '.git')) || File.file?(File.join(root, '.git'))

rails = File.exist?(File.join(root, 'Gemfile')) && File.read(File.join(root, 'Gemfile')).match?(/^\s*gem\s+['"]rails['"]/)
config = File.exist?(File.join(root, '.claude', 'backend.yml'))

if rails && !config
  puts '[backend plugin] Rails project without .claude/backend.yml — run /backend:setup to configure the backend workflow.'
  exit 0
end
exit 0 unless config

res = Plans.resolve
exit 0 unless res[:found]

dir = File.join(root, res[:dir])
ctx_path = File.join(dir, 'context.md')
ctx = File.exist?(ctx_path) ? File.readlines(ctx_path).first(160).join : '(no context.md)'

puts <<~TXT
  [backend plugin] The current branch `#{res[:branch]}` belongs to work item #{res[:key]} (#{res[:kind]}, stage: #{res[:stage]})#{res[:subtask] ? ", subtask #{res[:subtask]}" : ''}.
  Work item folder: #{res[:dir]} — follow #{File.expand_path('../../shared/skill-contract.md', __dir__)} when continuing it.

  ## State
  #{Plans.show(dir)}

  ## context.md
  #{ctx}
  Do not start working on it automatically — if the developer's first message is about this work, offer to continue from "Next step" (or they can run /backend:resume).
TXT
