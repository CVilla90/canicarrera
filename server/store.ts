/**
 * Race registry.
 *
 * Stage 0 keeps races in memory, which is the honest choice on Autoscale: the
 * filesystem is ephemeral and there is no always-on process to own a cache.
 * Everything is behind an interface and async so Postgres or Object Storage
 * slots in for Stage 1 without touching a route.
 *
 * Losing the registry is survivable by design — a race is fully recoverable
 * from its seed, so a share link keeps working after a redeploy even though the
 * id behind it does not.
 */
import type { RaceRecord } from '../shared/spec.ts';

export interface RaceStore {
  put(record: RaceRecord): Promise<void>;
  get(id: string): Promise<RaceRecord | undefined>;
  size(): Promise<number>;
}

export class MemoryRaceStore implements RaceStore {
  private readonly races = new Map<string, RaceRecord>();

  constructor(private readonly capacity = 500) {}

  async put(record: RaceRecord): Promise<void> {
    this.races.set(record.id, record);
    // Map preserves insertion order, so the first key is the oldest.
    while (this.races.size > this.capacity) {
      const oldest = this.races.keys().next();
      if (oldest.done) break;
      this.races.delete(oldest.value);
    }
  }

  async get(id: string): Promise<RaceRecord | undefined> {
    return this.races.get(id);
  }

  async size(): Promise<number> {
    return this.races.size;
  }
}
