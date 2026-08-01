/**
 * Talking to the server.
 *
 * Note the fallback: if the API is unreachable — a cold Autoscale instance that
 * has not woken yet, a flaky connection, or `vite` running without the API — we
 * curate a race locally instead of showing an error. The whole simulator is
 * already in the bundle because the client has to replay races anyway, so this
 * costs nothing and the free path keeps working when the server does not.
 */
import type {
  CreateRaceRequest,
  CreateRenderRequest,
  RaceResponse,
  RenderJobResponse,
} from '@shared/api.ts';
import { curate } from '@shared/curate.ts';
import { generateSpec } from '@shared/generator.ts';
import { normaliseSeed, randomSeed } from '@shared/rng.ts';
import { simulate } from '@shared/sim.ts';

const TIMEOUT_MS = 20_000;

/** Per-tab id for telemetry. Not a user id — there are no accounts. */
export function sessionId(): string {
  const key = 'canicarrera.session';
  let value = sessionStorage.getItem(key);
  if (!value) {
    value = randomSeed().toLowerCase();
    sessionStorage.setItem(key, value);
  }
  return value;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface RaceResult extends RaceResponse {
  /** True when the server was unreachable and we generated it here instead. */
  offline: boolean;
}

/** Local stand-in for the server's curation. Same code, different machine. */
function curateLocally(seed?: string): RaceResult {
  if (seed) {
    const spec = generateSpec(normaliseSeed(seed));
    const summary = simulate(spec);
    return {
      id: `local-${spec.seed}`,
      spec,
      metrics: summary.metrics,
      score: 0,
      exploration: false,
      curation: { candidates: 1, elapsedMs: 0 },
      offline: true,
    };
  }
  const seeds = Array.from({ length: 12 }, () => randomSeed());
  const result = curate({ seeds, budgetMs: 2500 });
  return {
    id: `local-${result.best.spec.seed}`,
    spec: result.best.spec,
    metrics: result.best.summary.metrics,
    score: result.best.scored.score,
    exploration: false,
    curation: { candidates: result.considered.length, elapsedMs: result.elapsedMs },
    offline: true,
  };
}

export async function createRace(request: CreateRaceRequest = {}): Promise<RaceResult> {
  try {
    const response = await postJson<RaceResponse>('/api/race', {
      ...request,
      session: sessionId(),
    });
    return { ...response, offline: false };
  } catch {
    return curateLocally(request.seed);
  }
}

export async function fetchRace(id: string): Promise<RaceResult | null> {
  try {
    const response = await fetch(`/api/race/${encodeURIComponent(id)}`);
    if (!response.ok) return null;
    return { ...((await response.json()) as RaceResponse), offline: false };
  } catch {
    return null;
  }
}

/**
 * Announces a render. Stage 0 always gets `mode: "client"` back, but the client
 * asks anyway — the day a server renderer exists, this call is already here.
 */
export async function requestRender(
  raceId: string,
  request: CreateRenderRequest,
): Promise<RenderJobResponse | null> {
  try {
    return await postJson<RenderJobResponse>(`/api/render/${encodeURIComponent(raceId)}`, {
      ...request,
      session: sessionId(),
    });
  } catch {
    return null;
  }
}

/** Fire and forget. A telemetry failure must never interrupt a race. */
export function track(kind: string, data: Record<string, unknown> = {}, raceId?: string, seed?: string): void {
  const payload = JSON.stringify({ kind, session: sessionId(), raceId, seed, data });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/telemetry', new Blob([payload], { type: 'application/json' }));
      return;
    }
  } catch {
    // sendBeacon can throw on some privacy settings; fall through to fetch.
  }
  void fetch('/api/telemetry', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => undefined);
}
