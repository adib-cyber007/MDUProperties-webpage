(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FloorPlanFurniture = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Conservative symbol proposals: isolated outlined objects only. The owner labels and accepts each one.
  function suggest(image, plan) {
    const { width, height, data } = image || {};
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 40 || height < 40 || width > 2048 || height > 2048 || data?.length !== width*height*4) throw new Error('The drawing could not be read for furniture detection.');
    const total=width*height, ink=new Uint8Array(total), seen=new Uint8Array(total), queue=new Int32Array(total), output=[];
    for(let i=0;i<total;i++) {
      const j=i*4, alpha=data[j+3]/255;
      const gray=(data[j]*.299+data[j+1]*.587+data[j+2]*.114)*alpha+255*(1-alpha);
      ink[i]=gray<190 ? 1 : 0;
    }
    // Furnished plans often use solid tinted shapes instead of dark closed
    // outlines. Find substantial colored regions independently of the ink
    // detector, then offer them for owner review (never auto-publish them).
    const colored=new Uint8Array(total), visited=new Uint8Array(total);
    for(let i=0;i<total;i++) {
      const j=i*4,r=data[j],g=data[j+1],b=data[j+2];
      colored[i]=Math.max(r,g,b)-Math.min(r,g,b)>=20 && Math.min(r,g,b)<230 && data[j+3]>220 ? 1 : 0;
    }
    const colorSide=Math.max(16,Math.round(Math.min(width,height)*.024));
    for(let seed=0;seed<total;seed++) {
      if(!colored[seed] || visited[seed]) continue;
      let head=0,tail=1,minX=width,maxX=0,minY=height,maxY=0;
      queue[0]=seed;visited[seed]=1;
      while(head<tail) {
        const index=queue[head++],x=index%width,y=Math.floor(index/width);
        minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
        for(const next of [x>0?index-1:-1,x<width-1?index+1:-1,y>0?index-width:-1,y<height-1?index+width:-1]) {
          if(next>=0 && colored[next] && !visited[next]) {visited[next]=1;queue[tail++]=next;}
        }
      }
      const bw=maxX-minX+1,bh=maxY-minY+1,area=bw*bh;
      if(bw<colorSide || bh<colorSide || bw>width*.32 || bh>height*.32 || tail<Math.max(120,total*.0012) || tail/area<.3) continue;
      const feetW=bw/width*plan.width,feetD=bh/height*plan.depth;
      if(feetW<.5 || feetD<.5 || feetW>15 || feetD>15) continue;
      const center=[(minX+maxX)/2/width,(minY+maxY)/2/height];
      if((plan.furniture||[]).some(item=>Math.hypot((item.center[0]-center[0])*width,(item.center[1]-center[1])*height)<Math.max(bw,bh)*.45)) continue;
      const aspect=Math.max(bw,bh)/Math.min(bw,bh);
      const type=tail>total*.0034 && aspect<2 ? 'bed' : tail>total*.0018 && aspect<1.35 ? 'table' : 'other';
      output.push({type,center,width:+feetW.toFixed(2),depth:+feetD.toFixed(2),rotation:0,source:'detected'});
      if(output.length>=50) break;
    }
    const minSide=Math.max(12,Math.round(Math.min(width,height)*.018));
    for(let seed=0;seed<total;seed++) {
      if(!ink[seed] || seen[seed]) continue;
      let head=0,tail=1,minX=width,maxX=0,minY=height,maxY=0;
      queue[0]=seed; seen[seed]=1;
      while(head<tail) {
        const index=queue[head++], x=index%width, y=Math.floor(index/width);
        minX=Math.min(minX,x); maxX=Math.max(maxX,x); minY=Math.min(minY,y); maxY=Math.max(maxY,y);
        for(const next of [x>0?index-1:-1,x<width-1?index+1:-1,y>0?index-width:-1,y<height-1?index+width:-1]) {
          if(next>=0 && ink[next] && !seen[next]) { seen[next]=1; queue[tail++]=next; }
        }
      }
      const bw=maxX-minX+1,bh=maxY-minY+1,area=bw*bh;
      if(minX<2 || minY<2 || maxX>width-3 || maxY>height-3 || bw<minSide || bh<minSide || bw>width*.32 || bh>height*.32 || tail/area>.65 || tail/area<.045) continue;
      const feetW=bw/width*plan.width,feetD=bh/height*plan.depth;
      if(feetW<.5 || feetD<.5 || feetW>15 || feetD>15) continue;
      // Require most of each edge to be inked; text and broken furniture symbols are not promoted.
      let top=0,bottom=0,left=0,right=0;
      for(let x=minX;x<=maxX;x++) {
        for(let d=0;d<3;d++) { if(ink[(minY+d)*width+x]) { top++; break; } }
        for(let d=0;d<3;d++) { if(ink[(maxY-d)*width+x]) { bottom++; break; } }
      }
      for(let y=minY;y<=maxY;y++) {
        for(let d=0;d<3;d++) { if(ink[y*width+minX+d]) { left++; break; } }
        for(let d=0;d<3;d++) { if(ink[y*width+maxX-d]) { right++; break; } }
      }
      if(Math.min(top/bw,bottom/bw,left/bh,right/bh)<.75) continue;
      const center=[(minX+maxX)/2/width,(minY+maxY)/2/height];
      if([...(plan.furniture||[]),...output].some(item=>Math.hypot((item.center[0]-center[0])*width,(item.center[1]-center[1])*height)<Math.max(bw,bh)*.4)) continue;
      const ratio=Math.max(feetW,feetD)/Math.min(feetW,feetD);
      const type=ratio>1.25 && Math.max(feetW,feetD)>=5 && Math.max(feetW,feetD)<=9 ? 'bed' : ratio<1.25 && feetW>=3 && feetD>=3 ? 'table' : 'other';
      output.push({ type, center, width: +feetW.toFixed(2), depth: +feetD.toFixed(2), rotation: 0, source:'detected' });
      if(output.length>=50) break;
    }
    return output;
  }
  return { suggest };
});
