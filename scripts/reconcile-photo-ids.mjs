// Local-only reconciliation. Never add the input/output hospital records to public/.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { autoMapSite } from '../src/lib/autoMap.js';
import { validateSite } from '../src/lib/model.js';

const [sourcePath, manifestPath, outputDir] = process.argv.slice(2);
if (!sourcePath || !manifestPath || !outputDir) throw new Error('Usage: node scripts/reconcile-photo-ids.mjs source.json reviewed-ids.json output-directory');
const source = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const byId = new Map(source.devices.map(d => [d.id, d]));
const seen = new Set();
const networkFields = ['ip', 'switch', 'port', 'subnet', 'gateway', 'dns'];
const site = structuredClone(source);
site.id = `${source.id}-photo-reviewed`;
site.name = `${source.name} · 사진 ID 대조`;
site.isPublicDemo = false;
site.devices = manifest.entries.map(([referenceId, sourceIds, detail, photo, referenceStatus = 'confirmed']) => {
  if (!/^\d{2,}$/.test(referenceId) || seen.has(referenceId)) throw new Error('Duplicate/invalid photo ID');
  seen.add(referenceId);
  const rows = sourceIds.map(id => { if (!byId.has(id)) throw new Error(`Missing source row ${id}`); return byId.get(id); });
  if (!rows.length || rows.some(d => d.floorId !== rows[0].floorId || d.location !== rows[0].location)) throw new Error('Conflicting location group');
  const device = structuredClone(rows[0]);
  Object.assign(device, {
    id: `photo-id-${referenceId}`, referenceId, referenceStatus, detail,
    installationStatus: 'installed', sourceDeviceIds: sourceIds,
    networkStatus: rows.length === 1 ? 'confirmed' : 'review',
    // A reference photo identifies a location, never a floor-plan coordinate.
    position: null, positionSource: null, spaceId: null, confirmedSpace: null, match: null,
    evidence: [{type: photo === 'user' ? 'user-confirmation' : 'annotated-photo', source: photo}],
    notes: `${device.notes || ''}\n사진 ID ${referenceId}: ${detail || device.location}\n${referenceStatus === 'review' ? '사진 번호 판독 미확정.' : ''}`,
  });
  if (rows.length > 1) {
    networkFields.forEach(key => { device[key] = ''; });
    device.name = `${device.location} · ${detail || referenceId}`;
    device.photos = [];
    device.sourceRow = null;
    device.photoMatch = '사진 ID와 엑셀 개별 IP의 연결은 미확정';
    device.notes += '\n같은 장소의 원본 엑셀 행 중 개별 IP 대조 필요. 행 순서로 IP를 지정하지 않음.';
  }
  return device;
});
site.photoReconciliation = {
  version: 1, sourceRecordCount: source.devices.length, sourceRecords: source.devices,
  excluded: manifest.excluded, unresolved: manifest.unresolved,
  warnings: [`사진 기준 장소 ${site.devices.length}건: ID 확인 ${site.devices.filter(d=>d.referenceStatus==='confirmed').length}건 · 번호 판독 검토 ${site.devices.filter(d=>d.referenceStatus==='review').length}건. 수량 검토 ${manifest.unresolved.length}개 장소 · 미설치 제외 ${manifest.excluded.length}건. 전체 설치 대수 확정값이 아닙니다.`],
};
site.warnings = [...(site.warnings || []), ...site.photoReconciliation.warnings];
const catalog = JSON.parse(await fs.readFile('public/catalog/site.json', 'utf8'));
for (const floor of site.floors) {
  if (!floor.image) continue;
  const file = floor.image.startsWith('/local-data/') ? floor.image.slice(1) : floor.image.startsWith('catalog/') ? `public/${floor.image}` : null;
  if (!file) throw new Error('Expected local image');
  const data = await fs.readFile(file);
  floor.planKey = createHash('sha256').update(data).digest('hex');
  floor.image = `data:image/${path.extname(file) === '.png' ? 'png' : 'jpeg'};base64,${data.toString('base64')}`;
}
site.spaces = (catalog.spaces || []).filter(s => site.floors.some(f => f.id === s.floorId && f.planKey === s.planKey));
// Embed only the retained device photos, leaving the source audit as original metadata.
for (const device of site.devices) device.photos = await Promise.all((device.photos || []).map(async image => {
  if (!image.startsWith('/local-data/')) throw new Error('Expected local device image');
  return `data:image/${image.endsWith('.png') ? 'png' : 'jpeg'};base64,${(await fs.readFile(image.slice(1))).toString('base64')}`;
}));
const result = autoMapSite(validateSite(site));
await fs.mkdir(outputDir, {recursive: true});
await fs.writeFile(path.join(outputDir, '사진ID-재매핑-현장.json'), JSON.stringify(result.site));
const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet('사진 ID 대조');
sheet.columns = [
  ['사진 ID', 'referenceId', 12], ['번호 확인', 'referenceStatus', 16], ['건물', 'building', 12], ['층', 'floor', 10],
  ['설치 장소', 'location', 50], ['세부 위치', 'detail', 58], ['IP 대조', 'networkStatus', 18], ['IP', 'ip', 20],
  ['원본 엑셀 행', 'sourceRows', 20], ['사진 근거', 'evidence', 18], ['지도 연결', 'match', 22],
].map(([header,key,width]) => ({header,key,width}));
result.site.devices.forEach(d => sheet.addRow({...d, referenceStatus: d.referenceStatus === 'review' ? '판독 검토 필요' : '확인', building: site.buildings.find(b=>b.id===d.buildingId)?.name, floor: site.floors.find(f=>f.id===d.floorId)?.name,
  networkStatus: d.networkStatus === 'review' ? '개별 IP 대조 필요' : '장소 기준 1:1', sourceRows: d.sourceDeviceIds.map(id=>byId.get(id).sourceRow || '미디어월').join(', '), evidence: d.evidence[0].source, match: d.match?.status}));
sheet.views = [{state: 'frozen', ySplit: 1}]; sheet.autoFilter = 'A1:K1'; sheet.getRow(1).font = {bold: true};
const audit = workbook.addWorksheet('미설치·수량 검토');
audit.columns = [{header:'설치 장소',key:'location',width:40},{header:'상태/근거',key:'reason',width:100}];
manifest.unresolved.forEach(r=>audit.addRow(r));
manifest.excluded.forEach(r=>audit.addRow({location:byId.get(r.sourceId)?.location,reason:r.reason}));
await workbook.xlsx.writeFile(path.join(outputDir, '사진ID-매핑대조표.xlsx'));
console.log(JSON.stringify({records:site.devices.length,confirmedIds:site.devices.filter(d=>d.referenceStatus==='confirmed').length,networkReview:site.devices.filter(d=>d.networkStatus==='review').length,map:result.stats,outputDir}));
