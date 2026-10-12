// Small promise wrapper around execFile that never throws: callers look at `code`.
import { execFile } from 'node:child_process';

export function sh(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { cwd: opts.cwd, env: opts.env ? Object.assign({}, process.env, opts.env) : process.env, timeout: opts.timeout || 60_000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
      resolve({ code, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err && typeof err.code !== 'number' ? err.message : null });
    });
    if (opts.input !== undefined) { child.stdin.end(opts.input); }
  });
}

export const quote = (s) => (/^[A-Za-z0-9_./:=@%+-]+$/.test(String(s)) ? String(s) : "'" + String(s).replace(/'/g, "'\\''") + "'");
export const cmdline = (parts) => parts.map(quote).join(' ');
