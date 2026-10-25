import { Injectable, computed, inject, signal } from '@angular/core';
import type { Collection, Folder, SavedRequest } from '../models/collection.model';
import type { RequestDefinition } from '../models/request.model';
import { DbService } from '../services/db.service';
import { SecretVaultService } from '../services/secret-vault.service';
import { uid } from '../utils/id';
import { cloneRequest } from '../utils/request';

export interface SaveMeta {
  name: string;
  description: string;
  collectionId: string;
  folderId: string | null;
}

function definitionOf(saved: SavedRequest): RequestDefinition {
  const { method, url, params, headers, auth, body, settings } = saved;
  return cloneRequest({ method, url, params, headers, auth, body, settings });
}

/** Collections, folders and saved requests (IndexedDB). Secrets stay encrypted in memory too. */
@Injectable({ providedIn: 'root' })
export class CollectionsStore {
  private readonly db = inject(DbService);
  private readonly vault = inject(SecretVaultService);

  readonly collections = signal<Collection[]>([]);
  readonly folders = signal<Folder[]>([]);
  readonly requests = signal<SavedRequest[]>([]);
  readonly favorites = computed(() => this.requests().filter((r) => r.favorite).sort((a, b) => a.name.localeCompare(b.name)));

  async load(): Promise<void> {
    const [collections, folders, requests] = await Promise.all([this.db.all('collections'), this.db.all('folders'), this.db.all('requests')]);
    this.collections.set(collections.sort((a, b) => a.createdAt - b.createdAt));
    this.folders.set(folders.sort((a, b) => a.name.localeCompare(b.name)));
    this.requests.set(requests.sort((a, b) => a.createdAt - b.createdAt));
  }

  // ---- collections ----
  async createCollection(name: string, description = '', demo = false): Promise<Collection> {
    const collection: Collection = { id: uid(), name: name.trim() || 'New collection', description, createdAt: Date.now(), ...(demo ? { demo } : {}) };
    await this.db.put('collections', collection);
    this.collections.update((list) => [...list, collection]);
    return collection;
  }

  async renameCollection(id: string, name: string): Promise<void> {
    const collection = this.collections().find((c) => c.id === id);
    if (!collection || !name.trim()) return;
    const updated = { ...collection, name: name.trim() };
    await this.db.put('collections', updated);
    this.collections.update((list) => list.map((c) => (c.id === id ? updated : c)));
  }

  async deleteCollection(id: string): Promise<void> {
    const folderIds = this.folders().filter((f) => f.collectionId === id).map((f) => f.id);
    const requestIds = this.requests().filter((r) => r.collectionId === id).map((r) => r.id);
    await Promise.all([this.db.delete('collections', id), this.db.deleteMany('folders', folderIds), this.db.deleteMany('requests', requestIds)]);
    this.collections.update((list) => list.filter((c) => c.id !== id));
    this.folders.update((list) => list.filter((f) => f.collectionId !== id));
    this.requests.update((list) => list.filter((r) => r.collectionId !== id));
  }

  // ---- folders ----
  async createFolder(collectionId: string, name: string, parentId: string | null = null): Promise<Folder> {
    const folder: Folder = { id: uid(), collectionId, parentId, name: name.trim() || 'New folder', createdAt: Date.now() };
    await this.db.put('folders', folder);
    this.folders.update((list) => [...list, folder].sort((a, b) => a.name.localeCompare(b.name)));
    return folder;
  }

  async renameFolder(id: string, name: string): Promise<void> {
    const folder = this.folders().find((f) => f.id === id);
    if (!folder || !name.trim()) return;
    const updated = { ...folder, name: name.trim() };
    await this.db.put('folders', updated);
    this.folders.update((list) => list.map((f) => (f.id === id ? updated : f)).sort((a, b) => a.name.localeCompare(b.name)));
  }

  /** Deletes a folder, its sub-folders and every request inside them. */
  async deleteFolder(id: string): Promise<void> {
    const ids = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of this.folders()) {
        if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
          ids.add(f.id);
          grew = true;
        }
      }
    }
    const requestIds = this.requests().filter((r) => r.folderId && ids.has(r.folderId)).map((r) => r.id);
    await Promise.all([this.db.deleteMany('folders', [...ids]), this.db.deleteMany('requests', requestIds)]);
    this.folders.update((list) => list.filter((f) => !ids.has(f.id)));
    this.requests.update((list) => list.filter((r) => !requestIds.includes(r.id)));
  }

  folderPath(folderId: string | null): string {
    const names: string[] = [];
    let current = this.folders().find((f) => f.id === folderId);
    while (current) {
      names.unshift(current.name);
      current = this.folders().find((f) => f.id === current!.parentId);
    }
    return names.join(' / ');
  }

  // ---- requests ----
  async saveRequest(def: RequestDefinition, meta: SaveMeta, existingId?: string | null, extra: Partial<SavedRequest> = {}): Promise<SavedRequest> {
    const existing = existingId ? this.requests().find((r) => r.id === existingId) : undefined;
    const { def: publicDef, secrets } = await this.vault.seal(def);
    const now = Date.now();
    const saved: SavedRequest = {
      ...publicDef,
      id: existing?.id ?? uid(),
      name: meta.name.trim() || 'Untitled request',
      description: meta.description,
      collectionId: meta.collectionId,
      folderId: meta.folderId,
      favorite: existing?.favorite ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      secrets,
      ...extra,
    };
    await this.db.put('requests', saved);
    this.requests.update((list) => (existing ? list.map((r) => (r.id === saved.id ? saved : r)) : [...list, saved]));
    return saved;
  }

  /** Returns the full definition, decrypting secrets. */
  async openRequest(id: string): Promise<{ saved: SavedRequest; def: RequestDefinition } | null> {
    const saved = this.requests().find((r) => r.id === id);
    if (!saved) return null;
    return { saved, def: await this.vault.unseal(definitionOf(saved), saved.secrets) };
  }

  async duplicateRequest(id: string): Promise<SavedRequest | null> {
    const opened = await this.openRequest(id);
    if (!opened) return null;
    const { saved, def } = opened;
    return this.saveRequest(def, { name: `${saved.name} (copy)`, description: saved.description, collectionId: saved.collectionId, folderId: saved.folderId });
  }

  async renameRequest(id: string, name: string): Promise<void> {
    await this.patchRequest(id, { name: name.trim() });
  }

  async toggleFavorite(id: string): Promise<void> {
    const r = this.requests().find((x) => x.id === id);
    if (r) await this.patchRequest(id, { favorite: !r.favorite });
  }

  async moveRequest(id: string, collectionId: string, folderId: string | null): Promise<void> {
    await this.patchRequest(id, { collectionId, folderId });
  }

  async deleteRequest(id: string): Promise<void> {
    await this.db.delete('requests', id);
    this.requests.update((list) => list.filter((r) => r.id !== id));
  }

  private async patchRequest(id: string, patch: Partial<SavedRequest>): Promise<void> {
    const r = this.requests().find((x) => x.id === id);
    if (!r || (patch.name !== undefined && !patch.name)) return;
    const updated = { ...r, ...patch, updatedAt: Date.now() };
    await this.db.put('requests', updated);
    this.requests.update((list) => list.map((x) => (x.id === id ? updated : x)));
  }

  /** Bulk insert used by import and demo seeding. */
  async insertAll(collections: Collection[], folders: Folder[], requests: SavedRequest[]): Promise<void> {
    await Promise.all([this.db.putMany('collections', collections), this.db.putMany('folders', folders), this.db.putMany('requests', requests)]);
    await this.load();
  }
}
