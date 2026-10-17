// Unit tests for how a new worktree gets its branch: local, fetched from origin, or created from master.  Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { Worktrees } from '../lib/worktrees.js';

const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@e.com', '-c', 'user.name=T', ...args], { stdio: 'pipe' }).toString().trim();
const W = { git: Worktrees.prototype.git };
const resolve = (main, branch, folder) => Worktrees.prototype.resolveBranch.call(W, main, branch, folder);

// origin (bare) with master + feature/remote-only; a clone `main` on master, one commit behind origin/master.
function repos() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-branches-'));
  const seed = path.join(tmp, 'seed'); const origin = path.join(tmp, 'origin.git'); const main = path.join(tmp, 'main');
  fs.mkdirSync(seed); git(seed, 'init', '-q', '-b', 'master'); git(seed, 'commit', '-q', '--allow-empty', '-m', 'base');
  git(tmp, 'clone', '-q', '--bare', seed, origin);
  git(tmp, 'clone', '-q', origin, main);
  git(seed, 'remote', 'add', 'origin', origin);
  git(seed, 'checkout', '-q', '-b', 'feature/remote-only'); git(seed, 'commit', '-q', '--allow-empty', '-m', 'remote work');
  git(seed, 'checkout', '-q', 'master'); git(seed, 'commit', '-q', '--allow-empty', '-m', 'newer master');
  git(seed, 'push', '-q', 'origin', 'master', 'feature/remote-only');
  return { tmp, seed, main };
}
const add = (main, plan) => git(main, 'worktree', 'add', '-q', ...plan.args);
const upstream = (dir) => { try { return git(dir, 'rev-parse', '--abbrev-ref', '@{u}'); } catch { return null; } };

test('a branch only on origin is fetched and tracks origin', async () => {
  const { tmp, seed, main } = repos();
  const folder = path.join(tmp, 'wt-remote');
  const plan = await resolve(main, 'feature/remote-only', folder);
  assert.equal(plan.created, false);
  add(main, plan);
  assert.equal(upstream(folder), 'origin/feature/remote-only');
  assert.equal(git(folder, 'rev-parse', 'HEAD'), git(seed, 'rev-parse', 'feature/remote-only'));
});

test('an unknown branch is created from the freshly fetched origin/master, without tracking it', async () => {
  const { tmp, seed, main } = repos();
  const folder = path.join(tmp, 'wt-new');
  const plan = await resolve(main, 'feature/KWEB-1-new', folder);
  assert.deepEqual([plan.created, plan.ref], [true, 'origin/master']);
  add(main, plan);
  assert.equal(git(folder, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feature/KWEB-1-new');
  assert.equal(git(folder, 'rev-parse', 'HEAD'), git(seed, 'rev-parse', 'master'), 'latest master, not the stale local one');
  assert.equal(upstream(folder), null);
});

test('an existing local branch is checked out as it is', async () => {
  const { tmp, main } = repos();
  git(main, 'branch', 'feature/local');
  const plan = await resolve(main, 'feature/local', path.join(tmp, 'wt-local'));
  assert.deepEqual([plan.created, plan.ref], [false, 'feature/local']);
});

test('without an origin, a new branch comes from the local master', async () => {
  const { tmp, main } = repos();
  git(main, 'remote', 'remove', 'origin');
  const folder = path.join(tmp, 'wt-offline');
  const plan = await resolve(main, 'feature/offline', folder);
  assert.deepEqual([plan.created, plan.ref], [true, 'master']);
  add(main, plan);
  assert.equal(git(folder, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feature/offline');
});

test('an unreachable origin is reported, not silently branched from master', async () => {
  const { tmp, main } = repos();
  git(main, 'remote', 'set-url', 'origin', path.join(tmp, 'gone.git'));
  await assert.rejects(resolve(main, 'feature/x', path.join(tmp, 'wt-x')), /Could not fetch from origin/);
});
