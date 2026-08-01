/**
 * The wire contract, shared by both sides so a rename can never silently break
 * the client.
 *
 * The render job API exists in Stage 0 even though it always answers
 * `mode: "client"`. It costs an afternoon now; retrofitting a polling protocol
 * onto a shipped client costs a rewrite (PLAN §2).
 */
import type {
  ArchetypeName,
  PaletteName,
  RaceMetrics,
  RaceSpec,
} from './spec.ts';

export interface CreateRaceRequest {
  /** Replay a specific seed. When omitted the server curates a new one. */
  seed?: string;
  archetype?: ArchetypeName;
  palette?: PaletteName;
  /** Per-tab id for telemetry. Not a user id. */
  session?: string;
}

export interface RaceResponse {
  id: string;
  spec: RaceSpec;
  metrics: RaceMetrics;
  /** Curation score, 0-1. */
  score: number;
  /** True when this race skipped curation (exploration arm). */
  exploration: boolean;
  curation: {
    candidates: number;
    elapsedMs: number;
  };
}

export type RenderMode = 'client' | 'server';

export interface CreateRenderRequest {
  width: number;
  height: number;
  fps: number;
  session?: string;
}

export interface RenderJobResponse {
  jobId: string;
  mode: RenderMode;
  status: 'client' | 'queued' | 'running' | 'done' | 'failed';
  /** Populated only in server mode, which Stage 0 never returns. */
  url?: string;
  /** Human-readable, Spanish, safe to show. */
  message?: string;
}

export interface TelemetryRequest {
  kind: string;
  session?: string;
  raceId?: string;
  seed?: string;
  data?: Record<string, unknown>;
}

export interface ApiError {
  error: string;
  /** Spanish, safe to show to a user. */
  message: string;
}
