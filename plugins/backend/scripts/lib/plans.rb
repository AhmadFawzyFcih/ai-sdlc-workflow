# frozen_string_literal: true
Encoding.default_external = Encoding::UTF_8
Encoding.default_internal = Encoding::UTF_8
# Plans — workspace library shared by plans.rb and the hooks. Stdlib only.
require 'json'
require 'yaml'
require 'time'
require 'fileutils'

module Plans
  KEY_RE = /\b[A-Z][A-Z0-9]+-\d+\b/

  module_function

  def project_root
    @project_root ||= begin
      env = ENV['CLAUDE_PROJECT_DIR']
      if env && !env.empty? && Dir.exist?(env)
        env
      else
        top = `git rev-parse --show-toplevel 2>/dev/null`.strip
        top.empty? ? Dir.pwd : top
      end
    end
  end

  def config
    @config ||= begin
      path = File.join(project_root, '.claude', 'backend.yml')
      File.exist?(path) ? (YAML.safe_load(File.read(path)) || {}) : {}
    rescue StandardError
      {}
    end
  end

  def plans_dir
    File.join(project_root, config['plans_dir'] || '.plans')
  end

  def rel(path)
    path.sub(%r{\A#{Regexp.escape(project_root)}/?}, '')
  end

  def now
    Time.now.iso8601
  end

  def current_branch
    b = `git -C "#{project_root}" rev-parse --abbrev-ref HEAD 2>/dev/null`.strip
    b.empty? || b == 'HEAD' ? nil : b
  end

  def slugify(title)
    s = title.to_s.dup.force_encoding(Encoding::UTF_8).scrub.gsub('ß', 'ss').unicode_normalize(:nfkd).gsub(/[^\x00-\x7F]/, '').downcase
    s.gsub(/[^a-z0-9]+/, ' ').split.first(5).join('-').then { |x| x.empty? ? 'item' : x }
  end

  def kind_dir(kind)
    File.join(plans_dir, kind == 'bug' ? 'bugs' : 'features')
  end

  def state_files
    Dir.glob(File.join(plans_dir, '{features,bugs}', '*', 'state.json')).sort
  end

  def read_state(dir)
    JSON.parse(File.read(File.join(dir, 'state.json')))
  end

  def write_json_atomic(path, data)
    tmp = "#{path}.tmp-#{Process.pid}"
    File.write(tmp, "#{JSON.pretty_generate(data)}\n")
    File.rename(tmp, path)
  end

  def write_state(dir, state)
    state['updated_at'] = now
    write_json_atomic(File.join(dir, 'state.json'), state)
  end

  def item_dir_for_key(key)
    Dir.glob(File.join(plans_dir, '{features,bugs}', "#{key}-*")).find { |d| File.directory?(d) } ||
      Dir.glob(File.join(plans_dir, '{features,bugs}', key)).find { |d| File.directory?(d) }
  end

  # Accepts a directory (absolute or relative to project root / cwd) or a KEY.
  def dir_arg(arg)
    abort 'plans.rb: missing <dir|KEY>' if arg.nil? || arg.empty?
    [arg, File.join(project_root, arg)].each do |cand|
      return File.expand_path(cand) if File.exist?(File.join(cand, 'state.json'))
    end
    if arg.match?(/\A#{KEY_RE}\z/)
      d = item_dir_for_key(arg)
      return d if d
      res = find_by { |_s, k| k == arg }
      return res[:dir] if res
    end
    abort "plans.rb: no work item found for #{arg.inspect}"
  end

  # Yields (state, key, branch) for root, stories and subtasks; returns first match with context.
  def find_by
    state_files.each do |file|
      dir = File.dirname(file)
      state = JSON.parse(File.read(file)) rescue next
      return { dir: dir, state: state } if yield(state, state['key'], state['branch'])
      (state['stories'] || []).each do |story|
        return { dir: dir, state: state, story: story['key'] } if yield(state, story['key'], story['branch'])
        (story['subtasks'] || []).each do |st|
          if yield(state, st['key'], st['branch'])
            return { dir: dir, state: state, story: story['key'], subtask: st['key'] }
          end
        end
      end
    end
    nil
  end

  def resolve(key = nil)
    res = nil
    if key
      d = item_dir_for_key(key)
      res = { dir: d, state: read_state(d) } if d
      res ||= find_by { |_s, k| k == key }
    else
      branch = current_branch
      if branch
        res = find_by { |_s, _k, b| b == branch }
        if res.nil? && (k = branch[KEY_RE])
          d = item_dir_for_key(k)
          res = d ? { dir: d, state: read_state(d) } : find_by { |_s, kk| kk == k }
        end
      end
    end
    return { found: false, branch: current_branch, plans_dir: rel(plans_dir) } unless res

    st = res[:state]
    {
      found: true, kind: st['kind'], key: st['key'], title: st['title'], stage: st['stage'],
      dir: rel(res[:dir]), story: res[:story], subtask: res[:subtask], branch: current_branch
    }.compact
  end

  def render_template(path, vars)
    File.read(path).gsub(/\{\{(\w+)\}\}/) { vars.fetch(Regexp.last_match(1).to_sym, '') }
  end

  def init(kind, key, title, url: nil, stage: nil)
    abort 'plans.rb init: kind must be feature or bug' unless %w[feature bug].include?(kind)
    abort "plans.rb init: invalid key #{key.inspect}" unless key.to_s.match?(/\A#{KEY_RE}\z/)
    existing = item_dir_for_key(key)
    return { created: false, dir: rel(existing), key: key } if existing

    dir = File.join(kind_dir(kind), "#{key}-#{slugify(title)}")
    FileUtils.mkdir_p(dir)
    stage ||= kind == 'bug' ? 'investigate' : 'plan-feature'
    t = now
    state = {
      'schema' => 1, 'kind' => kind, 'key' => key, 'title' => title, 'slug' => slugify(title),
      'url' => url, 'stage' => stage, 'branch' => nil, 'mr' => nil,
      'links' => {}, 'created_at' => t, 'updated_at' => t
    }
    state['stories'] = [] if kind == 'feature'
    write_json_atomic(File.join(dir, 'state.json'), state)

    tpl = File.expand_path('../../shared/templates/context.md', __dir__)
    next_step = kind == 'bug' ? "Run `/backend:fix-bug #{key}` to start the investigation." : "Run `/backend:plan-feature #{key}` to build the feature plan."
    File.write(File.join(dir, 'context.md'), render_template(tpl,
      key: key, title: title, kind: kind, url: url || '—', stage: stage, created_at: t,
      created_at_short: Time.now.strftime('%Y-%m-%d %H:%M'), next_step: next_step))
    event(dir, 'item.created', "Created #{kind} #{key} — #{title}", { 'kind' => kind })
    { created: true, dir: rel(dir), key: key }
  end

  def parse_value(raw)
    return nil if raw == 'null'
    JSON.parse(raw)
  rescue JSON::ParserError
    raw
  end

  def assign(hash, dotted, value)
    parts = dotted.split('.')
    last = parts.pop
    target = parts.reduce(hash) { |h, p| h[p] = {} unless h[p].is_a?(Hash); h[p] }
    target[last] = value
  end

  def update(dir, story_key, subtask_key, pairs)
    state = read_state(dir)
    target = state
    if story_key
      state['stories'] ||= []
      target = state['stories'].find { |s| s['key'] == story_key } ||
               (state['stories'] << { 'key' => story_key, 'status' => 'planned', 'subtasks' => [] }).last
      if subtask_key
        target['subtasks'] ||= []
        target = target['subtasks'].find { |s| s['key'] == subtask_key } ||
                 (target['subtasks'] << { 'key' => subtask_key, 'status' => 'pending' }).last
      end
    elsif subtask_key
      abort 'plans.rb update: --subtask requires --story'
    end
    old_stage = state['stage']
    pairs.each do |pair|
      k, v = pair.split('=', 2)
      abort "plans.rb update: expected field=value, got #{pair.inspect}" if v.nil? || k.empty?
      assign(target, k, parse_value(v))
    end
    write_state(dir, state)
    if state['stage'] != old_stage
      event(dir, 'stage.changed', "Stage #{old_stage} → #{state['stage']}", { 'from' => old_stage, 'to' => state['stage'] })
    end
    { ok: true, dir: rel(dir) }
  end

  def event(dir, type, msg, data = nil)
    line = { ts: now, type: type, msg: msg, branch: current_branch, data: data }.compact
    File.open(File.join(dir, 'events.jsonl'), 'a') { |f| f.puts(JSON.generate(line)) }
    { ok: true }
  end

  def show(dir)
    s = read_state(dir)
    out = ["#{s['key']} — #{s['title']}  [#{s['kind']} · stage: #{s['stage']}]"]
    out << "  branch: #{s['branch'] || '—'}  mr: #{s.dig('mr', 'url') || '—'}"
    (s['stories'] || []).each do |story|
      subs = story['subtasks'] || []
      done = subs.count { |x| x['status'] == 'done' }
      out << "  • #{story['key']} #{story['title']} [#{story['status']}] #{done}/#{subs.size} subtasks"
      subs.sort_by { |x| x['order'] || 0 }.each do |x|
        out << "      #{x['order'] || '-'}. #{x['key']} #{x['title']} [#{x['status']}] #{x['branch']} #{x.dig('mr', 'url')}".rstrip
      end
    end
    ev = File.join(dir, 'events.jsonl')
    if File.exist?(ev)
      last = File.readlines(ev).last(5).map { |l| JSON.parse(l) rescue nil }.compact
      out << '  recent:' unless last.empty?
      last.each { |e| out << "    #{e['ts']} #{e['type']} — #{e['msg']}" }
    end
    out.join("\n")
  end

  # Branch name from the configured pattern: kind = feature | subtask | bugfix
  def branch_name(kind, key, title)
    defaults = { 'feature' => 'feature/{key}-{slug}', 'subtask' => '{key}-{slug}', 'bugfix' => 'bugfix/{key}-{slug}' }
    abort "plans.rb name: kind must be one of #{defaults.keys.join(', ')}" unless defaults.key?(kind)
    pattern = config.dig('git', "#{kind}_branch_pattern") || defaults[kind]
    pattern.gsub('{key}', key).gsub('{slug}', slugify(title))
  end

  # Markdown outline: "line<TAB>level<TAB>heading" for every heading outside code fences.
  def outline(file)
    in_fence = false
    File.readlines(file).each_with_index.map do |line, i|
      in_fence = !in_fence if line.start_with?('```')
      next if in_fence
      m = line.match(/\A(#+)\s+(.*)/)
      "#{i + 1}\t#{m[1].size}\t#{m[2].strip}" if m
    end.compact
  end

  # Prints the section whose heading matches pattern (case-insensitive), up to the next heading
  # of the same or a higher level. Several matches → all of them.
  def section(file, pattern)
    lines = File.readlines(file)
    re = Regexp.new(pattern, Regexp::IGNORECASE)
    heads = outline(file).map { |l| n, lvl, text = l.split("\t", 3); [n.to_i, lvl.to_i, text] }
    out = []
    heads.each_with_index do |(n, lvl, text), idx|
      next unless text.match?(re)
      stop = heads[(idx + 1)..].find { |(_, l2, _)| l2 <= lvl }
      last = stop ? stop[0] - 1 : lines.size
      out << "#{File.basename(file)}:#{n}-#{last}" << lines[(n - 1)...last].join
    end
    abort "plans.rb section: no heading matches #{pattern.inspect} in #{file}" if out.empty?
    out.join("\n")
  end

  def list
    state_files.map do |f|
      s = JSON.parse(File.read(f)) rescue next
      { key: s['key'], kind: s['kind'], title: s['title'], stage: s['stage'], dir: rel(File.dirname(f)), updated_at: s['updated_at'] }
    end.compact
  end
end
