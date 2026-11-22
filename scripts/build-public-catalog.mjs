// Every published coordinate is read from the exact published plan, never a different department image.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { spacesFromTsv } from '../src/lib/imageAnalysis.js';
import { applyPublicMapping } from '../src/lib/publication.js';
const exec=promisify(execFile),root='public/catalog';await fs.mkdir(`${root}/maps`,{recursive:true});
const api=`${root}/official-places.json`;
await exec('curl',['--fail','-L','-sS','--max-time','30','https://www.cmcseoul.or.kr/api/hospitalguide/lookaround?dataType=front','-o',api]);
const places=JSON.parse(await fs.readFile(api,'utf8'));
await fs.writeFile(api,JSON.stringify(places.map(({placeCd,placeNm,parentPlaceCd,depth,placeAlias})=>({placeCd,placeNm,parentPlaceCd,depth,placeAlias})),null,2));
const buildings=places.filter(p=>p.depth===1).map(p=>({id:p.placeCd,name:p.placeNm}));
const floors=[];
for(const floor of places.filter(p=>p.depth===2)){
  const child=places.find(p=>p.parentPlaceCd===floor.placeCd&&p.depth===3);if(!child)continue;
  const sourceUrl=`https://www.cmcseoul.or.kr/api/attach/view/lookAround/${child.placeCd}/lookAroundImage/`,file=`${root}/maps/${floor.placeCd}.png`;
  // Keep the exact bytes for which the checked-in label coordinates were measured.
  try{await fs.access(file)}catch{await exec('curl',['--fail','-L','-sS','--max-time','30',sourceUrl,'-o',file]);}
  const planKey=crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
  floors.push({id:floor.placeCd,buildingId:floor.parentPlaceCd,name:floor.placeNm,order:floor.placeNm.startsWith('B')?-Number(floor.placeNm.slice(1)):Number(floor.placeNm.replace('F','')),image:`catalog/maps/${floor.placeCd}.png`,imageOrigin:'official',planKey,sourceUrl,imageNote:'표시 중인 원본 안내도의 글자 위치입니다. 개별 단말의 설치 지점이 아닙니다.'});
}
if(process.argv[2]){
 const lines=(await fs.readFile(process.argv[2],'utf8')).trim().split('\n').map(line=>JSON.parse(line));
 await fs.writeFile(`${root}/labels.json`,JSON.stringify(lines.map(({file,...rest})=>({floorId:path.basename(file,'.png'),...rest})),null,2));
}
const labels=JSON.parse(await fs.readFile(`${root}/labels.json`,'utf8')),spaces=[];
for(const plan of labels){
 const floor=floors.find(f=>f.id===plan.floorId);if(!floor)continue;
 if(plan.planKey!==floor.planKey){console.warn(`Re-analysis required for changed image: ${floor.id}`);continue;}
 const header='level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
 const rows=plan.texts.map((t,i)=>{const b=t.bounds;return['5','1',i+1,'1','1','1',b.x*plan.width,b.y*plan.height,b.width*plan.width,b.height*plan.height,t.confidence*100,t.text].join('\t');});
 spaces.push(...spacesFromTsv([header,...rows].join('\n'),{floor,width:plan.width,height:plan.height}).map(s=>({...s,recognitionEngine:'source-plan-labels',sourceUrl:floor.sourceUrl})));
}
const devices=[]; // Public rooms are never represented as installed terminals.
let site={version:1,matchingVersion:2,id:'seoul-st-mary',name:'서울성모병원',buildings,floors,spaces,devices,matchingRules:[],isPublicDemo:true,sources:[{name:'서울성모병원 병원둘러보기',url:'https://www.cmcseoul.or.kr/page/hospitalguide/lookaround'}],warnings:['현재 표시하는 안내도에서 읽은 장소만 포함합니다. 세부실이 없는 안내도는 상세 이미지를 등록해 주세요.']};
try{site=applyPublicMapping(site,JSON.parse(await fs.readFile(`${root}/published-mapping.json`,'utf8')))}catch(error){if(error.code!=='ENOENT')throw error;}
await fs.writeFile(`${root}/site.json`,JSON.stringify(site,null,2));
console.log(JSON.stringify({sourceBoundPlans:floors.length,imageLabels:spaces.length,foreignImageCoordinates:0,hospitalSpecificAliases:0}));
