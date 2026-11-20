// OCR runs in a browser worker. Only engine/language assets are downloaded;
// floor-plan image pixels are never uploaded.
export function spacesFromTsv(tsv, { floor, width, height }) {
  const lines = new Map();
  for (const raw of String(tsv || '').split('\n').slice(1)) {
    const c = raw.split('\t');
    if (c.length < 12 || c[0] !== '5' || Number(c[10]) < 35 || !c[11]?.trim()) continue;
    const word = { text:c.slice(11).join('\t').trim(), x:Number(c[6]), y:Number(c[7]), width:Number(c[8]), height:Number(c[9]), confidence:Number(c[10])/100 };
    const key=c.slice(1,5).join('-');if(!lines.has(key))lines.set(key,[]);lines.get(key).push(word);
  }
  const groups=[];
  for(const words of lines.values()) {
    words.sort((a,b)=>a.x-b.x);let group=[];
    for(const word of words){if(group.length && word.x-(group.at(-1).x+group.at(-1).width)>width*.045){groups.push(group);group=[]}group.push(word)}
    if(group.length)groups.push(group);
  }
  return groups.flatMap((words,i)=>{
    const name=words.map(w=>w.text).join(' ').trim();
    if(name.length<2 || !/\p{L}/u.test(name) || /출입구|엘리베이터|에스컬레이터/.test(name))return [];
    const left=Math.min(...words.map(w=>w.x))/width,top=Math.min(...words.map(w=>w.y))/height;
    const right=Math.max(...words.map(w=>w.x+w.width))/width,bottom=Math.max(...words.map(w=>w.y+w.height))/height;
    return [{id:`ocr-${floor.id}-${i}`,name,floorId:floor.id,buildingId:floor.buildingId,aliases:[],
      position:{x:(left+right)/2,y:(top+bottom)/2},bounds:{x:left,y:top,width:right-left,height:bottom-top},
      source:'ocr',confidence:Math.min(.85,words.reduce((s,w)=>s+w.confidence,0)/words.length)}];
  });
}

export async function analyzeFloorImage({ image, floor, onProgress=()=>{} }) {
  const img=new Image();img.src=image;await img.decode();
  const scale=Math.min(3,2200/Math.max(img.naturalWidth,img.naturalHeight));
  const canvas=document.createElement('canvas');canvas.width=Math.round(img.naturalWidth*scale);canvas.height=Math.round(img.naturalHeight*scale);
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
  const {createWorker,PSM}=await import('tesseract.js');
  onProgress('한글 장소 인식 준비 중…');
  let worker;
  try {
    worker=await createWorker(['kor','eng'],1,{logger:m=>{if(m.status==='recognizing text')onProgress(`장소 분석 중 ${Math.round(m.progress*100)}%`);}});
    await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT});
    const {data}=await worker.recognize(canvas,{}, {tsv:true,blocks:false});
    return spacesFromTsv(data.tsv,{floor,width:canvas.width,height:canvas.height});
  } finally { if(worker)await worker.terminate(); }
}
