#!/usr/bin/env ruby
# frozen_string_literal: true
Encoding.default_external = Encoding::UTF_8
Encoding.default_internal = Encoding::UTF_8
#
# Fast, read-only facts about a Rails codebase for /backend:system-overview. Prints JSON.
# Usage: ruby codebase-stats.rb [--since-sha SHA]

require 'json'
require 'set'
require 'time'

root = ENV['CLAUDE_PROJECT_DIR'].to_s
root = `git rev-parse --show-toplevel 2>/dev/null`.strip if root.empty?
root = Dir.pwd if root.empty?
Dir.chdir(root)
since = ARGV[ARGV.index('--since-sha') + 1] if ARGV.include?('--since-sha')

def sh(cmd)
  `#{cmd} 2>/dev/null`.to_s.strip
end

def files(glob)
  Dir.glob(glob, File::FNM_EXTGLOB).reject { |f| f.include?('/vendor/') || f.include?('node_modules') }
end

def count(glob)
  files(glob).size
end

def loc(glob)
  files(glob).sum { |f| File.foreach(f).count { |l| !l.strip.empty? && !l.strip.start_with?('#') } rescue 0 }
end

def read(path)
  File.exist?(path) ? File.read(path) : ''
end

# Ruby 2.6-safe (macOS system Ruby has no Enumerable#tally)
def tally(list)
  list.each_with_object(Hash.new(0)) { |x, h| h[x] += 1 }
end

out = { root: root, head: sh('git rev-parse HEAD'), generated_at: Time.now.iso8601 }

out[:counts] = {
  models: count('app/models/**/*.rb'),
  controllers: count('app/controllers/**/*_controller.rb'),
  api_controllers: Dir.glob('app/controllers/api/*').select { |d| File.directory?(d) }
                      .to_h { |d| [File.basename(d), count("#{d}/**/*_controller.rb")] },
  services: count('app/services/**/*.rb'),
  jobs: count('app/{jobs,workers,sidekiq}/**/*.rb'),
  policies: count('app/policies/**/*.rb'),
  serializers: count('app/{serializers,blueprints}/**/*.rb'),
  mailers: count('app/mailers/**/*.rb'),
  concerns: count('app/**/concerns/**/*.rb'),
  migrations: count('db/migrate/*.rb'),
  specs: count('spec/**/*_spec.rb'),
  spec_types: Dir.glob('spec/*').select { |d| File.directory?(d) }.to_h { |d| [File.basename(d), count("#{d}/**/*_spec.rb")] }
                .reject { |_, v| v.zero? }
}
out[:loc] = { app: loc('app/**/*.rb'), lib: loc('lib/**/*.rb'), spec: loc('spec/**/*.rb') }

# Top-level app folders and the biggest namespaces (domain hints)
out[:app_dirs] = Dir.glob('app/*').select { |d| File.directory?(d) }.to_h { |d| [File.basename(d), count("#{d}/**/*.rb")] }
ns = Hash.new(0)
files('app/{models,services,controllers}/**/*.rb').each do |f|
  parts = f.split('/')
  key = parts.size > 3 ? parts[2] : nil
  key = parts[3] if key == 'api' && parts.size > 5
  ns[key] += 1 if key && !key.end_with?('.rb') && !%w[concerns application_controller.rb].include?(key)
end
out[:namespaces] = ns.sort_by { |_, v| -v }.first(30).to_h

# Models with their associations (light parse)
out[:models] = files('app/models/**/*.rb').first(400).map do |f|
  src = read(f)
  klass = src[/^\s*class\s+([\w:]+)/, 1]
  next unless klass
  assoc = src.scan(/^\s*(belongs_to|has_many|has_one|has_and_belongs_to_many)\s+:(\w+)/).map { |t, n| "#{t}:#{n}" }
  { name: klass, file: f, associations: assoc.first(25) }
end.compact

# Routes (approximate, no boot)
routes = files('config/routes{.rb,/**/*.rb}').map { |f| read(f) }.join("\n")
out[:routes] = {
  resources: routes.scan(/^\s*resources?\s+:(\w+)/).flatten.uniq.first(150),
  namespaces: tally(routes.scan(/^\s*(?:namespace|scope)\s+:?['"]?(\w+)/).flatten),
  verb_lines: routes.scan(/^\s*(get|post|put|patch|delete)\s/).size,
  mounts: routes.scan(/^\s*mount\s+([\w:]+)/).flatten
}

# Integrations & other systems
env_vars = Set.new
files('{app,config,lib}/**/*.{rb,yml,erb}').each do |f|
  read(f).scan(/ENV(?:\.fetch\(|\[)\s*['"]([A-Z0-9_]+)['"]/) { |m| env_vars << m[0] }
end
out[:env_var_names] = env_vars.to_a.sort.first(200)
hosts = Set.new
files('config/**/*.{yml,rb}').each { |f| read(f).scan(%r{https?://([a-z0-9.-]+\.[a-z]{2,})}i) { |m| hosts << m[0].downcase } }
out[:hosts_in_config] = hosts.to_a.sort.first(80)
out[:http_clients] = files('app/**/*.rb').select { |f| read(f).match?(/Faraday\.new|HTTParty|Net::HTTP|RestClient|Excon/) }.first(60)
out[:messaging] = {
  sidekiq_queues: read('config/sidekiq.yml').scan(/^\s*-\s*\[?\s*:?['"]?(\w+)/).flatten.uniq,
  kafka_topics: files('{app,config,lib}/**/*.{rb,yml}').flat_map { |f| read(f).scan(/topic[:\s(]+['"]([\w.-]+)['"]/i).flatten }.uniq.first(80),
  webhooks: files('app/controllers/**/*webhook*').first(30)
}
out[:infra] = {
  docker_compose_services: read(%w[docker-compose.yml compose.yml docker-compose.yaml].find { |f| File.exist?(f) }.to_s)
                             .scan(/^  ([a-z0-9_-]+):\s*$/).flatten,
  procfile: (read('Procfile').lines + read('Procfile.dev').lines).map { |l| l[/^(\w+):/, 1] }.compact.uniq,
  databases: read('config/database.yml').scan(/adapter:\s*(\w+)/).flatten.uniq,
  engines: Dir.glob('{engines,components,packs,packages}/*').select { |d| File.directory?(d) },
  k8s_or_helm: Dir.glob('{k8s,kubernetes,helm,charts,deploy}/**/*.{yml,yaml}').first(20)
}

# Hotspots: most-changed files in the last 90 days
churn = sh("git log --since=90.days --name-only --format='' -- app lib")
out[:hotspots_90d] = tally(churn.split("\n").reject(&:empty?)).sort_by { |_, c| -c }.first(20).to_h
out[:recent_activity] = sh("git log -15 --date=short --format='%ad %s'").split("\n")

if since && !since.empty?
  out[:changed_since] = {
    sha: since,
    files: sh("git diff --name-status #{since}..HEAD -- app lib config db").split("\n").first(400),
    commits: sh("git log --oneline #{since}..HEAD").split("\n").size
  }
end

puts JSON.pretty_generate(out)
