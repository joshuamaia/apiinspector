import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type { EncryptedBlob } from '../models/collection.model';
import type { ExecutionRecord } from '../models/execution.model';
import type { RequestDefinition } from '../models/request.model';
import { DbService } from '../services/db.service';
import { ExecutionService } from '../services/execution.service';
import { SecretVaultService } from '../services/secret-vault.service';
import { uid } from '../utils/id';
import { blankRedacted, cloneRequest, createRequest } from '../utils/request';
import { HistoryStore } from './history.store';

export interface RequestTab {
  id: string;
  name: string;
  savedRequestId: string | null;
  draft: RequestDefinition;
  dirty: boolean;
  running: boolean;
  lastExecution: ExecutionRecord | null;
}

interface PersistedTab {
  id: string;
  name: string;
  savedRequestId: string | null;
  draft: RequestDefinition;
  dirty: boolean;
  lastExecutionId: string | null;
  secrets: EncryptedBlob | null;
}

const KV_KEY = 'workspace';

/** Open request tabs, their drafts and last responses. */
@Injectable({ providedIn: 'root' })
export class WorkspaceStore {
  private readonly db = inject(DbService);
  private readonly vault = inject(SecretVaultService);
  private readonly executor = inject(ExecutionService);
  private readonly history = inject(HistoryStore);
  private readonly controllers = new Map<string, AbortController>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private restored = false;

  readonly tabs = signal<RequestTab[]>([]);
  readonly activeId = signal<string | null>(null);
  readonly active = computed(() => this.tabs().find((t) => t.id === this.activeId()) ?? null);

  constructor() {
    effect(() => {
      const tabs = this.tabs();
      const active = this.activeId();
      if (!this.restored) return;
      untracked(() => this.schedulePersist(tabs, active));
    });
  }

  async restore(): Promise<void> {
    const saved = await this.db.getKv<{ tabs: PersistedTab[]; activeId: string | null }>(KV_KEY);
    const tabs: RequestTab[] = [];
    for (const t of saved?.tabs ?? []) {
      const draft = await this.vault.unseal(t.draft, t.secrets);
      const lastExecution = t.lastExecutionId ? ((await this.history.get(t.lastExecutionId)) ?? null) : null;
      tabs.push({ id: t.id, name: t.name, savedRequestId: t.savedRequestId, draft, dirty: t.dirty, running: false, lastExecution });
    }
    this.tabs.set(tabs);
    this.activeId.set(saved?.activeId && tabs.some((t) => t.id === saved.activeId) ? saved.activeId : (tabs[0]?.id ?? null));
    this.restored = true;
    if (tabs.length === 0) this.newTab();
  }

  private schedulePersist(tabs: RequestTab[], activeId: string | null): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(async () => {
      const persisted: PersistedTab[] = [];
      for (const t of tabs) {
        const { def, secrets } = await this.vault.seal(t.draft);
        persisted.push({ id: t.id, name: t.name, savedRequestId: t.savedRequestId, draft: def, dirty: t.dirty, lastExecutionId: t.lastExecution?.id ?? null, secrets });
      }
      await this.db.setKv(KV_KEY, { tabs: persisted, activeId });
    }, 400);
  }

  newTab(draft: RequestDefinition = createRequest(), name = 'Untitled request', savedRequestId: string | null = null, lastExecution: ExecutionRecord | null = null): RequestTab {
    const tab: RequestTab = { id: uid(), name, savedRequestId, draft: cloneRequest(draft), dirty: false, running: false, lastExecution };
    this.tabs.update((list) => [...list, tab]);
    this.activeId.set(tab.id);
    return tab;
  }

  /** Opens a saved request, focusing it if it is already open. */
  openSaved(savedRequestId: string, name: string, def: RequestDefinition): void {
    const existing = this.tabs().find((t) => t.savedRequestId === savedRequestId);
    if (existing) {
      this.activeId.set(existing.id);
      return;
    }
    const active = this.active();
    // Reuse a pristine empty tab instead of piling up tabs.
    if (active && !active.savedRequestId && !active.dirty && !active.draft.url && !active.lastExecution) {
      this.patch(active.id, { name, savedRequestId, draft: cloneRequest(def), dirty: false });
      return;
    }
    this.newTab(def, name, savedRequestId);
  }

  /** Opens a history entry (request + its response). Secrets were stripped, so they are blank. */
  async openExecution(executionId: string): Promise<void> {
    const record = await this.history.get(executionId);
    if (!record) return;
    this.newTab(blankRedacted(record.request), record.name, record.requestId, record);
  }

  select(id: string): void {
    this.activeId.set(id);
  }

  close(id: string): void {
    this.cancel(id);
    const list = this.tabs();
    const index = list.findIndex((t) => t.id === id);
    const next = list.filter((t) => t.id !== id);
    this.tabs.set(next);
    if (this.activeId() === id) this.activeId.set(next[Math.min(index, next.length - 1)]?.id ?? null);
    if (next.length === 0) this.newTab();
  }

  closeOthers(id: string): void {
    for (const t of this.tabs()) if (t.id !== id) this.cancel(t.id);
    this.tabs.update((list) => list.filter((t) => t.id === id));
    this.activeId.set(id);
  }

  duplicate(id: string): void {
    const tab = this.tabs().find((t) => t.id === id);
    if (tab) this.newTab(tab.draft, `${tab.name} (copy)`);
  }

  reorder(from: number, to: number): void {
    this.tabs.update((list) => {
      const copy = [...list];
      const [moved] = copy.splice(from, 1);
      copy.splice(to, 0, moved);
      return copy;
    });
  }

  updateDraft(id: string, draft: RequestDefinition): void {
    this.patch(id, { draft, dirty: true });
  }

  rename(id: string, name: string): void {
    if (name.trim()) this.patch(id, { name: name.trim() });
  }

  markSaved(id: string, savedRequestId: string, name: string): void {
    this.patch(id, { savedRequestId, name, dirty: false });
  }

  /** Detaches tabs from a saved request that was deleted. */
  detachSaved(savedRequestId: string): void {
    this.tabs.update((list) => list.map((t) => (t.savedRequestId === savedRequestId ? { ...t, savedRequestId: null, dirty: true } : t)));
  }

  async send(id: string): Promise<ExecutionRecord | null> {
    const tab = this.tabs().find((t) => t.id === id);
    if (!tab || tab.running) return null;
    const controller = new AbortController();
    this.controllers.set(id, controller);
    this.patch(id, { running: true });
    try {
      const record = await this.executor.execute(tab.draft, { name: tab.name, requestId: tab.savedRequestId, signal: controller.signal });
      this.patch(id, { lastExecution: record });
      return record;
    } finally {
      this.controllers.delete(id);
      this.patch(id, { running: false });
    }
  }

  cancel(id: string): void {
    this.controllers.get(id)?.abort();
  }

  private patch(id: string, patch: Partial<RequestTab>): void {
    this.tabs.update((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }
}
