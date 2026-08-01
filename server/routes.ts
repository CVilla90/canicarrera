/**
 * The API surface from PLAN §2.
 *
 * The server's job is small and valuable: mint seeds, curate, register, log.
 * It never draws a pixel, which is why Stage 0 runs at 1 vCPU / 2 GiB and costs
 * the $1 base fee.
 */
import { Router, type Request, type Response } from 'express';
import { randomBytes } from 'node:crypto';

import { curate } from '../shared/curate.ts';
import { generateSpec } from '../shared/generator.ts';
import { simulate } from '../shared/sim.ts';
import { normaliseSeed, randomSeed } from '../shared/rng.ts';
import { SIM_VERSION, type RaceRecord } from '../shared/spec.ts';
import type {
  CreateRaceRequest,
  CreateRenderRequest,
  RaceResponse,
  RenderJobResponse,
  TelemetryRequest,
} from '../shared/api.ts';
import type { RaceStore } from './store.ts';
import type { TelemetrySink } from './telemetry.ts';

/** Fraction of curated requests that skip scoring entirely (PLAN §2b). */
const EXPLORATION_RATE = 0.1;

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

function shortId(length = 10): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Cryptographically seeded, so two people pressing the button never collide. */
function freshSeed(): string {
  const bytes = randomBytes(8);
  let i = 0;
  return randomSeed(() => bytes[i++ % bytes.length] / 256);
}

/**
 * Coarse per-IP throttle. Approximate on Autoscale (state is per instance, and
 * instances come and go) but it costs nothing and stops a loop from a single
 * tab burning a vCPU on curation.
 */
class Throttle {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    const entry = this.hits.get(key);
    if (!entry || now > entry.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.hits.size > 5000) this.prune(now);
      return true;
    }
    entry.count++;
    return entry.count <= this.limit;
  }

  private prune(now: number): void {
    for (const [key, entry] of this.hits) if (now > entry.resetAt) this.hits.delete(key);
  }
}

export interface RouteDeps {
  store: RaceStore;
  telemetry: TelemetrySink;
  candidates: number;
}

