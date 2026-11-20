import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptySite, floorName, matchFloor, validateSite } from '../src/lib/model.js';
import { importSheet } from '../src/lib/workbook.js';

function site() {
  return { ...createEmptySite('테스트'), buildings: [{id:'main',name:'본관'},{id:'annex',name:'별관'}], floors:[
    {id:'main-b1',buildingId:'main',name:'B1',order:-1,image:null},
    {id:'main-1f',buildingId:'main',name:'1F',order:1,image:null},
    {id:'annex-1f',buildingId:'annex',name:'1F',order:1,image:null},
  ] };
}

test('photo IDs retain leading zeros and duplicate identifiers are rejected', () => {
  const data=site();
  data.devices=[{id:'a',name:'A',referenceId:'01',referenceStatus:'confirmed',networkStatus:'review',detail:'로비',photos:[]}];
  assert.equal(validateSite(data).devices[0].referenceId,'01');
  data.devices.push({...data.devices[0],id:'b'});
  assert.throws(()=>validateSite(data),/사진 ID/);
  data.devices[1].referenceId='02'; data.devices[1].referenceStatus='guessed';
  assert.throws(()=>validateSite(data),/확인 상태/);
});

test('normalizes Korean and mixed floor labels without guessing unknown center', () => {
  for (const [input,expected] of [['본관 B1 (3대)','B1'],['별관 지하 2층','B2'],['별관 2층 (2대)','2F'],['1f','1F'],['3','3F'],['감마나이프센터 (1대)',null]]) assert.equal(floorName(input),expected);
  assert.equal(matchFloor(site(),'별관','1층').id,'annex-1f');
  assert.equal(matchFloor(site(),'감마나이프센터','1층'),null);
  assert.equal(floorName('LAB2 1F'),'1F');assert.equal(floorName('B2동 1층'),'1F');
});

test('building identifiers containing B2 are not treated as basement floors',async()=>{
 const inspection={sheets:[{name:'목록',rows:[['건물','층','단말'],['LAB2','1F','장비1'],['B2동','2층','장비2']]}]};
 const result=await importSheet({inspection,sheetName:'목록',headerRow:1,mapping:{building:0,floor:1,name:2}},createEmptySite('다른 병원'));
 assert.deepEqual(result.buildings.map(b=>b.name),['LAB2','B2동']);assert.deepEqual(result.floors.map(f=>f.name),['1F','2F']);
});

test('rejects broken floor references and fabricated out-of-bounds positions', () => {
  const data = site(); data.devices=[{id:'1',name:'테스트',buildingId:'main',floorId:'annex-1f',position:null,photos:[]}];
  assert.throws(()=>validateSite(data), /일치/);
  data.devices[0].floorId='main-b1'; data.devices[0].position={x:1.1,y:0.5};
  assert.throws(()=>validateSite(data), /좌표/);
  data.devices[0].position={x:0,y:1}; assert.ok(validateSite(data));
  data.devices[0].photos=['https://example.com/photo.png']; assert.throws(()=>validateSite(data), /사진/);
});

test('merged group carry-forward preserves 3 terminals and unknown group stays unassigned', async () => {
  const inspection={sheets:[{name:'목록',rows:[['층','설치장소','단말명'],['본관 B1 (2대)','핵의학과','핵1'],['','핵의학과','핵2'],['감마나이프센터 (1대)','감마나이프센터','감마1']]}]};
  const result=await importSheet({inspection,sheetName:'목록',headerRow:1,mapping:{building:0,floor:0,location:1,name:2}},site());
  assert.equal(result.devices.length,3);
  assert.deepEqual(result.devices.map(d=>d.floorId),['main-b1','main-b1',null]);
  assert.equal(result.devices[2].buildingId,null);
  assert.ok(result.devices.every(d=>d.position===null));
});

test('import preserves confirmed position only on same floor and reports duplicates', async () => {
  const current=site(); current.devices=[{id:'known',name:'장비1',location:'진료실',buildingId:'main',floorId:'main-b1',photos:[],position:{x:0.2,y:0.6}}];
  const config={inspection:{sheets:[{name:'목록',rows:[['건물','층','장소','단말'],['본관','B1','진료실','장비1']]}]},sheetName:'목록',headerRow:1,mapping:{building:0,floor:1,location:2,name:3}};
  let result=await importSheet(config,current); assert.equal(result.devices[0].id,'known'); assert.deepEqual(result.devices[0].position,{x:0.2,y:0.6});
  config.inspection.sheets[0].rows[1][1]='1층'; result=await importSheet(config,current); assert.equal(result.devices[0].position,null);
  config.inspection.sheets[0].rows.push(['별관','1층','검사실','장비1']); result=await importSheet(config,current);
  assert.equal(new Set(result.devices.map(d=>d.id)).size,2); assert.ok(result.warnings.some(w=>w.includes('중복')));
  assert.ok(validateSite({...current,...result}));
});

test('a combined floor column also resolves the building when no separate building column exists', async () => {
  const inspection={sheets:[{name:'목록',rows:[['층','단말'],['별관 1층','단말A'],['','단말B'],['감마나이프센터 (1대)','단말C']]}]};
  const result=await importSheet({inspection,sheetName:'목록',headerRow:1,mapping:{floor:0,name:1}},site());
  assert.deepEqual(result.devices.map(d=>d.floorId),['annex-1f','annex-1f',null]);
});
