'use strict';
// Geometry sanity checks on supplied images; not an accuracy benchmark.
const fs = require('node:fs');
const path = require('node:path');
const { createRecognizer } = require('../floor-plan-recognition');
const G = require('../public/floor-plan-geometry');
(async () => {
  const files = process.argv.slice(2);
  if (!files.length) throw new Error('Pass one or more floor plan image paths.');
  const recognizer = createRecognizer({ baseUrl: process.env.FLOORPLAN_RECOGNITION_URL || 'http://127.0.0.1:8765' });
  const reports = [];
  for (const file of files) {
    const ext = path.extname(file).toLowerCase(), mime = {'.png':'png','.jpg':'jpeg','.jpeg':'jpeg','.webp':'webp'}[ext];
    if (!mime) throw new Error('Use PNG, JPEG or WebP.');
    const image = `data:image/${mime};base64,${fs.readFileSync(file).toString('base64')}`;
    const result = await recognizer.analyze({ image, width:30, depth:40 });
    const plan = G.validate({version:1,image,width:30,depth:40,height:10,thickness:.5,walls:result.walls,furniture:result.furniture,scaleConfirmed:false});
    const obj = G.toOBJ(plan);
    const boxes = G.boxes(plan);
    if (!result.walls.some(w=>w.kind==='wall') || !obj.includes('\nv ') || !boxes.length) throw new Error(`No usable geometry for ${file}`);
    reports.push({ file, engine:result.engine, walls:result.walls.filter(w=>w.kind==='wall').length, doors:result.walls.filter(w=>w.kind==='door').length,
      windows:result.walls.filter(w=>w.kind==='window').length, fixtures:result.furniture.length, rooms:result.rooms.length, inferenceMs:result.inferenceMs,
      reviewCandidates:result.candidates?.length||0,annotationFiltering:result.summary||null,
      geometryValid:true, objBytes:Buffer.byteLength(obj), boxes:boxes.length });
  }
  fs.mkdirSync('work',{recursive:true});fs.writeFileSync('work/floorplan-evaluation.json',JSON.stringify({accuracyMeasured:false,reports},null,2));
  console.log(JSON.stringify(reports));
})().catch(error=>{console.error(error);process.exitCode=1;});
