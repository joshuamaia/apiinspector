import { Injectable, inject } from '@angular/core';
import type { Collection, ExportBundle, Folder, SavedRequest } from '../models/collection.model';
import type { ContractBaseline } from '../models/drift.model';
import type { Flow } from '../models/flow.model';
import { CollectionsStore } from '../state/collections.store';
import { DriftStore } from '../state/drift.store';
import { FlowsStore } from '../state/flows.store';
import { uid } from '../utils/id';
import { blankRedacted, stripSecrets } from '../utils/request';
import { demoBaseline, demoCollections, demoFlow } from '../demo/demo-data';

export class ImportError extends Error {}

export interface ImportSummary {
  collections: number;
  requests: number;
  flows: number;
  baselines: number;
}

/** Import / export in the application's own JSON format. Secrets are never exported. */
@Injectable({ providedIn: 'root' })
export class ImportExportService {
  private readonly collections = inject(CollectionsStore);
  private readonly flows = inject(FlowsStore);
  private readonly drift = inject(DriftStore);

  /** Builds an export bundle. Pass a collection id to export a single collection. */
  async buildExport(collectionId?: string, includeExtras = true): Promise<ExportBundle> {
    const collections = this.collections.collections().filter((c) => !collectionId || c.id === collectionId);
    const ids = new Set(collections.map((c) => c.id));
    const requests = this.collections
      .requests()
      .filter((r) => ids.has(r.collectionId))
      .map(({ secrets: _secrets, ...r }) => ({ ...r, ...blankRedacted(stripSecrets(r)) }));
    return {
      format: 'api-inspector',
      version: 1,
      exportedAt: new Date().toISOString(),
      collections,
      folders: this.collections.folders().filter((f) => ids.has(f.collectionId)),
      requests,
      ...(includeExtras && !collectionId
        ? {
            flows: this.flows.flows().map((f) => ({ ...f, nodes: f.nodes.map((n) => ({ ...n, request: blankRedacted(stripSecrets(n.request)) })) })),
            baselines: this.drift.baselines(),
          }
        : {}),
    };
  }

  /** Validates and imports a bundle. New ids are generated so nothing is overwritten. */
  async import(text: string): Promise<ImportSummary> {
    let data: Partial<ExportBundle>;
    try {
      data = JSON.parse(text);
    } catch {
      throw new ImportError('The file is not valid JSON');
    }
    if (data?.format !== 'api-inspector' || data.version !== 1) {
      throw new ImportError('Unsupported file: expected an API Inspector export (format "api-inspector", version 1)');
    }
    if (!Array.isArray(data.collections) || !Array.isArray(data.requests) || !Array.isArray(data.folders)) {
      throw new ImportError('Malformed export: collections, folders and requests must be arrays');
    }

    const colIds = new Map<string, string>();
    const folderIds = new Map<string, string>();
    const collections: Collection[] = data.collections.map((c) => {
      const id = uid();
      colIds.set(c.id, id);
      return { id, name: String(c.name ?? 'Imported'), description: String(c.description ?? ''), createdAt: Date.now() };
    });
    for (const f of data.folders) folderIds.set(f.id, uid());
    const folders: Folder[] = data.folders
      .filter((f) => colIds.has(f.collectionId))
      .map((f) => ({ id: folderIds.get(f.id)!, collectionId: colIds.get(f.collectionId)!, parentId: f.parentId ? (folderIds.get(f.parentId) ?? null) : null, name: String(f.name), createdAt: Date.now() }));
    const requests: SavedRequest[] = data.requests
      .filter((r) => colIds.has(r.collectionId) && typeof r.url === 'string' && typeof r.method === 'string')
      .map((r) => ({ ...r, id: uid(), collectionId: colIds.get(r.collectionId)!, folderId: r.folderId ? (folderIds.get(r.folderId) ?? null) : null, secrets: null, favorite: !!r.favorite }));
    await this.collections.insertAll(collections, folders, requests);

    let flows = 0;
    for (const f of (data.flows ?? []) as Flow[]) {
      if (!Array.isArray(f?.nodes) || !Array.isArray(f?.edges)) continue;
      await this.flows.upsert({ ...f, id: uid(), demo: undefined });
      flows++;
    }
    let baselines = 0;
    for (const b of (data.baselines ?? []) as ContractBaseline[]) {
      if (!Array.isArray(b?.fields)) continue;
      await this.drift.save({ ...b, id: uid(), demo: undefined });
      baselines++;
    }
    return { collections: collections.length, requests: requests.length, flows, baselines };
  }

  /** (Re)creates the demonstration collections, flow and baseline (fixed ids: idempotent). */
  async loadDemo(): Promise<void> {
    const { collections, folders, requests } = demoCollections();
    await this.collections.insertAll(collections, folders, requests);
    await this.flows.upsert(demoFlow());
    await this.drift.save(demoBaseline());
  }
}
