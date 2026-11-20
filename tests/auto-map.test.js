import test from 'node:test';
import assert from 'node:assert/strict';
import { autoMapSite,matchPlace,confirmPlaceMatch,rejectPlaceMatch,updateSpace } from '../src/lib/autoMap.js';
import { spacesFromTsv,mergeOcrPasses } from '../src/lib/imageAnalysis.js';
import { attachPublicSpaces } from '../src/lib/catalog.js';
const key='a'.repeat(64),newKey='b'.repeat(64);
const floor={id:'1f',buildingId:'main',planKey:key};
function space(id,name,x=.3,more={}){return{id,name,floorId:'1f',buildingId:'main',planKey:key,geometryVersion:2,source:'plan-ocr',position:{x,y:.5},bounds:{x:x-.05,y:.45,width:.1,height:.1},confidence:.98,consensus:true,aliases:[],...more};}
function site(spaces,devices){return{id:'test',floors:[floor],spaces,devices,matchingRules:[]};}
const d=(location,more={})=>({id:'terminal',name:'terminal',location,buildingId:'main',floorId:'1f',position:null,...more});

test('unique label links the place without inventing a physical terminal point',()=>{
 const result=autoMapSite(site([space('mri','MRI실')],[d('MRI')]));
 assert.equal(result.stats.matched,1);assert.equal(result.site.devices[0].spaceId,'mri');assert.equal(result.site.devices[0].position,null);
});
test('foreign-image, legacy-highlight and different-floor coordinates cannot be reused',()=>{
 for(const s of [space('x','MRI실',.3,{planKey:newKey}),space('x','MRI실',.3,{source:'official-highlight'}),space('x','MRI실',.3,{floorId:'2f'})])assert.equal(matchPlace(d('MRI실'),[s],{floor}).status,'unmatched');
 assert.equal(matchPlace(d('MRI실',{floorId:null}),[space('x','MRI실')],{floor}).status,'unmatched');
});
test('room numbers are hard constraints: 101 is never assigned to 102',()=>{
 const spaces=[space('a','진료실 101'),space('b','진료실 102',.8)];
 assert.equal(matchPlace(d('진료실 101'),spaces,{floor}).spaceId,'a');
 assert.equal(matchPlace(d('101호'),spaces,{floor}).spaceId,'a');
 assert.equal(matchPlace(d('진료실 103'),spaces,{floor}).status,'unmatched');
 assert.equal(matchPlace(d('103 진료실'),spaces,{floor}).status,'unmatched');
});
test('same-name rooms and compound department groups require review',()=>{
 assert.equal(matchPlace(d('검사실'),[space('a','검사실'),space('b','검사실',.8)],{floor}).status,'ambiguous');
 const match=matchPlace(d('내과 + 외과'),[space('a','내과'),space('b','외과',.8)],{floor});
 assert.equal(match.status,'review');assert.equal(match.spaceId,undefined);assert.equal(match.candidates.length,2);
});
test('similar OCR names and unverified hospital aliases are only suggestions',()=>{
 assert.notEqual(matchPlace(d('정형외과'),[space('a','정형외가')],{floor}).status,'matched');
 assert.notEqual(matchPlace(d('보철과'),[space('a','치과병원',.3,{aliases:['보철과']})],{floor}).status,'matched');
 assert.equal(matchPlace(d('MRI실'),[space('a','영상의학과')],{floor}).status,'unmatched');
 assert.equal(matchPlace(d('내과'),[space('a','내과',.3,{confidence:.55})],{floor}).status,'review');
});
test('manual terminal points survive; old automatic centroids are removed',()=>{
 const input=site([space('a','내과')],[d('내과',{position:{x:.8,y:.8},positionSource:'manual'}),d('내과',{id:'legacy',position:{x:.2,y:.2},positionSource:'auto'})]);
 const result=autoMapSite(input);assert.deepEqual(result.site.devices[0].position,{x:.8,y:.8});assert.equal(result.site.devices[1].position,null);
});
test('one correction learns only inside the same site, floor and original image',()=>{
 const input=site([space('a','외래주사실')],[d('중앙주사실')]);
 const confirmed=confirmPlaceMatch(input,'terminal','a');
 assert.equal(autoMapSite(confirmed).site.devices[0].spaceId,'a');
 confirmed.devices.push(d('중앙주사실',{id:'second'}));assert.equal(autoMapSite(confirmed).site.devices[1].spaceId,'a');
 confirmed.floors[0].planKey=newKey;assert.equal(autoMapSite(confirmed).site.devices[0].spaceId,null);
 const once=confirmPlaceMatch(input,'terminal','a',{remember:false});assert.equal(once.matchingRules.length,0);assert.equal(autoMapSite(once).site.devices[0].spaceId,'a');
 const cleared=rejectPlaceMatch(once,'terminal');assert.equal(autoMapSite(cleared).site.devices[0].spaceId,null);
});
test('a previously confirmed terminal is re-evaluated when its Excel installation changes',()=>{
 const input=site([space('a','진료실 101'),space('b','진료실 102',.8)],[d('진료실 101')]);
 const confirmed=confirmPlaceMatch(input,'terminal','a',{remember:false});confirmed.devices[0].location='진료실 102';
 assert.equal(autoMapSite(confirmed).site.devices[0].spaceId,'b');
 const numbered=site([space('a','Room101-1'),space('b','Room1011',.8)],[d('Room101-1')]);
 numbered.devices[0].location='Room101 - 1';const rule=confirmPlaceMatch(numbered,'terminal','a');rule.devices[0].location='Room1011';assert.equal(autoMapSite(rule).site.devices[0].spaceId,'b');
});
test('correcting an OCR label re-evaluates matching against the actual plan',()=>{
 const input=site([space('a','신정내과')],[d('신장내과')]);
 const updated=updateSpace(input,'a',{name:'신장내과'});assert.equal(updated.devices[0].spaceId,'a');assert.equal(updated.spaces[0].source,'manual-region');
});
test('same algorithm works with unrelated Korean and English hospital labels',()=>{
 for(const [name,label] of [['새봄내과','새봄 내과'],['Emergency Department','emergency department'],['진료실 207','진료실207'],['MRI 2','MRI-2']]){
  assert.equal(matchPlace(d(label),[space('a',name)],{floor}).spaceId,'a',name);
 }
});
test('Korean-only text, wrapped suffixes and room numbers survive OCR parsing',()=>{
 const header='level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
 const rows=[['핵의학과',100,100,200,40],['세포치료',400,100,200,40],['센터',440,142,100,40],['101',100,300,100,40]].map(([text,x,y,w,h],i)=>`5\t1\t${i+1}\t1\t1\t1\t${x}\t${y}\t${w}\t${h}\t98\t${text}`);
 const found=spacesFromTsv([header,...rows].join('\n'),{floor,width:1000,height:1000});
 assert.ok(found.some(s=>s.name==='핵의학과'));assert.ok(found.some(s=>s.name==='세포치료 센터'));assert.ok(found.some(s=>s.roomNumber==='101'));assert.ok(found.every(s=>s.planKey===key&&s.geometryVersion===2));
 assert.ok(mergeOcrPasses(found,found).every(s=>s.consensus));
});
test('catalog migration retires foreign coordinates without replacing custom geometry',()=>{
 const catalog={id:'hospital',floors:[floor],spaces:[space('official','내과')],devices:[]};
 const input={id:'hospital',floors:[{...floor,planKey:newKey}],spaces:[space('old','잘못된 위치',.8,{source:'official-highlight'}),space('custom','사용자 장소',.3,{source:'manual-region',planKey:newKey})]};
 assert.deepEqual(attachPublicSpaces(input,catalog).spaces.map(s=>s.id),['custom']);
});
