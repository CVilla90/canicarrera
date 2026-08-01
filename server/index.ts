/**
 * One process: the API plus the built client.
 *
 * Replit Autoscale specifics that are not negotiable:
 *   - bind 0.0.0.0 and default to port 5000, not 3000
 *   - no background work, no timers that outlive a request, no writes that
 *     matter to the local filesystem
 *   - never block a request longer than ~60s (curation has a 4s budget)
 */
import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { createRouter } from './routes.ts';
import { MemoryRaceStore } from './store.ts';
import { createTelemetrySink } from './telemetry.ts';

const PORT = Number(process.env.PORT ?? 5000);
const HOST = '0.0.0.0';

const here = dirname(fileURLToPath(import.meta.url));
// Works both from source (server/) and from the bundle (dist/server/).
const clientDir = [resolve(here, '../client'), resolve(here, '../dist/client')].find((candidate) =>
  existsSync(join(candidate, 'index.html')),
);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

app.use(
  '/api',
  createRouter({
    store: new MemoryRaceStore(Number(process.env.RACE_REGISTRY_SIZE ?? 500)),
    telemetry: createTelemetrySink(),
    candidates: Number(process.env.CURATION_CANDIDATES ?? 20),
  }),
);

if (clientDir) {
  // Hashed assets are immutable; index.html must never be cached or a deploy
  // leaves people on a stale bundle pointing at deleted chunks.
  app.use(
    express.static(clientDir, {
      index: false,
      setHeaders: (res, path) => {
        if (path.includes(`${'assets'}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }),
  );
  app.get('/{*splat}', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(join(clientDir, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res
      .status(503)
      .type('text/plain')
      .send('El cliente no está compilado todavía. Ejecuta `npm run build` o usa `npm run dev`.');
  });
}

app.listen(PORT, HOST, () => {
  console.log(`canicarrera api  http://${HOST}:${PORT}`);
  console.log(clientDir ? `canicarrera web  serving ${clientDir}` : 'canicarrera web  (dev mode — run vite)');
});
