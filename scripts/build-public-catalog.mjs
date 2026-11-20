// Only public hospital material is read here. Never read site.json or XLSX data.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PNG } from 'pngjs';
import { normalizePlaceName } from '../src/lib/autoMap.js';
const exec = promisify(execFile), root = 'public/catalog';
await fs.mkdir(`${root}/maps`, { recursive: true });
const cache = 'local-data/public-highlights'; await fs.mkdir(cache, { recursive: true });
async function download(url, output) {
  await exec('curl', ['--fail','-L','-sS','--max-time','30',url,'-o',output]);
}
const api = `${root}/official-places.json`;
await download('https://www.cmcseoul.or.kr/api/hospitalguide/lookaround?dataType=front', api);
const places = JSON.parse(await fs.readFile(api, 'utf8'));
await fs.writeFile(api, JSON.stringify(places.map(({placeCd,placeNm,parentPlaceCd,depth,placeAlias})=>({placeCd,placeNm,parentPlaceCd,depth,placeAlias})),null,2));
const byId = new Map(places.map(p=>[p.placeCd,p]));
const buildings = places.filter(p=>p.depth===1).map(p=>({id:p.placeCd,name:p.placeNm}));
const floors = [], spaces = [];
const aliases = {
  'PET-CT센터':['PET-CT'], '소아안과':['소아안센터'], '소아청소년과':['소아청소년센터'],
  '외래주사실':['중앙주사실'], '치과병원':['보철과','교정과','보존과','치주과','구강악안면외과','치과'],
  '통합검사실(CT실/MRI실/일반촬영실)':['영상의학과','통합검사실'],
  'MRI실':['MRI'], 'CT실':['CT'], '초음파실':['초음파'],
  '세포치료':['세포치료센터'],
};

function highlightedArea(buffer) {
  let png; try { png=PNG.sync.read(buffer); } catch { return null; }
  const {width:w,height:h,data}=png, mask=new Uint8Array(w*h), visited=new Uint8Array(w*h);
  for (let i=0;i<w*h;i++) {
    const r=data[i*4],g=data[i*4+1],b=data[i*4+2];
    if (Math.max(r,g,b)-Math.min(r,g,b)>55 && (b>r+35 || g>r+22) && data[i*4+3]>200) mask[i]=1;
  }
  let largest=[];
  for (let i=0;i<mask.length;i++) {
    if (!mask[i] || visited[i]) continue;
    const pixels=[i]; visited[i]=1;
    for(let q=0;q<pixels.length;q++) {
      const p=pixels[q],x=p%w,y=Math.floor(p/w);
      const next=[];if(x)next.push(p-1);if(x<w-1)next.push(p+1);if(y)next.push(p-w);if(y<h-1)next.push(p+w);
      for(const n of next)if(mask[n]&&!visited[n]){visited[n]=1;pixels.push(n)}
    }
    if(pixels.length>largest.length)largest=pixels;
  }
  if(largest.length<180)return null;
  let minX=w,minY=h,maxX=0,maxY=0,sx=0,sy=0;
  for(const p of largest){const x=p%w,y=Math.floor(p/w);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);sx+=x;sy+=y}
  const cx=sx/largest.length,cy=sy/largest.length;
  let best=largest[0],distance=Infinity;
  for(const p of largest){const d=(p%w-cx)**2+(Math.floor(p/w)-cy)**2;if(d<distance){best=p;distance=d}}
  return {position:{x:(best%w+.5)/w,y:(Math.floor(best/w)+.5)/h},bounds:{x:minX/w,y:minY/h,width:(maxX-minX+1)/w,height:(maxY-minY+1)/h}};
}

