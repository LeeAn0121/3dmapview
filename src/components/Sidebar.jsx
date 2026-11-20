import { Search, Monitor, MapPin, Layers, FileSpreadsheet, Link2, CircleAlert } from 'lucide-react';
import { useState } from 'react';

export default function Sidebar({site, buildingId, floorId, setBuilding, setFloor, query, setQuery, devices, selectedId, selectDevice, selectedSpaceId,selectSpace,showAllFloors,reviewFilter,setReviewFilter,onNextReview,openImport}) {
  const [listMode,setListMode]=useState('devices');
  const installedFloorIds=new Set(site.devices.map(d=>d.floorId).filter(Boolean));
  const spaces=(site.spaces||[]).filter(s=>(showAllFloors||installedFloorIds.has(s.floorId))&&s.geometryVersion===2&&s.planKey&&s.planKey===site.floors.find(f=>f.id===s.floorId)?.planKey).filter(s=>query.trim()?[s.name,...(s.aliases||[]),s.roomNumber||''].some(v=>v.toLowerCase().includes(query.trim().toLowerCase())):floorId==='all'?s.buildingId===buildingId:s.floorId===floorId);
  const filteredDevices=devices.filter(d=>reviewFilter==='linked'?d.spaceId&&d.match?.status==='matched':reviewFilter==='review'?d.match?.status!=='matched':true);
  const floors = site.floors.filter(f => f.buildingId === buildingId&&(showAllFloors||installedFloorIds.has(f.id))).sort((a,b) => b.order-a.order);
  return <aside className="sidebar" aria-label="건물과 단말 목록">
    <div className="building-tabs">{site.buildings.map(b => <button key={b.id} className={buildingId===b.id?'active':''} onClick={()=>setBuilding(b.id)}>{b.name}</button>)}</div>
    <div className="floor-heading"><span>{showAllFloors?'병원 안내도 층':'실제 설치 층'}</span><span>{floors.length}개 층</span></div>
    <nav className="floor-list" aria-label="층 선택">
      <button className={floorId==='all'?'active':''} onClick={()=>setFloor('all')}><span><Layers size={17}/> {showAllFloors?'전체 안내도 층':'전체 설치 층'}</span><small>{site.devices.filter(d=>d.buildingId===buildingId).length}</small></button>
      {floors.map(f=><button key={f.id} className={floorId===f.id?'active':''} onClick={()=>setFloor(f.id)}><span>{f.name}</span><small>{site.devices.filter(d=>d.floorId===f.id).length}</small></button>)}
      <button className={floorId==='unassigned'?'active':''} onClick={()=>setFloor('unassigned')}><span>건물·층 미확정</span><small>{site.devices.filter(d=>!d.floorId).length}</small></button>
    </nav>
    <div className="terminal-section">
      <label className="search-field"><Search size={18}/><input aria-label="단말 검색" placeholder="사진 ID, 장소, 상세 위치, IP 검색" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button aria-label="검색 지우기" onClick={()=>setQuery('')}>×</button>}</label>
      <div className="section-heading"><div className="list-tabs"><button className={listMode==='devices'?'active':''} onClick={()=>setListMode('devices')}>단말 목록</button><button className={listMode==='spaces'?'active':''} onClick={()=>setListMode('spaces')}>장소 목록</button></div><span>{listMode==='devices'?`${filteredDevices.length}대`:`${spaces.length}곳`}</span></div>
      {listMode==='devices'&&!site.isPublicDemo&&<div className="review-toolbar"><div className="review-filters">{[['all','전체'],['review','검토 필요'],['linked','연결됨']].map(([value,label])=><button key={value} className={reviewFilter===value?'active':''} onClick={()=>setReviewFilter(value)}>{label}</button>)}</div><button className="text-button" onClick={onNextReview}>다음 검토</button></div>}
      {query&&<p className="search-note">모든 건물과 층에서 검색합니다.</p>}
      <div className="terminal-list">{listMode==='devices'?(filteredDevices.length?filteredDevices.map(d=><button className={'terminal-row '+(d.id===selectedId?'selected':'')} key={d.id} onClick={()=>selectDevice(d)}><Monitor size={19}/><span><strong>{d.referenceId?`ID ${d.referenceId} · `:''}{d.location}</strong><small>{d.name}{d.detail?` · ${d.detail}`:''}</small><em className="row-match-label">{d.match?.status==='matched'?'장소 연결됨':d.match?.status==='review'||d.match?.status==='ambiguous'?'검토 필요':'장소 미연결'}{d.position?' · 직접 위치 있음':''}</em></span><span className={'position-indicator '+(d.position||d.spaceId?'mapped':'')} title={d.position?'설치 위치 직접 지정':d.spaceId?'장소 연결':'장소 미연결'}>{d.position?<MapPin size={14}/>:d.spaceId?<Link2 size={14}/>:<CircleAlert size={14}/>}</span></button>):<div className="empty-list">해당 조건의 단말이 없습니다.</div>):(spaces.length?spaces.map(s=><button className={'terminal-row '+(s.id===selectedSpaceId?'selected':'')} key={s.id} onClick={()=>selectSpace(s)}><MapPin size={19}/><span><strong>{s.name}</strong><small>{site.floors.find(f=>f.id===s.floorId)?.name} · {s.source==='manual-region'?'직접 지정 영역':'현재 안내도 글자'}</small></span></button>):<div className="empty-list">확인된 장소가 없습니다. 현재 안내도에 장소 영역을 추가하거나 글자를 분석하세요.</div>)}</div>
    </div>
    <button className="import-button" onClick={openImport}><FileSpreadsheet size={18}/> 엑셀 가져오기</button>
  </aside>;
}
