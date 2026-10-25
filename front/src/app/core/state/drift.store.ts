import { Injectable, computed, inject, signal } from '@angular/core';
import type { ContractBaseline } from '../models/drift.model';

export interface DriftCheckSource {
  label: string;
  checkedAt: number;
  /** Parsed JSON, or an error message when the response was not JSON. */
  value?: unknown;
  error?: string;
  status?: number;
}
import { DbService } from '../services/db.service';
import { inferContract } from '../utils/drift';
import { uid } from '../utils/id';

/** Contract baselines used by the drift detector. */
@Injectable({ providedIn: 'root' })
export class DriftStore {
  private readonly db = inject(DbService);
  readonly baselines = signal<ContractBaseline[]>([]);
  readonly selectedId = signal<string | null>(null);
  readonly selected = computed(() => this.baselines().find((b) => b.id === this.selectedId()) ?? null);
  /** Last checked response per baseline (in memory); the report is derived from it and the current rules. */
  readonly checks = signal<Record<string, DriftCheckSource>>({});

  async load(): Promise<void> {
    const list = (await this.db.all('baselines')).sort((a, b) => a.createdAt - b.createdAt);
    this.baselines.set(list);
    if (!this.selectedId() && list.length) this.selectedId.set(list[0].id);
  }

  async create(name: string, sample: unknown, requestId: string | null = null): Promise<ContractBaseline> {
    const now = Date.now();
    const baseline: ContractBaseline = {
      id: uid(),
      name: name.trim() || 'New contract',
      description: '',
      requestId,
      sample: JSON.stringify(sample, null, 2),
      fields: inferContract(sample),
      strictAdditions: false,
      createdAt: now,
      updatedAt: now,
    };
    await this.save(baseline);
    this.selectedId.set(baseline.id);
    return baseline;
  }

  async save(baseline: ContractBaseline): Promise<void> {
    const updated = { ...baseline, updatedAt: Date.now() };
    await this.db.put('baselines', updated);
    this.baselines.update((list) => (list.some((b) => b.id === updated.id) ? list.map((b) => (b.id === updated.id ? updated : b)) : [...list, updated]));
    if (!this.selectedId()) this.selectedId.set(updated.id);
  }

  async remove(id: string): Promise<void> {
    await this.db.delete('baselines', id);
    this.baselines.update((list) => list.filter((b) => b.id !== id));
    this.checks.update((r) => {
      const copy = { ...r };
      delete copy[id];
      return copy;
    });
    if (this.selectedId() === id) this.selectedId.set(this.baselines()[0]?.id ?? null);
  }

  setCheck(id: string, check: DriftCheckSource): void {
    this.checks.update((r) => ({ ...r, [id]: check }));
  }
}