for(const floor of places.filter(p=>p.depth===2)) {
  const children=places.filter(p=>p.parentPlaceCd===floor.placeCd && p.depth===3);if(!children.length)continue;
  const url=`https://www.cmcseoul.or.kr/api/attach/view/lookAround/${children[0].placeCd}/lookAroundImage/`;
  const image=`${root}/maps/${floor.placeCd}.png`;await download(url,image);
  floors.push({id:floor.placeCd,buildingId:floor.parentPlaceCd,name:floor.placeNm,order:floor.placeNm.startsWith('B')?-Number(floor.placeNm.slice(1)):Number(floor.placeNm.replace('F','')),image:`catalog/maps/${floor.placeCd}.png`,imageOrigin:'official',sourceUrl:url,imageNote:'공개 부서 안내도 · 자동 위치는 부서 영역 기준의 추정입니다.'});
}
const targets=places.filter(p=>p.depth===3 || (p.depth===4 && p.placeCd.startsWith('A01002')));
let cursor=0;
await Promise.all(Array.from({length:5},async()=>{
  while(cursor<targets.length){
    const p=targets[cursor++], file=`${cache}/${p.placeCd}.png`;
    try{
      const url=`https://www.cmcseoul.or.kr/api/attach/view/lookAround/${p.placeCd}/lookAroundImage/`;
      try{await fs.access(file)}catch{await download(url,file)}
      const area=highlightedArea(await fs.readFile(file));if(!area)continue;
      const floor=p.depth===3?byId.get(p.parentPlaceCd):byId.get(byId.get(p.parentPlaceCd)?.parentPlaceCd);
      if(!floors.some(f=>f.id===floor?.placeCd))continue;
      spaces.push({id:`official-${p.placeCd}`,name:p.placeNm,floorId:floor.placeCd,buildingId:floor.parentPlaceCd,
        aliases:[...(aliases[p.placeNm]||[]),...(p.placeAlias?[p.placeAlias]:[])],...area,source:'official-highlight',confidence:.95,sourceUrl:url});
    }catch{ /* Missing source images remain unmatched, never fabricate a coordinate. */ }
  }
}));

const ocrFile=process.argv[2];
if(ocrFile){
  const lines=(await fs.readFile(ocrFile,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  await fs.writeFile(`${root}/labels.json`,JSON.stringify(lines.map(({file,...rest})=>({floorId:path.basename(file,'.png'),...rest})),null,2));
}
let labels=[];try{labels=JSON.parse(await fs.readFile(`${root}/labels.json`,'utf8'))}catch{}
for(const plan of labels){
  const floor=floors.find(f=>f.id===plan.floorId);if(!floor)continue;
  for(const [i,t] of plan.texts.entries()){
    const recognizedOfficial=places.some(p=>p.depth>=3&&normalizePlaceName(p.placeNm)===normalizePlaceName(t.text));
    if((t.confidence<.45&&!recognizedOfficial)||t.text.length<3||/출입구|^센터$|^의학과$|^사무실$/.test(t.text))continue;
    if(spaces.some(s=>s.floorId===floor.id&&[s.name,...s.aliases].map(normalizePlaceName).includes(normalizePlaceName(t.text))))continue;
    const b=t.bounds;
    spaces.push({id:`ocr-${floor.id}-${i}`,name:t.text,floorId:floor.id,buildingId:floor.buildingId,aliases:aliases[t.text]||[],
      position:{x:b.x+b.width/2,y:b.y+b.height/2},bounds:b,confidence:Math.min(.85,recognizedOfficial?Math.max(.7,t.confidence):t.confidence),source:'ocr'});
  }
}
spaces.sort((a,b)=>a.id.localeCompare(b.id));
const devices=spaces.map(s=>({id:`public-${s.id}`,name:s.name,location:s.name,kind:'공개 장소',buildingId:s.buildingId,floorId:s.floorId,
  ip:'',switch:'',port:'',photos:[],position:s.position,positionSource:'auto',spaceId:s.id,
  match:{status:'matched',confidence:s.confidence,method:'public-catalog',label:s.name},notes:'공식 안내도의 공개 장소입니다. 실제 단말 목록은 엑셀로 불러오세요.'}));
await fs.writeFile(`${root}/site.json`,JSON.stringify({version:1,id:'seoul-st-mary',name:'서울성모병원',buildings,floors,spaces,devices,isPublicDemo:true,
  sources:[{name:'서울성모병원 병원둘러보기',url:'https://www.cmcseoul.or.kr/page/hospitalguide/lookaround'}],
  warnings:['공개 장소 예시입니다. 실제 단말 목록은 브라우저에서 XLSX 파일로 불러오세요.']},null,2));
console.log(JSON.stringify({publicFloors:floors.length,publicSpaces:spaces.length,highlighted:spaces.filter(s=>s.source==='official-highlight').length,privateDataIncluded:false}));
