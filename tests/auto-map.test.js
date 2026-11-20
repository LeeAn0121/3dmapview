import test from 'node:test';
import assert from 'node:assert/strict';
import { autoMapSite, matchPlace } from '../src/lib/autoMap.js';
import { spacesFromTsv } from '../src/lib/imageAnalysis.js';
import { attachPublicSpaces } from '../src/lib/catalog.js';

const spaces = [
  { id:'pet',floorId:'b1',name:'PET-CT센터',aliases:['PET-CT'],position:{x:.2,y:.5},source:'official-highlight',confidence:.95 },
  { id:'a',floorId:'1f',name:'검사실',aliases:[],position:{x:.2,y:.5} },
  { id:'b',floorId:'1f',name:'검사실',aliases:[],position:{x:.8,y:.5} },
];
test('automatic locations use same-floor aliases and never invent unknown floor',()=>{
  const r=matchPlace({location:'PET-CT',floorId:'b1'},spaces);
  assert.equal(r.spaceId,'pet');assert.equal(r.method,'alias');assert.deepEqual(r.position,{x:.2,y:.5});
  assert.equal(matchPlace({location:'PET-CT',floorId:'1f'},spaces).status,'unmatched');
  assert.equal(matchPlace({location:'PET-CT',floorId:null},spaces).status,'unmatched');
  assert.equal(matchPlace({location:'검사실',floorId:'1f'},spaces).status,'ambiguous');
});
test('manual positions and intentional cleared locations survive bootstrap matching',()=>{
  const site={spaces,devices:[
    {id:'manual',floorId:'b1',location:'PET-CT',position:{x:.9,y:.9},positionSource:'manual'},
    {id:'oldmanual',floorId:'b1',location:'PET-CT',position:{x:.6,y:.6}},
    {id:'clear',floorId:'b1',location:'PET-CT',position:null,match:{method:'manual-clear'}},
    {id:'auto',floorId:'b1',location:'PET-CT',position:null},
  ]};
  const r=autoMapSite(site);assert.equal(r.stats.manual,2);assert.equal(r.stats.matched,1);
  assert.deepEqual(r.site.devices[0].position,{x:.9,y:.9});assert.equal(r.site.devices[2].position,null);
  assert.deepEqual(autoMapSite(site,{includeCleared:true}).site.devices[2].position,{x:.2,y:.5});
});
test('Korean-only OCR text is retained and numeric/noise text removed',()=>{
  const tsv='level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n'
    +'5\t1\t1\t1\t1\t1\t100\t100\t200\t40\t90\t핵의학과\n'
    +'5\t1\t2\t1\t1\t1\t100\t300\t100\t40\t90\t123\n';
  const result=spacesFromTsv(tsv,{floor:{id:'b1',buildingId:'main'},width:1000,height:1000});
  assert.equal(result.length,1);assert.equal(result[0].name,'핵의학과');assert.equal(result[0].position.x,.2);assert.ok(Math.abs(result[0].position.y-.12)<1e-9);
});

test('replaced custom floor image never receives public coordinates on reload',()=>{
  const catalog={id:'hospital',spaces:[{...spaces[0],floorId:'b1'}]};
  const custom={id:'hospital',floors:[{id:'b1',imageOrigin:'custom'}],spaces:[{id:'user-ocr',floorId:'b1'}]};
  assert.deepEqual(attachPublicSpaces(custom,catalog).spaces,[{id:'user-ocr',floorId:'b1'}]);
  const official={...custom,floors:[{id:'b1',imageOrigin:'official'}],spaces:[]};
  assert.equal(attachPublicSpaces(official,catalog).spaces[0].id,'pet');
});
