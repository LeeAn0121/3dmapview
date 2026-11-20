import { Search, Monitor, MapPin, Layers, FileSpreadsheet } from 'lucide-react';
import { useState } from 'react';

export default function Sidebar({site, buildingId, floorId, setBuilding, setFloor, query, setQuery, devices, selectedId, selectDevice, selectedSpaceId,selectSpace,openImport}) {
  const [listMode,setListMode]=useState('devices');
  const spaces=(site.spaces||[]).filter(s=>query.trim()?[s.name,...(s.aliases||[])].some(v=>v.toLowerCase().includes(query.trim().toLowerCase())):floorId==='all'?s.buildingId===buildingId:s.floorId===floorId);
  const floors = site.floors.filter(f => f.buildingId === buildingId).sort((a,b) => b.order-a.order);
  return <aside className="sidebar" aria-label="건물과 단말 목록">
    <div className="building-tabs">{site.buildings.map(b => <button key={b.id} className={buildingId===b.id?'active':''} onClick={()=>setBuilding(b.id)}>{b.name}</button>)}</div>
    <div className="floor-heading"><span>층 선택</span><span>{floors.length}개 층</span></div>
    <nav className="floor-list" aria-label="층 선택">
      <button className={floorId==='all'?'active':''} onClick={()=>setFloor('all')}><span><Layers size={17}/> 전체 층</span><small>{site.devices.filter(d=>d.buildingId===buildingId).length}</small></button>
      {floors.map(f=><button key={f.id} className={floorId===f.id?'active':''} onClick={()=>setFloor(f.id)}><span>{f.name}</span><small>{site.devices.filter(d=>d.floorId===f.id).length}</small></button>)}
      <button className={floorId==='unassigned'?'active':''} onClick={()=>setFloor('unassigned')}><span>건물·층 미확정</span><small>{site.devices.filter(d=>!d.floorId).length}</small></button>
    </nav>
    <div className="terminal-section">
      <label className="search-field"><Search size={18}/><input aria-label="단말 검색" placeholder="단말명, 설치 장소, IP 검색" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button aria-label="검색 지우기" onClick={()=>setQuery('')}>×</button>}</label>
      <div className="section-heading"><div className="list-tabs"><button className={listMode==='devices'?'active':''} onClick={()=>setListMode('devices')}>{site.isPublicDemo?'공개 장소':'단말 목록'}</button><button className={listMode==='spaces'?'active':''} onClick={()=>setListMode('spaces')}>장소 목록</button></div><span>{listMode==='devices'?`${devices.length}${site.isPublicDemo?'곳':'대'}`:`${spaces.length}곳`}</span></div>
      {query&&<p className="search-note">모든 건물과 층에서 검색합니다.</p>}
      <div className="terminal-list">{listMode==='devices'?(devices.length?devices.map(d=><button className={'terminal-row '+(d.id===selectedId?'selected':'')} key={d.id} onClick={()=>selectDevice(d)}><Monitor size={19}/><span><strong>{d.location}</strong><small>{d.name}</small></span><span className={'position-indicator '+(d.position?'mapped':'')+(d.positionSource==='auto'?' estimated':'')} title={d.position?(d.positionSource==='auto'?'자동 추정':'직접 지정'):'위치 미지정'}><MapPin size={14}/></span></button>):<div className="empty-list">표시할 단말이 없습니다.</div>):(spaces.length?spaces.map(s=><button className={'terminal-row '+(s.id===selectedSpaceId?'selected':'')} key={s.id} onClick={()=>selectSpace(s)}><MapPin size={19}/><span><strong>{s.name}</strong><small>{site.floors.find(f=>f.id===s.floorId)?.name} · {s.source==='ocr'?'이미지 분석':'공식 안내도'}</small></span></button>):<div className="empty-list">분석된 장소가 없습니다. 현장 관리에서 안내도를 분석할 수 있습니다.</div>)}</div>
    </div>
    <button className="import-button" onClick={openImport}><FileSpreadsheet size={18}/> 엑셀 가져오기</button>
  </aside>;
}
