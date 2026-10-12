// Claude Code sessions running in pseudo-terminals. Status comes from Claude Code hooks
// (injected with --settings) and, as a fallback, from the terminal output.
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import pty from '@lydell/node-pty';

const BUFFER_LIMIT = 600_000; // characters of scrollback kept for re-attaching
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)|\x1b[@-_]/g;

export class Sessions extends EventEmitter {
  constructor({ claudeBin, settingsPath }) {
    super();
    this.claudeBin = claudeBin;
    this.settingsPath = settingsPath;
    this.map = new Map();
  }

  list() {
    return [...this.map.values()].map(publicView).sort((a, b) => b.startedAt - a.startedAt);
  }

  get(id) { return this.map.get(id); }

  create({ project, command = '', title = '', key = null, resumeId = null, env: extraEnv = null }) {
    const id = resumeId || crypto.randomUUID();
    const old = this.map.get(id);
    if (old && old.pty) return old;

    const args = resumeId ? ['--resume', id] : ['--session-id', id];
    if (title) args.push('--name', title);
    if (this.settingsPath) args.push('--settings', this.settingsPath);
    if (command) args.push(command);

    // Through an interactive login shell so PATH and version managers (nvm, rvm, rbenv, asdf…)
    // match the developer's terminal (they usually live in ~/.zshrc, which only interactive shells read).
    const shell = process.env.SHELL || '/bin/zsh';
    const flags = (process.env.BACKEND_DASH_SHELL_FLAGS || '-lic').split(/\s+/).filter(Boolean);
    const env = Object.assign({}, process.env, extraEnv || {}, { BD_CLAUDE: this.claudeBin, TERM: 'xterm-256color', COLORTERM: 'truecolor' });
    delete env.CLAUDECODE; delete env.CLAUDE_CODE_ENTRYPOINT; delete env.CLAUDE_CODE_SSE_PORT;

    const s = old || { id, project, projectName: path.basename(project), command, title: title || (command ? command.split(' ')[0] : 'claude'), key, startedAt: Date.now() };
    Object.assign(s, {
      status: command ? 'running' : 'idle',
      detail: resumeId ? 'Reopened — waiting for you' : (command ? 'Starting Claude…' : 'Waiting for your first message'),
      updatedAt: Date.now(), endedAt: null, exitCode: null, stoppedByUser: false, hooked: false,
      // A reopened session starts on a clean screen: replaying the old one would make the terminal
      // answer its old queries (cursor position, device attributes) into the new process.
      buffer: ''
    });
    try {
      s.pty = pty.spawn(shell, [...flags, 'exec "$BD_CLAUDE" "$@"', 'claude', ...args], { name: 'xterm-256color', cols: 120, rows: 34, cwd: project, env });
    } catch (e) {
      s.pty = null;
      this.set(s, 'exited', 'Could not start: ' + e.message);
      this.map.set(id, s);
      return s;
    }
    this.map.set(id, s);
    s.pty.onData((d) => {
      s.buffer = (s.buffer + d).slice(-BUFFER_LIMIT);
      this.emit('out', id, d);
      this.sniff(s, d);
    });
    s.pty.onExit(({ exitCode }) => {
      s.pty = null;
      clearTimeout(s.killTimer);
      s.exitCode = exitCode;
      s.endedAt = Date.now();
      s.canReopen = hasTranscript(s.id);
      this.set(s, 'exited', s.stoppedByUser ? 'Stopped by you' : exitCode === 0 ? 'Session ended' : 'Ended with an error (code ' + exitCode + ')');
    });
    this.emit('update', publicView(s));
    return s;
  }

  input(id, data) {
    const s = this.map.get(id);
    if (!s || !s.pty) return;
    s.pty.write(data);
    if (s.status === 'needs' && /[\r\n]|^[0-9]$/.test(data)) this.set(s, 'running', 'Continuing…');
  }

  resize(id, cols, rows) {
    const s = this.map.get(id);
    if (s && s.pty && cols > 10 && rows > 3) { try { s.pty.resize(Math.floor(cols), Math.floor(rows)); } catch {} }
  }

  // Stop Claude and everything it started (MCP servers, a running rspec…): SIGTERM to the whole
  // process group, SIGKILL after 3 s if anything is still alive.
  kill(id) {
    const s = this.map.get(id);
    if (!s || !s.pty) return;
    s.stoppedByUser = true;
    const pid = s.pty.pid;
    const signal = (sig) => { try { process.kill(-pid, sig); } catch { try { s.pty && s.pty.kill(sig); } catch {} } };
    signal('SIGTERM');
    clearTimeout(s.killTimer);
    s.killTimer = setTimeout(() => { if (s.pty) signal('SIGKILL'); }, 3000);
  }

