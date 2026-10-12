// Browser test of the worktree screens against the real server, Docker and Postgres.
// Needs Playwright with a Chromium (PLAYWRIGHT_BROWSERS_PATH) and what worktrees.e2e.test.js needs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startHarness, sh } from './harness.js';

const require = createRequire(import.meta.url);
let chromium = null;
try { ({ chromium } = require('playwright')); } catch {}
const SHOTS = process.env.SHOTS || null; // folder for screenshots, if wanted

let H; let browser; let ctx; let page;
const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: false }); } };

before(async () => {
  if (!chromium) return;
  H = await startHarness();
  await H.setupShared();
  browser = await chromium.launch(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {});
  ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.goto(H.url + '/');
});

after(async () => {
  if (!chromium) return;
  try { await browser.close(); } catch {}
  await H.stop();
});

const skip = !chromium && 'playwright not installed';

test('header: project switcher and the Worktrees / Monitor buttons', { skip }, async () => {
  await page.waitForSelector('.proj');
  assert.match(await page.textContent('.proj'), /webapp/);
  assert.ok(await page.isVisible('.gbtn:has-text("Worktrees")'));
  assert.ok(await page.isVisible('.gbtn:has-text("Monitor")'));
  assert.match(page.url(), /\?p=webapp$/);
  await page.waitForSelector('.tab:has-text("Environment")'); // the main checkout has its own environment too
});

test('Worktrees page: shared services and the main checkout', { skip }, async () => {
  await page.click('.gbtn:has-text("Worktrees")');
  await page.waitForSelector('h1:has-text("Worktrees")');
  await page.waitForSelector('text=Shared services');
  await H.waitFor(async () => /2 \/ 2 up/.test(await page.textContent('#global')), 20000, 'shared up');
  assert.ok(await page.isVisible('.wt-card:has-text("webapp · main checkout")'), 'the main checkout has its own card');
  assert.ok(await page.isVisible('text=No worktrees yet'));
  await shot('01-worktrees-empty');
});

test('New worktree: create with a private copy and start everything', { skip }, async () => {
  await page.click('button:has-text("+ New worktree")');
  await page.waitForSelector('dialog h2:has-text("New worktree")');
  const sel = page.locator('dialog select').first();
  assert.equal(await sel.inputValue(), 'feature/PROJ-100-answers', 'branch from the plans is picked');
  assert.ok(await page.locator('dialog option[disabled]:has-text("master")').count(), 'master is greyed out (open in main)');
  assert.equal(await page.inputValue('dialog [data-k="name"]'), 'PROJ-100', 'name defaults to the ticket key, editable');
  assert.ok((await page.inputValue('dialog [data-k="folder"]')).endsWith('/webapp-worktrees/PROJ-100'));
  assert.ok(await page.locator('dialog .opt.on:has-text("Private copy")').count(), 'private copy preselected');
  assert.equal(await page.locator('dialog select').nth(2).inputValue(), 'webapp_test', 'own test database copied from webapp_test');
  assert.match(await page.textContent('dialog'), /slot 1/);
  assert.match(await page.textContent('dialog'), /web :3010/);
  await shot('02-new-worktree');
  await page.click('dialog label.check:has-text("Open it in a new browser tab") input'); // stay in this tab
  await page.click('dialog button:has-text("Create worktree")');
  await page.waitForSelector('dialog', { state: 'detached', timeout: 60000 });
  await page.waitForSelector('.tab.on:has-text("Environment")', { timeout: 30000 });
  assert.match(page.url(), /\?p=proj-100$/);
  assert.match(await page.textContent('.proj'), /PROJ-100/);
  // migrate → up → install → vite, all from the one click
  await H.waitFor(async () => { const t = await page.textContent('#view-env'); return /Backend[\s\S]*Up · :3010/.test(t) && /Frontend[\s\S]*Up · :5183/.test(t); }, 300000, 'backend and frontend up in the Environment tab');
  assert.match(await page.title(), /PROJ-100 · backend/);
  await shot('03-environment');
});

