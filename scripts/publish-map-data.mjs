import fs from 'node:fs/promises';
import { createPublicMapping, applyPublicMapping } from '../src/lib/publication.js';
import { validateSite } from '../src/lib/model.js';

const input = process.argv[2];
if (!input) throw new Error('Usage: node scripts/publish-map-data.mjs local-data/reviewed-site.json');
const source = validateSite(JSON.parse(await fs.readFile(input, 'utf8')));
const catalog = JSON.parse(await fs.readFile('public/catalog/site.json', 'utf8'));
const mapping = createPublicMapping(source, catalog, new Date().toISOString());
const published = validateSite(applyPublicMapping(catalog, mapping));
await fs.writeFile('public/catalog/published-mapping.json', JSON.stringify(mapping, null, 2));
await fs.writeFile('public/catalog/site.json', JSON.stringify(published, null, 2));
console.log(JSON.stringify({publishedRecords:published.devices.length, revision:mapping.revision}));
