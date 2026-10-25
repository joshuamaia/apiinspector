import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { Collection, Folder, SavedRequest } from '../../core/models/collection.model';
import { ImportError, ImportExportService } from '../../core/services/import-export.service';
import { ToastService } from '../../core/services/toast.service';
import { CollectionsStore } from '../../core/state/collections.store';
import { HistoryStore, type HistoryEntry } from '../../core/state/history.store';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { downloadFile, slugify } from '../../core/utils/download';
import { formatMs, statusTone, timeAgo } from '../../core/utils/format';
import { createRequest } from '../../core/utils/request';
import { ConfirmService } from '../../shared/components/dialogs/confirm-dialog.component';
import { IconComponent } from '../../shared/components/icon/icon.component';

type SidebarTab = 'collections' | 'history' | 'favorites';

const EXPANDED_KEY = 'api-inspector.sidebar.expanded';

@Component({
  selector: 'app-sidebar',
  imports: [IconComponent, CdkMenu, CdkMenuItem, CdkMenuTrigger, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent {
  protected readonly collections = inject(CollectionsStore);
  protected readonly history = inject(HistoryStore);
  private readonly workspace = inject(WorkspaceStore);
  private readonly importExport = inject(ImportExportService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  readonly navigated = output<void>();

  protected readonly tab = signal<SidebarTab>('collections');
  protected readonly query = signal('');
  protected readonly expanded = signal<Set<string>>(this.loadExpanded());
  protected readonly timeAgo = timeAgo;
  protected readonly formatMs = formatMs;
  protected readonly statusTone = statusTone;

  private readonly matcher = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return null;
    const terms = q.split(/\s+/);
    return (method: string, name: string, url: string) => {
      const haystack = `${method} ${name} ${url}`.toLowerCase();
      return terms.every((t) => haystack.includes(t));
    };
  });

  protected readonly searchResults = computed(() => {
    const match = this.matcher();
    if (!match) return [];
    return this.collections.requests().filter((r) => match(r.method, r.name, r.url));
  });

  protected readonly filteredHistory = computed(() => {
    const match = this.matcher();
    const list = match ? this.history.entries().filter((e) => match(e.request.method, e.name, e.request.url)) : this.history.entries();
    const groups: { label: string; items: HistoryEntry[] }[] = [];
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86_400_000).toDateString();
    for (const entry of list.slice(0, 300)) {
      const day = new Date(entry.createdAt).toDateString();
      const label = day === today ? 'Today' : day === yesterday ? 'Yesterday' : new Date(entry.createdAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
      const group = groups.at(-1);
      if (group?.label === label) group.items.push(entry);
      else groups.push({ label, items: [entry] });
    }
    return groups;
  });

  protected readonly filteredFavorites = computed(() => {
    const match = this.matcher();
    return match ? this.collections.favorites().filter((r) => match(r.method, r.name, r.url)) : this.collections.favorites();
  });

  protected childFolders(collectionId: string, parentId: string | null): Folder[] {
    return this.collections.folders().filter((f) => f.collectionId === collectionId && f.parentId === parentId);
  }

  protected requestsIn(collectionId: string, folderId: string | null): SavedRequest[] {
    return this.collections.requests().filter((r) => r.collectionId === collectionId && r.folderId === folderId);
  }

  protected countIn(collectionId: string): number {
    return this.collections.requests().filter((r) => r.collectionId === collectionId).length;
  }

  protected isOpen(id: string): boolean {
    return this.expanded().has(id);
  }

  protected toggle(id: string): void {
    const next = new Set(this.expanded());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.expanded.set(next);
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  }

  private loadExpanded(): Set<string> {
    try {
      return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '["demo-col-jsonplaceholder","demo-col-local","demo-fld-users","demo-fld-auth"]') as string[]);
    } catch {
      return new Set();
    }
  }

  private goToWorkspace(): void {
    if (this.router.url.split('?')[0] !== '/') void this.router.navigateByUrl('/');
    this.navigated.emit();
  }

  // ---- requests ----
  protected async open(request: SavedRequest): Promise<void> {
    const opened = await this.collections.openRequest(request.id);
    if (!opened) return;
    this.workspace.openSaved(request.id, request.name, opened.def);
    this.goToWorkspace();
  }

  protected async renameRequest(request: SavedRequest): Promise<void> {
    const name = await this.confirm.prompt('Rename request', 'Name', request.name, 'Rename');
    if (name) {
      await this.collections.renameRequest(request.id, name);
      for (const t of this.workspace.tabs()) if (t.savedRequestId === request.id) this.workspace.rename(t.id, name);
    }
  }

  protected async duplicateRequest(request: SavedRequest): Promise<void> {
    const copy = await this.collections.duplicateRequest(request.id);
    if (copy) this.toast.success(`Duplicated as "${copy.name}"`);
  }

  protected async deleteRequest(request: SavedRequest): Promise<void> {
    if (await this.confirm.confirm({ title: 'Delete request', message: `Delete "${request.name}"? This cannot be undone.`, danger: true, confirmLabel: 'Delete' })) {
      await this.collections.deleteRequest(request.id);
      this.workspace.detachSaved(request.id);
    }
  }

  protected toggleFavorite(request: SavedRequest, event?: Event): void {
    event?.stopPropagation();
    void this.collections.toggleFavorite(request.id);
  }

  protected newRequestIn(collectionId: string, folderId: string | null): void {
    const tab = this.workspace.newTab(createRequest(), 'Untitled request');
    void this.collections
      .saveRequest(tab.draft, { name: 'New request', description: '', collectionId, folderId })
      .then((saved) => this.workspace.markSaved(tab.id, saved.id, saved.name));
    if (folderId) this.ensureOpen(folderId);
    this.ensureOpen(collectionId);
    this.goToWorkspace();
  }

  private ensureOpen(id: string): void {
    if (!this.isOpen(id)) this.toggle(id);
  }

  // ---- collections & folders ----
  protected async newCollection(): Promise<void> {
    const name = await this.confirm.prompt('New collection', 'Name', '', 'Create');
    if (name) {
      const c = await this.collections.createCollection(name);
      this.ensureOpen(c.id);
      this.tab.set('collections');
    }
  }

  protected async newFolder(collectionId: string, parentId: string | null): Promise<void> {
    const name = await this.confirm.prompt('New folder', 'Name', '', 'Create');
    if (name) {
      await this.collections.createFolder(collectionId, name, parentId);
      this.ensureOpen(parentId ?? collectionId);
    }
  }

  protected async renameCollection(c: Collection): Promise<void> {
    const name = await this.confirm.prompt('Rename collection', 'Name', c.name, 'Rename');
    if (name) await this.collections.renameCollection(c.id, name);
  }

  protected async renameFolder(f: Folder): Promise<void> {
    const name = await this.confirm.prompt('Rename folder', 'Name', f.name, 'Rename');
    if (name) await this.collections.renameFolder(f.id, name);
  }

  protected async deleteCollection(c: Collection): Promise<void> {
    if (await this.confirm.confirm({ title: 'Delete collection', message: `Delete "${c.name}" and its ${this.countIn(c.id)} request(s)?`, danger: true, confirmLabel: 'Delete' })) {
      const ids = this.collections.requests().filter((r) => r.collectionId === c.id).map((r) => r.id);
      await this.collections.deleteCollection(c.id);
      ids.forEach((id) => this.workspace.detachSaved(id));
    }
  }

  protected async deleteFolder(f: Folder): Promise<void> {
    if (await this.confirm.confirm({ title: 'Delete folder', message: `Delete "${f.name}", its sub-folders and requests?`, danger: true, confirmLabel: 'Delete' })) {
      await this.collections.deleteFolder(f.id);
    }
  }

  protected async exportCollection(c?: Collection): Promise<void> {
    const bundle = await this.importExport.buildExport(c?.id);
    downloadFile(`api-inspector-${slugify(c?.name ?? 'workspace')}.json`, JSON.stringify(bundle, null, 2), 'application/json');
    this.toast.success('Exported (secrets are never included)');
  }

  protected async importFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const summary = await this.importExport.import(await file.text());
      this.toast.success(`Imported ${summary.collections} collection(s), ${summary.requests} request(s), ${summary.flows} flow(s), ${summary.baselines} baseline(s)`);
      this.tab.set('collections');
    } catch (err) {
      this.toast.error(err instanceof ImportError ? err.message : `Import failed: ${(err as Error).message}`);
    }
  }

  protected async loadDemo(): Promise<void> {
    await this.importExport.loadDemo();
    this.toast.success('Demo data loaded');
  }

  // ---- history ----
  protected async openExecution(entry: HistoryEntry): Promise<void> {
    await this.workspace.openExecution(entry.id);
    this.goToWorkspace();
  }

  protected compare(entry: HistoryEntry): void {
    void this.router.navigate(['/diff'], { queryParams: { left: entry.id } });
    this.navigated.emit();
  }

  protected baseline(entry: HistoryEntry): void {
    void this.router.navigate(['/drift'], { queryParams: { fromExecution: entry.id } });
    this.navigated.emit();
  }

  protected async clearHistory(): Promise<void> {
    if (await this.confirm.confirm({ title: 'Clear history', message: 'Delete all recorded executions? Metrics are computed from history.', danger: true, confirmLabel: 'Clear' })) {
      await this.history.clear();
    }
  }

  protected statusLabel(entry: HistoryEntry): string {
    return entry.outcome === 'error' ? (entry.error?.kind === 'TIMEOUT' ? 'T/O' : 'ERR') : String(entry.status);
  }
}