export function createRouter({ store, telemetry, candidates }: RouteDeps): Router {
  const router = Router();
  const raceThrottle = new Throttle(60, 60_000);
  const jobs = new Map<string, RenderJobResponse & { raceId: string }>();

  const clientKey = (req: Request): string =>
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
    req.socket.remoteAddress ??
    'unknown';

  router.get('/health', async (_req: Request, res: Response) => {
    res.json({
      ok: true,
      simVersion: SIM_VERSION,
      races: await store.size(),
      uptime: Math.round(process.uptime()),
    });
  });

  /** Invent a race. This is the one endpoint that costs real CPU. */
  router.post('/race', async (req: Request, res: Response) => {
    if (!raceThrottle.allow(clientKey(req))) {
      res.status(429).json({
        error: 'rate_limited',
        message: 'Demasiadas carreras seguidas. Espera un momento.',
      });
      return;
    }

    const body = (req.body ?? {}) as CreateRaceRequest;
    const requested = typeof body.seed === 'string' && body.seed.trim() ? body.seed : null;

    let record: RaceRecord;
    let candidateCount: number;
    let elapsedMs: number;

    if (requested) {
      // The user asked for a specific race. Curating it would be a bug — they
      // want THIS one, boring or not.
      const seed = normaliseSeed(requested);
      const spec = generateSpec(seed, { archetype: body.archetype, palette: body.palette });
      const started = Date.now();
      const summary = simulate(spec);
      elapsedMs = Date.now() - started;
      candidateCount = 1;
      record = {
        id: shortId(),
        spec,
        metrics: summary.metrics,
        score: 0,
        exploration: false,
        createdAt: Date.now(),
      };
      telemetry.write({
        kind: 'race_replayed',
        at: record.createdAt,
        session: body.session,
        raceId: record.id,
        seed,
        data: { metrics: summary.metrics, archetype: spec.archetype },
      });
    } else {
      // Keep an exploration arm, or the scorer only ever learns about the
      // regions it already likes (PLAN §2b).
      const exploration = Math.random() < EXPLORATION_RATE;
      const seeds = Array.from({ length: candidates }, () => freshSeed());
      const result = curate({
        seeds,
        exploration,
        archetype: body.archetype,
        palette: body.palette,
        budgetMs: 4000,
      });
      candidateCount = result.considered.length;
      elapsedMs = result.elapsedMs;
      record = {
        id: shortId(),
        spec: result.best.spec,
        metrics: result.best.summary.metrics,
        score: result.best.scored.score,
        exploration: result.exploration,
        createdAt: Date.now(),
      };
      telemetry.write({
        kind: 'race_created',
        at: record.createdAt,
        session: body.session,
        raceId: record.id,
        seed: record.spec.seed,
        data: {
          archetype: record.spec.archetype,
          palette: record.spec.palette,
          metrics: record.metrics,
          score: record.score,
          parts: result.best.scored.parts,
          exploration: result.exploration,
          considered: result.considered,
          elapsedMs: result.elapsedMs,
        },
      });
    }

    await store.put(record);

    const payload: RaceResponse = {
      id: record.id,
      spec: record.spec,
      metrics: record.metrics,
      score: record.score,
      exploration: record.exploration,
      curation: { candidates: candidateCount, elapsedMs },
    };
    res.json(payload);
  });

  /** Express 5 types a wildcard-capable param as string | string[]. */
  const param = (value: string | string[] | undefined): string =>
    Array.isArray(value) ? (value[0] ?? '') : (value ?? '');

  /** Replay a race by id. Falls back to nothing — the client retries by seed. */
  router.get('/race/:id', async (req: Request, res: Response) => {
    const record = await store.get(param(req.params.id));
    if (!record) {
      res.status(404).json({
        error: 'not_found',
        message: 'Esa carrera ya no está en el registro. Vuelve a abrirla con su semilla.',
      });
      return;
    }
    const payload: RaceResponse = {
      id: record.id,
      spec: record.spec,
      metrics: record.metrics,
      score: record.score,
      exploration: record.exploration,
      curation: { candidates: 0, elapsedMs: 0 },
    };
    res.json(payload);
  });

  /**
   * Ask for a render. Stage 0 always answers "your machine draws it" — but the
   * client already speaks the polling protocol, so the day a server renderer
   * exists it changes nothing here.
   */
  router.post('/render/:id', async (req: Request, res: Response) => {
    const record = await store.get(param(req.params.id));
    if (!record) {
      res.status(404).json({
        error: 'not_found',
        message: 'No encontramos esa carrera.',
      });
      return;
    }
    const body = (req.body ?? {}) as CreateRenderRequest;
    const job: RenderJobResponse & { raceId: string } = {
      jobId: shortId(12),
      raceId: record.id,
      mode: 'client',
      status: 'client',
      message: 'Tu equipo genera el video.',
    };
    jobs.set(job.jobId, job);
    if (jobs.size > 2000) jobs.delete(jobs.keys().next().value as string);

    telemetry.write({
      kind: 'export_started',
      at: Date.now(),
      session: body.session,
      raceId: record.id,
      seed: record.spec.seed,
      data: { width: body.width, height: body.height, fps: body.fps, mode: 'client' },
    });

    const { raceId, ...payload } = job;
    void raceId;
    res.json(payload);
  });

  router.get('/render/:jobId', (req: Request, res: Response) => {
    const job = jobs.get(param(req.params.jobId));
    if (!job) {
      res.status(404).json({ error: 'not_found', message: 'Ese trabajo ya no existe.' });
      return;
    }
    const { raceId, ...payload } = job;
    void raceId;
    res.json(payload);
  });

  /** Fire-and-forget. Never let a telemetry failure break someone's race. */
  router.post('/telemetry', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as TelemetryRequest;
    if (typeof body.kind === 'string' && body.kind.length < 64) {
      telemetry.write({
        kind: body.kind as never,
        at: Date.now(),
        session: body.session,
        raceId: body.raceId,
        seed: body.seed,
        data: body.data,
      });
    }
    res.status(204).end();
  });

  return router;
}
