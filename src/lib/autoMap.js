// Matching links an installation to an image label/room. It never invents a terminal point.
export const MATCHING_VERSION = 2;
export function normalizePlaceName(value) {
  const text=String(value||'').normalize('NFKC').toUpperCase().replace(/[‐‑‒–—]/g,'-').replace(/(\d)\s*([-.])\s*(?=\d)/g,'$1$2');
  return [...text].map((ch,i)=>/[\p{L}\p{N}]/u.test(ch)?ch:/[-.]/.test(ch)&&/\d/.test(text[i-1]||'')&&/\d/.test(text[i+1]||'')?ch:'').join('');
}
export function roomIdentifiers(value) {
  const text=String(value||'').normalize('NFKC').toUpperCase().replace(/[‐‑‒–—]/g,'-').replace(/(\d)\s*([-.])\s*(?=\d)/g,'$1$2'),ids=new Set();
  const token='([A-Z]?\\d{1,4}(?:[-.]\\d{1,3})?[A-Z]?)';
  for(const m of text.matchAll(new RegExp('(?:ROOM|RM|진료실|검사실|치료실|회의실|병실)\\s*#?\\s*'+token,'g')))ids.add(m[1]);
  for(const m of text.matchAll(new RegExp(token+'\\s*(?:호실|호|번방|(?:번\\s*)?(?:진료실|검사실|치료실|병실|ROOM))','g')))ids.add(m[1]);
  if(new RegExp('^\\s*'+token+'\\s*$').test(text))ids.add(text.trim());
  for(const m of text.matchAll(/\b((?:MRI|CT|PET|LAB)\s*[-_]?\s*\d{1,3}(?:[-.]\d{1,3})?)\b/g))ids.add(normalizePlaceName(m[1]));
  return [...ids];
}
function modality(value) {
  return normalizePlaceName(value).match(/^(MRI|CT|PETCT|ECG|EEG|EMG|XRAY)(?:실|검사실|촬영실)?$/)?.[1]||null;
}
function similarity(a,b) {
  if(!a||!b)return 0;
  let prev=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=next;}
  return 1-prev[b.length]/Math.max(a.length,b.length);
}
export function isSpaceOnPlan(space,floor) {
  return Boolean(floor?.planKey && space?.planKey===floor.planKey && space.geometryVersion===2 && space.floorId===floor.id && space.buildingId===floor.buildingId && space.position && ['plan-ocr','manual-region','reviewed-label'].includes(space.source));
}
const reviewResult=(status,reason,candidates=[])=>({status,reason,candidates,confidence:0});
function labelParts(label) {
  return String(label||'').split(/\s*(?:\+|\n|;|\s\/\s)\s*/).map(normalizePlaceName).filter(Boolean);
}
export function matchPlace(device,spaces,{floor,matchingRules=[]}={}) {
  if(!device.floorId||!floor)return reviewResult('unmatched','건물과 층을 먼저 확인해 주세요.');
  const usable=spaces.filter(s=>isSpaceOnPlan(s,floor));
  if(!usable.length)return reviewResult('unmatched','현재 안내도와 연결된 장소 분석이 없습니다. 이 안내도를 분석하거나 장소 영역을 등록해 주세요.');
  const label=device.location||device.name||'',query=normalizePlaceName(label),parts=labelParts(label),identifiers=roomIdentifiers(label);
  if(!query)return reviewResult('unmatched','엑셀의 설치 장소명이 비어 있습니다.');
  const confirmed=usable.find(s=>device.confirmedSpace?.spaceId===s.id&&device.confirmedSpace?.planKey===floor.planKey&&device.confirmedSpace?.floorId===floor.id&&normalizePlaceName(device.confirmedSpace?.inputLabel)===query);
  if(confirmed)return{status:'matched',spaceId:confirmed.id,label:confirmed.name,method:'confirmed',confidence:1,reason:'사용자가 원본 안내도에서 확인한 연결입니다.',candidates:[]};
  const rule=matchingRules.find(r=>r.floorId===floor.id&&r.planKey===floor.planKey&&normalizePlaceName(r.inputLabel)===query&&usable.some(s=>s.id===r.spaceId));
  if(rule){const space=usable.find(s=>s.id===rule.spaceId);return{status:'matched',reason:'이 현장에서 확인한 매칭 규칙을 적용했습니다.',spaceId:space.id,label:space.name,method:'confirmed-rule',confidence:1,candidates:[]};}
  const scored=usable.map(space=>{
    const name=normalizePlaceName(space.name),aliases=space.aliasesVerified?(space.aliases||[]).map(normalizePlaceName):[];
    const roomIds=[...new Set([...roomIdentifiers(space.name),...roomIdentifiers(space.roomNumber)])];
    const numericConflict=identifiers.length>0&&roomIds.length>0&&!identifiers.some(id=>roomIds.includes(id));
    if(numericConflict)return null;
    const exact=query===name,alias=aliases.includes(query),sameModality=modality(label)&&modality(label)===modality(space.name);
    const exactRoom=identifiers.length===1&&roomIds.includes(identifiers[0]);
    let score=exact?1:alias?.99:sameModality?.97:Math.max(similarity(query,name)*.78,...aliases.map(a=>similarity(query,a)*.78));
    let reason=exact?'안내도 표기와 일치':alias?'사용자가 확인한 별칭':sameModality?'검사 명칭의 표기 차이':'문자 유사 후보 · 확인 필요';
    if(exactRoom){score=Math.max(score,.9);reason='방 번호 일치 · 진료과와 함께 확인';}
    if(parts.length>1&&parts.some(p=>p===name||aliases.includes(p))){score=Math.max(score,.88);reason='여러 장소 중 일부만 일치 · 대표 장소를 임의로 선택하지 않음';}
    if(query.includes(name)&&name.length>=4||name.includes(query)&&query.length>=4){score=Math.max(score,.72);if(!exact)reason='상위 부서 또는 부분 표기 · 확인 필요';}
    return{space,score,reason,exact,alias,sameModality,exactRoom};
  }).filter(c=>c&&c.score>=.48).sort((a,b)=>b.score-a.score||a.space.id.localeCompare(b.space.id));
  const candidates=scored.slice(0,5).map(c=>({spaceId:c.space.id,label:c.space.name,score:c.score,reason:c.reason}));
  if(!scored.length)return reviewResult('unmatched',identifiers.length?'해당 방 번호와 장소명이 현재 안내도에서 확인되지 않습니다.':'현재 안내도에 해당 명칭이 없습니다. 상세 안내도를 등록하거나 장소를 직접 확인해 주세요.');
  const best=scored[0];
  const exacts=scored.filter(c=>c.exact||c.alias||c.sameModality);
  if(exacts.length>1){return reviewResult('ambiguous','동일한 이름 또는 별칭의 장소가 여러 곳입니다. 방 번호나 영역을 선택해 주세요.',candidates);}
  if(parts.length>1)return reviewResult('review','설치 장소가 여러 부서로 묶여 있습니다. 실제 연결할 장소를 확인해 주세요.',candidates);
  // Numbers are hard constraints. A bare room number can be automatic only if it is unique.
  const bareRoom=identifiers.length===1&&query.replace(/^(?:ROOM|RM)/,'').replace(/(?:호실|호|번방)$/,'')===normalizePlaceName(identifiers[0]);
  const roomMatches=scored.filter(c=>c.exactRoom);
  const clearReading=best.space.source!=='plan-ocr'||best.space.consensus||(best.space.confidence??0)>=.96;
  const automatic=(best.exact||best.alias||best.sameModality||(bareRoom&&roomMatches.length===1))&&(best.space.confidence??0)>=.85&&clearReading;
  if(automatic){return{status:'matched',spaceId:best.space.id,label:best.space.name,method:best.alias?'verified-alias':best.sameModality?'modality':'exact-label',confidence:best.score,reason:'현재 안내도에서 확인한 장소에 연결했습니다. 단말의 실제 설치 좌표를 뜻하지 않습니다.',candidates};}
  return reviewResult('review',best.exact?'OCR 표기는 일치하지만 인식 신뢰도가 낮습니다. 원본 글자를 확인해 주세요.':'비슷한 이름만 찾았습니다. 후보를 확인해 주세요.',candidates);
}
export function autoMapSite(input,{includeCleared=false}={}) {
  const site=structuredClone(input),stats={matched:0,review:0,unmatched:0,ambiguous:0,manual:0};
  site.devices=site.devices.map(device=>{
    if(!includeCleared&&device.match?.method==='manual-clear'){stats.unmatched++;return device;}
    const manualPoint=Boolean(device.position&&device.positionSource!=='auto');
    if(manualPoint)stats.manual++;
    const floor=site.floors?.find(f=>f.id===device.floorId);
    const match=matchPlace(device,site.spaces||[],{floor,matchingRules:site.matchingRules||[]});
    stats[match.status]++;
    // Previous versions' department centroids must not survive as terminal coordinates.
    return{...device,match,spaceId:match.status==='matched'?match.spaceId:null,
      position:manualPoint?device.position:null,positionSource:manualPoint?'manual':null};
  });
  site.matchingVersion=MATCHING_VERSION;
  return{site,stats,warnings:stats.unmatched+stats.review+stats.ambiguous?[`확인이 필요한 항목: ${stats.review+stats.ambiguous+stats.unmatched}`]:[]};
}
export function confirmPlaceMatch(input,deviceId,spaceId,{remember=true}={}) {
  const site=structuredClone(input),device=site.devices.find(d=>d.id===deviceId),space=site.spaces?.find(s=>s.id===spaceId),floor=site.floors.find(f=>f.id===device?.floorId);
  if(!device||!space||!isSpaceOnPlan(space,floor))throw new Error('현재 단말의 층·안내도에 있는 장소를 선택해 주세요.');
  const rule={id:crypto.randomUUID(),floorId:floor.id,planKey:floor.planKey,inputLabel:device.location||device.name,spaceId};
  // A confirmation is always stored for the current item; remember adds a reusable label rule.
  device.confirmedSpace={spaceId,planKey:floor.planKey,floorId:floor.id,inputLabel:device.location||device.name};
  if(remember)site.matchingRules=[...(site.matchingRules||[]).filter(r=>!(r.floorId===floor.id&&normalizePlaceName(r.inputLabel)===normalizePlaceName(rule.inputLabel))),rule];
  const result=autoMapSite(site).site;
  const target=result.devices.find(d=>d.id===deviceId);
  target.spaceId=spaceId;target.match={status:'matched',spaceId,label:space.name,method:'confirmed',confidence:1,reason:'사용자가 원본 안내도에서 확인했습니다.',candidates:[]};
  return result;
}
export function rejectPlaceMatch(input,deviceId) {
  const site=structuredClone(input),device=site.devices.find(d=>d.id===deviceId);if(!device)throw new Error('단말을 찾을 수 없습니다.');
  device.spaceId=null;delete device.confirmedSpace;device.match={status:'unmatched',method:'manual-clear',reason:'사용자가 장소 연결을 해제했습니다.',candidates:[]};return site;
}
export function updateSpace(input,spaceId,changes) {
  const site=structuredClone(input),space=site.spaces?.find(s=>s.id===spaceId);if(!space)throw new Error('장소를 찾을 수 없습니다.');
  const floor=site.floors.find(f=>f.id===space.floorId);if(!floor?.planKey)throw new Error('안내도의 이미지 식별 정보가 없습니다. 안내도를 다시 등록해 주세요.');
  for(const key of ['name','roomNumber','aliases','bounds','position'])if(changes[key]!==undefined)space[key]=changes[key];
  if(!space.name?.trim())throw new Error('장소 이름을 입력해 주세요.');
  space.geometryVersion=2;space.planKey=floor.planKey;space.source='manual-region';space.confidence=1;space.aliasesVerified=true;
  return autoMapSite(site).site;
}
