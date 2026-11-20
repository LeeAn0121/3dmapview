export function floorName(value) {
  const text = String(value ?? '').normalize('NFKC').trim().toUpperCase();
  const basement = text.match(/지하\s*(\d+)/) || text.match(/(?:^|[^A-Z0-9])B\s*(\d+)(?:F|층)?(?=$|[\s()[\],])/);
  if (basement) return `B${Number(basement[1])}`;
  const above = text.match(/(?:지상\s*)?(\d+)\s*(?:F|층)/) || text.match(/^(\d+)$/);
  return above ? `${Number(above[1])}F` : null;
}

export function floorOrder(name) {
  return name?.startsWith('B') ? -Number(name.slice(1)) : Number(name?.replace('F', '')) || 0;
}

export function matchFloor(site, buildingText, floorText) {
  const text = String(buildingText ?? '').trim();
  const building = site.buildings.find(b => b.name === text)
    || [...site.buildings].sort((a, b) => b.name.length - a.name.length).find(b => text.includes(b.name));
  const name = floorName(floorText) || floorName(buildingText);
  return site.floors.find(f => f.buildingId === building?.id && f.name === name) || null;
}

export function countDevices(site, floorId) {
  return site.devices.filter(d => d.floorId === floorId).length;
}

export function createEmptySite(name) {
  return { version: 1, matchingVersion: 2, id: crypto.randomUUID(), name: String(name).trim() || '새 현장', buildings: [], floors: [], spaces: [], matchingRules: [], devices: [], sources: [], warnings: [] };
}

export function imageIsAllowed(value) {
  return value == null || (typeof value === 'string' && (
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(value)
    || /^\/local-data\/(maps|photos)\/[a-zA-Z0-9_.-]+$/.test(value)
    || /^catalog\/maps\/[a-zA-Z0-9_.-]+$/.test(value)
  ));
}

export function validateSite(input) {
  if (!input || input.version !== 1 || typeof input.id !== 'string' || !input.id || typeof input.name !== 'string' || !input.name.trim()) throw new Error('지원하는 현장 파일 형식(version 1)이 아닙니다.');
  for (const key of ['buildings', 'floors', 'devices']) {
    if (!Array.isArray(input[key]) || input[key].length > 10000) throw new Error(`${key} 데이터가 올바르지 않습니다.`);
    const ids = new Set();
    for (const item of input[key]) {
      if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.name !== 'string') throw new Error(`${key}의 ID 또는 이름이 잘못되었거나 중복됩니다.`);
      ids.add(item.id);
    }
  }
  const buildings = new Set(input.buildings.map(b => b.id));
  const floors = new Map(input.floors.map(f => [f.id, f]));
  for (const floor of input.floors) {
    if (!buildings.has(floor.buildingId) || !Number.isFinite(floor.order) || !imageIsAllowed(floor.image)) throw new Error('층의 건물·순서·안내도 정보가 잘못되었습니다.');
    if (floor.imageNote != null && typeof floor.imageNote !== 'string') throw new Error('층 안내 문구 형식이 잘못되었습니다.');
    if (floor.planKey != null && !/^[a-f0-9]{64}$/.test(floor.planKey)) throw new Error('안내도 이미지 식별 정보가 잘못되었습니다.');
  }
  for (const device of input.devices) {
    for (const key of ['location', 'kind', 'ip', 'switch', 'port', 'subnet', 'gateway', 'dns', 'notes', 'photoMatch', 'sourceSheet']) {
      if (device[key] != null && typeof device[key] !== 'string') throw new Error(`단말 ${key} 항목은 문자열이어야 합니다.`);
    }
    if (device.buildingId != null && !buildings.has(device.buildingId)) throw new Error('단말의 건물 정보가 잘못되었습니다.');
    if (device.floorId != null && (!floors.has(device.floorId) || floors.get(device.floorId).buildingId !== device.buildingId)) throw new Error('단말의 건물과 층이 일치하지 않습니다.');
    if (device.position != null && (!device.floorId || !Number.isFinite(device.position.x) || !Number.isFinite(device.position.y) || device.position.x < 0 || device.position.x > 1 || device.position.y < 0 || device.position.y > 1)) throw new Error('단말 위치는 지정된 층의 0~1 좌표여야 합니다.');
    if (device.photos != null && (!Array.isArray(device.photos) || !device.photos.every(imageIsAllowed))) throw new Error('지원하지 않는 사진 주소가 있습니다.');
  }
  if (input.spaces != null) {
    if (!Array.isArray(input.spaces) || input.spaces.length > 20000) throw new Error('장소 데이터 형식이 잘못되었습니다.');
    const ids = new Set();
    for (const space of input.spaces) {
      if (!space || typeof space.id !== 'string' || ids.has(space.id) || typeof space.name !== 'string' || !floors.has(space.floorId) || floors.get(space.floorId).buildingId !== space.buildingId) throw new Error('장소의 이름·건물·층을 확인해 주세요.');
      ids.add(space.id);
      if (!space.position || ![space.position.x,space.position.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1)) throw new Error('장소 좌표가 잘못되었습니다.');
      if (space.aliases != null && (!Array.isArray(space.aliases) || !space.aliases.every(a=>typeof a==='string'))) throw new Error('장소 별칭 형식이 잘못되었습니다.');
      if (space.bounds && !['x','y','width','height'].every(k=>Number.isFinite(space.bounds[k])&&space.bounds[k]>=0&&space.bounds[k]<=1)) throw new Error('장소 영역 형식이 잘못되었습니다.');
      if (space.bounds && (space.bounds.x+space.bounds.width>1.00001 || space.bounds.y+space.bounds.height>1.00001)) throw new Error('장소 영역이 안내도 밖에 있습니다.');
      if (space.geometryVersion === 2 && !/^[a-f0-9]{64}$/.test(space.planKey || '')) throw new Error('장소와 원본 안내도의 연결 정보가 없습니다.');
      if (space.roomNumber != null && typeof space.roomNumber !== 'string') throw new Error('방 번호는 문자열이어야 합니다.');
    }
  }
  if (input.matchingRules != null && (!Array.isArray(input.matchingRules) || input.matchingRules.length>20000 || !input.matchingRules.every(r=>r&&typeof r.inputLabel==='string'&&typeof r.spaceId==='string'&&floors.has(r.floorId)&&/^[a-f0-9]{64}$/.test(r.planKey||'')))) throw new Error('현장 매칭 규칙 형식이 잘못되었습니다.');
  if (input.warnings != null && (!Array.isArray(input.warnings) || !input.warnings.every(w => typeof w === 'string'))) throw new Error('현장 안내 문구 형식이 잘못되었습니다.');
  if (input.sources != null && (!Array.isArray(input.sources) || !input.sources.every(s => s && typeof s.name === 'string' && (s.url == null || (typeof s.url === 'string' && /^https:\/\//.test(s.url)))))) throw new Error('출처 정보 형식이 잘못되었습니다.');
  return structuredClone(input);
}
