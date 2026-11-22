import { autoMapSite } from './autoMap.js';

// Allowlisted fields only: private exports also contain photos, network settings,
// spreadsheet rows and nested audit snapshots, none of which belong in a public map.
export function createPublicMapping(source, catalog, revision) {
  const fields = ['id', 'referenceId', 'referenceStatus', 'location', 'detail', 'kind', 'buildingId', 'floorId', 'installationStatus'];
  const compatibleFloors = new Set(catalog.floors.filter(f => source.floors.some(s => s.id === f.id && s.planKey === f.planKey)).map(f => f.id));
  const devices = source.devices.filter(d => d.installationStatus !== 'not-installed').map(d => {
    if (d.floorId && !compatibleFloors.has(d.floorId)) throw new Error(`공개 안내도와 원본이 다른 층: ${d.floorId}`);
    const record = Object.fromEntries(fields.filter(k => d[k] != null).map(k => [k, d[k]]));
    record.name = [d.referenceId ? `ID ${d.referenceId}` : '', d.location, d.detail].filter(Boolean).join(' · ');
    record.photos = [];
    record.position = d.position && d.positionSource === 'manual' && compatibleFloors.has(d.floorId) ? {x:d.position.x,y:d.position.y} : null;
    record.positionSource = record.position ? 'manual' : null;
    return record;
  });
  const audit = source.photoReconciliation;
  return {
    revision, devices,
    photoReconciliation: audit ? {
      warnings: [...(audit.warnings || [])],
      unresolved: (audit.unresolved || []).map(r => ({location:r.location, reason:r.reason})),
      excluded: (audit.excluded || []).map(r => ({status:r.status, reason:r.reason})),
    } : undefined,
  };
}

export function applyPublicMapping(catalog, mapping) {
  return autoMapSite({...catalog, devices:mapping.devices, isPublicDemo:false,
    isPublishedSnapshot:true, publishedMappingRevision:mapping.revision, photoReconciliation:mapping.photoReconciliation,
  }).site;
}

// Refresh the old demo or an untouched published snapshot. Private work survives.
export function upgradePublicDemo(site, catalog) {
  return (site.isPublicDemo || (site.isPublishedSnapshot && site.publishedMappingRevision !== catalog?.publishedMappingRevision)) && site.id === catalog?.id && catalog.publishedMappingRevision
    ? structuredClone(catalog) : null;
}
