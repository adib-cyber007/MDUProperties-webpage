'use strict';
// Test the sign-in form with a custom password and a separate demonstration store.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), work = path.join(root, 'work');
fs.mkdirSync(work, { recursive: true });
const dir = fs.mkdtempSync(path.join(work, 'login-test-'));
fs.cpSync(path.join(root, 'public'), path.join(dir, 'public'), { recursive: true });
for (const file of ['server.js', 'seo.js', 'telegram-bot.js', 'floor-plan-recognition.js']) fs.copyFileSync(path.join(root, file), path.join(dir, file));
for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL', 'ADMIN_SESSION_SECRET', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_OWNER_CHAT_IDS', 'TELEGRAM_OWNER_CHAT_ID', 'AI_DESIGN_API_KEY', 'OPENAI_API_KEY', 'FLOORPLAN_RECOGNITION_URL']) delete process.env[key];
process.env.NODE_ENV = 'production'; process.env.ADMIN_PASSWORD = 'login-browser-test-only';
const server = require(path.join(dir, 'server.js'));

async function run() {
  let browser;
  const errors = [];
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true });
    const context = await browser.newContext();
    await context.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    const submit = async password => {
      await page.getByLabel('Password', { exact: true }).fill(password);
      const response = page.waitForResponse(r => r.url() === base + '/api/login' && r.request().method() === 'POST');
      await page.getByRole('button', { name: 'Open dashboard' }).click();
      return (await response).status();
    };
    await page.goto(base + '/admin');
    await page.locator('#login-form').waitFor();
    // Follow any password advertised by the page, just as a visitor would.
    const advertised = page.locator('.login-note strong');
    const password = await advertised.count() ? (await advertised.innerText()).trim() : process.env.ADMIN_PASSWORD;
    assert.equal(await submit(password), 200, 'sign-in using the page instructions must succeed with a configured password');
    await page.getByRole('heading', { name: 'Owner dashboard', exact: true }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: 'Owner dashboard', exact: true }).waitFor();
    assert.equal((await context.request.get(base + '/api/admin/data')).status(), 200, 'the form session authorizes owner data after reload');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.locator('#login-form').waitFor();
    assert.equal((await context.request.get(base + '/api/admin/data')).status(), 401, 'sign-out removes owner access');
    assert.equal(await submit('aaranya-demo'), 401, 'the default demo password cannot authorize a configured server');
    await page.locator('#login-error').getByText('That password is not correct.', { exact: true }).waitFor();
    assert.equal(await submit(process.env.ADMIN_PASSWORD), 200, 'a correct password works after a failed attempt');
    await page.getByRole('heading', { name: 'Owner dashboard', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ pass: true, checks: ['page password instructions', 'form sign-in', 'session survives reload', 'sign-out blocks owner data', 'incorrect password and successful retry'], browserErrors: errors }));
  } finally {
    await browser?.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    const resolved = path.resolve(dir);
    if (!resolved.startsWith(work + path.sep) || !path.basename(resolved).startsWith('login-test-')) throw Error('Unexpected cleanup path');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
