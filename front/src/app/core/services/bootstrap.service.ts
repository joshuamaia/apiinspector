import { Injectable, inject, signal } from '@angular/core';
import { CollectionsStore } from '../state/collections.store';
import { DriftStore } from '../state/drift.store';
import { FlowsStore } from '../state/flows.store';
import { HistoryStore } from '../state/history.store';
import { WorkspaceStore } from '../state/workspace.store';
import { ApiService } from './api.service';
import { DbService } from './db.service';
import { ImportExportService } from './import-export.service';

/** Loads persisted state, seeds the demo data on first run and monitors the BFF. */
@Injectable({ providedIn: 'root' })
export class BootstrapService {
  private readonly db = inject(DbService);
  private readonly history = inject(HistoryStore);
  private readonly collections = inject(CollectionsStore);
  private readonly flows = inject(FlowsStore);
  private readonly drift = inject(DriftStore);
  private readonly workspace = inject(WorkspaceStore);
  private readonly importExport = inject(ImportExportService);
  private readonly api = inject(ApiService);
  readonly ready = signal(false);
  readonly error = signal<string | null>(null);

  async init(): Promise<void> {
    try {
      await Promise.all([this.history.load(), this.collections.load(), this.flows.load(), this.drift.load()]);
      if (!(await this.db.getKv<boolean>('seeded'))) {
        await this.importExport.loadDemo();
        await this.db.setKv('seeded', true);
      }
      await this.workspace.restore();
    } catch (err) {
      this.error.set(`Local storage (IndexedDB) is unavailable: ${(err as Error).message}. Data will not be saved.`);
      if (this.workspace.tabs().length === 0) this.workspace.newTab();
    } finally {
      this.ready.set(true);
    }
    void this.api.checkHealth();
    setInterval(() => void this.api.checkHealth(), 30_000);
  }
}
