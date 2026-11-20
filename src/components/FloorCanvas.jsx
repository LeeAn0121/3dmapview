import { Layers, Scan, ZoomIn, ZoomOut, RotateCcw, RotateCw, MapPin, MousePointer2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

function Markers({site,floor,selectedId,onSelect}) {
  if (site.isPublicDemo) return null;
  return site.devices.filter(d=>d.floorId===floor.id&&d.position&&d.positionSource!=='auto').map(d=><button key={d.id} className={'map-marker manual '+(selectedId===d.id?'selected':'')} style={{left:`${d.position.x*100}%`,top:`${d.position.y*100}%`,zIndex:selectedId===d.id?30:10}} aria-label={`${d.referenceId?`ID ${d.referenceId} · `:''}${d.name} 설치 위치`} data-position-source="manual" onClick={e=>{e.stopPropagation();onSelect(d)}}><MapPin size={23} fill="currentColor"/><span>{d.referenceId?`ID ${d.referenceId} · `:''}{d.name} · 직접 지정</span></button>);
}

function Places({site,floor,selectedSpaceId,onSelectSpace,editing}) {
  if(editing)return null;
  return (site.spaces||[]).filter(s=>s.floorId===floor.id&&s.position&&s.geometryVersion===2&&s.planKey&&s.planKey===floor.planKey).map(s=>{const b=s.bounds||{x:Math.max(0,s.position.x-.045),y:Math.max(0,s.position.y-.025),width:.09,height:.05};return <button key={s.id} className={'place-region '+(selectedSpaceId===s.id?'selected':'')} style={{left:`${b.x*100}%`,top:`${b.y*100}%`,width:`${b.width*100}%`,height:`${b.height*100}%`}} aria-label={`${s.name} 장소`} title={s.name} data-space-id={s.id} onClick={e=>{e.stopPropagation();onSelectSpace(s)}}><span>{s.name}</span></button>});
}

export default function FloorCanvas({site,buildingId,floorId,setFloor,mode,setMode,selectedId,onSelect,selectedSpaceId,onSelectSpace,onAddArea,showAllFloors,onToggleAllFloors,onImportRequest,focusPoint,onResetFocus,editing,setEditing,onPlace,zoom,setZoom,rotation,setRotation}) {
  const viewport=useRef(null);const [viewportSize,setViewportSize]=useState({width:700,height:600});
  const [imageRatios,setImageRatios]=useState({});
  const [drawing,setDrawing]=useState(false),[drag,setDrag]=useState(null);const dragStart=useRef(null);
  const ownFloorChange=useRef(null);
  const cancelDrawing=()=>{setDrawing(false);setDrag(null);dragStart.current=null};
  useEffect(()=>{if(editing)cancelDrawing()},[editing]);
  useEffect(()=>{cancelDrawing()},[site.id,selectedId,selectedSpaceId]);
  useEffect(()=>{if(ownFloorChange.current===floorId){ownFloorChange.current=null;return}cancelDrawing()},[floorId]);
  const rememberRatio=(floorId,img)=>{const ratio=img.naturalWidth/img.naturalHeight;if(floorId&&Number.isFinite(ratio)&&ratio>0)setImageRatios(previous=>previous[floorId]===ratio?previous:{...previous,[floorId]:ratio})};
  useEffect(()=>{const el=viewport.current;if(!el)return;const observer=new ResizeObserver(([entry])=>setViewportSize({width:entry.contentRect.width,height:entry.contentRect.height}));observer.observe(el);return()=>observer.disconnect()},[]);
  const installedFloorIds=new Set(site.devices.map(d=>d.floorId).filter(Boolean));
  const floors=floorId==='unassigned'?[]:site.floors.filter(f=>f.buildingId===buildingId&&(showAllFloors||installedFloorIds.has(f.id))).sort((a,b)=>b.order-a.order);
  const current=floors.find(f=>f.id===floorId)||floors.find(f=>f.name==='1F')||floors[0];
  const shown=mode==='flat'?(current?[current]:[]):floors;
  const planeWidth=Math.max(240,Math.min(520,viewportSize.width*.7));const rz=-27*Math.PI/180,rx=62*Math.PI/180;
  const corners=shown.flatMap(floor=>{
    const planeHeight=planeWidth/(imageRatios[floor.id]||820/660),cx=planeWidth*.5,cy=planeHeight*.3;
    return [[0,0],[planeWidth,0],[0,planeHeight],[planeWidth,planeHeight]].map(([x,y])=>({x:cx+(x-cx)*Math.cos(rz)-(y-cy)*Math.sin(rz),y:cy+((x-cx)*Math.sin(rz)+(y-cy)*Math.cos(rz))*Math.cos(rx)}));
  });
  const minX=Math.min(...corners.map(p=>p.x)),maxX=Math.max(...corners.map(p=>p.x)),minY=Math.min(...corners.map(p=>p.y)),maxY=Math.max(...corners.map(p=>p.y));const sceneWidth=maxX-minX+58,sceneHeight=(shown.length-1)*88+maxY-minY;const fit=Math.min(1,(viewportSize.width-32)/sceneWidth,(viewportSize.height-24)/sceneHeight);
  const building=site.buildings.find(b=>b.id===buildingId);
  const reset=()=>{setZoom(1);setRotation(0);onResetFocus();setDrawing(false);setDrag(null)};
  const pointOnMap=e=>{const r=e.currentTarget.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))}};
  const dragBounds=(start,end)=>({x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),width:Math.abs(end.x-start.x),height:Math.abs(end.y-start.y)});
  const startArea=()=>{setMode('flat');setZoom(1);setRotation(0);onResetFocus();setEditing(false);if(current&&floorId!==current.id){ownFloorChange.current=current.id;setFloor(current.id)}setDrawing(true);setDrag(null)};
  const enterFlat=()=>{setMode('flat');setEditing(false);setDrawing(false);setDrag(null);if(current&&floorId!==current.id)setFloor(current.id)};
  const focusWidth=Math.max(240,Math.min(620,viewportSize.width*.86)),focusRatio=imageRatios[current?.id]||820/660,focusHeight=focusWidth/focusRatio;
  const angle=(-20+rotation)*Math.PI/180,tilt=48*Math.PI/180,pointX=((focusPoint?.x??.5)-.5)*focusWidth,pointY=((focusPoint?.y??.5)-.5)*focusHeight;
  const panX=-(pointX*Math.cos(angle)-pointY*Math.sin(angle))*zoom,panY=-(pointX*Math.sin(angle)+pointY*Math.cos(angle))*Math.cos(tilt)*zoom;
  const flatAngle=rotation*Math.PI/180,flatOffsetX=pointX,flatOffsetY=pointY+23;
  const flatPanX=-(flatOffsetX*Math.cos(flatAngle)-flatOffsetY*Math.sin(flatAngle))*zoom,flatPanY=-(flatOffsetX*Math.sin(flatAngle)+flatOffsetY*Math.cos(flatAngle))*zoom;
  const focusedStack=mode==='stack'&&focusPoint&&current;
  return <section className={'canvas-region '+(editing?'editing':'')} aria-label="층별 안내도">
    <div className="canvas-topbar"><div className="view-tabs"><button className={mode==='stack'?'active':''} onClick={()=>{setMode('stack');setEditing(false);setDrawing(false);setDrag(null)}}><Layers size={18}/> 층 쌓아 보기</button><button className={mode==='flat'?'active':''} onClick={enterFlat}><Scan size={18}/> 평면 보기</button><button className="area-add-button" disabled={!current?.image||!current?.planKey} onClick={startArea}>장소 영역 추가</button></div><span className="canvas-building">{building?.name||'건물 없음'}</span></div><label className="overview-toggle"><input type="checkbox" checked={showAllFloors} onChange={()=>{cancelDrawing();onToggleAllFloors()}}/>전체 병원 안내도 보기<span>{showAllFloors?'설치 여부와 관계없이 표시':'설치 목록에 있는 층만 표시'}</span></label>
    {editing||drawing?<div className="editing-banner"><MousePointer2 size={17}/><span>{drawing?'현재 안내도에서 장소의 영역을 드래그하세요.':'현장에서 확인한 실제 설치 지점을 클릭하세요.'}</span><button aria-label="위치 지정 취소" onClick={()=>{setEditing(false);setDrawing(false);setDrag(null)}}><X size={18}/></button></div>:<div className="canvas-caption">{mode==='stack'?'층을 선택해 안내도와 단말을 확인하세요.':'도면을 확대해 설치 위치를 확인하세요.'}</div>}
    <div ref={viewport} className={'map-viewport '+mode+(focusPoint?' has-focus':'')} data-focused-space={focusPoint?(selectedSpaceId||selectedId):undefined}>
      {!shown.length?<div className="canvas-empty"><Layers size={40}/><h2>{floorId==='unassigned'?'건물·층을 먼저 확인하세요':!site.devices.length&&!showAllFloors?'설치 목록이 없습니다':showAllFloors?'등록된 안내도가 없습니다':'이 건물의 설치 층이 없습니다'}</h2><p>{floorId==='unassigned'?'선택한 단말의 건물과 층을 확인하기 전에는 다른 층의 안내도를 표시하지 않습니다.':!showAllFloors?'엑셀의 실제 설치 목록에 포함된 층만 표시합니다. 병원 전체 도면은 위 옵션에서 별도로 볼 수 있습니다.':'현장 관리에서 건물과 층별 안내도를 등록하세요.'}</p>{floorId!=='unassigned'&&<button className="primary" onClick={onImportRequest}>설치 목록 엑셀 가져오기</button>}</div>: mode==='stack'?<><div className={'stack-scene '+(focusedStack?'context-stack':'')} aria-hidden={focusedStack?'true':undefined} inert={focusedStack?true:undefined} style={{width:sceneWidth,height:sceneHeight,transform:`scale(${fit*(focusedStack?1:zoom)}) rotate(${rotation}deg)`}}>
        {shown.map((floor,i)=><div className={'stack-layer '+(floor.id===floorId?'selected':'')} key={floor.id} style={{top:i*88-minY,width:sceneWidth,zIndex:shown.length-i}}>
          <button className="stack-floor-label" style={{left:0,top:minY+(maxY-minY)*.4}} onClick={()=>setFloor(floor.id)}>{floor.name}</button>
          <div className="stack-plane" style={{width:planeWidth,left:58-minX,aspectRatio:imageRatios[floor.id]||820/660,transform:'rotateX(62deg) rotateZ(-27deg)'}} role="button" tabIndex={0} aria-label={`${building?.name} ${floor.name} 안내도`} onClick={()=>setFloor(floor.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setFloor(floor.id)}}}>
            {floor.image?<img src={floor.image} alt={`${building?.name} ${floor.name} 안내도`} draggable="false" onLoad={e=>rememberRatio(floor.id,e.currentTarget)}/>:<div className="missing-plan" style={{minHeight:0,height:'100%'}}>{floor.name} · 안내도 없음</div>}
            <Places site={site} floor={floor} selectedSpaceId={selectedSpaceId} onSelectSpace={onSelectSpace} editing={editing}/><Markers site={site} floor={floor} selectedId={selectedId} onSelect={onSelect}/>
          </div>
        </div>)}
      </div>{focusedStack&&<div className="focused-stack-scene" style={{width:focusWidth,height:focusHeight,transform:`translate(-50%,-50%) translate(${panX}px,${panY}px) scale(${zoom})`}}><div className="focused-floor-label">{building?.name} {current.name} · 선택 장소</div><div className="focus-plane" style={{width:focusWidth,height:focusHeight,transform:`rotateX(48deg) rotateZ(${-20+rotation}deg)`}}>{current.image?<img src={current.image} alt={`${building?.name} ${current.name} 선택 안내도`} draggable="false" onLoad={e=>rememberRatio(current.id,e.currentTarget)}/>:<div className="missing-plan">안내도 없음</div>}<Places site={site} floor={current} selectedSpaceId={selectedSpaceId} onSelectSpace={onSelectSpace} editing={editing}/><Markers site={site} floor={current} selectedId={selectedId} onSelect={onSelect}/></div></div>}</>:<div className={'flat-stage '+(focusPoint?'focus-flat-stage':'')} style={focusPoint?{width:focusWidth,transform:`translate(-50%,-50%) translate(${flatPanX}px,${flatPanY}px) scale(${zoom}) rotate(${rotation}deg)`}:{transform:`scale(${zoom}) rotate(${rotation}deg)`}}>
        <div className="flat-floor-title"><strong>{building?.name} {current?.name}</strong><span>층별 안내도</span></div>
        <div className={'flat-map '+(editing?'placing':'')+(drawing?' drawing-area':'')} onPointerDown={e=>{if(!drawing)return;e.preventDefault();dragStart.current=pointOnMap(e);setDrag({...dragStart.current,width:0,height:0});e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{if(drawing&&dragStart.current)setDrag(dragBounds(dragStart.current,pointOnMap(e)))}} onPointerUp={e=>{if(!drawing||!dragStart.current)return;const bounds=dragBounds(dragStart.current,pointOnMap(e));dragStart.current=null;setDrag(null);if(bounds.width>.008&&bounds.height>.008){setDrawing(false);onAddArea(current,bounds)}}} onPointerCancel={()=>{dragStart.current=null;setDrag(null)}} onClick={e=>{if(!editing||!current?.image)return;const r=e.currentTarget.getBoundingClientRect();onPlace({x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))})}}>
          {current?.image?<img src={current.image} alt={`${building?.name} ${current.name} 안내도`} draggable="false" onLoad={e=>rememberRatio(current.id,e.currentTarget)}/>:<div className="missing-plan">이 층의 안내도 이미지가 없습니다.</div>}
          {drag&&drawing&&<div className="area-drag-preview" style={{left:`${drag.x*100}%`,top:`${drag.y*100}%`,width:`${drag.width*100}%`,height:`${drag.height*100}%`}}/>}{current&&<><Places site={site} floor={current} selectedSpaceId={selectedSpaceId} onSelectSpace={onSelectSpace} editing={editing||drawing}/>{!drawing&&<Markers site={site} floor={current} selectedId={selectedId} onSelect={onSelect}/>}</>} 
        </div>
      </div>}
    </div>
    <div className="canvas-bottom"><div className="map-legend"><span className="legend-dot"/> 직접 지정한 설치 위치 <span className="legend-outline"/> 현재 안내도 장소 영역</div><div className="map-controls"><button aria-label="축소" onClick={()=>{if(!drawing)setZoom(v=>Math.max(.5,v-.1))}}><ZoomOut size={18}/></button><span>{Math.round(zoom*100)}%</span><button aria-label="확대" onClick={()=>{if(!drawing)setZoom(v=>Math.min(2,v+.1))}}><ZoomIn size={18}/></button><i/><button aria-label="왼쪽 회전" disabled={editing||drawing} onClick={()=>setRotation(v=>v-15)}><RotateCcw size={18}/></button><span>{rotation}°</span><button aria-label="오른쪽 회전" disabled={editing||drawing} onClick={()=>setRotation(v=>v+15)}><RotateCw size={18}/></button><i/><button aria-label="보기 초기화" onClick={reset}>초기화</button></div></div>
    <p className="image-note">{current?.imageNote||'안내도는 실제 비율과 다를 수 있습니다. 위치는 직접 확인해 지정하세요.'}</p>
  </section>;
}
