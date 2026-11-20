import { get, set } from 'idb-keyval';
import { validateSite, imageIsAllowed } from './model.js';
export { validateSite } from './model.js';

const KEY = 'floor-atlas-workspace-v1';
export async function loadWorkspace() {
  const workspace = await get(KEY);
  if (!workspace) return null;
  if (!Array.isArray(workspace.sites) || !workspace.sites.length) throw new Error('저장된 현장 데이터 형식이 잘못되었습니다.');
  return { sites: workspace.sites.map(validateSite), activeSiteId: workspace.activeSiteId };
}
export async function saveWorkspace(workspace) { await set(KEY, workspace); }

async function asDataUrl(url, cache) {
  if (!url || url.startsWith('data:')) return url;
  if (!imageIsAllowed(url)) throw new Error('허용되지 않은 이미지 주소입니다.');
  if (!cache.has(url)) cache.set(url, (async () => {
    const response = await fetch(url.startsWith('catalog/') ? `${import.meta.env.BASE_URL}${url}` : url);
    if (!response.ok) throw new Error('현장 이미지 파일을 읽지 못했습니다. 로컬 서버가 실행 중인지 확인해 주세요.');
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob);
    });
  })());
  return cache.get(url);
}

export async function hydrateSite(site) {
  const result = validateSite(site); const cache = new Map();
  await Promise.all([
    ...result.floors.map(async floor => { floor.image = await asDataUrl(floor.image, cache); }),
    ...result.devices.map(async device => { device.photos = await Promise.all((device.photos || []).map(p => asDataUrl(p, cache))); }),
  ]);
  return result;
}

export async function downloadSite(site) {
  const portable = await hydrateSite(site);
  const blob = new Blob([JSON.stringify(portable)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = `${site.name.replace(/[\\/:*?"<>|]/g, '_')}-현장.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
