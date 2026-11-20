import { normalizePlaceName, roomIdentifiers } from './autoMap.js';

// The fingerprint binds every coordinate to the exact image that was analyzed.
export async function fingerprintImage(image) {
  const response=await fetch(image);
  if(!response.ok)throw new Error('안내도 이미지를 읽지 못했습니다.');
  const digest=await crypto.subtle.digest('SHA-256',await response.arrayBuffer());
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
function union(words){
  const x=Math.min(...words.map(w=>w.x)),y=Math.min(...words.map(w=>w.y));
  const right=Math.max(...words.map(w=>w.x+w.width)),bottom=Math.max(...words.map(w=>w.y+w.height));
  return{x,y,width:right-x,height:bottom-y};
}
export function spacesFromTsv(tsv,{floor,width,height}) {
  const lines=new Map();
  for(const raw of String(tsv||'').split('\n').slice(1)){
    const c=raw.split('\t');if(c.length<12||c[0]!=='5'||Number(c[10])<30||!c[11]?.trim())continue;
    const word={text:c.slice(11).join('\t').trim(),x:Number(c[6]),y:Number(c[7]),width:Number(c[8]),height:Number(c[9]),confidence:Number(c[10])/100};
    if(![word.x,word.y,word.width,word.height,word.confidence].every(Number.isFinite)||word.width<=0||word.height<=0)continue;
    const key=c.slice(1,5).join('-');if(!lines.has(key))lines.set(key,[]);lines.get(key).push(word);
  }
  const groups=[];
  for(const words of lines.values()){
    words.sort((a,b)=>a.x-b.x);let group=[];
    for(const word of words){
      const last=group.at(-1),gap=last?word.x-last.x-last.width:0;
      if(last&&gap>Math.max(width*.025,Math.max(last.height,word.height)*1.8)){groups.push(group);group=[];}
      group.push(word);
    }
    if(group.length)groups.push(group);
  }
  let labels=groups.map(words=>({name:words.map(w=>w.text).join(' ').trim(),...union(words),confidence:Math.min(...words.map(w=>w.confidence))}));
  // Join vertically wrapped suffixes, never two complete department names.
  const suffix=/^(?:센터|의학과|진료실|검사실|치료실|의료센터|사무실)$/;
  const used=new Set(),merged=[];
  for(let i=0;i<labels.length;i++){
    if(used.has(i))continue;const a=labels[i];
    const j=labels.findIndex((b,k)=>k!==i&&!used.has(k)&&suffix.test(normalizePlaceName(b.name))&&!/(?:센터|의학과|내과|외과|진료실|검사실|치료실)$/.test(normalizePlaceName(a.name))&&b.y>=a.y+a.height*.7&&b.y-(a.y+a.height)<Math.max(a.height,b.height)*.9&&Math.abs(b.x+b.width/2-a.x-a.width/2)<Math.max(a.width,b.width)*.25);
    if(j>=0){const b=labels[j];used.add(j);merged.push({...union([a,b]),name:a.name+' '+b.name,confidence:Math.min(a.confidence,b.confidence)});}else merged.push(a);
  }
  return merged.flatMap(label=>{
    const name=label.name,canonical=normalizePlaceName(name);
    if(!canonical||(!/\p{L}/u.test(name)&&!/^\d{1,4}$/.test(canonical))||/출입구|엘리베이터|에스컬레이터/.test(name))return[];
    const b={x:Math.max(0,label.x/width),y:Math.max(0,label.y/height),width:Math.min(1,label.width/width),height:Math.min(1,label.height/height)};
    const position={x:Math.min(1,b.x+b.width/2),y:Math.min(1,b.y+b.height/2)};
    const ids=roomIdentifiers(name);
    return[{id:`ocr-${floor.id}-${canonical.slice(0,40)}-${Math.round(b.x*1000)}-${Math.round(b.y*1000)}`,name,floorId:floor.id,buildingId:floor.buildingId,aliases:[],roomNumber:ids.length===1?ids[0]:'',
      position,bounds:b,boundsType:'label',source:'plan-ocr',geometryVersion:2,planKey:floor.planKey,confidence:label.confidence,consensus:false}];
  });
}
export function mergeOcrPasses(primary,secondary) {
  const result=primary.map(s=>({...s})),consumed=new Set();
  for(const s of result){
    const index=secondary.findIndex((t,i)=>!consumed.has(i)&&normalizePlaceName(s.name)===normalizePlaceName(t.name)&&Math.hypot(s.position.x-t.position.x,s.position.y-t.position.y)<.025);
    if(index>=0){consumed.add(index);s.consensus=true;s.confidence=Math.min(s.confidence,secondary[index].confidence);}
  }
  for(const [i,s] of secondary.entries())if(!consumed.has(i)&&!result.some(t=>normalizePlaceName(t.name)===normalizePlaceName(s.name)&&Math.hypot(t.position.x-s.position.x,t.position.y-s.position.y)<.025))result.push(s);
  return result;
}
export async function analyzeFloorImage({image,floor,onProgress=()=>{}}) {
  const planKey=await fingerprintImage(image),boundFloor={...floor,planKey};
  const img=new Image();img.src=image;await img.decode();
  const scale=Math.min(4,2800/Math.max(img.naturalWidth,img.naturalHeight));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
  const{createWorker,PSM}=await import('tesseract.js');let worker,pass=1;
  try{
    onProgress('한글·영문 OCR 준비 중…');
    worker=await createWorker(['kor','eng'],1,{logger:m=>{if(m.status==='recognizing text')onProgress(`원본 안내도 분석 ${pass}/2 · ${Math.round(m.progress*100)}%`);}});
    await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT,preserve_interword_spaces:'1'});
    const first=await worker.recognize(canvas,{}, {tsv:true,blocks:false});
    const primary=spacesFromTsv(first.data.tsv,{floor:boundFloor,width:canvas.width,height:canvas.height});
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
    for(let i=0;i<pixels.data.length;i+=4){const gray=.299*pixels.data[i]+.587*pixels.data[i+1]+.114*pixels.data[i+2];const level=Math.max(0,Math.min(255,(gray-128)*1.35+128));pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=level;}
    ctx.putImageData(pixels,0,0);pass=2;
    const second=await worker.recognize(canvas,{}, {tsv:true,blocks:false});
    const secondary=spacesFromTsv(second.data.tsv,{floor:boundFloor,width:canvas.width,height:canvas.height});
    return mergeOcrPasses(primary,secondary);
  }finally{if(worker)await worker.terminate();}
}
