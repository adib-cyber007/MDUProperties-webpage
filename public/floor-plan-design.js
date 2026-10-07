(function (root, factory) {
  const api = typeof module === 'object' && module.exports ? factory(require('./floor-plan-geometry'), require('./floor-plan-finishes')) : factory(root.FloorPlanGeometry, root.FloorPlanFinishes);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FloorPlanDesign = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (G, F) {
  'use strict';
  const STYLES = { surprise: 'Choose for me', natural: 'Warm natural', modern: 'Modern calm', classic: 'Classic elegance', coastal: 'Coastal', earthy: 'Earthy & rich' };
  const WALL_PATTERNS = ['solid','plaster','linen','stripes','botanical','trellis','dots','damask','panels','slats'];
  const EXTERIOR_PATTERNS = ['solid','plaster','stone','concrete','slats','panels'];
  const FLOOR_PATTERNS = ['wood','chevron','herringbone','tiles','checker','marble','terrazzo','stone','concrete'];
  const fail = message => { throw Object.assign(new Error(message), {status:400}); };
  const clone = value => JSON.parse(JSON.stringify(value));
  function finishSummary(finish) {
    const value=G.validateFinish({...finish,pattern:finish.pattern==='custom'?'solid':finish.pattern});
    return {...value,pattern:finish.pattern};
  }
  function context(model,{keepOverrides=false}={}) {
    return {floors:G.floorsOf(model).filter(f => f.plan?.walls.some(w => w.kind === 'wall')).map(({index,plan}) => {
      const sides=G.wallSurfaces(plan);
      return ({
      index,width:plan.width,depth:plan.depth,height:plan.height,
      lockedFinishes:Object.fromEntries(['wall','exterior','floor','ceiling'].filter(key=>plan.finishLocks?.[key]||(key==='exterior'&&plan.finishLocks?.wall)).map(key=>[key,finishSummary(plan.finishes?.[key]||F.DEFAULTS[key])])),
      walls:plan.walls.flatMap((wall,index) => wall.kind === 'wall' ? [{index,a:wall.a,b:wall.b,outside:sides[index].outside,uncertain:sides[index].uncertain,
        ...(plan.finishLocks?.wall||wall.finishLocked||(keepOverrides&&wall.finish)?{lockedFinish:finishSummary(wall.finish||plan.finishes?.wall||F.DEFAULTS.wall)}:{}),
        ...(plan.finishLocks?.wall||plan.finishLocks?.exterior||wall.finishLocked||(keepOverrides&&wall.exteriorFinish)?{lockedExteriorFinish:finishSummary(wall.exteriorFinish||plan.finishes?.exterior||F.DEFAULTS.exterior)}:{})}] : []),
      furniture:(plan.furniture || []).map(item => item.type)
    });})};
  }
  function validateRequest(input) {
    if (!input || !Object.hasOwn(STYLES,input.style) || !['mixed','paint','wallpaper'].includes(input.wallLook)) fail('Choose a supported design style and wall finish.');
    if (typeof input.brief !== 'string' || input.brief.length > 240) fail('Keep the design brief to 240 characters.');
    const floors=input.context?.floors;
    if (!Array.isArray(floors) || !floors.length || floors.length > G.MAX_FLOORS) fail('Detect or trace the walls before designing the house.');
    const ids=new Set();
    const checked=floors.map(f => {
      if (!Number.isInteger(f.index) || f.index < 0 || f.index >= G.MAX_FLOORS || ids.has(f.index)) fail('Invalid floor selection.');ids.add(f.index);
      if (![f.width,f.depth].every(n=>Number.isFinite(n)&&n>=4&&n<=500) || !Number.isFinite(f.height) || f.height<7 || f.height>25) fail('Invalid drawing dimensions.');
      if (!Array.isArray(f.walls) || !f.walls.length || f.walls.length>G.MAX_SEGMENTS) fail('Review the detected walls first.');
      const wallIds=new Set();
      const walls=f.walls.map(w=>{
        if (!Number.isInteger(w.index)||w.index<0||w.index>=G.MAX_SEGMENTS||wallIds.has(w.index)) fail('Invalid wall selection.');wallIds.add(w.index);
        if (![w.a,w.b].every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&n>=0&&n<=1))) fail('Invalid wall coordinates.');
        if(Math.hypot((w.b[0]-w.a[0])*f.width,(w.b[1]-w.a[1])*f.depth)<.1) fail('Invalid wall length.');
        if(w.outside!==undefined&&!['left','right','both','none'].includes(w.outside))fail('Invalid wall surface classification.');
        return {index:w.index,a:[...w.a],b:[...w.b],outside:w.outside||'none',uncertain:w.uncertain===true,
          ...(w.lockedFinish?{lockedFinish:referenceFinish(w.lockedFinish)}:{}),...(w.lockedExteriorFinish?{lockedExteriorFinish:referenceFinish(w.lockedExteriorFinish)}:{})};
      });
      if (!Array.isArray(f.furniture)||f.furniture.length>G.MAX_FURNITURE||f.furniture.some(type=>!Object.hasOwn(G.FURNITURE,type))) fail('Invalid furniture summary.');
      if(f.lockedFinishes!==undefined&&(!f.lockedFinishes||typeof f.lockedFinishes!=='object'||Array.isArray(f.lockedFinishes)))fail('Invalid locked finish summary.');
      const lockedFinishes=Object.fromEntries(['wall','exterior','floor','ceiling'].filter(key=>f.lockedFinishes?.[key]!==undefined).map(key=>[key,referenceFinish(f.lockedFinishes[key])]));
      return {index:f.index,width:f.width,depth:f.depth,height:f.height,walls,lockedFinishes,furniture:[...f.furniture]};
    });
    if(checked.every(f=>f.lockedFinishes.floor&&f.lockedFinishes.ceiling&&f.walls.every(w=>
      (w.outside==='both'||f.lockedFinishes.wall||w.lockedFinish)&&(w.outside==='none'||f.lockedFinishes.wall||f.lockedFinishes.exterior||w.lockedExteriorFinish))))fail('Unlock at least one finish before regenerating.');
    return {style:input.style,wallLook:input.wallLook,brief:input.brief.trim(),previous:typeof input.previous==='string'?input.previous.slice(0,80):'',context:{floors:checked}};
  }
  function referenceFinish(value) {
    if(!value||!G.FINISH_PATTERNS.includes(value.pattern))fail('Invalid locked finish summary.');
    const {pattern,color,accent,scale,rotation}=value;
    return finishSummary({pattern,color,accent,scale,rotation});
  }
  function surface(value,patterns) {
    const finish=G.validateFinish(value);
    if (!patterns.includes(finish.pattern)) fail('The designer returned an unsuitable surface material.');
    return finish;
  }
  function validateDesign(value,request) {
    if (!value || typeof value.title!=='string' || !value.title.trim() || value.title.length>80 || typeof value.summary!=='string' || value.summary.length>400) fail('The designer returned an incomplete design.');
    const finishes={wall:surface(value.finishes?.wall,WALL_PATTERNS),exterior:surface(value.finishes?.exterior,EXTERIOR_PATTERNS),floor:surface(value.finishes?.floor,FLOOR_PATTERNS),ceiling:surface(value.finishes?.ceiling,['solid','plaster','panels','coffer','slats'])};
    if (request.wallLook==='paint' && finishes.wall.pattern!=='solid' && finishes.wall.pattern!=='plaster') fail('The design did not respect the paint-only selection.');
    const wallpaper=['stripes','botanical','trellis','dots','damask','linen'];
    if (request.wallLook==='wallpaper' && !wallpaper.includes(finishes.wall.pattern)) fail('The design did not include the requested wallpaper.');
    if (!Array.isArray(value.accents)||value.accents.length>request.context.floors.length) fail('The designer returned too many accent walls.');
    const seen=new Set();
    const accents=value.accents.map(a=>{
      const floor=request.context.floors.find(f=>f.index===a.floorIndex);
      const wall=floor?.walls.find(w=>w.index===a.wallIndex);
      if (!wall||seen.has(a.floorIndex)) fail('The accent wall does not exist in the drawing.');seen.add(a.floorIndex);
      if(wall.lockedFinish||floor.lockedFinishes?.wall)fail('The designer tried to change a locked wall.');
      if(wall.outside==='both')fail('An indoor accent needs a wall with an inside face. Review the wall classification first.');
      const finish=surface(a.finish,WALL_PATTERNS);
      if(request.wallLook==='paint'&&!['solid','plaster'].includes(finish.pattern)) fail('The accent did not respect the paint-only selection.');
      return {floorIndex:a.floorIndex,wallIndex:a.wallIndex,finish};
    });
    return {title:value.title.trim(),summary:value.summary.trim(),finishes,accents};
  }
  const PALETTES = [
    ['natural','Quiet oak','Warm ivory plaster','Natural oak','Forest botanical','A warm ivory backdrop, oak flooring and a leafy accent create a relaxed, natural interior.'],
    ['natural','Soft linen','Natural linen','Pale ash','Sage trellis','Soft linen and pale timber keep the house light; a sage accent adds a gentle pattern.'],
    ['modern','Silver & slate','Mist grey','Soft concrete','Ink trellis','Cool grey walls and soft concrete floors create a clean, contemporary palette.'],
    ['modern','Warm minimal','Chalk white','Ash chevron','Oak slats','Chalk walls and pale chevron flooring bring texture to a restrained palette.'],
    ['classic','Ivory elegance','Warm ivory plaster','White marble','Linen damask','Ivory walls, pale marble and a damask accent give the house a refined, classic finish.'],
    ['classic','Walnut & cream','Cream stripe','Walnut herringbone','Gold botanical','Cream walls and walnut herringbone pair with a warm botanical accent.'],
    ['coastal','Coastal blue','Chalk white','Pale ash','Blue botanical','Bright walls, pale ash and a blue botanical accent create an airy coastal mood.'],
    ['coastal','Sea glass','Silver linen','White porcelain','Blue stripe','Silver linen, pale porcelain and blue stripes give the house a fresh, quiet palette.'],
    ['earthy','Clay & stone','Sand plaster','Sandstone','Terracotta plaster','Sand walls, sandstone flooring and a clay accent add warmth and natural texture.'],
    ['earthy','Garden retreat','Sage plaster','Honey oak','Forest botanical','Sage walls and honey oak create a warm garden-inspired setting.']
  ];
  function localDesign(request,random=Math.random) {
    const choices=PALETTES.filter(p=>(request.style==='surprise'||p[0]===request.style)&&p[1]!==request.previous);
    const p=choices[Math.min(choices.length-1,Math.floor(random()*choices.length))];
    const preset=(kind,name)=>clone(F.PRESETS[kind].find(v=>v.name===name).finish);
    let wall=preset('wall',p[2]), accent=preset('wall',p[4]);
    if(request.wallLook==='paint') {wall={...wall,pattern:'plaster'};accent={...accent,pattern:'solid'};}
    if(request.wallLook==='wallpaper')wall={...accent,pattern:['linen','stripes','botanical','trellis','dots','damask'].includes(accent.pattern)?accent.pattern:'linen'};
    const accents=request.wallLook==='wallpaper'?[]:request.context.floors.filter(f=>!f.lockedFinishes?.wall&&f.walls.some(w=>!w.lockedFinish&&w.outside!=='both')).map(f=>{
      const w=f.walls.filter(w=>!w.lockedFinish&&w.outside!=='both').sort((a,b)=>Math.hypot((b.b[0]-b.a[0])*f.width,(b.b[1]-b.a[1])*f.depth)-Math.hypot((a.b[0]-a.a[0])*f.width,(a.b[1]-a.a[1])*f.depth))[0];
      return {floorIndex:f.index,wallIndex:w.index,finish:accent};
    });
    const ceiling=['Warm white','Ivory plaster','Cool white','Warm white','Classic panel grid','Warm white','Cool white','Blue panel grid','Ivory plaster','Sage paint'][PALETTES.indexOf(p)];
    const exterior=['Ivory render','Sand render','Cool grey render','Warm white facade','Limestone cladding','Sand render','Warm white facade','Cool grey render','Terracotta facade','Timber cladding'][PALETTES.indexOf(p)];
    return validateDesign({title:p[1],summary:(request.wallLook==='mixed'?p[5]:`A coordinated ${STYLES[p[0]].toLowerCase()} palette with ${request.wallLook==='paint'?'painted':'wallpapered'} inside walls.`)+` Outside faces use ${exterior.toLowerCase()}.`,finishes:{wall,exterior:preset('exterior',exterior),floor:preset('floor',p[3]),ceiling:preset('ceiling',ceiling)},accents},request);
  }
  function applyDesign(model,design,{keepOverrides=true}={}) {
    const next=clone(model);
    const floors=next.version===2?next.floors:[{plan:next}];
    floors.forEach((floor,index)=>{
      const plan=floor.plan;if(!plan?.walls.some(w=>w.kind==='wall'))return;
      // Finish-only operation: openings, furniture, dimensions and geometry stay intact.
      const previousWall=plan.finishes?.wall||F.DEFAULTS.wall,previousExterior=plan.finishes?.exterior||F.DEFAULTS.exterior;
      const changes=Object.fromEntries(Object.entries(design.finishes).filter(([key])=>!plan.finishLocks?.[key]&&!(key==='exterior'&&plan.finishLocks?.wall)));
      if(Object.keys(changes).length)plan.finishes={...plan.finishes,...clone(changes)};
      plan.walls=plan.walls.map((wall,wallIndex)=>{
        if(wall.kind!=='wall'||plan.finishLocks?.wall)return wall;
        // A wall using the floor-wide finish needs its own frozen copy when
        // the other walls change. Uploaded textures are copied locally only.
        if(wall.finishLocked)return {...wall,finish:clone(wall.finish||previousWall),exteriorFinish:clone(wall.exteriorFinish||previousExterior)};
        const {finish,exteriorFinish,...plain}=wall,accent=design.accents.find(a=>a.floorIndex===index&&a.wallIndex===wallIndex);
        if(keepOverrides&&finish)plain.finish=finish;else if(accent)plain.finish=clone(accent.finish);
        if(exteriorFinish&&(plan.finishLocks?.exterior||keepOverrides))plain.exteriorFinish=exteriorFinish;
        return plain;
      });
    });
    return G.validate(next);
  }
  function lockState(model,{keepOverrides=false}={}) {
    let walls=0,exteriors=0,floors=0,ceilings=0,unlocked=false;
    for(const {plan} of G.floorsOf(model)) {
      if(!plan?.walls.some(w=>w.kind==='wall'))continue;
      if(plan.finishLocks?.floor)floors++;else unlocked=true;
      if(plan.finishLocks?.ceiling)ceilings++;else unlocked=true;
      const sides=G.wallSurfaces(plan);
      if(plan.walls.some((w,i)=>w.kind==='wall'&&sides[i].outside!=='none')&&(plan.finishLocks?.wall||plan.finishLocks?.exterior))exteriors++;
      for(const [i,wall] of plan.walls.entries()) {
        if(wall.kind!=='wall')continue;
        if(plan.finishLocks?.wall||wall.finishLocked)walls++;
        else {
          if(sides[i].outside!=='both'&&!(keepOverrides&&wall.finish))unlocked=true;
          if(sides[i].outside!=='none'&&!plan.finishLocks?.exterior&&!(keepOverrides&&wall.exteriorFinish))unlocked=true;
        }
      }
    }
    return {walls,exteriors,floors,ceilings,unlocked};
  }
  function createControls(root,{getModel,peekModel,applyModel,isReady,onBusy}) {
    let busy=false,controller=null,previous='',undo=null,applied=null,configured=null;
    root.innerHTML=`<div class="fp-design-heading"><div><span class="fp-design-eyebrow">Your house designer</span><h3>Give this house a new look.</h3><p>Inside walls and the exterior get separate finishes. Lock the designs you love below, then regenerate the others.</p><span class="fp-design-provider" data-design-provider role="status">Checking AI connection…</span></div><button type="button" class="btn fp-surprise-button">Surprise me <span aria-hidden="true">✦</span></button></div>
      <div class="fp-design-options"><label>Design style<select data-design-style>${Object.entries(STYLES).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label><label>Wall look<select data-design-look><option value="mixed">Paint + an accent</option><option value="paint">Paint only</option><option value="wallpaper">Wallpaper</option></select></label><label class="fp-design-brief">Your brief (optional)<input data-design-brief maxlength="240" placeholder="Sage walls, warm wood, a calm feel"></label></div>
      <label class="fp-design-keep"><input type="checkbox" data-design-keep> Also keep unlocked individual wall finishes</label><p class="fp-design-lock-summary" data-design-lock-summary role="status"></p>
      <div class="fp-design-result" hidden><div><span data-design-source></span><strong data-design-title></strong><p data-design-summary></p><div class="fp-design-swatches" aria-label="Design colors"></div></div><button type="button" class="btn btn-outline btn-small" data-design-undo>Undo design</button></div>
      <p class="fp-design-status" role="status" aria-live="polite">Finishes apply to all uploaded floors. Save the project to keep the design.</p>`;
    const button=root.querySelector('.fp-surprise-button'),status=root.querySelector('.fp-design-status'),result=root.querySelector('.fp-design-result');
    const fingerprint=model=>JSON.stringify(G.validate(model));
    const say=(text,error=false)=>{status.textContent=text;status.classList.toggle('error-message',error);};
    function sync() {
      const ready=isReady(),locks=lockState(peekModel(),{keepOverrides:root.querySelector('[data-design-keep]').checked});button.disabled=busy||!ready||!locks.unlocked;
      root.querySelector('[data-design-lock-summary]').textContent=ready&&!locks.unlocked?'All finishes are protected. Unlock a wall, exterior, flooring or ceiling to regenerate.':`${locks.walls} wall${locks.walls===1?'':'s'}, ${locks.exteriors} exterior${locks.exteriors===1?'':'s'}, ${locks.floors} flooring design${locks.floors===1?'':'s'} and ${locks.ceilings} ceiling${locks.ceilings===1?'':'s'} locked. Surprise me changes only the unprotected finishes.`;
      root.querySelectorAll('.fp-design-options input,.fp-design-options select,[data-design-keep]').forEach(e=>{e.disabled=busy||!ready;});
      root.querySelector('[data-design-brief]').disabled=busy||!ready||configured===false;
      root.setAttribute('aria-busy',String(busy));
      root.querySelector('[data-design-undo]').disabled=busy||!undo;
    }
    button.onclick=async()=>{
      if(busy)return;
      let snapshot;
      try {snapshot=clone(getModel());if(!G.hasGeometry(snapshot))throw new Error('Detect or trace the walls first.');if(!lockState(snapshot,{keepOverrides:root.querySelector('[data-design-keep]').checked}).unlocked)throw new Error('Unlock at least one finish before regenerating.');}catch(error){say(error.message,true);return;}
      const before=fingerprint(snapshot),keepOverrides=root.querySelector('[data-design-keep]').checked;
      const request=validateRequest({style:root.querySelector('[data-design-style]').value,wallLook:root.querySelector('[data-design-look]').value,brief:root.querySelector('[data-design-brief]').value,previous,context:context(snapshot,{keepOverrides})});
      busy=true;controller=new AbortController();const timer=setTimeout(()=>controller.abort(),45000);onBusy(true);sync();button.textContent='Designing…';say('Choosing coordinated colors, flooring and wall finishes…');
      try {
        const response=await fetch('/api/admin/design-surprise',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request),signal:controller.signal});
        const payload=await response.json();if(!response.ok)throw new Error(payload.error||'The design could not be generated.');
        if(!root.isConnected)return;
        if(fingerprint(peekModel())!==before)throw new Error('The drawing changed while designing. Try Surprise me again for the current drawing.');
        const design=validateDesign(payload.design,request),next=applyDesign(snapshot,design,{keepOverrides});
        applyModel(next);undo=snapshot;applied=fingerprint(next);previous=design.title;result.hidden=false;
        root.querySelector('[data-design-title]').textContent=design.title;
        root.querySelector('[data-design-summary]').textContent=design.summary;
        root.querySelector('[data-design-source]').textContent=payload.source==='ai'?'AI design':'Local design palette';
        const swatches=root.querySelector('.fp-design-swatches');swatches.replaceChildren();
        const displayed=G.floorsOf(next).find(f=>f.plan?.walls.some(w=>w.kind==='wall')).plan;
        for(const name of ['wall','exterior','floor','ceiling']){const finish=displayed.finishes?.[name]||F.DEFAULTS[name],swatch=document.createElement('span');swatch.style.backgroundColor=finish.color;swatch.title=`${name==='wall'?'Inside walls':name}: ${finish.color}`;swatch.setAttribute('aria-label',swatch.title);swatches.append(swatch);}
        say(payload.source==='ai'?'Your AI design is applied to unlocked finishes. Locked designs are kept. Try another or save the project.':'A local palette is applied to unlocked finishes. Locked designs are kept. Connect an AI provider for designs tailored to your brief.');
      }catch(error){if(root.isConnected)say(error.name==='AbortError'?'The designer took too long. Try again.':error.message,true);}
      finally{clearTimeout(timer);busy=false;controller=null;if(root.isConnected){onBusy(false);button.innerHTML='Surprise me <span aria-hidden="true">✦</span>';sync();}}
    };
    root.querySelector('[data-design-undo]').onclick=()=>{
      if(!undo||busy)return;
      if(fingerprint(peekModel())!==applied)return say('Other changes were made after this design. Use the planner’s Undo control to review those first.',true);
      applyModel(clone(undo));undo=null;applied=null;result.hidden=true;say('The previous finishes are restored.');sync();
    };
    root.querySelector('[data-design-keep]').onchange=sync;
    fetch('/api/admin/design-surprise').then(response=>response.ok?response.json():null).then(info=>{
      if(!root.isConnected)return;
      if(!info){root.querySelector('[data-design-provider]').textContent='AI connection could not be checked. Sign in again to check it.';return;}
      configured=info.configured;
      root.querySelector('[data-design-provider]').textContent=configured?'AI provider configured · floor-plan recognition uses image analysis':'AI not connected · Surprise me uses local palettes';
      if(!busy&&!previous)say(configured?'AI designs apply to all uploaded floors. Save the project to keep your chosen look.':'Local palettes are ready. Connect an AI provider to use a custom design brief.');sync();
    }).catch(()=>{if(root.isConnected)root.querySelector('[data-design-provider]').textContent='AI connection could not be checked.';});
    const observer=new MutationObserver(()=>{if(!root.isConnected){controller?.abort();observer.disconnect();}});
    observer.observe(document.body,{childList:true,subtree:true});
    sync();return {sync,isBusy:()=>busy,dispose(){controller?.abort();observer.disconnect();}};
  }
  return {STYLES,WALL_PATTERNS,EXTERIOR_PATTERNS,FLOOR_PATTERNS,context,validateRequest,validateDesign,localDesign,applyDesign,lockState,createControls};
});
