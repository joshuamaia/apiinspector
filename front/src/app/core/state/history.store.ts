import { Injectable, computed, inject, signal } from '@angular/core';
import type { ExecutionRecord } from '../models/execution.model';
import { DbService } from '../services/db.service';
import { SettingsService } from '../services/settings.service';

/** History entry kept in memory: the record without its (potentially large) body. */
export type HistoryEntry = Omit<ExecutionRecord, 'response'> & { size?: number; contentType?: string | null };

function summarize(record: ExecutionRecord): HistoryEntry {
  const { response, ...rest } = record;
  return { ...rest, size: response?.size, contentType: response?.contentType ?? null };
}

/** Local execution history (IndexedDB). Bodies are loaded on demand. */
@Injectable({ providedIn: 'root' })
export class HistoryStore {
  private readonly db = inject(DbService);
  private readonly settings = inject(SettingsService);
  readonly entries = signal<HistoryEntry[]>([]);
  readonly loaded = signal(false);
  readonly count = computed(() => this.entries().length);

  async load(): Promise<void> {
    const all = await this.db.all('history');
    this.entries.set(all.map(summarize).sort((a, b) => b.createdAt - a.createdAt));
    this.loaded.set(true);
  }

  async add(record: ExecutionRecord): Promise<void> {
    const stored = structuredClone(record);
    const limit = this.settings.settings().storedBodyLimit;
    if (stored.response && stored.response.body.length > limit) {
      stored.response = { ...stored.response, body: stored.response.body.slice(0, limit) };
      stored.storedBodyTruncated = true;
    }
    await this.db.put('history', stored);
    this.entries.update((list) => [summarize(stored), ...list]);
    await this.prune();
  }

  async get(id: string): Promise<ExecutionRecord | undefined> {
    return this.db.get('history', id);
  }

  async remove(id: string): Promise<void> {
    await this.db.delete('history', id);
    this.entries.update((list) => list.filter((e) => e.id !== id));
  }

  async clear(): Promise<void> {
    await this.db.clear('history');
    this.entries.set([]);
  }

  private async prune(): Promise<void> {
    const limit = this.settings.settings().historyLimit;
    const list = this.entries();
    if (list.length <= limit) return;
    const excess = list.slice(limit).map((e) => e.id);
    await this.db.deleteMany('history', excess);
    this.entries.set(list.slice(0, limit));
  }
}
