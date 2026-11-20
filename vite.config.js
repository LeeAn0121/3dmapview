import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

// Private seed data is served only from this loopback dev server, never bundled.
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), {
    name: 'local-hospital-data',
    configureServer(server) {
      server.middlewares.use('/local-data', (req, res) => {
        const pathname = decodeURIComponent((req.url || '').split('?')[0]);
        const base = path.resolve('local-data');
        const file = path.resolve(base, '.' + pathname);
        if (!file.startsWith(base + path.sep)) { res.statusCode = 403; return res.end(); }
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; return res.end('Local data not found'); }
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json; charset=utf-8' : file.endsWith('.png') ? 'image/png' : 'image/jpeg');
        fs.createReadStream(file).pipe(res);
      });
    },
  }],
});
