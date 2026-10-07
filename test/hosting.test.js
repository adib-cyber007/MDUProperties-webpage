'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

test('Vercel can import the entrypoint, serve website routes and the bundled walkthrough, and require a production owner password', async () => {
  const env = { ...process.env, NODE_ENV: 'production', VERCEL: '1', PORT: '0' };
  for (const key of ['HOST', 'ADMIN_PASSWORD', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'TELEGRAM_BOT_TOKEN']) delete env[key];
  const probe = `
    const server = require('./server.js');
    server.once('listening', async () => {
      try {
        const base = 'http://127.0.0.1:' + server.address().port;
        const routes = [];
        for (const route of ['/', '/listings', '/3d-projects', '/admin', '/api/listings', '/api/models', '/floor-plan-renderer.js']) {
          const response = await fetch(base + route), body = await response.text();
          routes.push({ route, status: response.status, type: response.headers.get('content-type'), bytes: body.length });
        }
        const login = await fetch(base + '/api/login', { method: 'POST', body: JSON.stringify({ password: 'aaranya-demo' }) });
        console.log('HOST_REPORT:' + JSON.stringify({ address: server.address().address, routes, loginStatus: login.status }));
      } catch (error) { console.error(error); process.exitCode = 1; }
      finally { server.close(); }
    });
  `;
  const child = spawn(process.execPath, ['-e', probe], { cwd: path.resolve(__dirname, '..'), env, windowsHide: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
  const timeout = setTimeout(() => child.kill(), 20000);
  const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }).finally(() => clearTimeout(timeout));
  assert.equal(exit, 0, stderr || stdout);
  const match = stdout.match(/HOST_REPORT:(.+)/); assert.ok(match, stdout);
  const result = JSON.parse(match[1]); assert.equal(result.address, '0.0.0.0');
  assert.ok(result.routes.every(route => route.status === 200 && route.bytes > 0));
  const renderer = result.routes.find(route => route.route === '/floor-plan-renderer.js');
  assert.match(renderer.type, /javascript/); assert.ok(renderer.bytes > 100000, 'real browser bundle is served');
  assert.equal(result.loginStatus, 503, 'production never uses the local demo owner password');
});
