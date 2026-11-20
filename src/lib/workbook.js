import { floorName, floorOrder } from './model.js';

function cellText(cell) {
  const value = cell?.value;
  if (value == null) return '';
  if (typeof value === 'object') {
    if (value.richText) return value.richText.map(p => p.text).join('');
    if ('result' in value) return String(value.result ?? '');
    if ('text' in value) return String(value.text ?? '');
    return '';
  }
  return String(value).trim();
}

export async function inspectWorkbook(file) {
  if (!file || file.size > 80 * 1024 * 1024) throw new Error('엑셀은 80MB 이하의 .xlsx 파일을 선택해 주세요.');
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(await file.arrayBuffer()); }
  catch { throw new Error('엑셀 파일을 열 수 없습니다. 암호가 없는 .xlsx 파일인지 확인해 주세요.'); }
  const sheets = workbook.worksheets.map(sheet => {
    if (sheet.rowCount > 20000 || sheet.columnCount > 300) throw new Error('시트는 20,000행, 300열 이하로 준비해 주세요.');
    return { name: sheet.name, rows: Array.from({ length: sheet.rowCount }, (_, ri) => {
      const row = sheet.getRow(ri + 1);
      return Array.from({ length: sheet.columnCount }, (_, ci) => cellText(row.getCell(ci + 1)));
    }) };
  });
  return { sheets, workbook };
}

export async function importSheet({ inspection, sheetName, headerRow, mapping }, site) {
  const sheet = inspection.sheets.find(s => s.name === sheetName);
  if (!sheet || !Number.isInteger(headerRow) || headerRow < 1 || headerRow >= sheet.rows.length) throw new Error('시트와 헤더 행을 확인해 주세요.');
  if (mapping.location == null && mapping.name == null) throw new Error('설치 장소 또는 단말명 열을 지정해 주세요.');
  const buildings = structuredClone(site.buildings), floors = structuredClone(site.floors), devices = [], warnings = [];
  let lastBuilding = '', lastFloor = ''; const consumed = new Set();
  for (let i = headerRow; i < sheet.rows.length; i++) {
    const row = sheet.rows[i];
    const read = key => mapping[key] == null ? '' : String(row[mapping[key]] ?? '').trim();
    const location = read('location'), name = read('name') || location;
    if (!name) continue;
    if (/^(합계|총계|소계|계)$/.test(name)) continue;
    const buildingCell = read('building') || (mapping.building == null ? read('floor') : ''), floorCell = read('floor');
    if (buildingCell) lastBuilding = buildingCell;
    if (floorCell) lastFloor = floorCell;
    // An explicit new group with no floor must not inherit the preceding group's floor.
    if (buildingCell && mapping.building === mapping.floor) lastFloor = buildingCell;
    const floorLabel = floorName(lastFloor) || floorName(lastBuilding);
    let building = buildings.find(b => b.name === lastBuilding) || [...buildings].sort((a,b) => b.name.length-a.name.length).find(b => lastBuilding.includes(b.name));
    if (!building && lastBuilding) {
      const buildingLabel = lastBuilding.replace(/\([^)]*\)/g, '').replace(/(?:지하\s*|B\s*)\d+|(?:지상\s*)?\d+\s*(?:F|층)/gi, '').trim();
      if (buildingLabel && (mapping.building !== mapping.floor || floorLabel)) {
        building = { id: crypto.randomUUID(), name: buildingLabel }; buildings.push(building);
      }
    }
    if (!building && buildings.length === 1 && (!lastBuilding || (floorLabel && !lastBuilding.replace(/\([^)]*\)/g, '').replace(/(?:지하\s*|B\s*)\d+|(?:지상\s*)?\d+\s*(?:F|층)/gi, '').trim()))) building = buildings[0];
    let floor = building && floorLabel ? floors.find(f => f.buildingId === building.id && f.name === floorLabel) : null;
    if (!floor && building && floorLabel) {
      floor = { id: crypto.randomUUID(), buildingId: building.id, name: floorLabel, order: floorOrder(floorLabel), image: null };
      floors.push(floor);
    }
    const oldMatches = site.devices.filter(d => d.name === name && !consumed.has(d.id));
    const old = oldMatches.length === 1 ? oldMatches[0] : null;
    if (old) consumed.add(old.id);
    devices.push({ ...(old || {}), id: old?.id || crypto.randomUUID(), name, location, kind: read('kind') || old?.kind || '셋톱박스',
      buildingId: building?.id || null, floorId: floor?.id || null,
      ip: read('ip'), switch: read('switch'), port: read('port'),
      position: old?.floorId === floor?.id ? old?.position || null : null,
      positionSource: old?.floorId === floor?.id ? old?.positionSource || null : null,
      spaceId: old?.floorId === floor?.id ? old?.spaceId || null : null,
      match: old?.floorId === floor?.id ? old?.match || null : null,
      photos: old?.photos || [], notes: old?.notes || '', sourceSheet: sheetName, sourceRow: i + 1 });
  }
  if (!devices.length) throw new Error('가져올 단말이 없습니다. 헤더 행과 열 연결을 확인해 주세요.');
  const names = new Map(); devices.forEach(d => names.set(d.name, (names.get(d.name) || 0) + 1));
  const duplicates = [...names.values()].filter(n => n > 1).length;
  if (duplicates) warnings.push(`중복 단말명이 ${duplicates}종 있습니다. 별도 항목으로 가져왔습니다.`);
  const unassigned = devices.filter(d => !d.floorId).length;
  if (unassigned) warnings.push(`${unassigned}대의 건물·층을 확인해 주세요.`);
  warnings.push('선택한 시트의 목록으로 교체했습니다. 같은 단말명의 사진과 동일 층 위치는 유지됩니다.');
  return { devices, floors, buildings, warnings };
}