test('Environment tab: steps, output, database and ports', { skip }, async () => {
  const env = await page.textContent('#view-env');
  assert.match(env, /webapp_proj_100/);
  assert.match(env, /Test\s*webapp_proj_100_test/);
  assert.match(env, /test ✓/);
  assert.match(env, /RAILS_ENV=test/);
  assert.match(env, /20261001000000_create_answers/);
  assert.match(env, /applied/);
  assert.match(env, /3010[\s\S]*3000/);
  assert.match(env, /Also brought from the main checkout[\s\S]*frontend\/planviewer[\s\S]*own clone/);
  // the output of the migrate step opens in a terminal tab
  await page.locator('.step:has-text("Migrate") button:has-text("Output")').click();
  await page.waitForSelector('.tab.on:has-text("Migrate")');
  await H.waitFor(async () => /migrated on webapp_proj_100/.test(await page.textContent('.view.proc.on .xterm-rows')), 10000, 'migrate output');
  await shot('04-output');
  // hiding/showing the sidebar with a terminal open: quick, no errors, the terminal refits once it settles
  const cols0 = await page.evaluate(() => document.querySelector('.view.proc.on .xterm-rows').children.length);
  for (let i = 0; i < 7; i++) { const t = Date.now(); await page.click('.side-toggle'); assert.ok(Date.now() - t < 1000, 'toggle took ' + (Date.now() - t) + 'ms'); }
  assert.match(await page.getAttribute('#app', 'class'), /side-hidden/);
  await page.waitForTimeout(400);
  const wide = await page.evaluate(() => document.querySelector('.view.proc.on .xterm-screen').getBoundingClientRect().width);
  await page.click('.side-toggle'); await page.waitForTimeout(400);
  const narrow = await page.evaluate(() => document.querySelector('.view.proc.on .xterm-screen').getBoundingClientRect().width);
  assert.ok(wide > narrow + 100, `terminal refits: ${wide} → ${narrow}`);
  assert.ok(cols0 > 0);
  // "Open in VS Code" sits before Start all
  const heads = await page.locator('#view-env .section-head').first().locator('.row-gap .btn').allTextContents();
  assert.ok(heads.indexOf('</> Open in VS Code') >= 0 && heads.indexOf('</> Open in VS Code') === heads.indexOf('▶ Start all') - 1, heads.join(' | '));
  await page.click('.tab:has-text("Environment")');
  await page.locator('#view-env button:has-text("Open in VS Code")').click();
  await page.waitForSelector('.toast:has-text("Could not open VS Code")'); // no VS Code in the test machine
  // the Environment tab can be closed, stays closed after a reload, and comes back from the Home strip
  await page.locator('.tab:has-text("Environment") button.x').click();
  assert.equal(await page.locator('.tab:has-text("Environment")').count(), 0);
  await page.reload();
  await page.waitForSelector('#envstrip');
  assert.equal(await page.locator('.tab:has-text("Environment")').count(), 0, 'stays closed');
  await page.locator('#envstrip button:has-text("Environment")').first().click();
  await page.waitForSelector('.tab.on:has-text("Environment")');
  await page.click('#gnav .gbtn:has-text("Home")');
  await page.waitForSelector('#envstrip');
  assert.match(await page.textContent('#envstrip'), /proj-100\.localhost:5183/);
  await shot('05-home-strip');
});

test('switcher: worktree under webapp with its state and a new-tab button', { skip }, async () => {
  await page.click('.proj');
  await page.waitForSelector('.pmenu');
  const menu = await page.textContent('.pmenu');
  assert.match(menu, /webapp · main checkout/);
  assert.match(menu, /PROJ-100 · slot 1/);
  assert.match(menu, /up/);
  await shot('06-switcher');
  const [popup] = await Promise.all([ctx.waitForEvent('page'), page.locator('.pmenu .mi.child button.nt').click()]);
  await popup.waitForLoadState();
  assert.match(popup.url(), /\?p=proj-100$/);
  await popup.waitForSelector('.proj:has-text("PROJ-100")');
  await popup.close();
  // switching projects in this tab
  await page.click('.proj');
  await page.locator('.pmenu button:has-text("webapp")').first().click();
  await page.waitForSelector('.proj:has-text("webapp")');
  assert.match(page.url(), /\?p=webapp$/);
});

test('Monitor: tiles, memory per worktree and the chart', { skip }, async () => {
  await page.click('.gbtn:has-text("Monitor")');
  await page.waitForSelector('h1:has-text("Monitor")');
  await H.waitFor(async () => /PROJ-100[\s\S]*web/.test(await page.textContent('#global')), 60000, 'worktree group');
  const t = await page.textContent('#global');
  assert.match(t, /Mac memory/);
  assert.match(t, /Docker VM memory/);
  assert.match(t, /Shared services[\s\S]*postgres/);
  await H.waitFor(async () => page.locator('.chart svg').count(), 30000, 'chart');
  await page.locator('.chart rect').hover();
  assert.ok(await page.isVisible('.chart .tip'), 'hover tooltip');
  await H.waitFor(async () => /PROJ-100/.test(await page.locator('section[aria-label="Disk by worktree"]').textContent()), 120000, 'disk sizes');
  await shot('07-monitor');
  await page.click('.gbtn:has-text("Monitor")');
});

