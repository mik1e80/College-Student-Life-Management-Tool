// One geometric definition for SVG and antialiased PNG, with no dependencies.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
const shapes = [
  { type:'box', x:40, y:52, w:50, h:88, r:15, stroke:6 },
  { type:'box', x:102, y:52, w:50, h:88, r:15, stroke:6 },
  { type:'circle', x:65, y:93, r:15, stroke:5 },
  { type:'line', x1:65, y1:84, x2:65, y2:93, stroke:5 },
  { type:'line', x1:65, y1:93, x2:72, y2:98, stroke:5 },
  { type:'line', x1:117, y1:81, x2:137, y2:81, stroke:5 },
  { type:'line', x1:117, y1:96, x2:137, y2:96, stroke:5 },
  { type:'line', x1:117, y1:111, x2:130, y2:111, stroke:5 },
];
const svgShape = s => s.type === 'box' ? `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.r}" stroke-width="${s.stroke}"/>` : s.type === 'circle' ? `<circle cx="${s.x}" cy="${s.y}" r="${s.r}" stroke-width="${s.stroke}"/>` : `<path d="M${s.x1} ${s.y1}L${s.x2} ${s.y2}" stroke-width="${s.stroke}"/>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" rx="42" fill="#171717"/><g fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round">${shapes.map(svgShape).join('')}</g></svg>\n`;
writeFileSync('dist/icon.svg',svg);
writeFileSync('download-site/icon.svg',svg);
function roundedDistance(x,y,s) {
  const qx = Math.abs(x-s.x-s.w/2)-(s.w/2-s.r), qy = Math.abs(y-s.y-s.h/2)-(s.h/2-s.r);
  return Math.hypot(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0)-s.r;
}
function hit(s,x,y) {
  if(s.type==='box') return Math.abs(roundedDistance(x,y,s))<=s.stroke/2;
  if(s.type==='circle') return Math.abs(Math.hypot(x-s.x,y-s.y)-s.r)<=s.stroke/2;
  const dx=s.x2-s.x1,dy=s.y2-s.y1,t=Math.max(0,Math.min(1,((x-s.x1)*dx+(y-s.y1)*dy)/(dx*dx+dy*dy)));
  return Math.hypot(x-s.x1-t*dx,y-s.y1-t*dy)<=s.stroke/2;
}
function crc32(buf) { let c=0xffffffff; for(const b of buf) { c^=b; for(let i=0;i<8;i++) c=(c>>>1)^(0xedb88320&-(c&1)); } return (c^0xffffffff)>>>0; }
function chunk(type,data) { const t=Buffer.from(type),len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([len,t,data,crc]); }
for(const size of [192,512]) {
  const data=Buffer.alloc(size*(size*4+1)),samples=3;
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    let alpha=0,light=0;
    for(let sy=0;sy<samples;sy++) for(let sx=0;sx<samples;sx++) {
      const px=(x+(sx+.5)/samples)*192/size,py=(y+(sy+.5)/samples)*192/size;
      if(roundedDistance(px,py,{x:0,y:0,w:192,h:192,r:42})>0) continue;
      alpha++; light+=shapes.some(s=>hit(s,px,py))?255:23;
    }
    const v=alpha?Math.round(light/alpha):0,offset=y*(size*4+1)+1+x*4;
    data.set([v,v,v,Math.round(alpha*255/(samples*samples))],offset);
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
  writeFileSync(`dist/icon-${size}.png`,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(data)),chunk('IEND',Buffer.alloc(0))]));
}
