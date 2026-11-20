import { useEffect, useRef, useState } from 'react';
import { X, Plus, Upload, FileSpreadsheet } from 'lucide-react';
import { createEmptySite, floorName } from '../lib/model.js';

export function Modal({title,onClose,children,wide=false}) {
  const ref=useRef(null);useEffect(()=>{ref.current?.showModal()},[]);
  return <dialog ref={ref} className={'modal '+(wide?'wide':'')} onCancel={onClose} onClick={e=>{if(e.target===ref.current)onClose()}}><div className="modal-header"><h2>{title}</h2><button className="icon-button" aria-label="닫기" onClick={onClose}><X size={21}/></button></div>{children}</dialog>;
}

function readImage(file) {
  return new Promise((resolve,reject)=>{if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type))return reject(new Error('PNG, JPG, WebP 이미지 파일을 선택하세요.'));if(file.size>15*1024*1024)return reject(new Error('이미지는 15MB 이하로 등록하세요.'));const r=new FileReader();r.onerror=()=>reject(new Error('이미지를 읽을 수 없습니다.'));r.onload=()=>resolve(r.result);r.readAsDataURL(file)});
}

export function SiteManager({site,sites,onClose,onAddSite,onUpdateSite,onSwitchSite,onImportJSON}) {
  const [siteName,setSiteName]=useState('');const [buildingName,setBuildingName]=useState('');const [building,setBuilding]=useState(site.buildings[0]?.id||'');const [level,setLevel]=useState('');const [image,setImage]=useState(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [analysisStatus,setAnalysisStatus]=useState('');const [analyzeImage,setAnalyzeImage]=useState(true);
  const addBuilding=e=>{e.preventDefault();if(!buildingName.trim())return;const b={id:crypto.randomUUID(),name:buildingName.trim()};if(site.buildings.some(x=>x.name===b.name)){setError('동일한 건물이 있습니다.');return}onUpdateSite({...site,buildings:[...site.buildings,b]});setBuilding(b.id);setBuildingName('');setError('')};
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
  const closeManager=()=>{alive.current=false;onClose()};
  const addFloor=async e=>{
    e.preventDefault();if(busy)return;
    const form=e.currentTarget;setError('');setAnalysisStatus('');setBusy(true);
    try{
      const name=floorName(level);if(!building||!name)throw new Error('건물과 층을 입력하세요.');
      const existing=site.floors.find(f=>f.buildingId===building&&f.name===name);
      const img=image?await readImage(image):existing?.image||null;
      if(!alive.current)return;
      const order=name.startsWith('B')?-parseInt(name.slice(1)):parseInt(name);
      if(!Number.isFinite(order))throw new Error('층은 B1 또는 1F처럼 입력하세요.');
      const f={...(existing||{}),id:existing?.id||crypto.randomUUID(),buildingId:building,name,order,image:img,imageOrigin:image?'custom':existing?.imageOrigin,imageNote:image?'현장에서 등록한 안내도입니다.':existing?.imageNote||'현장에서 등록한 안내도입니다.'};
      let spaces=image?(site.spaces||[]).filter(s=>s.floorId!==f.id):[...(site.spaces||[])];
      if(analyzeImage&&img){
        try{
          setAnalysisStatus('장소 분석 중…');
          const {analyzeFloorImage}=await import('../lib/imageAnalysis.js');
          if(!alive.current)return;
          const found=await analyzeFloorImage({image:img,floor:f,onProgress:p=>{
            if(!alive.current)return;
            if(typeof p==='string'){setAnalysisStatus(p);return}
            const n=typeof p==='number'?p:p?.progress;
            setAnalysisStatus(Number.isFinite(n)?`장소 분석 중… ${Math.round(n*100)}%`:'장소 분석 중…');
          }});
          if(!alive.current)return;
          spaces=[...spaces.filter(s=>s.floorId!==f.id),...found];
          setAnalysisStatus(`안내도 저장 완료 · 장소 ${found.length}곳 분석`);
        }catch(err){
          if(!alive.current)return;
          setAnalysisStatus('안내도는 저장했습니다. 장소 분석에 실패해 직접 위치를 지정할 수 있습니다.');setError('장소 분석: '+err.message);
        }
      }
      if(!alive.current)return;
      onUpdateSite({...site,spaces,floors:existing?site.floors.map(x=>x.id===f.id?f:x):[...site.floors,f]});
      setLevel('');setImage(null);form.reset();
    }catch(e){if(alive.current)setError(e.message)}finally{if(alive.current)setBusy(false)}
  };
  return <Modal title="현장 관리" onClose={closeManager} wide><div className="modal-body manager-body"><fieldset className="manager-controls" disabled={busy}><section><h3>현장 전환</h3><label>저장된 현장<select value={site.id} onChange={e=>{onSwitchSite(e.target.value);onClose()}}>{sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><form className="inline-form" onSubmit={e=>{e.preventDefault();if(siteName.trim()){onAddSite(createEmptySite(siteName.trim()));onClose()}}}><label>새 현장명<input value={siteName} onChange={e=>setSiteName(e.target.value)} placeholder="새 병원 또는 현장 이름" required/></label><button className="secondary" type="submit"><Plus size={16}/>현장 추가</button></form><label className="file-button"><Upload size={16}/> 저장한 현장 JSON 불러오기<input type="file" accept="application/json,.json" onChange={e=>{if(e.target.files[0])onImportJSON(e.target.files[0]).then(onClose).catch(err=>setError(err.message))}}/></label></section>
    <section><h3>{site.name} · 건물과 안내도</h3><form className="inline-form" onSubmit={addBuilding}><label>건물명<input placeholder="본관, 별관 등" value={buildingName} onChange={e=>setBuildingName(e.target.value)} required/></label><button className="secondary" type="submit"><Plus size={16}/>건물 추가</button></form><form onSubmit={addFloor} className="floor-form"><div className="form-grid"><label>건물<select value={building} onChange={e=>setBuilding(e.target.value)} required><option value="">건물 선택</option>{site.buildings.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label>층<input placeholder="B1, 1F, 2F" value={level} onChange={e=>setLevel(e.target.value)} required/></label></div><label>안내도 이미지<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>setImage(e.target.files[0]||null)}/></label><label className="analysis-checkbox"><input type="checkbox" checked={analyzeImage} onChange={e=>setAnalyzeImage(e.target.checked)}/>이미지에서 장소명 자동 분석</label><p className="hint">같은 건물·층을 입력하면 안내도를 교체합니다. 이미지 교체 후 단말 위치를 다시 확인하세요.</p><button disabled={busy||!site.buildings.length} className="primary" type="submit">{busy?'처리 중…':'층·안내도 저장'}</button>{analysisStatus&&<p role="status" className="hint">{analysisStatus}</p>}</form><div className="registered-floors">{site.buildings.map(b=><div key={b.id}><strong>{b.name}</strong><span>{site.floors.filter(f=>f.buildingId===b.id).sort((a,b)=>b.order-a.order).map(f=>f.name+(f.image?'':' (이미지 없음)')).join(' · ')||'등록된 층 없음'}</span></div>)}</div></section>{error&&<p role="alert" className="error-message">{error}</p>}</fieldset></div></Modal>;
}

const fieldLabels={building:'건물',floor:'층',location:'설치 장소',name:'단말명',ip:'IP 주소',switch:'스위치',port:'포트',kind:'종류'};
function guessMapping(headers) {
 const found={};const patterns={building:/건물|동명/,floor:/^층$|층별|건물.*층/,location:/설치.*위치|설치.*장소|장소|진료/,name:/단말기?\s*이름|단말명|단말기명/,ip:/사용.*IP|단말기IP|IP주소|^IP$/i,switch:/스위치/,port:/연동 포트|^포트$/,kind:/종류|구분/};
 for(const [k,re] of Object.entries(patterns)){const i=headers.findIndex(h=>re.test(String(h)));found[k]=i<0?null:i}if(found.building==null&&found.floor!=null)found.building=found.floor;return found;
}
export function WorkbookImport({site,onClose,onImported}) {
 const [inspection,setInspection]=useState(null);const [sheet,setSheet]=useState('');const [headerRow,setHeaderRow]=useState(1);const [mapping,setMapping]=useState({});const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [filename,setFilename]=useState('');const [replaceConfirmed,setReplaceConfirmed]=useState(false);
 const rows=inspection?.sheets.find(s=>s.name===sheet)?.rows||[];const headers=rows[headerRow-1]||[];
 const load=async file=>{if(!file)return;setBusy(true);setError('');try{const {inspectWorkbook}=await import('../lib/workbook.js');const data=await inspectWorkbook(file);setInspection(data);setFilename(file.name);const first=data.sheets[0];setSheet(first.name);const idx=first.rows.findIndex(r=>r.some(v=>/설치.*위치|설치.*장소|단말명|단말기.*이름/.test(String(v))));const hr=idx>=0?idx+1:1;setHeaderRow(hr);setMapping(guessMapping(first.rows[hr-1]||[]))}catch(e){setError(e.message)}finally{setBusy(false)}};
 const changeSheet=name=>{setSheet(name);setHeaderRow(1);setMapping(guessMapping(inspection.sheets.find(s=>s.name===name)?.rows[0]||[]))};
 const submit=async()=>{if(!replaceConfirmed)return;setBusy(true);setError('');try{const {importSheet}=await import('../lib/workbook.js');const result=await importSheet({inspection,sheetName:sheet,headerRow,mapping},site);onImported(result);onClose()}catch(e){setError(e.message)}finally{setBusy(false)}};
 return <Modal title="엑셀 단말 목록 가져오기" onClose={onClose} wide><div className="modal-body"><p className="modal-intro">엑셀의 열을 연결해 단말을 가져옵니다. 파일은 이 브라우저에서만 처리됩니다.</p><label className="upload-area"><FileSpreadsheet size={28}/><strong>{filename||'XLSX 파일 선택'}</strong><span>현장마다 다른 열 구성을 지정할 수 있습니다.</span><input type="file" accept=".xlsx" onChange={e=>load(e.target.files[0])}/></label>{inspection&&<><div className="form-grid"><label>시트<select value={sheet} onChange={e=>changeSheet(e.target.value)}>{inspection.sheets.map(s=><option key={s.name}>{s.name}</option>)}</select></label><label>제목 행 번호<input type="number" min="1" max={Math.max(1,rows.length)} value={headerRow} onChange={e=>{const n=Number(e.target.value);setHeaderRow(n);setMapping(guessMapping(rows[n-1]||[]))}}/></label></div><div className="mapping-grid">{Object.entries(fieldLabels).map(([key,label])=><label key={key}>{label}<select value={mapping[key]??''} onChange={e=>setMapping({...mapping,[key]:e.target.value===''?null:Number(e.target.value)})}><option value="">연결 안 함</option>{headers.map((h,i)=><option key={i} value={i}>{String.fromCharCode(65+i)} · {h||'(빈 제목)'}</option>)}</select></label>)}</div><p className="hint">설치 장소 또는 단말명 중 하나 이상 연결하세요. 건물·층이 하나의 열에 있으면 ‘층’에 연결하세요. 빈 건물·층 셀은 앞 행의 값을 이어받습니다. 기존 단말과 겹치는 이름은 가져오기 결과에서 안내합니다.</p><div className="preview-table"><table><caption>미리보기 · 첫 5개 행</caption><thead><tr>{headers.slice(0,8).map((h,i)=><th key={i}>{h||String.fromCharCode(65+i)}</th>)}</tr></thead><tbody>{rows.slice(headerRow,headerRow+5).map((r,i)=><tr key={i}>{headers.slice(0,8).map((_,j)=><td key={j}>{r[j]||''}</td>)}</tr>)}</tbody></table></div></>}{inspection&&<label className="replace-confirmation"><input type="checkbox" checked={replaceConfirmed} onChange={e=>setReplaceConfirmed(e.target.checked)}/><span>현재 현장의 {site.isPublicDemo?'공개 장소':'단말'} {site.devices.length}{site.isPublicDemo?'곳':'대'}를 선택한 시트의 목록으로 교체합니다. 시트에 없는 단말은 제외되며, 같은 단말명의 참고 사진과 동일 층 위치는 유지됩니다. 교체에 동의합니다.</span></label>}{error&&<p className="error-message" role="alert">{error}</p>}<div className="modal-actions"><button className="secondary" onClick={onClose}>취소</button><button className="primary" disabled={!inspection||busy||!replaceConfirmed||(mapping.name==null&&mapping.location==null)} onClick={submit}>{busy?'처리 중…':'단말 가져오기'}</button></div></div></Modal>;
}