test('shared database: migrate asks, "run on shared anyway", banner and roll back', { skip }, async () => {
  await page.click('.gbtn:has-text("Worktrees")');
  await page.click('button:has-text("+ New worktree")');
  await page.waitForSelector('dialog h2:has-text("New worktree")');
  await page.locator('dialog select').first().selectOption('feature/PROJ-300-hide');
  await page.click('dialog .opt:has-text("Shared")');
  await page.click('dialog label.check:has-text("Start everything") input');
  await page.click('dialog label.check:has-text("Open it in a new browser tab") input');
  await page.click('dialog button:has-text("Create worktree")');
  await page.waitForSelector('.tab.on:has-text("Environment")', { timeout: 60000 });
  await page.waitForSelector('#view-env .step:has-text("Migrate")');
  await page.locator('.step:has-text("Migrate") button:has-text("Run")').click();
  await page.waitForSelector('dialog h2:has-text("This branch has its own migration")');
  assert.match(await page.textContent('dialog'), /20261002000000_add_hidden/);
  await shot('08-migrate-dialog');
  await page.click('dialog button:has-text("Run on shared anyway")');
  await H.waitFor(() => H.psql("SELECT count(*) FROM schema_migrations WHERE version = '20261002000000'", 'webapp_development') === '1', 60000, 'migrated on shared');
  await page.click('.gbtn:has-text("Worktrees")');
  await page.waitForSelector('text=Shared DB is ahead of main', { timeout: 20000 });
  await shot('09-banner');
  await page.click('.banner button:has-text("Roll back")');
  await H.waitFor(() => H.psql("SELECT count(*) FROM schema_migrations WHERE version = '20261002000000'", 'webapp_development') === '0', 60000, 'rolled back');
  await page.waitForSelector('text=Shared DB is ahead of main', { state: 'detached', timeout: 20000 });
});

test('delete: clean worktree with its branch; dirty one needs "I understand"', { skip }, async () => {
  // PROJ-300: clean → no confirmation box
  await page.locator('.wt-card:has-text("PROJ-300") button.title').click(); // opens its Environment tab
  await page.waitForSelector('.tab.on:has-text("Environment")');
  await page.waitForSelector('#view-env h1:has-text("PROJ-300")');
  await page.click('button:has-text("Delete worktree…")');
  await page.waitForSelector('dialog h2:has-text("Delete worktree PROJ-300?")');
  assert.equal(await page.locator('dialog button.end').isDisabled(), false, 'nothing uncommitted');
  await page.click('dialog label.check:has-text("Also delete the local branch") input');
  assert.match(await page.textContent('dialog'), /1 commit not pushed/);
  assert.equal(await page.locator('dialog button.end').isDisabled(), true, 'deleting the branch loses its commit → confirm');
  await page.click('dialog label.check:has-text("I understand") input');
  await page.click('dialog button.end');
  await page.waitForSelector('.toast:has-text("Deleted PROJ-300")', { timeout: 120000 });
  await page.waitForSelector('.proj:has-text("webapp")');
  assert.ok(!sh('git', ['-C', H.MAIN, 'branch']).includes('PROJ-300'));
  // PROJ-100: uncommitted work
  const wt = path.join(path.dirname(H.MAIN), 'webapp-worktrees', 'PROJ-100');
  fs.writeFileSync(path.join(wt, 'wip.txt'), 'wip');
  await page.click('.proj');
  await page.locator('.pmenu .mi.child button').first().click();
  await page.waitForSelector('.tab:has-text("Environment")');
  await page.click('.tab:has-text("Environment")');
  await page.click('button:has-text("Delete worktree…")');
  await page.waitForSelector('dialog h2:has-text("Delete worktree PROJ-100?")');
  assert.match(await page.textContent('dialog'), /1 uncommitted change/);
  assert.match(await page.textContent('dialog'), /webapp_proj_100/);
  assert.match(await page.textContent('dialog'), /Test database webapp_proj_100_test/);
  assert.equal(await page.locator('dialog button.end').isDisabled(), true, 'disabled until confirmed');
  await shot('10-delete-dialog');
  await page.click('dialog label.check:has-text("I understand") input');
  await page.click('dialog button.end');
  await page.waitForSelector('.toast:has-text("Deleted PROJ-100")', { timeout: 120000 });
  assert.ok(!fs.existsSync(wt));
  assert.equal(H.psql("SELECT count(*) FROM pg_database WHERE datname = 'webapp_proj_100'"), '0');
  await page.click('.gbtn:has-text("Worktrees")');
  await page.waitForSelector('text=No worktrees yet');
});

test('folder page: set a subtask status by hand', { skip }, async () => {
  await page.click('.gbtn.on').catch(() => {});
  if (await page.locator('#app.global').count()) await page.click('.gbtn:has-text("Worktrees")');
  await page.click('#tree button.name:has-text("features")');
  await page.click('#tree button.name:has-text("PROJ-100-answers")');
  await page.waitForSelector('.story-row');
  const chev = page.locator('.story-row button[aria-expanded]').first();
  if ((await chev.getAttribute('aria-expanded')) === 'false') await chev.click();
  const sel = page.locator('select[aria-label="Set the status of PROJ-103"]');
  await sel.waitFor();
  await sel.selectOption('done');
  await page.waitForSelector('.toast:has-text("PROJ-103 → done")');
  await H.waitFor(() => JSON.parse(fs.readFileSync(path.join(H.MAIN, '.plans/features/PROJ-100-answers/state.json'), 'utf8')).stories[0].subtasks[0].status === 'done', 10000, 'state.json');
  await shot('12-subtask-status');
});

test('light mode renders the worktree pages', { skip }, async () => {
  await page.click('button:has-text("Light")');
  await page.waitForSelector('html.lt');
  await shot('11-worktrees-light');
  await page.click('button:has-text("Dark")');
});
