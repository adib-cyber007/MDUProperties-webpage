'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

test('Vercel imports a callable handler without opening a port', async t => {
  for (const { vercel, password } of [{ vercel: true }, { vercel: false }, { vercel: true, password: 'hosting-test-only' }]) {
    await t.test(password ? 'configured owner receives the JSON body' : vercel ? 'with Vercel system variables' : 'without Vercel system variables', async () => {
      const env = { ...process.env, NODE_ENV: 'production' };
      for (const key of ['NODE_TEST_CONTEXT', 'VERCEL', 'HOST', 'PORT', 'ADMIN_PASSWORD', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'TELEGRAM_BOT_TOKEN']) delete env[key];
      if (vercel) env.VERCEL = '1';
      if (password) env.ADMIN_PASSWORD = password;
      const probe = `
        const assert = require('node:assert/strict');
        const http = require('node:http');
        const { Readable, Writable } = require('node:stream');
        http.Server.prototype.listen = () => { throw new Error('Import opened a listening port'); };
        (async () => {
          let handler = await import('./server.js');
          // Vercel unwraps nested CJS/ESM default exports before invocation.
          for (let i = 0; i < 5 && handler.default; i++) handler = handler.default;
          assert.equal(typeof handler, 'function', 'Vercel must receive a request handler');
          assert.equal(typeof handler.listen, 'function', 'Vercel must preserve raw request bodies');
          assert.equal(require('./server.js').listening, false);
          async function invoke(route, method = 'GET', body = '') {
            const request = Readable.from(body ? [Buffer.from(body)] : []);
            request.url = route; request.method = method;
            request.socket = { remoteAddress: '127.0.0.1' };
            request.headers = { host: 'localhost', 'content-type': 'application/json' };
            const chunks = [];
            const response = new Writable({ write(chunk, encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
            response.headersSent = false;
            response.headers = {};
            response.setHeader = (name, value) => { response.headers[name] = value; return response; };
            response.writeHead = (status, headers) => { response.statusCode = status; Object.assign(response.headers, headers); response.headersSent = true; return response; };
            const finished = new Promise((resolve, reject) => { response.once('finish', resolve); response.once('error', reject); });
            await handler(request, response); await finished;
            return { route, status: response.statusCode, type: response.headers['Content-Type'], bytes: Buffer.concat(chunks).length };
          }
          const routes = [];
          for (const route of ['/', '/listings', '/3d-projects', '/admin', '/floor-plan-renderer.js']) routes.push(await invoke(route));
          // Only the in-memory demo store is used, with all remote credentials unset.
          if (process.env.VERCEL) for (const route of ['/api/listings', '/api/models']) routes.push(await invoke(route));
          const login = await invoke('/api/login', 'POST', JSON.stringify({ password: process.env.ADMIN_PASSWORD || 'aaranya-demo' }));
          console.log('HOST_REPORT:' + JSON.stringify({ routes, loginStatus: login.status }));
        })().catch(error => { console.error(error); process.exitCode = 1; });
      `;
      const child = spawn(process.execPath, ['-e', probe], { cwd: path.resolve(__dirname, '..'), env, windowsHide: true });
      let stdout = '', stderr = '';
      child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
      const timeout = setTimeout(() => child.kill(), 10000);
      const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }).finally(() => clearTimeout(timeout));
      assert.equal(exit, 0, stderr || stdout);
      const match = stdout.match(/HOST_REPORT:(.+)/); assert.ok(match, stderr || stdout);
      const result = JSON.parse(match[1]);
      assert.ok(result.routes.every(route => route.status === 200 && route.bytes > 0));
      const renderer = result.routes.find(route => route.route === '/floor-plan-renderer.js');
      assert.match(renderer.type, /javascript/); assert.ok(renderer.bytes > 100000, 'real browser bundle is served');
      assert.equal(result.loginStatus, password ? 200 : 503, password ? 'configured owner can sign in using the raw JSON body' : 'production never uses the local demo owner password');
    });
  }
});
