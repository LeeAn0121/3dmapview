import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicMapping, applyPublicMapping, upgradePublicDemo} from '../src/lib/publication.js';

const planKey='a'.repeat(64);
const catalog={version:1,id:'hospital',name:'Hospital',buildings:[{id:'main',name:'Main'}],floors:[{id:'f1',buildingId:'main',name:'1F',order:1,planKey}],spaces:[],devices:[],isPublicDemo:true};
function privateSite(){return {...catalog,devices:[{id:'d1',name:'PRIVATE_DEVICE',referenceId:'01',referenceStatus:'confirmed',location:'Lobby',detail:'Entrance',floorId:'f1',buildingId:'main',ip:'10.0.0.42',photos:['data:image/jpeg;base64,c2VjcmV0'],notes:'PRIVATE_NOTE',sourceDeviceIds:['PRIVATE_ROW'],position:{x:.2,y:.3},positionSource:'auto'}],photoReconciliation:{sourceRecords:[{ip:'10.0.0.42'}],warnings:['Count review'],unresolved:[{location:'Lobby',reason:'Verify quantity',sourceIds:['PRIVATE_ROW']}],excluded:[{status:'not-installed',reason:'Not installed',sourceId:'PRIVATE_ROW'}]}};}

test('public mapping retains IDs/locations but never copies private fields or nested audit records',()=>{
 const mapping=createPublicMapping(privateSite(),catalog,'r1');
 const json=JSON.stringify(mapping);
 for(const privateValue of ['10.0.0.42','PRIVATE_DEVICE','PRIVATE_NOTE','PRIVATE_ROW','data:image','sourceRecords','sourceDeviceIds'])assert.ok(!json.includes(privateValue),privateValue);
 assert.equal(mapping.devices[0].referenceId,'01');assert.equal(mapping.devices[0].detail,'Entrance');
 assert.equal(mapping.devices[0].position,null);
 assert.equal(applyPublicMapping(catalog,mapping).devices.length,1);
});

test('public demo migrates to populated data without replacing private imported workspaces',()=>{
 const published=applyPublicMapping(catalog,createPublicMapping(privateSite(),catalog,'r1'));
 assert.equal(upgradePublicDemo(catalog,published).devices.length,1);
 assert.equal(upgradePublicDemo({...catalog,isPublicDemo:false},published),null);
 assert.equal(upgradePublicDemo({...catalog,id:'another-hospital'},published),null);
 assert.equal(upgradePublicDemo({...published,publishedMappingRevision:'old'},published).devices.length,1);
 assert.equal(upgradePublicDemo({...published,publishedMappingRevision:'old',isPublishedSnapshot:false},published),null);
});

test('public map refuses foreign plan coordinates and excludes known uninstalled records',()=>{
 const source=privateSite();source.floors=[{...source.floors[0],planKey:'b'.repeat(64)}];
 assert.throws(()=>createPublicMapping(source,catalog,'r1'),/다른 층/);
 const valid=privateSite();valid.devices[0].installationStatus='not-installed';
 assert.equal(createPublicMapping(valid,catalog,'r1').devices.length,0);
});
