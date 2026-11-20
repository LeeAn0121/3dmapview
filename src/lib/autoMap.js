export function normalizePlaceName(value) {
  return String(value || '').normalize('NFKC').toUpperCase().replace(/[\s\-_.·•&()（）]/g, '');
}

function similarity(a, b) {
  if (!a || !b || a.length < 4 || b.length < 4 || a.slice(0, 2) !== b.slice(0, 2)) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(current[j-1]+1,previous[j]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));
    previous = current;
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}

export function matchPlace(device, spaces) {
  if (!device.floorId) return { status: 'unmatched', reason: '건물·층 미확정' };
  const candidates = spaces.filter(s => s.floorId === device.floorId && s.position);
  const label = device.location || device.name;
  const parts = String(label || '').split(/\s*[+\n]\s*/).filter(Boolean);
  const queries = [...new Set([label, ...parts].map(normalizePlaceName).filter(Boolean))];
  const scored = candidates.map(space => {
    const names = [space.name, ...(space.aliases || [])].map(normalizePlaceName);
    let score = 0, method = 'exact';
    for (const query of queries) {
      for (let i = 0; i < names.length; i++) {
        const exact = query === names[i];
        let candidate = exact ? (i === 0 ? 1 : .94) : similarity(query, names[i]) * .91;
        if (parts.length > 1 && query !== normalizePlaceName(label)) candidate *= .9;
        if (candidate > score) { score = candidate; method = exact ? (parts.length > 1 ? 'group' : i === 0 ? 'exact' : 'alias') : 'fuzzy'; }
      }
    }
    return { space, score, method };
  }).filter(c => c.score >= .78).sort((a,b)=>b.score-a.score || a.space.id.localeCompare(b.space.id));
  if (!scored.length) return { status: 'unmatched', reason: '안내도에서 대응 장소를 찾지 못했습니다.' };
  // A compound installation group is represented by its first named department.
  if (parts.length > 1 && scored.length > 1) {
    const primary = scored.find(c => [c.space.name,...(c.space.aliases || [])].map(normalizePlaceName).includes(normalizePlaceName(parts[0])));
    if (primary) scored.splice(0, scored.length, primary);
  }
  const best = scored[0], next = scored[1];
  if (next && best.score-next.score < .055 && Math.hypot(best.space.position.x-next.space.position.x,best.space.position.y-next.space.position.y) > .025) {
    return { status: 'ambiguous', reason: '동일하거나 유사한 장소가 여러 곳입니다.', candidates: scored.slice(0,3).map(c=>c.space.id) };
  }
  return { status: 'matched', spaceId: best.space.id, position: { ...best.space.position },
    confidence: Math.min(best.score, best.space.confidence ?? .85), method: best.method, label: best.space.name,
    source: best.space.source || 'ocr' };
}

export function autoMapSite(input, { includeCleared = false } = {}) {
  const site = structuredClone(input), stats = { matched: 0, unmatched: 0, ambiguous: 0, manual: 0 };
  const spaces = site.spaces || [];
  site.devices = site.devices.map(device => {
    if (!includeCleared && device.match?.method === 'manual-clear') { stats.unmatched++; return device; }
    if (device.position && device.positionSource !== 'auto') { stats.manual++; return device; }
    const match = matchPlace(device, spaces);
    stats[match.status === 'matched' ? 'matched' : match.status === 'ambiguous' ? 'ambiguous' : 'unmatched']++;
    const result = { ...device, match };
    if (match.status === 'matched') return { ...result, position: match.position, spaceId: match.spaceId, positionSource: 'auto' };
    if (device.positionSource === 'auto') return { ...result, position: null, spaceId: null, positionSource: null };
    return result;
  });
  return { site, stats, warnings: stats.unmatched || stats.ambiguous ? [`미매칭 ${stats.unmatched}대 · 중복 후보 ${stats.ambiguous}대는 확인이 필요합니다.`] : [] };
}
