import { Dialog } from '@angular/cdk/dialog';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ToastService } from '../../core/services/toast.service';
import { CollectionsStore, type SaveMeta } from '../../core/state/collections.store';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { SaveRequestDialogComponent, type SaveDialogData } from '../../shared/components/dialogs/save-request-dialog.component';

/** Save / save-as orchestration shared by the top bar, tabs and keyboard shortcuts. */
@Injectable({ providedIn: 'root' })
export class RequestActionsService {
  private readonly workspace = inject(WorkspaceStore);
  private readonly collections = inject(CollectionsStore);
  private readonly dialog = inject(Dialog);
  private readonly toast = inject(ToastService);

  async save(tabId: string, forceDialog = false): Promise<void> {
    const tab = this.workspace.tabs().find((t) => t.id === tabId);
    if (!tab) return;
    const existing = tab.savedRequestId ? this.collections.requests().find((r) => r.id === tab.savedRequestId) : undefined;

    if (existing && !forceDialog) {
      await this.collections.saveRequest(tab.draft, { name: existing.name, description: existing.description, collectionId: existing.collectionId, folderId: existing.folderId }, existing.id);
      this.workspace.markSaved(tab.id, existing.id, existing.name);
      this.toast.success(`Saved "${existing.name}"`);
      return;
    }

    const data: SaveDialogData = {
      name: existing ? `${existing.name}${forceDialog ? ' (copy)' : ''}` : tab.name === 'Untitled request' ? '' : tab.name,
      description: existing?.description ?? '',
      collectionId: existing?.collectionId ?? null,
      folderId: existing?.folderId ?? null,
    };
    const ref = this.dialog.open<SaveMeta>(SaveRequestDialogComponent, { data, backdropClass: 'cdk-overlay-dark-backdrop' });
    const meta = await firstValueFrom(ref.closed);
    if (!meta) return;
    const saved = await this.collections.saveRequest(tab.draft, meta, forceDialog ? null : existing?.id);
    this.workspace.markSaved(tab.id, saved.id, saved.name);
    this.toast.success(`Saved "${saved.name}" to ${this.collections.collections().find((c) => c.id === saved.collectionId)?.name ?? 'collection'}`);
  }
}
