import { autoMapSite } from './autoMap.js';
import { hydrateSite } from './storage.js';
import { createEmptySite } from './model.js';

export function assetUrl(path) {
  return path?.startsWith('catalog/') ? `${import.meta.env.BASE_URL}${path}` : path;
}

export async function loadPublicCatalog() {
  const response = await fetch(`${import.meta.env.BASE_URL}catalog/site.json`);
  if (!response.ok) throw new Error('공개 장소 카탈로그를 불러오지 못했습니다.');
  return response.json();
}

export function attachPublicSpaces(site, catalog) {
  if (site.id !== catalog?.id) return site;
  const compatibleFloors = new Set(site.floors.filter(f => f.imageOrigin !== 'custom' && !f.imageNote?.startsWith('현장에서 등록한')).map(f=>f.id));
  const additions=catalog.spaces.filter(s=>compatibleFloors.has(s.floorId));
  const officialIds = new Set(additions.map(s => s.id));
  return { ...site, spaces: [...(site.spaces || []).filter(s => !officialIds.has(s.id)), ...additions] };
}

export async function loadInitialSite() {
  let catalog;
  try { catalog = await loadPublicCatalog(); } catch { catalog = null; }
  if (import.meta.env.DEV) {
    try {
      const response = await fetch('/local-data/site.json');
      if (response.ok) {
        const raw = attachPublicSpaces(await response.json(), catalog);
        return { site: autoMapSite(await hydrateSite(raw)).site, catalog };
      }
    } catch { /* Public catalog remains available if local data is absent. */ }
  }
  if (catalog) return { site: await hydrateSite(catalog), catalog };
  return { site: createEmptySite('새 현장'), catalog: null };
}
