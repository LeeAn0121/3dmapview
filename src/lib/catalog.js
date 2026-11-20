import { autoMapSite, isSpaceOnPlan } from './autoMap.js';
import { fingerprintImage } from './imageAnalysis.js';
import { hydrateSite } from './storage.js';
import { createEmptySite } from './model.js';
export function assetUrl(path){return path?.startsWith('catalog/')?`${import.meta.env.BASE_URL}${path}`:path;}
export async function loadPublicCatalog(){const response=await fetch(`${import.meta.env.BASE_URL}catalog/site.json`);if(!response.ok)throw new Error('공개 안내도를 불러오지 못했습니다.');return response.json();}
export async function bindPlanKeys(input){
 const site=structuredClone(input),changed=new Set();
 await Promise.all(site.floors.map(async floor=>{
  if(!floor.image){floor.planKey=null;return;}
  try{const key=await fingerprintImage(assetUrl(floor.image));if(floor.planKey&&floor.planKey!==key)changed.add(floor.id);floor.planKey=key;}
  catch{floor.planKey=null;}
 }));
 if(changed.size)site.devices=site.devices.map(d=>changed.has(d.floorId)?{...d,position:null,positionSource:null,spaceId:null,confirmedSpace:null,match:null}:d);
 return site;
}
export function attachPublicSpaces(input,catalog){
 const site=structuredClone(input);
 // Reject every previous-version coordinate regardless of its asserted department name.
 site.spaces=(site.spaces||[]).filter(s=>isSpaceOnPlan(s,site.floors.find(f=>f.id===s.floorId)));
 if(site.id!==catalog?.id)return site;
 const compatible=new Set(site.floors.filter(f=>f.planKey&&catalog.floors?.some(c=>c.id===f.id&&c.planKey===f.planKey)).map(f=>f.id));
 const existing=new Map(site.spaces.map(s=>[s.id,s]));
 for(const space of catalog.spaces||[])if(compatible.has(space.floorId)&&!existing.has(space.id))existing.set(space.id,space);
 site.spaces=[...existing.values()];
 if(site.isPublicDemo)site.devices=[];
 return site;
}
export async function loadInitialSite(){
 let catalog=null;try{catalog=await loadPublicCatalog();}catch{}
 if(import.meta.env.DEV){try{const response=await fetch('/local-data/site.json');if(response.ok){const raw=await bindPlanKeys(await response.json());return{site:autoMapSite(await hydrateSite(attachPublicSpaces(raw,catalog))).site,catalog};}}catch{}}
 if(catalog)return{site:await hydrateSite(catalog),catalog};
 return{site:createEmptySite('새 현장'),catalog:null};
}
