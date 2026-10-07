'use strict';
const G = require('./public/floor-plan-geometry');

function failure(message, status = 502) { return Object.assign(new Error(message), { status }); }

function createRecognizer({ baseUrl = process.env.FLOORPLAN_RECOGNITION_URL || '', token = process.env.FLOORPLAN_SERVICE_TOKEN || '', fetchImpl = fetch, timeoutMs = 90000 } = {}) {
  function endpoint(route) {
    if (!baseUrl) throw failure('Pretrained recognition is not configured. Start the local recognition service.', 503);
    let url;
    try { url = new URL(baseUrl); } catch { throw failure('The recognition service URL is invalid.', 503); }
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) {
      throw failure('Recognition requires HTTPS or a local loopback service.', 503);
    }
    return `${url.href.replace(/\/+$/, '')}${route}`;
  }
  async function request(route, body, signal) {
    const timeout = AbortSignal.timeout(body ? timeoutMs : 2500);
    const init = { method: body ? 'POST' : 'GET', redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) };
    let response;
    try { response = await fetchImpl(endpoint(route), init); }
    catch (error) {
      if (error.status) throw error;
      throw failure(error.name === 'TimeoutError' ? 'Recognition timed out. Try a smaller, tightly cropped drawing.' : 'Recognition could not connect. Start or restart the recognition service.', 503);
    }
    if (!response.ok) throw failure(response.status === 429 ? 'Recognition is busy. Wait for the current drawing to finish.' : 'The recognition service could not analyze this drawing.', response.status === 429 ? 429 : response.status === 400 ? 400 : 502);
    // A compromised/misconfigured service must not make the website buffer an unbounded response.
    const reader = response.body.getReader(); let length = 0; const chunks = [];
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length;
        if (length > 1024 * 1024) { await reader.cancel(); throw failure('The recognition response was too large.'); } chunks.push(value); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) { if (error.status) throw error; throw failure('Recognition returned an invalid response.'); }
  }
  return {
    async status() {
      if (!baseUrl) return { configured: false, ready: false, engine: 'cubicasa5k' };
      try { const result = await request('/health'); const supported=['mitunet','cubicasa5k'].includes(result.engine); return { configured: true, ready: result.ready === true && supported, engine:supported?result.engine:'cubicasa5k',wallOnly:result.wallOnly===true,pipeline:result.pipeline||result.engine }; }
      catch { return { configured: true, ready: false, engine: 'cubicasa5k' }; }
    },
    async analyze(body, signal) {
      // Validate client images, dimensions and decoded geometry using the same rules as saved plans.
      const plan = G.validate({ version: 1, image: body?.image, width: body?.width, depth: body?.depth,
        height: 10, thickness: .5, walls: [], scaleConfirmed: false, published: false });
      const mode=body?.mode??'combined';
      if(!['combined','walls','openings','furniture'].includes(mode))throw failure('Choose combined, wall, opening, or furniture recognition.',400);
      const profile=body?.profile??'auto';
      if(!['auto','standard','colored'].includes(profile))throw failure('Choose automatic, FLRplanner, or coloured-wall recognition.',400);
      const result = await request('/analyze', { image: plan.image, width: plan.width, depth: plan.depth,
        ...(body?.mode !== undefined?{mode}: {}),...(body?.profile!==undefined?{profile}: {}) }, signal);
      try {
        if (!['cubicasa5k','mitunet','color-walls'].includes(result.engine) || !Array.isArray(result.walls) || !Array.isArray(result.furniture)) throw new Error();
        const wallOnly=result.engine==='mitunet' && mode==='walls';
        const proposed=wallOnly?result.walls.filter(w=>w.kind==='wall'):result.walls;
        const geometry = G.validate({ ...plan, walls: ['cubicasa5k','color-walls'].includes(result.engine)?G.surroundOpenings(proposed,plan.width,plan.depth):proposed, furniture: wallOnly?[]:result.furniture,
          recognition: { engine: result.engine, regions: result.rooms ?? [], inferenceMs: result.inferenceMs,
            ...(result.engine==='mitunet'?{candidates:result.candidates??[],annotations:result.annotations??[],summary:result.summary??{}}:{}) } });
        const fixtures = geometry.furniture.map((item, i) => ({ ...item,
            detector: 'cubicasa5k', label: typeof result.furniture[i].label === 'string' ? result.furniture[i].label.slice(0, 40) : G.FURNITURE[item.type].label,
            confidence: typeof result.furniture[i].confidence === 'number' && result.furniture[i].confidence >= 0 && result.furniture[i].confidence <= 1 ? result.furniture[i].confidence : null }));
        return { engine: result.engine, walls: geometry.walls,
          furniture: G.recognitionFurniture({ ...geometry, furniture: fixtures }, [], plan.width, plan.depth),
          rooms: geometry.recognition.regions,
          inferenceMs: geometry.recognition.inferenceMs,
          sources: {walls:result.engine==='color-walls'?'color-geometry':result.engine,
            openings:result.engine==='color-walls'?'color-gaps+cubicasa5k':'cubicasa5k',furniture:'cubicasa5k'},
          ...(result.engine==='mitunet'?{candidates:geometry.recognition.candidates,annotations:geometry.recognition.annotations,summary:geometry.recognition.summary}:{}),
          warnings: ['Review detected geometry and confirm the drawing scale.', ...(wallOnly?['Uncertain walls are excluded from 3D until accepted.']:['Furniture and fixture suggestions need review before adding them.'])] };
      } catch { throw failure('Recognition returned geometry the editor cannot use. Try cropping to one floor.'); }
    }
  };
}
module.exports = { createRecognizer };