  canReopen(id) {
    const s = this.map.get(id);
    return !!s && hasTranscript(s.id);
  }

  dismiss(id) {
    this.kill(id);
    this.map.delete(id);
    this.emit('removed', id);
  }

  killAll() { for (const [id, s] of this.map) if (s.pty) { try { process.kill(-s.pty.pid, 'SIGTERM'); } catch {} } }

  // Claude Code hook payload (UserPromptSubmit, PreToolUse, Notification, Stop).
  hook(p) {
    const s = this.map.get(p && p.session_id);
    if (!s) return false;
    s.hooked = true;
    const ev = p.hook_event_name;
    if (ev === 'UserPromptSubmit') this.set(s, 'running', 'Working on: ' + oneLine(p.prompt, 90));
    else if (ev === 'PreToolUse') { s.lastTool = describeTool(p, s.project); this.set(s, 'running', s.lastTool); }
    else if (ev === 'Notification') {
      const msg = oneLine(p.message || '', 140);
      if (p.notification_type === 'idle_prompt' || /waiting for your input/i.test(msg)) this.set(s, 'idle', 'Waiting for your next message');
      else this.set(s, 'needs', msg || 'Claude needs your answer', true);
    } else if (ev === 'Stop') this.set(s, 'idle', 'Finished — waiting for you', false, true);
    return true;
  }

  // Fallback when hooks are not reporting (e.g. an older Claude Code): look at the screen.
  sniff(s, chunk) {
    const text = chunk.replace(ANSI, '');
    if (/Do you want to (proceed|make this edit|create|run|allow)/i.test(text) && s.status !== 'needs') {
      this.set(s, 'needs', 'Waiting for your approval', true);
    } else if (!s.hooked && s.status === 'running' && /esc to interrupt/i.test(text)) {
      s.updatedAt = Date.now();
    }
  }

  set(s, status, detail, attention = false, finished = false) {
    const changed = s.status !== status || s.detail !== detail;
    s.status = status;
    s.detail = detail;
    s.updatedAt = Date.now();
    if (!changed) return;
    const view = publicView(s);
    this.emit('update', view);
    if (attention) this.emit('attention', view, 'needs');
    else if (finished) this.emit('attention', view, 'finished');
  }
}

function publicView(s) {
  return {
    id: s.id, project: s.project, projectName: s.projectName, command: s.command, title: s.title, key: s.key,
    status: s.status, detail: s.detail, lastTool: s.lastTool || null, startedAt: s.startedAt, updatedAt: s.updatedAt,
    endedAt: s.endedAt, exitCode: s.exitCode, alive: !!s.pty, stoppedByUser: !!s.stoppedByUser,
    canReopen: !s.pty && (s.canReopen || (s.canReopen = hasTranscript(s.id)))
  };
}

// Claude Code keeps each conversation as <config>/projects/<encoded cwd>/<session id>.jsonl.
// No file = nothing was ever said in that session, so there is nothing to reopen.
function hasTranscript(id) {
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
  let subs = [];
  try { subs = fs.readdirSync(dir); } catch { return false; }
  return subs.some((d) => { try { return fs.statSync(path.join(dir, d, id + '.jsonl')).size > 0; } catch { return false; } });
}

function oneLine(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function describeTool(p, project) {
  const name = p.tool_name || 'tool';
  const input = p.tool_input || {};
  const rel = (f) => (f && project && f.startsWith(project + path.sep) ? path.relative(project, f) : f);
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(name)) return 'Editing ' + rel(input.file_path || input.notebook_path || '');
  if (name === 'Read') return 'Reading ' + rel(input.file_path || '');
  if (name === 'Bash') return 'Running ' + oneLine(input.command, 80);
  if (name === 'Grep' || name === 'Glob') return 'Searching ' + oneLine(input.pattern, 60);
  if (name === 'Task' || name === 'Agent') return 'Agent: ' + oneLine(input.subagent_type || input.description || '', 60);
  if (name.startsWith('mcp__')) { const [, server, tool] = name.split('__'); return 'Calling ' + server + ' · ' + tool; }
  if (name === 'Skill') return 'Loading skill ' + oneLine(input.skill || input.name || '', 50);
  return name;
}
