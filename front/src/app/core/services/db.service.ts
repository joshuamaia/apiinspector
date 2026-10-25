import { Injectable } from '@angular/core';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Collection, Folder, SavedRequest, EncryptedBlob } from '../models/collection.model';
import type { ContractBaseline } from '../models/drift.model';
import type { ExecutionRecord } from '../models/execution.model';
import type { Flow } from '../models/flow.model';

/** Flow as persisted: node secrets are encrypted separately. */
export interface StoredFlow extends Flow {
  secrets?: EncryptedBlob | null;
}

interface InspectorDB extends DBSchema {
  collections: { key: string; value: Collection };
  folders: { key: string; value: Folder; indexes: { byCollection: string } };
  requests: { key: string; value: SavedRequest; indexes: { byCollection: string } };
  history: { key: string; value: ExecutionRecord; indexes: { byCreatedAt: number } };
  flows: { key: string; value: StoredFlow };
  baselines: { key: string; value: ContractBaseline };
  kv: { key: string; value: unknown };
}

export type StoreName = 'collections' | 'folders' | 'requests' | 'history' | 'flows' | 'baselines' | 'kv';

const DB_NAME = 'api-inspector';
const DB_VERSION = 1;

/** Thin typed wrapper over IndexedDB (via `idb`). */
@Injectable({ providedIn: 'root' })
export class DbService {
  private dbPromise: Promise<IDBPDatabase<InspectorDB>> | null = null;

  private db(): Promise<IDBPDatabase<InspectorDB>> {
    this.dbPromise ??= openDB<InspectorDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('collections', { keyPath: 'id' });
        db.createObjectStore('folders', { keyPath: 'id' }).createIndex('byCollection', 'collectionId');
        db.createObjectStore('requests', { keyPath: 'id' }).createIndex('byCollection', 'collectionId');
        db.createObjectStore('history', { keyPath: 'id' }).createIndex('byCreatedAt', 'createdAt');
        db.createObjectStore('flows', { keyPath: 'id' });
        db.createObjectStore('baselines', { keyPath: 'id' });
        db.createObjectStore('kv');
      },
    });
    return this.dbPromise;
  }

  async all<S extends Exclude<StoreName, 'kv'>>(store: S): Promise<InspectorDB[S]['value'][]> {
    return (await this.db()).getAll(store);
  }

  async get<S extends Exclude<StoreName, 'kv'>>(store: S, id: string): Promise<InspectorDB[S]['value'] | undefined> {
    return (await this.db()).get(store, id);
  }

  async put<S extends Exclude<StoreName, 'kv'>>(store: S, value: InspectorDB[S]['value']): Promise<void> {
    await (await this.db()).put(store, value as never);
  }

  async putMany<S extends Exclude<StoreName, 'kv'>>(store: S, values: InspectorDB[S]['value'][]): Promise<void> {
    const tx = (await this.db()).transaction(store, 'readwrite');
    await Promise.all([...values.map((v) => tx.store.put(v as never)), tx.done]);
  }

  async delete(store: Exclude<StoreName, 'kv'>, id: string): Promise<void> {
    await (await this.db()).delete(store, id);
  }

  async deleteMany(store: Exclude<StoreName, 'kv'>, ids: string[]): Promise<void> {
    if (!ids.length) return;
    const tx = (await this.db()).transaction(store, 'readwrite');
    await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
  }

  async clear(store: StoreName): Promise<void> {
    await (await this.db()).clear(store);
  }

  /** History ids ordered from newest to oldest. */
  async historyIdsNewestFirst(): Promise<string[]> {
    const db = await this.db();
    const ids: string[] = [];
    let cursor = await db.transaction('history').store.index('byCreatedAt').openKeyCursor(null, 'prev');
    while (cursor) {
      ids.push(cursor.primaryKey);
      cursor = await cursor.continue();
    }
    return ids;
  }

  async getKv<T>(key: string): Promise<T | undefined> {
    return (await (await this.db()).get('kv', key)) as T | undefined;
  }

  async setKv(key: string, value: unknown): Promise<void> {
    await (await this.db()).put('kv', value, key);
  }

  async deleteKv(key: string): Promise<void> {
    await (await this.db()).delete('kv', key);
  }
}
