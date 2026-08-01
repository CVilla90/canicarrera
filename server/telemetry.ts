/**
 * Telemetry (PLAN §2.6 / W11).
 *
 * This is the one thing in Stage 0 that cannot be added retroactively. The
 * panel that reads it can wait; the writing of it cannot. Every race we serve
 * records the spec, what the curator measured, and — later, from the client —
 * whether anyone actually exported it. Those pairs are the training data for
 * Stage 2b's scorer.
 *
 * No personal data, no IP addresses, no cookies. A session id the client
 * generates per tab is enough to tell "watched then exported" from "watched,
 * left".
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export type TelemetryKind =
  | 'race_created'
  | 'race_replayed'
  | 'capability_probe'
  | 'export_started'
  | 'export_finished'
  | 'export_failed'
  | 'race_watched'
  | 'race_abandoned';

export interface TelemetryEvent {
  kind: TelemetryKind;
  at: number;
  /** Per-tab id minted by the client. Not a user id — we have no accounts. */
  session?: string;
  raceId?: string;
  seed?: string;
  data?: Record<string, unknown>;
}

export interface TelemetrySink {
  write(event: TelemetryEvent): void;
}

class NoopSink implements TelemetrySink {
  write(): void {}
}

class ConsoleSink implements TelemetrySink {
  write(event: TelemetryEvent): void {
    console.log(`[telemetry] ${JSON.stringify(event)}`);
  }
}

/**
 * Local development only. On Autoscale the filesystem resets on every publish
 * and is not shared between instances, so this would silently lose data — hence
 * the warning at construction rather than a surprise in three months.
 */
class JsonlSink implements TelemetrySink {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  write(event: TelemetryEvent): void {
    const line = `${JSON.stringify(event)}\n`;
    this.queue = this.queue
      .then(async () => {
        await mkdir(dirname(this.file), { recursive: true });
        await appendFile(this.file, line, 'utf8');
      })
      .catch((err) => {
        console.warn(`[telemetry] write failed: ${String(err)}`);
      });
  }
}

export function createTelemetrySink(mode = process.env.TELEMETRY_SINK ?? 'jsonl'): TelemetrySink {
  switch (mode) {
    case 'none':
      return new NoopSink();
    case 'console':
      return new ConsoleSink();
    case 'jsonl':
    default: {
      const file = resolve(process.cwd(), 'data', 'telemetry.jsonl');
      if (process.env.REPLIT_DEPLOYMENT) {
        console.warn(
          '[telemetry] jsonl sink on an ephemeral filesystem — events will be lost on redeploy. ' +
            'Move to Object Storage or Postgres before relying on this data.',
        );
      }
      return new JsonlSink(file);
    }
  }
}
