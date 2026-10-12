#!/usr/bin/env ruby
# frozen_string_literal: true
Encoding.default_external = Encoding::UTF_8
Encoding.default_internal = Encoding::UTF_8
#
# Detects facts about the current Rails project for /backend:setup. Prints JSON. Never fails hard.

require 'json'

root = ENV['CLAUDE_PROJECT_DIR'].to_s
root = `git rev-parse --show-toplevel 2>/dev/null`.strip if root.empty?
root = Dir.pwd if root.empty?
Dir.chdir(root)

def read(path)
  File.exist?(path) ? File.read(path) : ''
end

def sh(cmd)
  `#{cmd} 2>/dev/null`.strip
end

def which(bin)
  !sh("command -v #{bin}").empty?
end

# Ruby 2.6-safe (macOS system Ruby has no Enumerable#tally)
def tally(list)
  list.each_with_object(Hash.new(0)) { |x, h| h[x] += 1 }
end

gemfile = read('Gemfile')
lock = read('Gemfile.lock')
gem_version = ->(name) { lock[/^    #{Regexp.escape(name)} \(([^)]+)\)/, 1] }
has_gem = ->(name) { !gem_version.(name).nil? || gemfile.match?(/gem\s+['"]#{Regexp.escape(name)}['"]/) }

out = {}
out[:root] = root
out[:rails_project] = gemfile.match?(/^\s*gem\s+['"]rails['"]/) || has_gem.('rails')
out[:app_name] = read('config/application.rb')[/^module\s+(\w+)/, 1]
out[:ruby] = read('.ruby-version').strip.then { |v| v.empty? ? nil : v } ||
             gemfile[/^ruby\s+['"]([^'"]+)['"]/, 1] || lock[/RUBY VERSION\s+ruby ([\d.]+)/, 1]
out[:rails] = gem_version.('rails') || gem_version.('railties')
out[:api_only] = read('config/application.rb').include?('config.api_only = true')

gems = %w[rspec-rails rswag rswag-specs factory_bot factory_bot_rails sidekiq good_job solid_queue delayed_job
          pundit cancancan action_policy rubocop rubocop-rails brakeman sentry-ruby sentry-rails bugsnag rollbar
          honeybadger ddtrace datadog newrelic_rpm active_model_serializers jsonapi-serializer blueprinter alba
          jbuilder graphql grape kafka ruby-kafka karafka bunny sneakers faraday httparty]
out[:gems] = gems.select { |g| has_gem.(g) }.to_h { |g| [g, gem_version.(g) || 'Gemfile'] }

out[:tests] = Dir.exist?('spec') ? 'rspec' : (Dir.exist?('test') ? 'minitest' : nil)
out[:factories] = Dir.exist?('spec/factories') || has_gem.('factory_bot_rails') ? 'factory_bot' : 'fixtures'

# API layout
api_dirs = Dir.glob('app/controllers/api/*').select { |d| File.directory?(d) }.map { |d| File.basename(d) }
out[:api] = {
  controllers_path: Dir.exist?('app/controllers/api') ? 'app/controllers/api' : nil,
  versions: api_dirs.grep(/\Av\d+\z/).sort,
  serializers_path: %w[app/serializers app/blueprints app/views/api].find { |d| Dir.exist?(d) },
  swagger_output: %w[swagger swagger_docs public/api-docs].find { |d| Dir.exist?(d) },
  swagger_specs: sh(%q(grep -rl "swagger_helper" spec --include='*_spec.rb' | head -50)).split("\n")
                   .map { |f| File.dirname(f).sub(%r{/v\d+(/.*)?\z}, '') }.then { |l| tally(l) }.max_by { |_, c| c }&.first,
  permission_file_candidates: Dir.glob('config/initializers/*').select { |f| File.basename(f).match?(/permission|ability|acl|role/i) } +
                              Dir.glob('config/*.{yml,yaml}').select { |f| File.basename(f).match?(/permission|ability|acl/i) }
}

# Git
remote_url = sh('git remote get-url origin')
out[:git] = {
  remote: remote_url.empty? ? nil : 'origin',
  remote_url: remote_url.sub(%r{//[^@/]+@}, '//'),
  host: remote_url.include?('github') ? 'github' : (remote_url.include?('gitlab') ? 'gitlab' : nil),
  default_branch: sh('git symbolic-ref --short refs/remotes/origin/HEAD').sub(%r{\Aorigin/}, '').then { |b| b.empty? ? nil : b } ||
                  %w[main master develop].find { |b| !sh("git rev-parse --verify --quiet #{b}").empty? },
  current_branch: sh('git rev-parse --abbrev-ref HEAD'),
  branch_examples: sh("git for-each-ref --sort=-committerdate --count=15 --format='%(refname:short)' refs/heads refs/remotes").split("\n").uniq.first(15),
  merge_commits_last_100: sh('git log -100 --merges --format=%h').split("\n").size
}
keys = (sh('git log -300 --format=%s') + "\n" + out[:git][:branch_examples].join("\n")).scan(/\b([A-Z][A-Z0-9]+)-\d+\b/).flatten
out[:jira_project_key_guess] = tally(keys).max_by { |_, c| c }&.first

out[:cli] = { glab: which('glab'), gh: which('gh'), jq: which('jq'), rubocop_binstub: File.exist?('bin/rubocop') }
out[:local_port] = read('Procfile.dev')[/-p\s+(\d+)/, 1] || read('config/puma.rb')[/PORT['"]?\]?\s*\|\|\s*(\d+)/, 1] || '3000'
out[:existing] = {
  backend_yml: File.exist?('.claude/backend.yml'),
  plans_dir: Dir.exist?('.plans'),
  plans_ignored: read('.gitignore').lines.any? { |l| l.strip.match?(%r{\A/?\.plans/?\z}) },
  claude_md: File.exist?('CLAUDE.md'),
  project_rules: Dir.glob('.claude/rules/*.md').map { |f| File.basename(f) },
  project_skills: Dir.glob('.claude/skills/*/SKILL.md').map { |f| File.basename(File.dirname(f)) }
}

puts JSON.pretty_generate(out)
