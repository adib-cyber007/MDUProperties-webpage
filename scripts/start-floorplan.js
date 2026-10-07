'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
// Windows virtual environments launch a second Python process. Stop the owned
// process tree so that the model does not keep its port open after Ctrl+C.
function stopChild(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    const taskkill = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
    spawn(taskkill, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      .on('error', () => child.kill())
      .on('exit', code => {
        if (code && child.exitCode === null) {
          console.error(`Could not stop process tree ${child.pid}. Check Windows process permissions.`);
          child.kill();
        }
      });
  } else child.kill();
}
function startFloorplan(overrides = {}) {
  const configuration = { ...process.env, ...overrides };
  const python = configuration.FLOORPLAN_PYTHON || path.join(root, 'services/floorplan/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!fs.existsSync(python)) throw new Error('Create services/floorplan/.venv and install its dependencies first. See services/floorplan/README.md.');
  const port = Number(configuration.FLOORPLAN_PORT || 8765);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('FLOORPLAN_PORT must be between 1024 and 65535.');
  const recognitionUrl = `http://127.0.0.1:${port}`;
  const env = { ...configuration, FLOORPLAN_ENGINE: configuration.FLOORPLAN_ENGINE || 'cubicasa5k', FLOORPLAN_RECOGNITION_URL: recognitionUrl };
  const service = spawn(python, ['services/floorplan/app.py', '--port', String(port)], { cwd: root, env, stdio: 'inherit', windowsHide: true });
  let site, stopping = false;
  function stop(code = 0) { if (stopping) return; stopping = true; stopChild(site); stopChild(service); process.exitCode = code; }
  service.on('error', error => { console.error(`Recognition could not start: ${error.message}`); stop(1); });
  service.on('exit', code => { if (!stopping) { console.error('Recognition service stopped.'); stop(code || 1); } });
  const ready = (async () => {
    const until = Date.now() + 60000;
    while (Date.now() < until && !stopping) {
      try {
        const state = await (await fetch(recognitionUrl + '/health', { signal: AbortSignal.timeout(1000) })).json();
        if (!state.ready) { console.error(state.error || 'Recognition model failed to load.'); stop(1); return; }
        console.log(`${state.engine} floor plan recognition is ready on ${state.device || 'cpu'}.`);
        site = spawn(process.execPath, ['server.js'], { cwd: root, env, stdio: 'inherit', windowsHide: true });
        site.on('error', error => { console.error(error.message); stop(1); });
        site.on('exit', code => { if (!stopping) stop(code || 0); });
        return;
      } catch { await new Promise(resolve => setTimeout(resolve, 500)); }
    }
    if (!stopping) { console.error('Recognition startup timed out.'); stop(1); }
  })().catch(error => { console.error(error.message); stop(1); });
  return { stop, ready, service, get site() { return site; } };
}
if (require.main === module) {
  try {
    const launcher = startFloorplan();
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => launcher.stop());
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { startFloorplan };
