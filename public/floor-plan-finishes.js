(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FloorPlanFinishes = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const make = (pattern, color, accent, scale = 3, rotation = 0) => ({ pattern, color, accent, scale, rotation });
  const DEFAULTS = {
    wall: make('plaster', '#eee8de', '#d7cec0'),
    exterior: make('plaster', '#d8d4c9', '#b6b1a6', 4),
    floor: make('wood', '#cfb68f', '#9d7f56', 4),
    ceiling: make('solid', '#faf8f2', '#d9d5cd', 4)
  };
  const entry = (name, pattern, color, accent, scale = 3) => ({ name, finish: make(pattern, color, accent, scale) });
  const PRESETS = {
    wall: [
      entry('Warm ivory plaster','plaster','#eee8de','#d7cec0'), entry('Chalk white','solid','#faf9f5','#ddd9d0'),
      entry('Sand plaster','plaster','#ddc9ad','#bca488'), entry('Mist grey','plaster','#d5d9da','#aab2b6'),
      entry('Sage plaster','plaster','#b7c3ab','#88987d'), entry('Terracotta plaster','plaster','#bf846a','#97614d'),
      entry('Charcoal paint','solid','#454b4e','#6b7377'), entry('Ocean paint','solid','#50717b','#9fb6bc'),
      entry('Natural linen','linen','#e4d7bd','#b9a784'), entry('Rose linen','linen','#dfc0b9','#b98e86'),
      entry('Silver linen','linen','#d6d9d8','#a2aaa7'), entry('Navy linen','linen','#344b67','#7a8da5'),
      entry('Cream stripe','stripes','#f0e7d4','#c9b995'), entry('Sage stripe','stripes','#e1e7da','#97ad89'),
      entry('Blue stripe','stripes','#dce5e9','#8eabbc'), entry('Blush stripe','stripes','#efe0dc','#c6968c'),
      entry('Forest botanical','botanical','#eee9da','#6c8464',4), entry('Blue botanical','botanical','#e4eaf0','#65869d',4),
      entry('Gold botanical','botanical','#f4ebd8','#b69a59',4), entry('Sage trellis','trellis','#e6ecdf','#8fa181'),
      entry('Ink trellis','trellis','#e9e6df','#5e6970'), entry('Gold dots','dots','#f4eee1','#b79754',2),
      entry('Indigo damask','damask','#e1e7ed','#687d9b',4), entry('Linen damask','damask','#f0e7d8','#bca57d',4),
      entry('Walnut panels','panels','#987459','#664b37',4), entry('Oak slats','slats','#c9ae83','#977953',3)
    ],
    exterior: [
      entry('Ivory render','plaster','#e4dfd3','#c4bcae',4), entry('Sand render','plaster','#d2bfa3','#af997a',4),
      entry('Cool grey render','plaster','#b7bec0','#8a9599',4), entry('Terracotta facade','plaster','#ae7658','#81553f',4),
      entry('Warm white facade','solid','#eeeae0','#c9c2b5',4), entry('Charcoal facade','solid','#505b60','#778389',4),
      entry('Limestone cladding','stone','#d3cbb7','#a69b84',4), entry('Slate cladding','stone','#727e82','#49575b',4),
      entry('Timber cladding','slats','#ac8960','#75583b',3), entry('Concrete facade','concrete','#b5b5ad','#8e8e83',4)
    ],
    floor: [
      entry('Natural oak','wood','#cfb68f','#9d7f56',4), entry('Pale ash','wood','#e1d5bd','#b5a88b',4),
      entry('Honey oak','wood','#c6a06c','#896641',4), entry('Walnut','wood','#8c674f','#5d4232',4),
      entry('Smoked oak','wood','#91857a','#625a52',4), entry('Oak herringbone','herringbone','#cbb188','#967753',4),
      entry('Walnut herringbone','herringbone','#a17c5b','#684a34',4), entry('Ash chevron','chevron','#ddd1b8','#af9d7b',4),
      entry('Warm porcelain','tiles','#e4ddd0','#bcb4a5',2), entry('White porcelain','tiles','#f0efeb','#c4c6c4',2),
      entry('Graphite tile','tiles','#666f73','#434c50',2), entry('Sage tile','tiles','#aebba5','#7f9077',2),
      entry('Blue tile','tiles','#89a9b5','#5a7c89',2), entry('Black and cream','checker','#ede6d5','#4b504e',3),
      entry('Rose checker','checker','#eddbd1','#af8070',3), entry('White marble','marble','#eeeae2','#a8a9a7',4),
      entry('Sand marble','marble','#decdb2','#a49072',4), entry('Dark marble','marble','#3d4849','#9caeaa',4),
      entry('Ivory terrazzo','terrazzo','#e8dfce','#917e69',3), entry('Blue terrazzo','terrazzo','#c9dadd','#65888e',3),
      entry('Sandstone','stone','#c7b590','#8f7c5a',3), entry('Slate','stone','#798184','#535a5e',3),
      entry('Soft concrete','concrete','#bfc0b9','#92968d',4), entry('Warm concrete','concrete','#cbbdac','#a0907e',4)
    ],
    ceiling: [
      entry('Warm white','solid','#faf8f2','#d9d5cd',4), entry('Cool white','solid','#eef2f3','#cbd3d6',4),
      entry('Ivory plaster','plaster','#eee8de','#d7cec0',4), entry('Sage paint','solid','#d9e1d0','#aebca0',4),
      entry('Oak slats','slats','#d8c19d','#a48b65',4), entry('Walnut panels','panels','#9f7c60','#6c4e37',4),
      entry('Classic panel grid','coffer','#f4f0e7','#c9c2b5',4), entry('Blue panel grid','coffer','#cfdde3','#91a7b2',4)
    ]
  };
  const COLORS = [
    ['Chalk','#faf9f5'],['Ivory','#eee8de'],['Sand','#d9c5a5'],['Taupe','#a79480'],['Clay','#bc8066'],['Walnut','#795b45'],
    ['Silver','#d6d9d8'],['Mist','#b6c0c4'],['Slate','#7b898d'],['Charcoal','#454b4e'],['Ink','#242c30'],['Black','#171b1d']
  ].map(([name,color])=>({name,color}));
  function hsl(h,s,l) {
    s/=100;l/=100;const a=s*Math.min(l,1-l);
    const f=n=>{const k=(n+h/30)%12;return Math.round(255*(l-a*Math.max(-1,Math.min(k-3,9-k,1)))).toString(16).padStart(2,'0');};
    return `#${f(0)}${f(8)}${f(4)}`;
  }
  ['Rose','Coral','Amber','Ochre','Lime','Leaf','Sage','Teal','Ocean','Indigo','Violet','Berry'].forEach((name,i)=>{
    [['pale',82,26],['soft',68,30],['rich',48,36],['deep',30,30]].forEach(([tone,light,saturation])=>COLORS.push({name:`${name} ${tone}`,color:hsl(i*30,saturation,light)}));
  });

  // Procedural samples, shared by the library and rendered materials.
  // Drawing coordinates are one repeat; the renderer maps repeats in real feet.
  function canvas(finish, size = 256) {
    const surface = document.createElement('canvas');surface.width=surface.height=size;
    const ctx=surface.getContext('2d');ctx.scale(size/256,size/256);ctx.fillStyle=finish.color;ctx.fillRect(0,0,256,256);
    ctx.strokeStyle=finish.accent;ctx.fillStyle=finish.accent;ctx.lineWidth=2;
    let seed=7349;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    const line=(x,y,a,b)=>{ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(a,b);ctx.stroke();};
    switch(finish.pattern) {
      case 'plaster': case 'linen': case 'concrete':
        ctx.globalAlpha=finish.pattern==='concrete'?.22:.1;
        for(let i=0;i<1500;i++)ctx.fillRect(random()*256,random()*256,1+random()*3,1);
        if(finish.pattern==='linen'){ctx.globalAlpha=.22;ctx.lineWidth=.7;for(let n=0;n<256;n+=4){line(n,0,n,256);line(0,n,256,n);}}
        break;
      case 'stripes': for(let x=0;x<256;x+=64)ctx.fillRect(x,0,24,256);break;
      case 'dots': for(let y=32;y<256;y+=64)for(let x=32;x<256;x+=64){ctx.beginPath();ctx.arc(x+(y%128?0:16),y,5,0,Math.PI*2);ctx.fill();}break;
      case 'trellis': for(let y=-128;y<384;y+=64)for(let x=-128;x<384;x+=64){ctx.beginPath();ctx.moveTo(x,y+32);ctx.lineTo(x+32,y);ctx.lineTo(x+64,y+32);ctx.lineTo(x+32,y+64);ctx.closePath();ctx.stroke();}break;
      case 'botanical': case 'damask':
        for(let y=0;y<256;y+=128)for(let x=0;x<256;x+=128){
          line(x+64,y+10,x+64,y+120);
          for(let k=0;k<4;k++)for(const sign of [-1,1]){
            ctx.beginPath();ctx.ellipse(x+64+sign*18,y+30+k*22,19,7,sign*.55,0,Math.PI*2);ctx.fill();
          }
          if(finish.pattern==='damask'){ctx.beginPath();ctx.ellipse(x+64,y+65,49,55,0,0,Math.PI*2);ctx.stroke();}
        }break;
      case 'wood': case 'slats':
        for(let y=0;y<256;y+=32){ctx.globalAlpha=(y%64?.12:.04);ctx.fillRect(0,y,256,32);ctx.globalAlpha=.55;line(0,y,256,y);
          if(finish.pattern==='wood')line(y%64?64:176,y,y%64?64:176,y+32);
          ctx.globalAlpha=.15;ctx.lineWidth=.7;for(let j=0;j<7;j++)line(0,y+random()*31,256,y+random()*31);ctx.lineWidth=2;
        }break;
      case 'chevron': case 'herringbone':
        ctx.lineWidth=2;
        for(let y=-256;y<512;y+=32)for(let x=-256;x<512;x+=128){line(x,y,x+64,y+64);line(x+64,y+64,x+128,y);
          if(finish.pattern==='herringbone')line(x+32,y+32,x+16,y+48);
        }break;
      case 'tiles':case 'checker':
        for(let y=0;y<256;y+=128)for(let x=0;x<256;x+=128){if(finish.pattern==='checker'&&(x+y)%256===0)ctx.fillRect(x,y,128,128);if(!finish.tile)ctx.strokeRect(x+.8,y+.8,127,127);}break;
      case 'marble':
        ctx.globalAlpha=.45;ctx.lineWidth=1.4;
        for(let i=0;i<8;i++){let y=random()*256;ctx.beginPath();ctx.moveTo(0,y);for(let x=16;x<=256;x+=16){y+=(random()-.5)*32;ctx.lineTo(x,y);}ctx.stroke();}
        break;
      case 'terrazzo':
        for(let i=0;i<150;i++){ctx.globalAlpha=.2+random()*.55;const x=random()*256,y=random()*256,r=2+random()*7;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+r,y+random()*r);ctx.lineTo(x+random()*r,y+r);ctx.closePath();ctx.fill();}break;
      case 'stone':
        ctx.globalAlpha=.5;for(let y=0;y<256;y+=64){line(0,y,256,y);for(let x=y%128?64:0;x<256;x+=128)line(x,y,x,y+64);}
        ctx.globalAlpha=.12;for(let i=0;i<800;i++)ctx.fillRect(random()*256,random()*256,2,2);break;
      case 'panels':case 'coffer':
        for(let y=0;y<256;y+=128)for(let x=0;x<256;x+=128){ctx.lineWidth=5;ctx.strokeRect(x+4,y+4,120,120);ctx.globalAlpha=.45;ctx.lineWidth=1;ctx.strokeRect(x+13,y+13,102,102);ctx.globalAlpha=1;}break;
    }
    ctx.globalAlpha=1;
    if(finish.tile) {
      ctx.strokeStyle=finish.tile.grout;ctx.lineWidth=2;
      for(let n=0;n<=256;n+=128){line(n,0,n,256);line(0,n,256,n);}
    }
    return surface;
  }
  return { DEFAULTS, PRESETS, COLORS, canvas };
});
